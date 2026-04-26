import { getDb } from '../db.js';
import { branches, warehouses } from '../models/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { eq, desc, inArray, sql } from 'drizzle-orm';
import { branchFilterFor } from './scopeService.js';

/**
 * Validate that `warehouseId` exists, is active, and belongs to `branchId`.
 * Used when setting `branches.defaultWarehouseId` so we never wire up a
 * default that the user can't actually use.
 */
async function assertWarehouseBelongsToBranch(db, warehouseId, branchId) {
  if (warehouseId == null) return;
  const [wh] = await db
    .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!wh) throw new ValidationError('Default warehouse not found');
  if (wh.branchId != null && Number(wh.branchId) !== Number(branchId)) {
    throw new ValidationError('Default warehouse must belong to the same branch');
  }
  if (wh.isActive === false) {
    throw new ValidationError('Default warehouse must be active');
  }
}

export class BranchService {
  async getAll(actingUser = null) {
    const db = await getDb();
    const allowed = branchFilterFor(actingUser);

    let q = db
      .select({
        id: branches.id,
        name: branches.name,
        address: branches.address,
        isActive: branches.isActive,
        defaultWarehouseId: branches.defaultWarehouseId,
        createdAt: branches.createdAt,
        warehouseCount: sql`(SELECT COUNT(*) FROM warehouses w WHERE w.branch_id = ${branches.id})`.as('warehouseCount'),
      })
      .from(branches)
      .orderBy(desc(branches.createdAt));

    if (allowed !== null) {
      if (allowed.length === 0) return [];
      q = q.where(inArray(branches.id, allowed));
    }
    return await q;
  }

  async getById(id) {
    const db = await getDb();
    const [branch] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  /**
   * Resolve the active warehouse for a branch.
   * Falls back to the first active warehouse on the branch when no default
   * is configured. Returns `{ warehouseId, isDefault, hasDefault }` so the
   * caller can warn the admin about a missing default.
   */
  async resolveActiveWarehouse(branchId) {
    if (!branchId) return { warehouseId: null, isDefault: false, hasDefault: false };
    const db = await getDb();
    const [branch] = await db
      .select({ id: branches.id, defaultWarehouseId: branches.defaultWarehouseId })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    if (!branch) return { warehouseId: null, isDefault: false, hasDefault: false };

    if (branch.defaultWarehouseId) {
      const [wh] = await db
        .select({ id: warehouses.id, isActive: warehouses.isActive, branchId: warehouses.branchId })
        .from(warehouses)
        .where(eq(warehouses.id, branch.defaultWarehouseId))
        .limit(1);
      if (wh && wh.isActive !== false && Number(wh.branchId) === Number(branchId)) {
        return { warehouseId: wh.id, isDefault: true, hasDefault: true };
      }
    }

    const [first] = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(sql`${warehouses.branchId} = ${branchId} AND ${warehouses.isActive} = true`)
      .limit(1);
    return {
      warehouseId: first?.id || null,
      isDefault: false,
      hasDefault: !!branch.defaultWarehouseId,
    };
  }

  async create(data) {
    const db = await getDb();
    const [existing] = await db
      .select()
      .from(branches)
      .where(eq(branches.name, data.name))
      .limit(1);
    if (existing) throw new ConflictError('Branch name already exists');

    const [row] = await db
      .insert(branches)
      .values({
        name: data.name,
        address: data.address || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      })
      .returning();

    // Default warehouse is set after creation since the warehouse must already
    // exist and reference this branch. Callers that send `defaultWarehouseId`
    // on create must have provisioned the warehouse first.
    if (data.defaultWarehouseId) {
      await assertWarehouseBelongsToBranch(db, data.defaultWarehouseId, row.id);
      const [updated] = await db
        .update(branches)
        .set({ defaultWarehouseId: data.defaultWarehouseId })
        .where(eq(branches.id, row.id))
        .returning();
      return updated;
    }
    return row;
  }

  async update(id, data) {
    const db = await getDb();
    if (data.defaultWarehouseId !== undefined && data.defaultWarehouseId !== null) {
      await assertWarehouseBelongsToBranch(db, data.defaultWarehouseId, id);
    }
    const [row] = await db
      .update(branches)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.defaultWarehouseId !== undefined
          ? { defaultWarehouseId: data.defaultWarehouseId }
          : {}),
      })
      .where(eq(branches.id, id))
      .returning();
    if (!row) throw new NotFoundError('Branch');
    return row;
  }

  async delete(id) {
    const db = await getDb();
    // Soft-delete only if warehouses are linked. Otherwise allow hard delete.
    const [wh] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.branchId, id))
      .limit(1);
    if (wh) {
      await db.update(branches).set({ isActive: false }).where(eq(branches.id, id));
      return { message: 'Branch deactivated (has warehouses)' };
    }
    const [deleted] = await db.delete(branches).where(eq(branches.id, id)).returning();
    if (!deleted) throw new NotFoundError('Branch');
    return { message: 'Branch deleted' };
  }
}

export default new BranchService();
