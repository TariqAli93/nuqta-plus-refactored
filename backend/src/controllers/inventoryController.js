import inventoryService from '../services/inventoryService.js';
import { stockAdjustmentSchema, stockTransferSchema } from '../utils/validation.js';

export class InventoryController {
  async getWarehouseStock(request, reply) {
    const warehouseId = Number(request.params.warehouseId);
    const { search, lowStockOnly } = request.query || {};
    const data = await inventoryService.getWarehouseStock(warehouseId, {
      search,
      lowStockOnly: lowStockOnly === 'true' || lowStockOnly === true,
    });
    return reply.send({ success: true, data });
  }

  async getProductTotals(request, reply) {
    const productId = Number(request.params.productId);
    const data = await inventoryService.getProductTotals(productId);
    return reply.send({ success: true, data });
  }

  async getStock(request, reply) {
    const productId = Number(request.params.productId);
    const warehouseId = Number(request.params.warehouseId);
    const quantity = await inventoryService.getStock(productId, warehouseId);
    return reply.send({ success: true, data: { productId, warehouseId, quantity } });
  }

  async adjustStock(request, reply) {
    const validated = stockAdjustmentSchema.parse(request.body);
    const data = await inventoryService.adjustStock({
      ...validated,
      userId: request.user.id,
    });
    return reply.code(201).send({ success: true, data, message: 'Stock adjusted' });
  }

  async transferStock(request, reply) {
    const validated = stockTransferSchema.parse(request.body);
    const data = await inventoryService.transferStock({
      ...validated,
      userId: request.user.id,
    });
    return reply.code(201).send({ success: true, data, message: 'Stock transferred' });
  }

  async getMovements(request, reply) {
    const { warehouseId, productId, movementType, page, limit } = request.query || {};
    const result = await inventoryService.getStockMovements({
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      productId: productId ? Number(productId) : undefined,
      movementType,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return reply.send({ success: true, data: result.data, meta: result.meta });
  }

  async getLowStock(request, reply) {
    const warehouseId = Number(request.query.warehouseId || request.params.warehouseId);
    const data = await inventoryService.getLowStockProducts(warehouseId);
    return reply.send({ success: true, data });
  }
}
