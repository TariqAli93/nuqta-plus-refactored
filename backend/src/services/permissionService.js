import { getDb } from '../db.js';
import { warehouses, branches } from '../models/index.js';
import { eq, and, ne } from 'drizzle-orm';
import { AuthorizationError, NotFoundError, ValidationError } from '../utils/errors.js';
import featureFlagsService from './featureFlagsService.js';

/**
 * Branch + warehouse permission policy.
 *
 * Single source of truth for "can this user do X?" decisions on branches,
 * warehouses, and inter-warehouse transfers. Service modules and route
 * handlers MUST consult this module instead of duplicating role checks.
 *
 * Most checks are pure functions of the user object — they don't read the
 * database — so callers can use them inline without paying for I/O. The
 * async helpers (`canViewWarehouse`, `canTransferBetweenWarehouses`) load
 * the warehouse row when the decision needs the warehouse's branch.
 *
 * Role rules (also documented in auth/permissionMatrix.js):
 *   global_admin / admin → full access on everything.
 *   branch_admin         → full access within their assigned branch.
 *   branch_manager       → read + change-default-warehouse + transfer
 *                          within their assigned branch.
 *   manager / cashier / viewer → POS/inventory scope only; no branch or
 *                          warehouse CRUD, no default-warehouse changes.
 */

// ── Stable error codes attached to thrown errors so the API + frontend can
// localize the message and decide whether to render a per-field hint.
export const PERMISSION_ERRORS = Object.freeze({
  BRANCH_CREATE_FORBIDDEN: 'BRANCH_CREATE_FORBIDDEN',
  BRANCH_DELETE_FORBIDDEN: 'BRANCH_DELETE_FORBIDDEN',
  BRANCH_UPDATE_FORBIDDEN: 'BRANCH_UPDATE_FORBIDDEN',
  BRANCH_ACCESS_DENIED: 'BRANCH_ACCESS_DENIED',
  WAREHOUSE_CREATE_FORBIDDEN: 'WAREHOUSE_CREATE_FORBIDDEN',
  WAREHOUSE_UPDATE_FORBIDDEN: 'WAREHOUSE_UPDATE_FORBIDDEN',
  WAREHOUSE_DELETE_FORBIDDEN: 'WAREHOUSE_DELETE_FORBIDDEN',
  WAREHOUSE_MOVE_FORBIDDEN: 'WAREHOUSE_MOVE_FORBIDDEN',
  WAREHOUSE_ACCESS_DENIED: 'WAREHOUSE_ACCESS_DENIED',
  TRANSFER_OUTSIDE_BRANCH_FORBIDDEN: 'TRANSFER_OUTSIDE_BRANCH_FORBIDDEN',
  DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN: 'DEFAULT_WAREHOUSE_UPDATE_FORBIDDEN',
  DEFAULT_WAREHOUSE_OUTSIDE_BRANCH: 'DEFAULT_WAREHOUSE_OUTSIDE_BRANCH',
});

const ROLE = Object.freeze({
  GLOBAL_ADMIN: 'global_admin',
  ADMIN: 'admin',
  BRANCH_ADMIN: 'branch_admin',
  BRANCH_MANAGER: 'branch_manager',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  VIEWER: 'viewer',
});

const GLOBAL_ROLES = new Set([ROLE.GLOBAL_ADMIN, ROLE.ADMIN]);

// ── Predicates ────────────────────────────────────────────────────────────
export function isGlobalAdmin(user) {
  return !!user && GLOBAL_ROLES.has(user.role);
}
export function isBranchAdmin(user) {
  return user?.role === ROLE.BRANCH_ADMIN;
}
export function isBranchManager(user) {
  return user?.role === ROLE.BRANCH_MANAGER;
}

function ownsBranch(user, branchId) {
  if (!user?.assignedBranchId || branchId == null) return false;
  return Number(user.assignedBranchId) === Number(branchId);
}

// ── Branch policies ───────────────────────────────────────────────────────
/** Only global admins can create branches. */
export function canCreateBranch(user) {
  return isGlobalAdmin(user);
}

/** Only global admins can delete branches. */
export function canDeleteBranch(user) {
  return isGlobalAdmin(user);
}

/** A user can see a branch when global, or it's their assigned branch. */
export function canViewBranch(user, branchId) {
  if (isGlobalAdmin(user)) return true;
  return ownsBranch(user, branchId);
}

/** Edit name/address/active flag on a branch — branch_admin or global. */
export function canEditBranchMeta(user, branchId) {
  if (isGlobalAdmin(user)) return true;
  return isBranchAdmin(user) && ownsBranch(user, branchId);
}

