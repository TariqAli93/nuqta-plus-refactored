import { SaleController } from '../controllers/saleController.js';

const saleController = new SaleController();

export default async function saleRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:create')],
    handler: saleController.create,
    schema: {
      description: 'Create new sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.getAll,
    schema: {
      description: 'Get all sales',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/report', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.getSalesReport,
    schema: {
      description: 'Get sales report',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          currency: { type: 'string' },
        },
      },
    },
  });

  fastify.get('/top-products', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.getTopProducts,
    schema: {
      description: 'Get top selling products',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 5 },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
      },
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.getById,
    schema: {
      description: 'Get sale by ID',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/cancel', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:delete')],
    handler: saleController.cancel,
    schema: {
      description: 'Cancel sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:delete')],
    handler: saleController.removeSale,
    schema: {
      description: 'Remove sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/restore', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:update')],
    handler: saleController.restoreSale,
    schema: {
      description: 'Restore cancelled sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:saleId/payment', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:update')],
    handler: saleController.addPayment,
    schema: {
      description: 'Add payment to sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:saleId/payments/:paymentId', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:update')],
    handler: saleController.removePayment,
    schema: {
      description: 'Remove payment from sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/currency/exchange-rates', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.getExchangeRates,
    schema: {
      description: 'Get exchange rates for all currencies',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/currency/convert', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: saleController.convertAmount,
    schema: {
      description: 'Convert amount between currencies',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/draft', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:create')],
    handler: saleController.createDraft,
    schema: {
      description: 'Create draft sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/draft/:id/complete', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:create')],
    handler: saleController.completeDraft,
    schema: {
      description: 'Complete draft sale',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/drafts/old', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:delete')],
    handler: saleController.deleteOldDrafts,
    schema: {
      description: 'Delete old draft sales (older than 1 day)',
      tags: ['sales'],
      security: [{ bearerAuth: [] }],
    },
  });
}
