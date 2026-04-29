import { and, eq } from 'drizzle-orm';
import { getDb } from '../db.js';
import { idempotencyKeys } from '../models/index.js';
import { ValidationError } from './errors.js';

/**
 * Idempotency wrapper for write endpoints.
 *
 * Clients send `Idempotency-Key: <uuid>` (or any non-empty token) on POST/
 * DELETE requests. The first successful response is persisted in the
 * `idempotency_keys` table keyed by (key, scope); any later request with the
 * same key+scope short-circuits and replays the cached response.
 *
 * Scope is the route handler's logical name (e.g. `sales:create`,
 * `sales:add-payment`). Keys are isolated per scope so a UUID reused by a
 * client across endpoints doesn't collide.
 *
 * Behaviour:
 *   - No header → handler runs normally, no caching.
 *   - Cache hit → cached body and HTTP status are sent verbatim.
 *   - Cache miss + handler success (2xx) → response is captured and stored.
 *     Tap into `reply.send(...)` so the controller code stays unchanged.
 *   - Handler error → not cached; the next retry will run the handler again.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {string} scope
 * @param {() => Promise<unknown>} handler
 */
export async function withIdempotency(request, reply, scope, handler) {
  const headerKey =
    request.headers['idempotency-key'] || request.headers['x-idempotency-key'];
  const key = typeof headerKey === 'string' ? headerKey.trim() : '';

  if (!key) {
    return handler();
  }
  if (key.length > 200) {
    throw new ValidationError('Idempotency-Key must be 200 characters or fewer');
  }

  const db = await getDb();

  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope)))
    .limit(1);

  if (existing) {
    reply.header('Idempotent-Replayed', 'true');
    return reply.code(existing.statusCode || 200).send(existing.response);
  }

  // Capture the response body the controller sends. Fastify exposes
  // reply.send() as the only way handlers return data, so we wrap it once.
  let captured;
  let captureCode = 200;
  const originalSend = reply.send.bind(reply);
  reply.send = (payload) => {
    captured = payload;
    captureCode = reply.statusCode || 200;
    return originalSend(payload);
  };

  try {
    const result = await handler();
    // Some handlers `return reply.send(...)`; others `return value`. If we
    // didn't capture via send(), treat the returned value as the body.
    if (captured === undefined && result !== undefined && result !== reply) {
      captured = result;
      captureCode = reply.statusCode || 200;
    }

    if (captured !== undefined && captureCode >= 200 && captureCode < 300) {
      try {
        await db
          .insert(idempotencyKeys)
          .values({
            key,
            scope,
            userId: request.user?.id || null,
            response: captured,
            statusCode: captureCode,
          })
          .onConflictDoNothing({
            target: [idempotencyKeys.key, idempotencyKeys.scope],
          });
      } catch (err) {
        // Caching failures must never break a successful write.
        request.log?.warn({ err }, '[idempotency] failed to persist key');
      }
    }
    return result;
  } finally {
    reply.send = originalSend;
  }
}
