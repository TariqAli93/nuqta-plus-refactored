import { ProductController } from '../controllers/productController.js';

const productController = new ProductController();

export default async function productRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize('products:create')],
    handler: productController.create,
    schema: {
      description: 'Create new product',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('products:read')],
    handler: productController.getAll,
    schema: {
      description: 'Get all products',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/low-stock', {
    onRequest: [fastify.authenticate, fastify.authorize('products:read')],
    handler: productController.getLowStock,
    schema: {
      description: 'Get low stock products',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('products:read')],
    handler: productController.getById,
    schema: {
      description: 'Get product by ID',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('products:update')],
    handler: productController.update,
    schema: {
      description: 'Update product',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize('products:delete')],
    handler: productController.delete,
    schema: {
      description: 'Delete product',
      tags: ['products'],
      security: [{ bearerAuth: [] }],
    },
  });
}
