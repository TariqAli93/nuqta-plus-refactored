import { BranchController } from '../controllers/branchController.js';

const branchController = new BranchController();

export default async function branchRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: branchController.getAll,
    schema: { description: 'List branches', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: branchController.getById,
    schema: { description: 'Get branch by id', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: branchController.create,
    schema: { description: 'Create branch', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: branchController.update,
    schema: { description: 'Update branch', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:manage')],
    handler: branchController.delete,
    schema: { description: 'Delete branch', tags: ['inventory'], security: [{ bearerAuth: [] }] },
  });
}