/**
 * Change the branch's `defaultWarehouseId`. branch_manager has this even
 * though they can't edit other branch metadata — that's the whole point of
 * the role.
 */
export function canEditBranchDefaultWarehouse(user, branchId) {
  if (isGlobalAdmin(user)) return true;
  if (!ownsBranch(user, branchId)) return false;
  return isBranchAdmin(user) || isBranchManager(user);
}

// ── Warehouse policies ────────────────────────────────────────────────────
/** Branch admins and globals can create warehouses (in the right branch). */
export function canCreateWarehouse(user) {
  return isGlobalAdmin(user) || isBranchAdmin(user);
}

/** Same as `canCreateWarehouse` but also checks the target branch. */
export function canCreateWarehouseInBranch(user, branchId) {
  if (!canCreateWarehouse(user)) return false;
  if (isGlobalAdmin(user)) return true;
  // branch_admin must target their own branch.
  return ownsBranch(user, branchId);
}

/** Edit/move/disable a warehouse — branch_admin (in own branch) or global. */
export function canEditWarehouseRow(user, warehouseRow) {
  if (isGlobalAdmin(user)) return true;
  if (!isBranchAdmin(user)) return false;
  // null branchId on a warehouse means "global" (multi-branch off) — only
  // global admins can touch those.
  return ownsBranch(user, warehouseRow?.branchId);
}

/**
 * Spec-aligned alias for {@link canEditWarehouseRow}. Use this in callers
 * that talk about "updating" a warehouse — both names map to the same rule
 * (branch_admin within their branch, or global admin).
 */
export const canUpdateWarehouse = canEditWarehouseRow;

/** Delete a warehouse — branch_admin (in own branch) or global. */
export function canDeleteWarehouseRow(user, warehouseRow) {
  return canEditWarehouseRow(user, warehouseRow);
}

/**
 * Spec-aligned alias for {@link canDeleteWarehouseRow}.
 */
export const canDeleteWarehouse = canDeleteWarehouseRow;

/**
 * Move a warehouse from `warehouseRow.branchId` to `targetBranchId`.
 *
 *   global admin  → any move (including in/out of branches).
 *   branch_admin  → may only move within their own branch (effectively a
 *                   no-op move). Cannot move a warehouse OUT of their branch
 *                   or move someone else's warehouse INTO their branch.
 *   anyone else   → no move.
 *
 * Targeting `null` (multi-branch off → global warehouse) is a global-admin-
 * only operation.
 */
export function canMoveWarehouse(user, warehouseRow, targetBranchId) {
  if (!warehouseRow) return false;
  const currentBranchId = warehouseRow.branchId ?? null;
  const next = targetBranchId == null ? null : Number(targetBranchId);
  if (Number(currentBranchId) === Number(next)) {
    // Not actually a move — just defer to the regular edit check.
    return canEditWarehouseRow(user, warehouseRow);
  }
  if (isGlobalAdmin(user)) return true;
  if (!isBranchAdmin(user)) return false;
  // branch_admin: must own both the source AND the destination branch.
  return ownsBranch(user, currentBranchId) && ownsBranch(user, next);
}

/**
 * Read-side check for a warehouse: globals + branch-bound users in the same
 * branch. Cashier/viewer/manager may also be locked to a single warehouse
 * via `assignedWarehouseId` — that lock is enforced here too.
 */
export function canViewWarehouseRow(user, warehouseRow) {
  if (!warehouseRow) return false;
  if (isGlobalAdmin(user)) return true;
  if (!user) return false;
  if (warehouseRow.branchId != null && !ownsBranch(user, warehouseRow.branchId)) {
    return false;
  }
  if (
    user.assignedWarehouseId &&
    Number(user.assignedWarehouseId) !== Number(warehouseRow.id) &&
    !isBranchAdmin(user) &&
    !isBranchManager(user)
  ) {
    return false;
  }
  return true;
}

/** DB-aware variant of {@link canViewWarehouseRow}. */
export async function canViewWarehouse(user, warehouseId) {
  if (isGlobalAdmin(user)) return true;
  if (!warehouseId) return false;
  const db = await getDb();
  const [row] = await db
    .select({ id: warehouses.id, branchId: warehouses.branchId })
    .from(warehouses)
    .where(eq(warehouses.id, Number(warehouseId)))
    .limit(1);
  return canViewWarehouseRow(user, row);
}

