import { getDb } from '../db.js';
import {
  warehouseTransfers,
  warehouses,
  products,
  users,
  branches,
} from '../models/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { ValidationError } from '../utils/errors.js';
import {
  isGlobalAdmin,
  enforceBranchScope,
  branchFilterFor,
} from './scopeService.js';
import warehouseService, { TRANSFER_ERRORS } from './warehouseService.js';
import { InventoryService } from './inventoryService.js';
import featureFlagsService from './featureFlagsService.js';
import alertBus from '../events/alertBus.js';
import auditService from './auditService.js';

/**
 * Approval-gated warehouse-to-warehouse transfer.
 *
 * Stock is only moved when a branch admin (or global admin) approves the
 * request. All approve/reject mutations go through a DB transaction.
 */
export class WarehouseTransferService {
  /**
   * Create a pending transfer request.
   * Transfers are same-branch only unless the caller is global_admin.
   */
  async create(payload, actingUser) {
    await featureFlagsService.requireFeature('warehouseTransfers');

    const { fromWarehouseId, toWarehouseId, productId, quantity, notes } = payload;
    if (!fromWarehouseId || !toWarehouseId) {
      const err = new ValidationError('Both source and destination warehouses are required');
      err.code = TRANSFER_ERRORS.WAREHOUSE_NOT_FOUND;
      throw err;
    }
    if (Number(fromWarehouseId) === Number(toWarehouseId)) {
      const err = new ValidationError('Source and destination warehouses must differ');
      err.code = TRANSFER_ERRORS.SAME_SOURCE_AND_DESTINATION;
      throw err;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity must be a positive integer');
    }

    // Both checks attach a stable `code` so the controller/UI can route the
    // error to the right field instead of a generic toast.
    const fromWh = await warehouseService.assertCanTransferFrom(fromWarehouseId, actingUser);
    const toWh = await warehouseService.assertCanTransferTo(toWarehouseId, fromWh, actingUser);

    const db = await getDb();

    // Transfer inherits the source branch — that's the branch whose admin will approve.
    const branchId = fromWh.branchId;

    const [row] = await db
      .insert(warehouseTransfers)
      .values({
        branchId,
        fromWarehouseId,
        toWarehouseId,
        productId,
        quantity,
        status: 'pending',
        requestedBy: actingUser?.id || null,
        notes: notes || null,
      })
      .returning();

    await auditService.log({
      userId: actingUser?.id,
      username: actingUser?.username,
      action: 'inventory:transfer_requested',
      resource: 'warehouse_transfers',
      resourceId: row.id,
      details: { fromWarehouseId, toWarehouseId, productId, quantity, branchId },
    });

    alertBus.emit('alerts.changed', 'inventory.transfer_requested');
    return row;
  }

