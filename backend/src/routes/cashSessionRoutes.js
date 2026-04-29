import { CashSessionController } from '../controllers/cashSessionController.js';

const cashSessionController = new CashSessionController();

/**
 * Cash session / shift closing routes. Mounted under /api/cash-sessions.
 *
 * Route ordering: keep static segments (`/current`) before dynamic `/:id`,
 * the same convention used by saleRoutes.
 */
export default async function cashSessionRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/open', {
    onRequest: [fastify.authenticate, fastify.authorize('cash_sessions:open')],
    handler: (req, reply) => cashSessionController.open(req, reply),
    schema: {
      description: 'Open a new cash session for the current user',
      tags: ['cash-sessions'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/current', {
    onRequest: [fastify.authenticate, fastify.authorize('cash_sessions:read')],
    handler: (req, reply) => cashSessionController.getCurrent(req, reply),
    schema: {
      description: 'Get the current open cash session for the acting user',
      tags: ['cash-sessions'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('cash_sessions:read')],
    handler: (req, reply) => cashSessionController.list(req, reply),
    schema: {
      description: 'List cash sessions',
      tags: ['cash-sessions'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
          status: { type: 'string', enum: ['open', 'closed'] },
          userId: { type: 'number' },
          branchId: { type: 'number' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
      },
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('cash_sessions:read')],
    handler: (req, reply) => cashSessionController.getById(req, reply),
    schema: {
      description: 'Get cash session by id',
      tags: ['cash-sessions'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/close', {
    onRequest: [fastify.authenticate, fastify.authorize('cash_sessions:close')],
    handler: (req, reply) => cashSessionController.close(req, reply),
    schema: {
      description: 'Close a cash session and record variance',
      tags: ['cash-sessions'],
      security: [{ bearerAuth: [] }],
    },
  });
}
