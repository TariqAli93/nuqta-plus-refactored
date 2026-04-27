import { getDb } from '../db.js';
import { warehouses, branches, productStock } from '../models/index.js';
import { NotFoundError, ConflictError, ValidationError, AuthorizationError } from '../utils/errors.js';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { isGlobalAdmin, branchFilterFor } from './scopeService.js';
import featureFlagsService from './featureFlagsService.js';

/**
 * Stable error codes attached to thrown errors so the frontend can localize
 * the message and decide whether to show a per-field hint or a global toast.
 */
export const TRANSFER_ERRORS = Object.freeze({
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  WAREHOUSE_INACTIVE: 'WAREHOUSE_INACTIVE',
  SOURCE_WAREHOUSE_NOT_ALLOWED: 'SOURCE_WAREHOUSE_NOT_ALLOWED',
  DESTINATION_WAREHOUSE_NOT_ALLOWED: 'DESTINATION_WAREHOUSE_NOT_ALLOWED',
  SAME_SOURCE_AND_DESTINATION: 'SAME_SOURCE_AND_DESTINATION',
  TRANSFER_OUTSIDE_BRANCH_FORBIDDEN: 'TRANSFER_OUTSIDE_BRANCH_FORBIDDEN',
});

export const WAREHOUSE_ERRORS = Object.freeze({
  WAREHOUSE_CREATE_FORBIDDEN: 'WAREHOUSE_CREATE_FORBIDDEN',
  WAREHOUSE_DELETE_FORBIDDEN: 'WAREHOUSE_DELETE_FORBIDDEN',
  WAREHOUSE_ACCESS_DENIED: 'WAREHOUSE_ACCESS_DENIED',
});

