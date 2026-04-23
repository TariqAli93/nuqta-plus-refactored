import { WarehouseController } from '../controllers/warehouseController.js';

const warehouseController = new WarehouseController();

export default async function warehouseRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: warehouseController.getAll,
    schema: { description: 'List warehouses', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: warehouseController.getById,
    schema: { description: 'Get warehouse by id', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: warehouseController.create,
    schema: { description: 'Create warehouse', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: warehouseController.update,
    schema: { description: 'Update warehouse', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: warehouseController.delete,
    schema: { description: 'Delete warehouse', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });
}
