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

  // Smart credit decision — pre-check whether a proposed installment sale
  // should be allowed for this customer. Read-only.
  fastify.post('/:id/credit/check-installment', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.checkInstallmentDecision.bind(customerController),
    schema: {
      description:
        'Smart credit decision for a proposed installment sale (allowed/risk/reason/suggestions).',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'number' } } },
      body: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          branchId: { type: 'number' },
        },
        required: ['amount'],
      },
    },
  });

  // Aging buckets for one customer's overdue installments.
  fastify.get('/:id/aging', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: customerController.getAging.bind(customerController),
    schema: {
      description: 'Receivables aging buckets for the customer (0-7, 8-30, 31-60, 61+).',
      tags: ['customers'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'number' } } },
    },
  });
}