function tagError(err, code) {
  err.code = code;
  return err;
}

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

  async create(data, actingUser = null) {
    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchFeatureOn = flags.multiBranch !== false;

    // Only branch_admin and global admins can create warehouses.
    // branch_manager (and below) are explicitly blocked, even though the
    // route guard normally catches this — the redundant check yields a
    // stable error code for the API.
    if (actingUser && !isGlobalAdmin(actingUser)) {
      const role = actingUser.role;
      if (role !== 'branch_admin') {
        throw tagError(
          new AuthorizationError('You do not have permission to create warehouses'),
          WAREHOUSE_ERRORS.WAREHOUSE_CREATE_FORBIDDEN
        );
      }
      // branch_admin can only create within their assigned branch.
      if (
        branchFeatureOn &&
        data.branchId &&
        Number(data.branchId) !== Number(actingUser.assignedBranchId)
      ) {
        throw tagError(
          new AuthorizationError('Warehouses can only be created in your assigned branch'),
          WAREHOUSE_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
    }

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

  async update(id, data, actingUser = null) {
    const db = await getDb();

    // Only branch_admin and global admins can update warehouses (branch
    // managers must use the branch endpoint to set the default warehouse).
    if (actingUser && !isGlobalAdmin(actingUser)) {
      if (actingUser.role !== 'branch_admin') {
        throw tagError(
          new AuthorizationError('You do not have permission to update warehouses'),
          WAREHOUSE_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
      // branch_admin can only update warehouses in their assigned branch.
      const [wh] = await db
        .select({ branchId: warehouses.branchId })
        .from(warehouses)
        .where(eq(warehouses.id, id))
        .limit(1);
      if (
        wh &&
        wh.branchId != null &&
        Number(wh.branchId) !== Number(actingUser.assignedBranchId)
      ) {
        throw tagError(
          new AuthorizationError('Warehouse belongs to a different branch'),
          WAREHOUSE_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
    }

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

  /**
   * Verify the acting user is allowed to act on `warehouseId` as a transfer
   * source. Throws a tagged error so the controller can surface a stable
   * `code` to the client.
   *
   * Rules:
   *  - global admin: any active warehouse.
   *  - branch-bound user: warehouse must be in the user's assigned branch.
   *  - fixed-warehouse user: must equal `assignedWarehouseId`.
   */
  async assertCanTransferFrom(warehouseId, actingUser) {
    const db = await getDb();
    const [wh] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);
    if (!wh) {
      throw tagError(new NotFoundError('Source warehouse'), TRANSFER_ERRORS.WAREHOUSE_NOT_FOUND);
    }
    if (wh.isActive === false) {
      throw tagError(new ValidationError('Source warehouse is inactive'), TRANSFER_ERRORS.WAREHOUSE_INACTIVE);
    }
    if (isGlobalAdmin(actingUser)) return wh;

    const flags = await featureFlagsService.getFeatureFlags();
    const branchOn = flags.multiBranch !== false;

    if (branchOn) {
      if (!actingUser?.assignedBranchId) {
        throw tagError(
          new AuthorizationError('User has no branch assigned'),
          TRANSFER_ERRORS.SOURCE_WAREHOUSE_NOT_ALLOWED
        );
      }
      if (Number(wh.branchId) !== Number(actingUser.assignedBranchId)) {
        throw tagError(
          new AuthorizationError('Source warehouse is outside your branch'),
          TRANSFER_ERRORS.SOURCE_WAREHOUSE_NOT_ALLOWED
        );
      }
    }
    if (
      actingUser?.assignedWarehouseId &&
      Number(actingUser.assignedWarehouseId) !== Number(warehouseId)
    ) {
      throw tagError(
        new AuthorizationError('You can only transfer from your assigned warehouse'),
        TRANSFER_ERRORS.SOURCE_WAREHOUSE_NOT_ALLOWED
      );
    }
    return wh;
  }

  /**
   * Verify the acting user can use `destinationId` as a transfer destination
   * given the validated `source` warehouse row.
   */
  async assertCanTransferTo(destinationId, source, actingUser) {
    if (!destinationId) {
      throw tagError(
        new ValidationError('Destination warehouse is required'),
        TRANSFER_ERRORS.DESTINATION_WAREHOUSE_NOT_ALLOWED
      );
    }
    if (Number(destinationId) === Number(source.id)) {
      throw tagError(
        new ValidationError('Source and destination warehouses must differ'),
        TRANSFER_ERRORS.SAME_SOURCE_AND_DESTINATION
      );
    }

    const db = await getDb();
    const [wh] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, destinationId))
      .limit(1);
    if (!wh) {
      throw tagError(new NotFoundError('Destination warehouse'), TRANSFER_ERRORS.WAREHOUSE_NOT_FOUND);
    }
    if (wh.isActive === false) {
      throw tagError(
        new ValidationError('Destination warehouse is inactive'),
        TRANSFER_ERRORS.WAREHOUSE_INACTIVE
      );
    }

    if (isGlobalAdmin(actingUser)) return wh;

    const flags = await featureFlagsService.getFeatureFlags();
    const branchOn = flags.multiBranch !== false;
    if (branchOn && Number(wh.branchId) !== Number(source.branchId)) {
      throw tagError(
        new AuthorizationError('Cross-branch transfers require a global admin'),
        TRANSFER_ERRORS.TRANSFER_OUTSIDE_BRANCH_FORBIDDEN
      );
    }
    return wh;
  }

  /**
   * Resolve the list of warehouses the acting user can use as transfer
   * destinations for a given source warehouse.
   *
   *  - branch feature ON, normal user → other active warehouses in the same
   *    branch (always, even when the user is locked to a single warehouse
   *    for sales/POS purposes — transfers are intentionally wider).
   *  - branch feature ON, global admin → any other active warehouse.
   *  - branch feature OFF → any other active warehouse.
   */
  async getTransferTargets(sourceWarehouseId, actingUser) {
    if (!sourceWarehouseId) {
      throw tagError(
        new ValidationError('sourceWarehouseId is required'),
        TRANSFER_ERRORS.WAREHOUSE_NOT_FOUND
      );
    }
    // Reuses the source-permission check so we can't hand out destinations
    // for a source the caller can't even use.
    const source = await this.assertCanTransferFrom(sourceWarehouseId, actingUser);

    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchOn = flags.multiBranch !== false;
    const conds = [
      eq(warehouses.isActive, true),
      ne(warehouses.id, sourceWarehouseId),
    ];

    if (branchOn && !isGlobalAdmin(actingUser)) {
      // Same-branch only for non-admins.
      if (source.branchId == null) {
        // Source is global (no branch) — only other global warehouses are
        // valid destinations.
        conds.push(sql`${warehouses.branchId} IS NULL`);
      } else {
        conds.push(eq(warehouses.branchId, source.branchId));
      }
    }

    return await db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        isActive: warehouses.isActive,
      })
      .from(warehouses)
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .where(and(...conds))
      .orderBy(desc(warehouses.createdAt));
  }

  async delete(id, actingUser = null) {
    const db = await getDb();

    // Only branch_admin and global admins can delete warehouses.
    if (actingUser && !isGlobalAdmin(actingUser)) {
      if (actingUser.role !== 'branch_admin') {
        throw tagError(
          new AuthorizationError('You do not have permission to delete warehouses'),
          WAREHOUSE_ERRORS.WAREHOUSE_DELETE_FORBIDDEN
        );
      }
      // branch_admin can only delete within their assigned branch.
      const [wh] = await db
        .select({ branchId: warehouses.branchId })
        .from(warehouses)
        .where(eq(warehouses.id, id))
        .limit(1);
      if (
        wh &&
        wh.branchId != null &&
        Number(wh.branchId) !== Number(actingUser.assignedBranchId)
      ) {
        throw tagError(
          new AuthorizationError('Warehouse belongs to a different branch'),
          WAREHOUSE_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
    }

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
