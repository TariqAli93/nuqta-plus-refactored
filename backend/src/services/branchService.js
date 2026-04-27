import { getDb } from '../db.js';
import { branches, warehouses } from '../models/index.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthorizationError,
} from '../utils/errors.js';
import { eq, desc, inArray, sql } from 'drizzle-orm';
import { branchFilterFor, isGlobalAdmin, isBranchAdmin, isBranchManager } from './scopeService.js';

/**
 * Stable error codes attached to thrown errors so the frontend can render a
 * field-aware, localized message.
 */
export const BRANCH_ERRORS = Object.freeze({
  BRANCH_CREATE_FORBIDDEN: 'BRANCH_CREATE_FORBIDDEN',
  BRANCH_DELETE_FORBIDDEN: 'BRANCH_DELETE_FORBIDDEN',
  BRANCH_ACCESS_DENIED: 'BRANCH_ACCESS_DENIED',
  DEFAULT_WAREHOUSE_OUTSIDE_BRANCH: 'DEFAULT_WAREHOUSE_OUTSIDE_BRANCH',
  DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN: 'DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN',
});

function tag(err, code) {
  err.code = code;
  return err;
}

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
    throw tag(
      new ValidationError('Default warehouse must belong to the same branch'),
      BRANCH_ERRORS.DEFAULT_WAREHOUSE_OUTSIDE_BRANCH
    );
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

  async create(data, actingUser = null) {
    // Branch creation is global-admin only — branch_admin/branch_manager
    // shouldn't be able to spawn new branches alongside their own.
    if (actingUser && !isGlobalAdmin(actingUser)) {
      throw tag(
        new AuthorizationError('Only global admins can create branches'),
        BRANCH_ERRORS.BRANCH_CREATE_FORBIDDEN
      );
    }
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

  /**
   * Update branch fields with role-aware filtering.
   *
   *  - global_admin / admin: full update (all fields).
   *  - branch_admin: full update on the branch they're assigned to.
   *  - branch_manager: only `defaultWarehouseId`, and only on their assigned branch.
   *  - everyone else: rejected.
   */
  async update(id, data, actingUser = null) {
    const db = await getDb();

    if (actingUser) {
      if (!isGlobalAdmin(actingUser)) {
        // Both branch_admin and branch_manager are scoped to their branch.
        if (
          !actingUser.assignedBranchId ||
          Number(actingUser.assignedBranchId) !== Number(id)
        ) {
          throw tag(
            new AuthorizationError('You can only modify your assigned branch'),
            BRANCH_ERRORS.BRANCH_ACCESS_DENIED
          );
        }
        if (isBranchManager(actingUser)) {
          // Branch managers can ONLY pick the default warehouse — strip any
          // other fields the caller may have sent.
          const allowedKeys = ['defaultWarehouseId'];
          const sentDisallowed = Object.keys(data).filter(
            (k) => !allowedKeys.includes(k) && data[k] !== undefined
          );
          if (sentDisallowed.length > 0) {
            throw tag(
              new AuthorizationError(
                'Branch managers can only update the default warehouse'
              ),
              BRANCH_ERRORS.DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN
            );
          }
        } else if (!isBranchAdmin(actingUser)) {
          // Other branch-scoped roles (manager, cashier, viewer) — denied.
          throw tag(
            new AuthorizationError('You do not have permission to update this branch'),
            BRANCH_ERRORS.BRANCH_ACCESS_DENIED
          );
        }
      }
    }

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

  async delete(id, actingUser = null) {
    if (actingUser && !isGlobalAdmin(actingUser)) {
      throw tag(
        new AuthorizationError('Only global admins can delete branches'),
        BRANCH_ERRORS.BRANCH_DELETE_FORBIDDEN
      );
    }
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
