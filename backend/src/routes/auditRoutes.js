import auditController from '../controllers/auditController.js';

export default async function auditRoutes(fastify) {
  fastify.get('/', {
    schema: {
      tags: ['Audit'],
      summary: 'List audit logs with pagination and filters',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          userId: { type: 'integer' },
          action: { type: 'string' },
          resource: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          search: { type: 'string' },
        },
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('audit:read')],
    handler: auditController.list,
  });

  fastify.get('/actions', {
    schema: {
      tags: ['Audit'],
      summary: 'Get distinct action types for filters',
    },
    onRequest: [fastify.authenticate, fastify.authorize('audit:read')],
    handler: auditController.getActions,
  });

  fastify.delete('/purge', {
    schema: {
      tags: ['Audit'],
      summary: 'Purge audit logs older than N days',
      body: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1 },
        },
        required: ['days'],
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('audit:delete')],
    handler: auditController.purge,
  });
}
