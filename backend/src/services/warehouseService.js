import { getDb } from '../db.js';
import { warehouses, branches, productStock } from '../models/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { isGlobalAdmin, branchFilterFor } from './scopeService.js';
import featureFlagsService from './featureFlagsService.js';

export class WarehouseService {
  /**
   * List warehouses, scoped by the acting user.
   *
   * Behavior depends on the `multiBranch` feature flag:
   *  - enabled: warehouses are filtered by branch (and the caller's allowed
   *    branches). Branch-bound users only see their assigned branch.
   *  - disabled: warehouses are global. The `branchId` filter is ignored.
   */
  async getAll({ branchId, activeOnly = false } = {}, actingUser = null) {
    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchFeatureOn = flags.multiBranch !== false;

    const conds = [];

    if (branchFeatureOn) {
      // Branch-bound users only see warehouses in their assigned branch. If
      // they have an assignedWarehouseId, narrow further to that warehouse.
      const allowedBranches = branchFilterFor(actingUser);
      if (allowedBranches !== null) {
        if (allowedBranches.length === 0) return [];
        conds.push(eq(warehouses.branchId, allowedBranches[0]));
        if (actingUser?.assignedWarehouseId) {
          conds.push(eq(warehouses.id, actingUser.assignedWarehouseId));
        }
      } else if (branchId) {
        conds.push(eq(warehouses.branchId, Number(branchId)));
      }
    } else if (actingUser?.assignedWarehouseId && !isGlobalAdmin(actingUser)) {
      // Branches off, but the user is still locked to a specific warehouse.
      conds.push(eq(warehouses.id, actingUser.assignedWarehouseId));
    }

    if (activeOnly) conds.push(eq(warehouses.isActive, true));

    let q = db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        isActive: warehouses.isActive,
        createdAt: warehouses.createdAt,
      })
      .from(warehouses)
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .orderBy(desc(warehouses.createdAt));

    if (conds.length) q = q.where(and(...conds));
    return await q;
  }

  async getById(id) {
    const db = await getDb();
    const [row] = await db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        isActive: warehouses.isActive,
        createdAt: warehouses.createdAt,
      })
      .from(warehouses)
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .where(eq(warehouses.id, id))
      .limit(1);
    if (!row) throw new NotFoundError('Warehouse');
    return row;
  }

  async create(data) {
    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchFeatureOn = flags.multiBranch !== false;

    if (branchFeatureOn && !data.branchId) {
      throw new ValidationError('branchId is required when multi-branch is enabled');
    }

    if (data.branchId) {
      const [branch] = await db
        .select()
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .limit(1);
      if (!branch) throw new NotFoundError('Branch');
    }

    // Uniqueness is enforced per-branch when branches exist, otherwise globally.
    const dupConds = [eq(warehouses.name, data.name)];
    if (data.branchId) dupConds.push(eq(warehouses.branchId, data.branchId));
    else dupConds.push(sql`${warehouses.branchId} IS NULL`);
    const [existing] = await db
      .select()
      .from(warehouses)
      .where(and(...dupConds))
      .limit(1);
    if (existing) {
      throw new ConflictError(
        data.branchId
          ? 'A warehouse with this name already exists in the branch'
          : 'A warehouse with this name already exists'
      );
    }

    const [row] = await db
      .insert(warehouses)
      .values({
        name: data.name,
        branchId: data.branchId || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      })
      .returning();

    // Initialise product_stock rows for this warehouse (quantity 0 by default)
    await db.execute(sql`
      INSERT INTO product_stock (product_id, warehouse_id, quantity)
      SELECT p.id, ${row.id}, 0
      FROM products p
      WHERE p.is_active = true
      ON CONFLICT DO NOTHING
    `);

    return row;
  }

  async update(id, data) {
    const db = await getDb();

    // If branch is changing, make sure no branch still points at this warehouse
    // as its default. Force the admin to clear the default first to avoid an
    // orphaned default that no user can reach.
    if (data.branchId !== undefined) {
      const [current] = await db
        .select({ id: warehouses.id, branchId: warehouses.branchId })
        .from(warehouses)
        .where(eq(warehouses.id, id))
        .limit(1);
      const newBranchId = data.branchId == null ? null : Number(data.branchId);
      if (current && Number(current.branchId) !== newBranchId) {
        const [b] = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.defaultWarehouseId, id))
          .limit(1);
        if (b) {
          throw new ConflictError(
            `Cannot move warehouse: it is the default warehouse for branch "${b.name}". Pick a different default first.`
          );
        }
      }
    }

    const [row] = await db
      .update(warehouses)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.branchId !== undefined ? { branchId: data.branchId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      })
      .where(eq(warehouses.id, id))
      .returning();
    if (!row) throw new NotFoundError('Warehouse');

    // Disabling a warehouse that is currently a branch default is not allowed
    // — the admin must pick a different default first.
    if (data.isActive === false) {
      const [b] = await db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(eq(branches.defaultWarehouseId, id))
        .limit(1);
      if (b) {
        // Roll back the disable.
        await db.update(warehouses).set({ isActive: true }).where(eq(warehouses.id, id));
        throw new ConflictError(
          `Cannot disable warehouse: it is the default warehouse for branch "${b.name}". Pick a different default first.`
        );
      }
    }
    return row;
  }

  async delete(id) {
    const db = await getDb();

    // Block deletion when this warehouse is still set as a branch default.
    const [defaultFor] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.defaultWarehouseId, id))
      .limit(1);
    if (defaultFor) {
      throw new ConflictError(
        `Cannot delete warehouse: it is the default warehouse for branch "${defaultFor.name}". Pick a different default first.`
      );
    }

    // Check if any stock exists; if so, soft-deactivate instead of deleting.
    const [hasStock] = await db
      .select({ total: sql`COALESCE(SUM(quantity), 0)` })
      .from(productStock)
      .where(eq(productStock.warehouseId, id));

    if (Number(hasStock?.total || 0) > 0) {
      await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, id));
      return { message: 'Warehouse deactivated (contains stock)' };
    }

    // No stock — safe to delete (cascade clears product_stock)
    const [deleted] = await db.delete(warehouses).where(eq(warehouses.id, id)).returning();
    if (!deleted) throw new NotFoundError('Warehouse');
    return { message: 'Warehouse deleted' };
  }
}

export default new WarehouseService();
