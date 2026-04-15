import backupController from '../controllers/backupController.js';

export default async function backupRoutes(fastify) {
  fastify.get('/', {
    schema: {
      tags: ['Settings'],
      summary: 'List available backups',
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: backupController.list,
  });

  fastify.post('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Create a new backup',
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:create')],
    handler: backupController.create,
  });

  fastify.delete('/:filename', {
    schema: {
      tags: ['Settings'],
      summary: 'Delete a backup',
      params: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
        },
        required: ['filename'],
      },
    },
    onRequest: [fastify.authenticate, fastify.authorize('settings:delete')],
    handler: backupController.delete,
  });
}