// ── Allowed-id helpers used by list queries ───────────────────────────────
/**
 * Branch IDs the user is allowed to see.
 *  - `null` → unrestricted (skip the WHERE clause)
 *  - `[]`   → no branches (return empty list)
 *  - `[id]` → single allowed branch
 */
export function getAllowedBranchIdsSync(user) {
  if (isGlobalAdmin(user)) return null;
  if (!user?.assignedBranchId) return [];
  return [user.assignedBranchId];
}

/**
 * Resolve the warehouse IDs a user is allowed to see. Async because
 * non-globals need a query against the warehouses table. When the
 * multi-branch feature is OFF, scope is global and only the
 * assignedWarehouseId lock applies.
 */
export async function getAllowedWarehouseIds(user) {
  const flags = await featureFlagsService.getFeatureFlags();
  const branchOn = flags.multiBranch !== false;
  const db = await getDb();

  if (isGlobalAdmin(user)) {
    const rows = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.isActive, true));
    return rows.map((r) => r.id);
  }

  if (!branchOn) {
    const rows = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.isActive, true));
    let ids = rows.map((r) => r.id);
    if (user?.assignedWarehouseId) {
      ids = ids.filter((id) => id === user.assignedWarehouseId);
    }
    return ids;
  }

  if (!user?.assignedBranchId) return [];
  const rows = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.branchId, user.assignedBranchId), eq(warehouses.isActive, true)));
  let ids = rows.map((r) => r.id);
  // Cashier/viewer/manager locked to one warehouse — narrow further.
  if (
    user?.assignedWarehouseId &&
    !isBranchAdmin(user) &&
    !isBranchManager(user)
  ) {
    ids = ids.filter((id) => id === user.assignedWarehouseId);
  }
  return ids;
}

// ── Transfer policy ───────────────────────────────────────────────────────
/**
 * Decide whether `user` is allowed to move stock from `sourceId` to `destId`.
 * Both warehouses must exist and be active. Non-globals can only transfer
 * within their assigned branch.
 *
 * Returns the loaded `{ source, destination }` pair on success so callers
 * don't need to refetch.
 */
export async function canTransferBetweenWarehouses(user, sourceId, destId) {
  if (!sourceId || !destId) {
    throw makeError(
      new ValidationError('Source and destination warehouses are required'),
      PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
    );
  }
  if (Number(sourceId) === Number(destId)) {
    throw makeError(
      new ValidationError('Source and destination warehouses must differ'),
      PERMISSION_ERRORS.TRANSFER_OUTSIDE_BRANCH_FORBIDDEN
    );
  }
  const db = await getDb();
  const [source, destination] = await Promise.all([
    db
      .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, sourceId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, destId))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!source) {
    throw makeError(new NotFoundError('Source warehouse'), PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED);
  }
  if (!destination) {
    throw makeError(new NotFoundError('Destination warehouse'), PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED);
  }
  if (source.isActive === false || destination.isActive === false) {
    throw makeError(
      new ValidationError('Both warehouses must be active'),
      PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
    );
  }

  if (isGlobalAdmin(user)) return { source, destination };

  // Source must belong to the user's branch.
  if (!ownsBranch(user, source.branchId)) {
    throw makeError(
      new AuthorizationError('You can only transfer from warehouses in your branch'),
      PERMISSION_ERRORS.WAREHOUSE_ACCESS_DENIED
    );
  }
  // Destination must be in the same branch as the source for non-globals.
  const flags = await featureFlagsService.getFeatureFlags();
  const branchOn = flags.multiBranch !== false;
  if (branchOn && Number(destination.branchId) !== Number(source.branchId)) {
    throw makeError(
      new AuthorizationError('Cross-branch transfers require a global admin'),
      PERMISSION_ERRORS.TRANSFER_OUTSIDE_BRANCH_FORBIDDEN
    );
  }
  return { source, destination };
}

// ── Capabilities (UI-facing aggregate) ────────────────────────────────────
const EMPTY_CAPABILITIES = Object.freeze({
  canCreateBranch: false,
  canDeleteBranch: false,
  canCreateWarehouse: false,
  canEditWarehouse: false,
  canDeleteWarehouse: false,
  canEditBranchMeta: false,
  canChangeDefaultWarehouse: false,
  canTransferBetweenBranchWarehouses: false,
  canTransferStock: false,
  canViewAllBranches: false,
  canViewAllWarehouses: false,
  canSwitchBranch: false,
  canSwitchWarehouse: false,
  canUseInstallments: false,
  canUsePOS: false,
  canUseDraftInvoices: false,
  canApproveTransfer: false,
  canManageFeatureToggles: false,
  canManageUsers: false,
});

