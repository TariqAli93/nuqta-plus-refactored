import { getDb } from '../db.js';
import { branches, warehouses } from '../models/index.js';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthorizationError,
} from '../utils/errors.js';
import { eq, desc, inArray, sql } from 'drizzle-orm';
import permissionService, {
  PERMISSION_ERRORS,
  assertCan,
  canCreateBranch,
  canDeleteBranch,
  canEditBranchMeta,
  canEditBranchDefaultWarehouse,
  getAllowedBranchIdsSync,
  isGlobalAdmin,
} from './permissionService.js';

/**
 * Branch CRUD. All authorization decisions live in `permissionService`;
 * this module only handles validation and persistence.
 */

// Re-export error codes for backwards compatibility with existing imports.
export const BRANCH_ERRORS = PERMISSION_ERRORS;

async function assertWarehouseBelongsToBranch(db, warehouseId, branchId) {
  if (warehouseId == null) return;
  const [wh] = await db
    .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!wh) throw new ValidationError('Default warehouse not found');
  if (wh.branchId != null && Number(wh.branchId) !== Number(branchId)) {
    const err = new ValidationError('Default warehouse must belong to the same branch');
    err.code = PERMISSION_ERRORS.DEFAULT_WAREHOUSE_OUTSIDE_BRANCH;
    throw err;
  }
  if (wh.isActive === false) {
    throw new ValidationError('Default warehouse must be active');
  }
}

export class BranchService {
  /**
   * Backend-filtered list — branch-bound users only ever receive their own
   * branch. The frontend renders the response as-is and never tries to
   * filter for authorization.
   */
  async getAll(actingUser = null) {
    const db = await getDb();
    const allowed = getAllowedBranchIdsSync(actingUser);

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

  async getById(id, actingUser = null) {
    if (actingUser) {
      assertCan(
        permissionService.canViewBranch(actingUser, id),
        'Branch belongs to a different scope',
        PERMISSION_ERRORS.BRANCH_ACCESS_DENIED
      );
    }
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
    if (actingUser) {
      assertCan(
        canCreateBranch(actingUser),
        'Only global admins can create branches',
        PERMISSION_ERRORS.BRANCH_CREATE_FORBIDDEN
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
   * Update branch fields with policy-driven, role-aware filtering.
   *
   * The policy decides:
   *   canEditBranchMeta              → name/address/isActive
   *   canEditBranchDefaultWarehouse  → defaultWarehouseId
   *
   * Branch managers only get the second one — sending other fields raises
   * `BRANCH_UPDATE_FORBIDDEN`.
   */
  async update(id, data, actingUser = null) {
    const db = await getDb();

    if (actingUser) {
      assertCan(
        permissionService.canViewBranch(actingUser, id),
        'Branch belongs to a different scope',
        PERMISSION_ERRORS.BRANCH_ACCESS_DENIED
      );
      const wantsMeta =
        data.name !== undefined || data.address !== undefined || data.isActive !== undefined;
      const wantsDefault = data.defaultWarehouseId !== undefined;
      const allowMeta = canEditBranchMeta(actingUser, id);
      const allowDefault = canEditBranchDefaultWarehouse(actingUser, id);

      if (wantsMeta && !allowMeta) {
        // Branch managers see DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN here so the
        // UI can guide them back to changing only the default; everyone else
        // gets the generic BRANCH_UPDATE_FORBIDDEN.
        const code = isGlobalAdmin(actingUser)
          ? PERMISSION_ERRORS.BRANCH_UPDATE_FORBIDDEN
          : allowDefault
            ? PERMISSION_ERRORS.DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN
            : PERMISSION_ERRORS.BRANCH_UPDATE_FORBIDDEN;
        const err = new AuthorizationError(
          'You may only change the default warehouse on this branch'
        );
        err.code = code;
        throw err;
      }
      if (wantsDefault && !allowDefault) {
        const err = new AuthorizationError(
          'You do not have permission to change this branch default warehouse'
        );
        err.code = PERMISSION_ERRORS.DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN;
        throw err;
      }
      if (!wantsMeta && !wantsDefault && !allowMeta && !allowDefault) {
        const err = new AuthorizationError(
          'You do not have permission to update this branch'
        );
        err.code = PERMISSION_ERRORS.BRANCH_UPDATE_FORBIDDEN;
        throw err;
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
    if (actingUser) {
      assertCan(
        canDeleteBranch(actingUser),
        'Only global admins can delete branches',
        PERMISSION_ERRORS.BRANCH_DELETE_FORBIDDEN
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
