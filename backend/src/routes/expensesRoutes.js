import expensesController from '../controllers/expensesController.js';

export default async function expensesRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:create')],
    handler: expensesController.create.bind(expensesController),
    schema: {
      description: 'Record a new expense',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:read')],
    handler: expensesController.getAll.bind(expensesController),
    schema: {
      description: 'List expenses (branch-scoped, paginated)',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/summary', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:read')],
    handler: expensesController.summary.bind(expensesController),
    schema: {
      description:
        'Aggregated expense summary by date range, branch, category, currency.',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:read')],
    handler: expensesController.getById.bind(expensesController),
    schema: {
      description: 'Get expense by id',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:update')],
    handler: expensesController.update.bind(expensesController),
    schema: {
      description: 'Update expense',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('expenses:delete')],
    handler: expensesController.delete.bind(expensesController),
    schema: {
      description: 'Delete expense',
      tags: ['expenses'],
      security: [{ bearerAuth: [] }],
    },
  });
}