/**
 * Build the `capabilities` object the frontend uses to drive UI visibility.
 * Backend remains the authority — these flags only let the UI hide actions
 * the user cannot perform, never grant new ones.
 *
 * Capabilities are computed from THREE inputs: backend feature flags, user
 * role, and assigned branch/warehouse scope. A capability is `false` whenever
 * the feature it gates is disabled, even if the role would otherwise grant
 * it (e.g. a `global_admin` cannot use installments while installments=false).
 */
export async function getUserCapabilities(user) {
  if (!user) return { ...EMPTY_CAPABILITIES };

  const branchId = user.assignedBranchId || null;
  const flags = await featureFlagsService.getFeatureFlags();

  const branchOn = flags.multiBranch !== false;
  const warehouseOn = flags.multiWarehouse !== false;
  const transfersOn = flags.warehouseTransfers !== false;
  const installmentsOn = flags.installments !== false;
  const posOn = flags.pos !== false;
  const draftsOn = flags.draftInvoices !== false;

  const role = user.role;
  const isGlobal = isGlobalAdmin(user);
  const isBA = isBranchAdmin(user);
  const isBM = isBranchManager(user);
  const isCashier = role === 'cashier';
  const isManager = role === 'manager';

  return {
    // Branch lifecycle is meaningless when multiBranch is off.
    canCreateBranch: branchOn && canCreateBranch(user),
    canDeleteBranch: branchOn && canDeleteBranch(user),
    // Warehouse CRUD also requires the multi-branch feature, since warehouses
    // are tied to branches in the data model.
    canCreateWarehouse: branchOn && canCreateWarehouse(user),
    canEditWarehouse: branchOn && (isGlobal || isBA),
    canDeleteWarehouse: branchOn && (isGlobal || isBA),
    canEditBranchMeta:
      branchOn && (branchId ? canEditBranchMeta(user, branchId) : isGlobal),
    canChangeDefaultWarehouse:
      branchOn &&
      (branchId ? canEditBranchDefaultWarehouse(user, branchId) : isGlobal),
    // Transfer-related capabilities require the warehouseTransfers / inventoryTransfers flag.
    canTransferBetweenBranchWarehouses:
      transfersOn && (isGlobal || isBA || isBM),
    // Spec name. Same rule as above plus cashier/manager who can request
    // (server-side approval queue handles the rest).
    canTransferStock:
      transfersOn && (isGlobal || isBA || isBM || isManager || isCashier),
    canApproveTransfer: transfersOn && (isGlobal || isBA),
    canViewAllBranches: branchOn && isGlobal,
    canViewAllWarehouses: isGlobal || !branchOn,
    // Switching branch context is admin-only and also requires multi-branch.
    canSwitchBranch: branchOn && isGlobal,
    // Switching warehouse only matters when the user has more than one to
    // pick from — backend reflects that via scope.canSwitchWarehouse.
    canSwitchWarehouse: warehouseOn || branchOn ? !user.assignedWarehouseId : false,
    // POS / installments / draft invoices: feature-gated for ALL roles
    // including global admin.
    canUseInstallments: installmentsOn && (isGlobal || isBA || isBM || isManager || isCashier),
    canUsePOS: posOn && (isGlobal || isBA || isBM || isManager || isCashier),
    canUseDraftInvoices: draftsOn && (isGlobal || isBA || isBM || isManager || isCashier),
    canManageFeatureToggles: isGlobal,
    canManageUsers: isGlobal || isBA,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────
function makeError(err, code) {
  err.code = code;
  return err;
}

/** Throwing variant: raise a tagged AuthorizationError if the predicate fails. */
export function assertCan(predicate, message, code) {
  if (predicate) return;
  const err = new AuthorizationError(message);
  err.code = code;
  throw err;
}

export default {
  PERMISSION_ERRORS,
  isGlobalAdmin,
  isBranchAdmin,
  isBranchManager,
  canCreateBranch,
  canDeleteBranch,
  canViewBranch,
  canEditBranchMeta,
  canEditBranchDefaultWarehouse,
  canCreateWarehouse,
  canCreateWarehouseInBranch,
  canEditWarehouseRow,
  canUpdateWarehouse,
  canDeleteWarehouseRow,
  canDeleteWarehouse,
  canMoveWarehouse,
  canViewWarehouseRow,
  canViewWarehouse,
  canTransferBetweenWarehouses,
  getAllowedBranchIdsSync,
  getAllowedWarehouseIds,
  getUserCapabilities,
  assertCan,
};
