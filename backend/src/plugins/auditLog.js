import fp from 'fastify-plugin';
import auditService from '../services/auditService.js';

/**
 * Automatic audit logging plugin.
 *
 * Hooks into onResponse for mutating methods (POST/PUT/PATCH/DELETE) and
 * writes a row to the audit_log table.  The route can opt out by setting
 * `config.skipAudit = true` in the route definition.
 *
 * The action string is derived from the HTTP method + the route URL:
 *   POST   /api/sales       → sale:create
 *   PUT    /api/products/5   → product:update
 *   DELETE /api/users/3      → user:delete
 */

const METHOD_TO_VERB = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Routes that should never be logged (infrastructure, health, etc.)
const SKIP_PREFIXES = ['/health', '/version', '/server-info', '/__shutdown__'];

/**
 * Derive a human-readable action string from method + URL.
 *   POST /api/sales → "sale:create"
 *   DELETE /api/products/5 → "product:delete"
 */
function deriveAction(method, url) {
  const verb = METHOD_TO_VERB[method];
  if (!verb) return null;

  // Strip query string
  const path = url.split('?')[0];

  // Match /api/<resource>[/<id>][/<sub>]
  const match = path.match(/^\/api\/([a-z-]+)/i);
  if (!match) return `${method.toLowerCase()}:${path}`;

  let resource = match[1];

  // Singularize common patterns
  if (resource.endsWith('ies')) {
    resource = resource.slice(0, -3) + 'y'; // categories → category
  } else if (resource.endsWith('es') && !resource.endsWith('ses')) {
    resource = resource.slice(0, -2); // — not used currently but future-safe
  } else if (resource.endsWith('s')) {
    resource = resource.slice(0, -1); // sales → sale, products → product
  }

  return `${resource}:${verb}`;
}

/**
 * Extract the resource ID from the URL if present.
 *   /api/products/42 → 42
 *   /api/sales → null
 */
function extractResourceId(url) {
  const path = url.split('?')[0];
  const match = path.match(/^\/api\/[a-z-]+\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function auditLogPlugin(fastify) {
  fastify.addHook('onResponse', async (request, reply) => {
    // Only log mutating methods
    if (!METHOD_TO_VERB[request.method]) return;

    // Skip infrastructure routes
    if (SKIP_PREFIXES.some((p) => request.url.startsWith(p))) return;

    // Allow per-route opt-out via route config
    if (request.routeOptions?.config?.skipAudit) return;

    // Skip failed requests (4xx/5xx) — we only log successful mutations
    if (reply.statusCode >= 400) return;

    const action = deriveAction(request.method, request.url);
    if (!action) return;

    try {
      await auditService.log({
        userId: request.user?.id || null,
        username: request.user?.username || null,
        action,
        resource: request.url.split('?')[0].match(/^\/api\/([a-z-]+)/i)?.[1] || null,
        resourceId: extractResourceId(request.url),
        ipAddress: request.ip,
      });
    } catch (err) {
      // Never let audit failures break the actual request
      request.log.error({ err }, 'Audit log write failed');
    }
  });
}

export default fp(auditLogPlugin);
