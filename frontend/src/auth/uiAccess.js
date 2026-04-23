/**
 * UI Access Control Helper
 *
 * Thin role-based checks used across the Vue UI (menu items, buttons, router
 * guards). Delegates to the shared permission matrix so there's one source of
 * truth between backend and frontend.
 *
 * Roles:
 * - global_admin: Full cross-branch access (alias: admin)
 * - branch_admin: Full access inside one branch
 * - manager:      Store manager — manages sales/products/customers
 * - cashier:      Creates sales + customers, read-only for admin areas
 * - viewer:       Read-only
 *
 * NOTE: This is UI gating only. Backend enforces scope + permissions
 * authoritatively (see `backend/src/services/scopeService.js` and the
 * `authorize()` Fastify decorator).
 */

import { hasPermission, isGlobalRole, ROLES } from './permissionMatrix.js';

// ── Low-level helpers ──────────────────────────────────────────────────────
export function isGlobalAdmin(role) {
  return isGlobalRole(role);
}

export function isBranchAdmin(role) {
  return role === ROLES.BRANCH_ADMIN;
}

export function isManager(role) {
  return role === ROLES.MANAGER;
}

export function isCashier(role) {
  return role === ROLES.CASHIER;
}

export function isViewer(role) {
  return role === ROLES.VIEWER;
}

// ── Branch / warehouse context ─────────────────────────────────────────────
export function canSwitchBranchContext(role) {
  return hasPermission('switch_branch_context', role);
}

export function canSwitchWarehouseContext(role) {
  return hasPermission('switch_warehouse_context', role);
}

export function canApproveWarehouseTransfer(role) {
  return hasPermission('approve_warehouse_transfer', role);
}

export function canManageFeatureToggles(role) {
  return hasPermission('manage_feature_toggles', role);
}

// ── Resource helpers ───────────────────────────────────────────────────────
export function canManageUsers(role) {
  return hasPermission('users:manage', role);
}

export function canViewUsers(role) {
  return hasPermission('view:users', role);
}

export function canDeleteSales(role) {
  return hasPermission('sales:delete', role);
}

export function canRestoreSales(role) {
  return hasPermission('sales:delete', role);
}

export function canCreateSales(role) {
  return hasPermission('sales:create', role);
}

export function canAddPayments(role) {
  return hasPermission('sales:update', role);
}

export function canManageProducts(role) {
  return hasPermission('products:update', role);
}

export function canDeleteProducts(role) {
  return hasPermission('products:delete', role);
}

export function canManageCategories(role) {
  return hasPermission('categories:update', role);
}

export function canManageCustomers(role) {
  return hasPermission('customers:update', role);
}

export function canDeleteCustomers(role) {
  return hasPermission('customers:delete', role);
}

export function canManageSettings(role) {
  return hasPermission('settings:manage', role);
}

export function canViewReports(role) {
  return hasPermission('read:reports', role);
}

// ── Inventory ──────────────────────────────────────────────────────────────
export function canViewInventory(role) {
  return hasPermission('inventory:read', role);
}

export function canAdjustInventory(role) {
  return hasPermission('inventory:adjust', role);
}

export function canRequestTransfer(role) {
  return hasPermission('inventory:transfer', role);
}

export function canManageInventory(role) {
  return hasPermission('inventory:manage', role);
}

// ── Coarse write guard ─────────────────────────────────────────────────────
export function isReadOnly(role) {
  return role === ROLES.VIEWER;
}

export function canWrite(role) {
  return !!role && role !== ROLES.VIEWER;
}

export function canDelete(role) {
  // Any role that can delete sales can delete (covers admins / managers /
  // branch admins). Viewers and cashiers cannot.
  return canDeleteSales(role);
}

// ── Summary helper ─────────────────────────────────────────────────────────
export function getAllowedActions(role) {
  return {
    // scope
    isGlobalAdmin: isGlobalAdmin(role),
    isBranchAdmin: isBranchAdmin(role),
    canSwitchBranchContext: canSwitchBranchContext(role),
    canSwitchWarehouseContext: canSwitchWarehouseContext(role),
    canApproveWarehouseTransfer: canApproveWarehouseTransfer(role),
    canManageFeatureToggles: canManageFeatureToggles(role),

    // resources
    canManageUsers: canManageUsers(role),
    canViewUsers: canViewUsers(role),
    canDeleteSales: canDeleteSales(role),
    canRestoreSales: canRestoreSales(role),
    canCreateSales: canCreateSales(role),
    canAddPayments: canAddPayments(role),
    canManageProducts: canManageProducts(role),
    canDeleteProducts: canDeleteProducts(role),
    canManageCategories: canManageCategories(role),
    canManageCustomers: canManageCustomers(role),
    canDeleteCustomers: canDeleteCustomers(role),
    canManageSettings: canManageSettings(role),
    canViewReports: canViewReports(role),

    // inventory
    canViewInventory: canViewInventory(role),
    canAdjustInventory: canAdjustInventory(role),
    canRequestTransfer: canRequestTransfer(role),
    canManageInventory: canManageInventory(role),

    // coarse
    isReadOnly: isReadOnly(role),
    canWrite: canWrite(role),
    canDelete: canDelete(role),
  };
}

export default {
  // scope
  isGlobalAdmin,
  isBranchAdmin,
  isManager,
  isCashier,
  isViewer,
  canSwitchBranchContext,
  canSwitchWarehouseContext,
  canApproveWarehouseTransfer,
  canManageFeatureToggles,

  // resources
  canManageUsers,
  canViewUsers,
  canDeleteSales,
  canRestoreSales,
  canCreateSales,
  canAddPayments,
  canManageProducts,
  canDeleteProducts,
  canManageCategories,
  canManageCustomers,
  canDeleteCustomers,
  canManageSettings,
  canViewReports,

  // inventory
  canViewInventory,
  canAdjustInventory,
  canRequestTransfer,
  canManageInventory,

  // coarse
  isReadOnly,
  canWrite,
  canDelete,
  getAllowedActions,
};
