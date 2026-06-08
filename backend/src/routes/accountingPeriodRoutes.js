import accountingPeriodController from '../controllers/accountingPeriodController.js';

/**
 * Accounting period routes. Mounted under /api/accounting-periods.
 * Static segments (`/current`) come before dynamic `/:id`.
 */
export default async function accountingPeriodRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('accounting_periods:read')],
    handler: (req, reply) => accountingPeriodController.list(req, reply),
    schema: { description: 'List accounting periods', tags: ['accounting'], security: [{ bearerAuth: [] }] },
  });

  fastify.get('/current', {
    onRequest: [fastify.authenticate, fastify.authorize('accounting_periods:read')],
    handler: (req, reply) => accountingPeriodController.current(req, reply),
    schema: { description: 'Get the open accounting period for the caller scope', tags: ['accounting'], security: [{ bearerAuth: [] }] },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('accounting_periods:read')],
    handler: (req, reply) => accountingPeriodController.getById(req, reply),
    schema: { description: 'Get an accounting period with details', tags: ['accounting'], security: [{ bearerAuth: [] }] },
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('accounting_periods:open')],
    handler: (req, reply) => accountingPeriodController.open(req, reply),
    schema: { description: 'Open a new accounting period', tags: ['accounting'], security: [{ bearerAuth: [] }] },
  });

  fastify.post('/:id/close', {
    onRequest: [fastify.authenticate, fastify.authorize('accounting_periods:close')],
    handler: (req, reply) => accountingPeriodController.close(req, reply),
    schema: { description: 'Close an accounting period (computes + freezes snapshot)', tags: ['accounting'], security: [{ bearerAuth: [] }] },
  });
}
