import { ResetController } from '../controllers/resetController.js';

const resetController = new ResetController();

export default async function resetRoutes(fastify) {
  fastify.post('/database', {
    onRequest: [fastify.authenticate],
    handler: resetController.resetDatabase,
    schema: {
      description: 'Reset the database',
      tags: ['reset'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            success: { type: 'boolean' },
          },
        },
        500: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  });
}
