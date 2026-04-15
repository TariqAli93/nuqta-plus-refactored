import { CategoryController } from '../controllers/categoryController.js';

const categoryController = new CategoryController();

export default async function categoryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('categories:create')],
    handler: categoryController.create,
    schema: {
      description: 'Create new category',
      tags: ['categories'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('categories:read')],
    handler: categoryController.getAll,
    schema: {
      description: 'Get all categories',
      tags: ['categories'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('categories:read')],
    handler: categoryController.getById,
    schema: {
      description: 'Get category by ID',
      tags: ['categories'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('categories:update')],
    handler: categoryController.update,
    schema: {
      description: 'Update category',
      tags: ['categories'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('categories:delete')],
    handler: categoryController.delete,
    schema: {
      description: 'Delete category',
      tags: ['categories'],
      security: [{ bearerAuth: [] }],
    },
  });
}
