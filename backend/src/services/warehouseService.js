import { getDb } from '../db.js';
import { warehouses, branches, productStock } from '../models/index.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthorizationError,
} from '../utils/errors.js';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import featureFlagsService from './featureFlagsService.js';
import {
  PERMISSION_ERRORS,
  assertCan,
  canCreateWarehouseInBranch,
  canEditWarehouseRow,
  canDeleteWarehouseRow,
  canViewWarehouseRow,
  canTransferBetweenWarehouses,
  getAllowedBranchIdsSync,
  isGlobalAdmin,
} from './permissionService.js';

/**
 * Warehouse CRUD + transfer-target listing. All authorization decisions go
 * through `permissionService`; this module focuses on persistence and the
 * narrow set of validation rules that depend on the database (uniqueness,
 * default-warehouse references, stock).
 */

// Backwards-compatible alias kept for existing imports. The codes themselves
// live in permissionService.
export const TRANSFER_ERRORS = Object.freeze({
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  WAREHOUSE_INACTIVE: 'WAREHOUSE_INACTIVE',
  SOURCE_WAREHOUSE_NOT_ALLOWED: PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED,
  DESTINATION_WAREHOUSE_NOT_ALLOWED: PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED,
  SAME_SOURCE_AND_DESTINATION: 'SAME_SOURCE_AND_DESTINATION',
  TRANSFER_OUTSIDE_BRANCH_FORBIDDEN: PERMISSION_ERRORS.TRANSFER_OUTSIDE_BRANCH_FORBIDDEN,
});

export const WAREHOUSE_ERRORS = PERMISSION_ERRORS;

function tagError(err, code) {
  err.code = code;
  return err;
}

export class WarehouseService {
  /**
   * List warehouses scoped by the acting user. Backend filters by branch
   * for branch-bound users (and by warehouse for fixed-warehouse users) so
   * the frontend never receives rows it isn't allowed to see.
   *
   *   global admin           → all warehouses
   *   branch_admin/manager   → all warehouses in their branch
   *   manager/cashier/viewer → warehouses in their branch, narrowed to
   *                            assignedWarehouseId when set
   *   multi-branch OFF       → all active warehouses (assignedWarehouseId
   *                            still narrows non-globals)
   */
  async getAll({ branchId, activeOnly = false } = {}, actingUser = null) {
    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchFeatureOn = flags.multiBranch !== false;

    const conds = [];

    if (branchFeatureOn) {
      const allowedBranches = getAllowedBranchIdsSync(actingUser);
      if (allowedBranches !== null) {
        if (allowedBranches.length === 0) return [];
        conds.push(eq(warehouses.branchId, allowedBranches[0]));
        // Cashier/viewer/manager fixed to a single warehouse — narrow down
        // even within the branch. branch_admin/branch_manager see all.
        if (
          actingUser?.assignedWarehouseId &&
          !['branch_admin', 'branch_manager'].includes(actingUser.role)
        ) {
          conds.push(eq(warehouses.id, actingUser.assignedWarehouseId));
        }
      } else if (branchId) {
        conds.push(eq(warehouses.branchId, Number(branchId)));
      }
    } else if (actingUser?.assignedWarehouseId && !isGlobalAdmin(actingUser)) {
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

  async getById(id, actingUser = null) {
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
    if (actingUser) {
      assertCan(
        canViewWarehouseRow(actingUser, row),
        'Warehouse belongs to a different scope',
        PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
      );
    }
    return row;
  }

  async create(data, actingUser = null) {
    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchFeatureOn = flags.multiBranch !== false;

    if (actingUser) {
      // Policy decides who can create + into which branch.
      if (!canCreateWarehouseInBranch(actingUser, data.branchId)) {
        const code =
          isGlobalAdmin(actingUser) || actingUser.role === 'branch_admin'
            ? PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
            : PERMISSION_ERRORS.WAREHOUSE_CREATE_FORBIDDEN;
        const message =
          code === PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
            ? 'Warehouses can only be created in your assigned branch'
            : 'You do not have permission to create warehouses';
        const err = new AuthorizationError(message);
        err.code = code;
        throw err;
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

    // Load the row first so the policy can see its branch when deciding.
    const [current] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId })
      .from(warehouses)
      .where(eq(warehouses.id, id))
      .limit(1);
    if (!current) throw new NotFoundError('Warehouse');

    if (actingUser) {
      assertCan(
        canEditWarehouseRow(actingUser, current),
        'You do not have permission to update this warehouse',
        PERMISSION_ERRORS.WAREHOUSE_UPDATE_FORBIDDEN
      );
    }

    // If branch is changing, make sure no branch still points at this warehouse
    // as its default.
    if (data.branchId !== undefined) {
      const newBranchId = data.branchId == null ? null : Number(data.branchId);
      if (Number(current.branchId) !== newBranchId) {
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
   * source. Delegates the authorization decision to `permissionService`;
   * keeps the lookup-and-validate plumbing here so callers receive the row.
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
          PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
      if (Number(wh.branchId) !== Number(actingUser.assignedBranchId)) {
        throw tagError(
          new AuthorizationError('Source warehouse is outside your branch'),
          PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
        );
      }
    }
    if (
      actingUser?.assignedWarehouseId &&
      Number(actingUser.assignedWarehouseId) !== Number(warehouseId) &&
      !['branch_admin', 'branch_manager'].includes(actingUser.role)
    ) {
      throw tagError(
        new AuthorizationError('You can only transfer from your assigned warehouse'),
        PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
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
        PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
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
        PERMISSION_ERRORS.TRANSFER_OUTSIDE_BRANCH_FORBIDDEN
      );
    }
    return wh;
  }

  /**
   * Resolve the list of warehouses the acting user can use as transfer
   * destinations for a given source warehouse. Backend-filtered — the
   * frontend renders the response as the dropdown options without further
   * authorization filtering.
   */
  async getTransferTargets(sourceWarehouseId, actingUser) {
    if (!sourceWarehouseId) {
      throw tagError(
        new ValidationError('sourceWarehouseId is required'),
        TRANSFER_ERRORS.WAREHOUSE_NOT_FOUND
      );
    }
    const source = await this.assertCanTransferFrom(sourceWarehouseId, actingUser);

    const db = await getDb();
    const flags = await featureFlagsService.getFeatureFlags();
    const branchOn = flags.multiBranch !== false;
    const conds = [
      eq(warehouses.isActive, true),
      ne(warehouses.id, sourceWarehouseId),
    ];

    if (branchOn && !isGlobalAdmin(actingUser)) {
      if (source.branchId == null) {
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

    const [current] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId })
      .from(warehouses)
      .where(eq(warehouses.id, id))
      .limit(1);
    if (!current) throw new NotFoundError('Warehouse');

    if (actingUser) {
      assertCan(
        canDeleteWarehouseRow(actingUser, current),
        'You do not have permission to delete this warehouse',
        PERMISSION_ERRORS.WAREHOUSE_DELETE_FORBIDDEN
      );
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