  /**
   * List transfers with a branch-aware filter.
   * Branch-bound users only see their branch.
   */
  async list(actingUser, { status, page = 1, limit = 20 } = {}) {
    const db = await getDb();
    const conds = [];

    const allowedBranches = branchFilterFor(actingUser);
    if (allowedBranches) {
      if (allowedBranches.length === 0) return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      conds.push(eq(warehouseTransfers.branchId, allowedBranches[0]));
    }
    if (status) conds.push(eq(warehouseTransfers.status, status));

    let countQ = db.select({ count: sql`count(*)` }).from(warehouseTransfers);
    if (conds.length) countQ = countQ.where(and(...conds));
    const [countRow] = await countQ;
    const total = Number(countRow?.count || 0);

    const fromAlias = { ...warehouses };
    let q = db
      .select({
        id: warehouseTransfers.id,
        branchId: warehouseTransfers.branchId,
        branchName: branches.name,
        fromWarehouseId: warehouseTransfers.fromWarehouseId,
        toWarehouseId: warehouseTransfers.toWarehouseId,
        productId: warehouseTransfers.productId,
        productName: products.name,
        quantity: warehouseTransfers.quantity,
        status: warehouseTransfers.status,
        requestedBy: warehouseTransfers.requestedBy,
        requestedByName: users.username,
        approvedBy: warehouseTransfers.approvedBy,
        approvedAt: warehouseTransfers.approvedAt,
        rejectionReason: warehouseTransfers.rejectionReason,
        notes: warehouseTransfers.notes,
        createdAt: warehouseTransfers.createdAt,
      })
      .from(warehouseTransfers)
      .leftJoin(branches, eq(warehouseTransfers.branchId, branches.id))
      .leftJoin(products, eq(warehouseTransfers.productId, products.id))
      .leftJoin(users, eq(warehouseTransfers.requestedBy, users.id))
      .orderBy(desc(warehouseTransfers.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    if (conds.length) q = q.where(and(...conds));

    const data = await q;

    // Attach warehouse names with two separate queries to keep SQL simple.
    const whIds = Array.from(
      new Set(data.flatMap((r) => [r.fromWarehouseId, r.toWarehouseId]))
    );
    let whMap = {};
    if (whIds.length) {
      const whRows = await db
        .select({ id: warehouses.id, name: warehouses.name })
        .from(warehouses);
      whMap = Object.fromEntries(whRows.map((w) => [w.id, w.name]));
    }
    const enriched = data.map((r) => ({
      ...r,
      fromWarehouseName: whMap[r.fromWarehouseId] || null,
      toWarehouseName: whMap[r.toWarehouseId] || null,
    }));

    return { data: enriched, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getById(id, actingUser) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(warehouseTransfers)
      .where(eq(warehouseTransfers.id, id))
      .limit(1);
    if (!row) throw new NotFoundError('Transfer');
    enforceBranchScope(actingUser, row.branchId);
    return row;
  }

  async approve(id, actingUser) {
    const transfer = await this.getById(id, actingUser);
    if (transfer.status !== 'pending') {
      throw new ValidationError('Only pending transfers can be approved');
    }

    // Branch admins can only approve transfers in their own branch. Global
    // admins can approve anything. Plain users cannot approve at all — the
    // route guard enforces this via `approve_warehouse_transfer`.
    if (!isGlobalAdmin(actingUser)) {
      enforceBranchScope(actingUser, transfer.branchId);
    }

    const result = await InventoryService.withTransaction(async (tx) => {
      // `applyStockChangeTx` locks the (product, warehouse) row via
      // SELECT FOR UPDATE, so concurrent transfers are serialised at the
      // product_stock row level.
      await InventoryService.applyStockChangeTx(tx, {
        productId: transfer.productId,
        warehouseId: transfer.fromWarehouseId,
        quantityChange: -transfer.quantity,
        movementType: 'transfer_out',
        referenceType: 'transfer',
        referenceId: transfer.id,
        notes: transfer.notes,
        userId: actingUser?.id || null,
      });
      await InventoryService.applyStockChangeTx(tx, {
        productId: transfer.productId,
        warehouseId: transfer.toWarehouseId,
        quantityChange: transfer.quantity,
        movementType: 'transfer_in',
        referenceType: 'transfer',
        referenceId: transfer.id,
        notes: transfer.notes,
        userId: actingUser?.id || null,
      });

      const [updated] = await tx
        .update(warehouseTransfers)
        .set({
          status: 'approved',
          approvedBy: actingUser?.id || null,
          approvedAt: new Date(),
        })
        .where(eq(warehouseTransfers.id, id))
        .returning();
      return updated;
    });

    await auditService.log({
      userId: actingUser?.id,
      username: actingUser?.username,
      action: 'inventory:transfer_approved',
      resource: 'warehouse_transfers',
      resourceId: id,
      details: { fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, quantity: transfer.quantity },
    });

    alertBus.emit('alerts.changed', 'inventory.transfer_approved');
    return result;
  }

  async reject(id, reason, actingUser) {
    const transfer = await this.getById(id, actingUser);
    if (transfer.status !== 'pending') {
      throw new ValidationError('Only pending transfers can be rejected');
    }
    if (!isGlobalAdmin(actingUser)) {
      enforceBranchScope(actingUser, transfer.branchId);
    }

    const db = await getDb();
    const [updated] = await db
      .update(warehouseTransfers)
      .set({
        status: 'rejected',
        approvedBy: actingUser?.id || null,
        approvedAt: new Date(),
        rejectionReason: reason || null,
      })
      .where(eq(warehouseTransfers.id, id))
      .returning();

    await auditService.log({
      userId: actingUser?.id,
      username: actingUser?.username,
      action: 'inventory:transfer_rejected',
      resource: 'warehouse_transfers',
      resourceId: id,
      details: { reason: reason || null },
    });

    alertBus.emit('alerts.changed', 'inventory.transfer_rejected');
    return updated;
  }
}

export default new WarehouseTransferService();
