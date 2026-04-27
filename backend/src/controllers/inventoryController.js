import inventoryService from '../services/inventoryService.js';
import warehouseTransferService from '../services/warehouseTransferService.js';
import warehouseService from '../services/warehouseService.js';
import { stockAdjustmentSchema, stockTransferSchema } from '../utils/validation.js';
import {
  isGlobalAdmin,
  enforceWarehouseScope,
  branchFilterFor,
} from '../services/scopeService.js';
import { getDb } from '../db.js';
import { warehouses } from '../models/index.js';
import { eq, inArray } from 'drizzle-orm';

export class InventoryController {
  async getWarehouseStock(request, reply) {
    const warehouseId = Number(request.params.warehouseId);
    const { search, lowStockOnly } = request.query || {};
    await enforceWarehouseScope(request.user, warehouseId);
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
    await enforceWarehouseScope(request.user, warehouseId);
    const quantity = await inventoryService.getStock(productId, warehouseId);
    return reply.send({ success: true, data: { productId, warehouseId, quantity } });
  }

  async adjustStock(request, reply) {
    const validated = stockAdjustmentSchema.parse(request.body);
    await enforceWarehouseScope(request.user, validated.warehouseId);
    const data = await inventoryService.adjustStock({
      ...validated,
      userId: request.user.id,
    });
    return reply.code(201).send({ success: true, data, message: 'Stock adjusted' });
  }

  async transferStock(request, reply) {
    const validated = stockTransferSchema.parse(request.body);

    // Global admins can transfer immediately (bypass approval). Anyone else
    // must go through the approval flow by creating a transfer request.
    if (isGlobalAdmin(request.user)) {
      // Validate source/destination warehouses with the same explicit codes
      // the request flow uses, so even admin POSTs get a useful error when
      // the IDs are stale or inactive.
      const fromWh = await warehouseService.assertCanTransferFrom(
        validated.fromWarehouseId,
        request.user
      );
      await warehouseService.assertCanTransferTo(validated.toWarehouseId, fromWh, request.user);

      const data = await inventoryService.transferStock({
        ...validated,
        userId: request.user.id,
      });
      return reply.code(201).send({ success: true, data, message: 'Stock transferred' });
    }

    const request_ = await warehouseTransferService.create(validated, request.user);
    return reply
      .code(202)
      .send({ success: true, data: request_, message: 'Transfer request created (pending approval)' });
  }

  async getMovements(request, reply) {
    const { warehouseId, productId, movementType, page, limit } = request.query || {};

    // Derive a branch-scoped warehouse filter for non-global-admins.
    let warehouseIds;
    const allowedBranches = branchFilterFor(request.user);
    if (allowedBranches !== null) {
      if (allowedBranches.length === 0) {
        return reply.send({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
      }
      const db = await getDb();
      const rows = await db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.branchId, allowedBranches[0]));
      warehouseIds = rows.map((r) => r.id);
      if (warehouseId) {
        if (!warehouseIds.includes(Number(warehouseId))) {
          return reply.send({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
        }
        warehouseIds = [Number(warehouseId)];
      }
    }

    const result = await inventoryService.getStockMovements({
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      warehouseIds,
      productId: productId ? Number(productId) : undefined,
      movementType,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return reply.send({ success: true, data: result.data, meta: result.meta });
  }

  async getLowStock(request, reply) {
    const warehouseId = Number(request.query.warehouseId || request.params.warehouseId);
    await enforceWarehouseScope(request.user, warehouseId);
    const data = await inventoryService.getLowStockProducts(warehouseId);
    return reply.send({ success: true, data });
  }
}
