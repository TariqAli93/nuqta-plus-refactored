import { CustomerController } from '../controllers/customerController.js';

const customerController = new CustomerController();

export default async function customerRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:create')],
    handler: customerController.create,
    schema: {
      description: 'Create new customer',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getAll,
    schema: {
      description: 'Get all customers',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          limit: { type: 'number' },
          search: { type: 'string' },
        },
      },
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getById,
    schema: {
      description:
        'Get customer by ID. Pass `?include=profile` to receive the full profile payload (financial summary, sales, installments, payments, debt timeline).',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'number' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          include: {
            type: 'string',
            description: "Comma-separated includes. Supported: 'profile' (alias 'details').",
          },
        },
      },
    },
  });

  fastify.get('/:id/profile', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getProfile,
    schema: {
      description:
        'Get the full customer profile: basic info, financial summary, sales/invoices, installments, payments, and debt timeline. Branch-scoped: non-global-admins only see customers active in their assigned branch.',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'number' },
        },
      },
    },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:update')],
    handler: customerController.update,
    schema: {
      description: 'Update customer',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:delete')],
    handler: customerController.delete,
    schema: {
      description: 'Delete customer',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id/credit', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getCreditSnapshot,
    schema: {
      description: "Get customer's cached credit score & recommended limit",
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/credit/recalculate', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:update')],
    handler: customerController.recalculateCreditScore,
    schema: {
      description: 'Recalculate one customer’s credit score on demand',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id/credit-score', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getCreditRiskAssessment,
    schema: {
      description:
        'Hybrid credit-risk assessment: returns probability, level, reasons, and feature breakdown for the customer.',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'number' } },
      },
    },
  });
}
