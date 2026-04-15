import { AlertController } from '../controllers/alertController.js';

const alertController = new AlertController();

export default async function alertRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: alertController.getAlerts,
    schema: {
      description: 'Get all alerts (overdue installments, low stock, out of stock)',
      tags: ['alerts'],
      security: [{ bearerAuth: [] }],
    },
  });
}
