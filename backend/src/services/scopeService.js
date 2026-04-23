import { getDb } from '../db.js';
import { warehouses, branches, users } from '../models/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import { AuthorizationError } from '../utils/errors.js';

/**
 * Branch-aware auth scope helpers.
 *
 * - `global_admin` / legacy `admin`  → full cross-branch access, can switch context.
 * - `branch_admin`                   → bound to users.assignedBranchId.
 * - `manager` / `cashier` / `viewer` → bound to their assigned branch (and to their
 *                                      assigned warehouse if one is set).
 */

const GLOBAL_ROLES = new Set(['global_admin', 'admin']);
const BRANCH_ADMIN_ROLES = new Set(['branch_admin']);

export function isGlobalAdmin(user) {
  return !!user && GLOBAL_ROLES.has(user.role);
}

export function isBranchAdmin(user) {
  return !!user && BRANCH_ADMIN_ROLES.has(user.role);
}

/**
 * Resolve the effective scope for a user. Called by authService at login and
 * anywhere the UI needs to know what the user can see and switch.
 *
 * @param {{id:number, role:string, assignedBranchId?:number|null, assignedWarehouseId?:number|null}} user
 */
export async function resolveUserScope(user) {
  if (!user) {
    return {
      role: null,
      isGlobalAdmin: false,
      isBranchAdmin: false,
      branchId: null,
      warehouseId: null,
      allowedBranchIds: [],
      allowedWarehouseIds: [],
      canSwitchBranch: false,
      canSwitchWarehouse: false,
    };
  }

  const db = await getDb();
  const global_ = isGlobalAdmin(user);

  if (global_) {
    const [branchRows, warehouseRows] = await Promise.all([
      db.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true)),
      db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.isActive, true)),
    ]);
    return {
      role: user.role,
      isGlobalAdmin: true,
      isBranchAdmin: false,
      branchId: user.assignedBranchId || null,
      warehouseId: user.assignedWarehouseId || null,
      allowedBranchIds: branchRows.map((b) => b.id),
      allowedWarehouseIds: warehouseRows.map((w) => w.id),
      canSwitchBranch: true,
      canSwitchWarehouse: true,
    };
  }

  // Non-global users must have an assigned branch
  const branchId = user.assignedBranchId || null;
  let allowedWarehouseIds = [];
  if (branchId) {
    const whs = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.branchId, branchId), eq(warehouses.isActive, true)));
    allowedWarehouseIds = whs.map((w) => w.id);
  }

  // If the user has a specific warehouse assignment, lock them to it.
  const fixedWarehouseId = user.assignedWarehouseId || null;
  const visibleWarehouseIds = fixedWarehouseId
    ? allowedWarehouseIds.filter((id) => id === fixedWarehouseId)
    : allowedWarehouseIds;

  return {
    role: user.role,
    isGlobalAdmin: false,
    isBranchAdmin: isBranchAdmin(user),
    branchId,
    warehouseId: fixedWarehouseId || visibleWarehouseIds[0] || null,
    allowedBranchIds: branchId ? [branchId] : [],
    allowedWarehouseIds: visibleWarehouseIds,
    canSwitchBranch: false,
    // A user with only one visible warehouse has nothing to switch between.
    canSwitchWarehouse: !fixedWarehouseId && visibleWarehouseIds.length > 1,
  };
}

/**
 * Throw if the given user cannot access a resource in the given branch.
 * Global admins pass through. Others must match their assignedBranchId.
 */
export function enforceBranchScope(user, resourceBranchId) {
  if (isGlobalAdmin(user)) return;
  if (!resourceBranchId) return; // legacy rows without a branch — let them through
  if (!user?.assignedBranchId) {
    throw new AuthorizationError('User has no branch assigned');
  }
  if (Number(user.assignedBranchId) !== Number(resourceBranchId)) {
    throw new AuthorizationError('Resource belongs to a different branch');
  }
}

/**
 * Throw unless the user is allowed to act on `warehouseId`.
 */
export async function enforceWarehouseScope(user, warehouseId) {
  if (isGlobalAdmin(user)) return;
  if (!warehouseId) return;

  const db = await getDb();
  const [wh] = await db
    .select({ id: warehouses.id, branchId: warehouses.branchId })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  if (!wh) throw new AuthorizationError('Warehouse not found');

  enforceBranchScope(user, wh.branchId);

  // Fixed-warehouse users are locked to their one warehouse.
  if (user?.assignedWarehouseId && Number(user.assignedWarehouseId) !== Number(warehouseId)) {
    throw new AuthorizationError('User is restricted to a different warehouse');
  }
}

export async function getAllowedWarehouseIds(user) {
  const scope = await resolveUserScope(user);
  return scope.allowedWarehouseIds;
}

/**
 * Resolve the branch a resource inherits from a warehouse id. Handy for sale
 * creation when the caller only passes warehouseId.
 */
export async function getBranchIdForWarehouse(warehouseId) {
  if (!warehouseId) return null;
  const db = await getDb();
  const [wh] = await db
    .select({ branchId: warehouses.branchId })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  return wh?.branchId || null;
}

/**
 * Filter-helper for Drizzle `where` clauses: returns the branch id list a user
 * is allowed to see, or null when the user is global (no filtering needed).
 */
export function branchFilterFor(user) {
  if (isGlobalAdmin(user)) return null;
  if (!user?.assignedBranchId) return [];
  return [user.assignedBranchId];
}

export default {
  isGlobalAdmin,
  isBranchAdmin,
  resolveUserScope,
  enforceBranchScope,
  enforceWarehouseScope,
  getAllowedWarehouseIds,
  getBranchIdForWarehouse,
  branchFilterFor,
};
