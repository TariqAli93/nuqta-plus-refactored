import { InventoryController } from '../controllers/inventoryController.js';

const inventoryController = new InventoryController();

export default async function inventoryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /inventory/warehouses/:warehouseId/stock — list all product stock rows for a warehouse
  fastify.get('/warehouses/:warehouseId/stock', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: inventoryController.getWarehouseStock,
    schema: {
      description: 'List product stock for a warehouse',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // GET /inventory/warehouses/:warehouseId/low-stock — low-stock products in a warehouse
  fastify.get('/warehouses/:warehouseId/low-stock', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: inventoryController.getLowStock,
    schema: {
      description: 'Low-stock products for a warehouse',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // GET /inventory/products/:productId/totals — total + per-warehouse breakdown
  fastify.get('/products/:productId/totals', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: inventoryController.getProductTotals,
    schema: {
      description: 'Get product totals across warehouses',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // GET /inventory/products/:productId/warehouses/:warehouseId — single stock read
  fastify.get('/products/:productId/warehouses/:warehouseId', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: inventoryController.getStock,
    schema: {
      description: 'Get stock for a product in a warehouse',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // POST /inventory/adjust — manual adjustment (in or out)
  fastify.post('/adjust', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:adjust')],
    handler: inventoryController.adjustStock,
    schema: {
      description: 'Manually adjust stock in a warehouse',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // POST /inventory/transfer — transfer between two warehouses
  fastify.post('/transfer', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:transfer')],
    handler: inventoryController.transferStock,
    schema: {
      description: 'Transfer stock between warehouses',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });

  // GET /inventory/movements — paginated stock movements with filters
  fastify.get('/movements', {
    onRequest: [fastify.authenticate, fastify.authorize('inventory:read')],
    handler: inventoryController.getMovements,
    schema: {
      description: 'List stock movements',
      tags: ['inventory'],
      security: [{ bearerAuth: [] }],
    },
  });
}
