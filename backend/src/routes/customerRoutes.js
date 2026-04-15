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
      description: 'Get customer by ID',
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
}
