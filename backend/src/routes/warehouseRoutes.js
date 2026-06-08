import { WarehouseController } from '../controllers/warehouseController.js';

const warehouseController = new WarehouseController();

export default async function warehouseRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: warehouseController.getAll,
    schema: { description: 'List warehouses', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  // Stock-transfer destination list. The default `GET /warehouses` is narrowed
  // by POS/inventory scope; this endpoint returns the wider list of valid
  // transfer destinations within the caller's branch.
  fastify.get('/transfer-targets', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: warehouseController.getTransferTargets,
    schema: {
      description: 'List warehouses valid as transfer destinations',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: warehouseController.getById,
    schema: { description: 'Get warehouse by id', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  // Idempotent self-heal: ensure a default warehouse exists (used when branch
  // management is off and none was ever created). Declared before `/:id` write
  // routes; GET `/:id` won't shadow a POST, but keeping literal paths grouped
  // makes the routing intent obvious.
  fastify.post('/ensure-default', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: warehouseController.ensureDefault,
    schema: {
      description: 'Ensure a default warehouse exists',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
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
