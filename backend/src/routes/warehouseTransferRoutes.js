import { WarehouseTransferController } from '../controllers/warehouseTransferController.js';

const controller = new WarehouseTransferController();

export default async function warehouseTransferRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: controller.list,
    schema: {
      description: 'List warehouse transfer requests',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:transfer')],
    handler: controller.create,
    schema: {
      description: 'Request a warehouse transfer (requires approval)',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: controller.getById,
    schema: {
      description: 'Get transfer request',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/approve', {
    onRequest: [fastify.authenticate, fastify.authorize('approve_warehouse_transfer')],
    handler: controller.approve,
    schema: {
      description: 'Approve pending transfer',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/reject', {
    onRequest: [fastify.authenticate, fastify.authorize('approve_warehouse_transfer')],
    handler: controller.reject,
    schema: {
      description: 'Reject pending transfer',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });
}
