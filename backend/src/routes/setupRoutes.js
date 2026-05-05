import { getSetupStatus, runFirstRun } from '../services/setupService.js';
import { getDiagnostics } from '../db.js';

/**
 * Whether the diagnostics endpoint should expose detailed payload to the
 * caller. Detailed mode is enabled in:
 *   - non-production (NODE_ENV !== 'production')
 *   - server-mode installs that explicitly opt in via NUQTA_DEBUG_DIAGNOSTICS=1
 *
 * In every other case the endpoint still responds, but returns only the
 * compact `summary` block — no candidate paths, no error stacks.
 */
function diagnosticsAllowed() {
  if (process.env.NODE_ENV !== 'production') return true;
  if (process.env.NUQTA_DEBUG_DIAGNOSTICS === '1') return true;
  return false;
}

export default async function setupRoutes(fastify) {
  // GET /api/setup/status — public, used by the SPA on every cold load.
  // Frontend treats `setupRequired === true` as the single signal to route
  // to FirstRun; backend is authoritative.
  fastify.get('/status', async () => {
    const status = await getSetupStatus();
    fastify.log.info(
      { reason: status.reason, setupRequired: status.setupRequired },
      `[bootstrap] /api/setup/status: ${status.reason}`
    );
    return status;
  });

  // GET /api/setup/diagnostics — verbose bootstrap state. Public so that an
  // operator can hit it on a fresh install before any admin user exists,
  // but credentials are masked and detailed payload only exposed in
  // dev/debug-enabled installs.
  fastify.get('/diagnostics', async () => {
    const detailed = diagnosticsAllowed();
    const full = getDiagnostics();
    if (detailed) return full;
    return {
      summary: full.summary,
      requiredTables: full.requiredTables,
      maskedDatabaseUrl: full.maskedDatabaseUrl,
      schemaReady: full.schemaReady,
      reason: full.reason,
      reasonDetails: full.reasonDetails,
    };
  });

  // POST /api/setup/first-run — public so it's reachable from a fresh,
  // user-less install. The service rejects the call when setup is already
  // complete, so a leaked endpoint cannot overwrite admin credentials.
  fastify.post(
    '/first-run',
    {
      config: {
        // Don't include the password body in the audit log payload.
        skipAuditBody: true,
        rateLimit: {
          max: 5,
          timeWindow: '5 minutes',
        },
      },
      schema: {
        description: 'Initialize the system with the first admin user and company defaults',
        tags: ['setup'],
        body: {
          type: 'object',
          required: ['username', 'password', 'fullName'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
            fullName: { type: 'string' },
            phone: { type: 'string' },
            company: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                city: { type: 'string' },
                area: { type: 'string' },
                street: { type: 'string' },
                phone: { type: 'string' },
                phone2: { type: 'string' },
                invoiceType: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await runFirstRun(request.body, { ipAddress: request.ip });
      return reply.code(201).send(result);
    }
  );
}
