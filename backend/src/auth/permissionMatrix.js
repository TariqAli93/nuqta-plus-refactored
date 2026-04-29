/**
 * Permission Matrix — single source of truth for RBAC.
 *
 * Roles:
 * - global_admin: Cross-branch access. Can switch branch/warehouse context,
 *                 manage feature flags, approve any transfer.
 * - admin: Legacy full-access role. Treated as global_admin for authorization.
 * - branch_admin: Admin for one branch. Can approve transfers inside their branch
 *                 and create/delete warehouses in that branch.
 * - branch_manager: Like branch_admin but can NOT create/delete branches or
 *                   warehouses. Can change the branch's default warehouse,
 *                   transfer stock inside the branch, and switch active
 *                   warehouse within the branch.
 * - manager: Manages sales, products, customers inside their branch.
 * - cashier: Creates sales, reads data; cannot delete or manage users.
 * - viewer: Read-only.
 */

// ── Role groups ───────────────────────────────────────────────────────────
// Keep role lists named so they stay consistent and easy to audit.
export const ROLES = Object.freeze({
  GLOBAL_ADMIN: 'global_admin',
  ADMIN: 'admin',
  BRANCH_ADMIN: 'branch_admin',
  BRANCH_MANAGER: 'branch_manager',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  VIEWER: 'viewer',
});

const GLOBAL = [ROLES.GLOBAL_ADMIN, ROLES.ADMIN];
const BRANCH_ADMIN = [...GLOBAL, ROLES.BRANCH_ADMIN];
// Branch managers sit between branch_admin and manager: they get
// branch-scoped admin privileges that don't create/delete branches or
// warehouses.
const BRANCH_MANAGER = [...BRANCH_ADMIN, ROLES.BRANCH_MANAGER];
const MANAGER = [...BRANCH_MANAGER, ROLES.MANAGER];
const CASHIER = [...MANAGER, ROLES.CASHIER];
const ALL = [...CASHIER, ROLES.VIEWER];

const PERMISSION_MATRIX = {
  // ── Sales ────────────────────────────────────────────────────────────────
  'sales:create': CASHIER,
  'sales:read': ALL,
  'sales:update': CASHIER,
  'sales:delete': MANAGER,
  'sales.override_credit_limit': MANAGER,

  // ── Cash sessions / shift closing ────────────────────────────────────────
  // Any cashier (and above) opens / closes their own shift. Reading a session
  // is allowed for everyone in scope so reports and audit screens render.
  'cash_sessions:open': CASHIER,
  'cash_sessions:close': CASHIER,
  'cash_sessions:read': ALL,

  // ── Products ─────────────────────────────────────────────────────────────
  'products:create': MANAGER,
  'products:read': ALL,
  'products:update': MANAGER,
  'products:delete': [...GLOBAL, ROLES.MANAGER], // skip branch_admin for delete

  // ── Customers ────────────────────────────────────────────────────────────
  'customers:create': CASHIER,
  'customers:read': ALL,
  'customers:update': CASHIER,
  'customers:delete': MANAGER,

  // ── Categories ───────────────────────────────────────────────────────────
  'categories:create': MANAGER,
  'categories:read': ALL,
  'categories:update': MANAGER,
  'categories:delete': [...GLOBAL, ROLES.MANAGER],

  // ── Frontend view permissions ───────────────────────────────────────────
  'view:dashboard': ALL,
  'view:sales': ALL,
  'view:products': ALL,
  'view:customers': ALL,
  'view:categories': ALL,
  'view:reports': ALL,
  'view:inventory': ALL,
  'view:users': BRANCH_ADMIN,
  'view:settings': GLOBAL,
  'view:roles': GLOBAL,
  'view:permissions': GLOBAL,
  'view:audit': GLOBAL,

  // ── Frontend action aliases (kept for backward compat) ──────────────────
  'create:sales': CASHIER,
  'manage:sales': MANAGER,
  'delete:sales': MANAGER,
  'create:products': MANAGER,
  'manage:products': MANAGER,
  'create:customers': CASHIER,
  'manage:customers': MANAGER,
  'update:customers': CASHIER,
  'update:products': MANAGER,
  'read:reports': ALL,

  // ── User management ──────────────────────────────────────────────────────
  // Branch admins manage users inside their branch; global admins manage all.
  'users:create': BRANCH_ADMIN,
  'users:read': BRANCH_MANAGER,
  'users:update': BRANCH_ADMIN,
  'users:delete': GLOBAL,
  'users:manage': BRANCH_ADMIN,

  // ── Settings ─────────────────────────────────────────────────────────────
  // Administrative settings require global admin.
  'settings:read': GLOBAL,
  'settings:update': GLOBAL,
  'settings:manage': GLOBAL,
  'settings:create': GLOBAL,
  'settings:delete': GLOBAL,
  // Public-read settings (currency, company info) — needed everywhere in the UI.
  'settings:read_public': ALL,

  // ── Audit log ────────────────────────────────────────────────────────────
  'audit:read': GLOBAL,
  'audit:delete': GLOBAL,

  // ── Inventory ────────────────────────────────────────────────────────────
  'inventory:read': ALL,
  'inventory:adjust': MANAGER,
  // Cashiers create transfer *requests* (those go to the approval queue).
  'inventory:transfer': CASHIER,
  // Branch/warehouse CRUD — restricted to branch_admin and global admins.
  // Branch managers intentionally lack this so they can't create/delete
  // warehouses or rename branches; their branch-config rights are limited
  // to the dedicated `branches:set_default_warehouse` permission below.
  'inventory:manage': BRANCH_ADMIN,
  // Granular: change the branch's default warehouse only. Branch managers
  // get this so they can pick the active default for their own branch.
  'branches:set_default_warehouse': BRANCH_MANAGER,

  // ── Branch / warehouse scope ─────────────────────────────────────────────
  manage_all_branches: GLOBAL,
  switch_branch_context: GLOBAL,
  switch_warehouse_context: GLOBAL,
  approve_warehouse_transfer: BRANCH_ADMIN,
  manage_feature_toggles: GLOBAL,
};

/** Any role that grants full cross-branch access. */
export function isGlobalRole(role) {
  return role === ROLES.GLOBAL_ADMIN || role === ROLES.ADMIN;
}

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(permission, role) {
  if (!permission || !role) return false;

  // Global admins have everything.
  if (isGlobalRole(role)) return true;

  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) {
    // Unknown permission — deny by default (fail secure).
    console.warn(`Unknown permission: ${permission}`);
    return false;
  }

  return allowedRoles.includes(role);
}

/**
 * Get all permissions for a role.
 */
export function getRolePermissions(role) {
  if (!role) return [];
  if (isGlobalRole(role)) return Object.keys(PERMISSION_MATRIX);

  return Object.keys(PERMISSION_MATRIX).filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role)
  );
}

/**
 * Pattern helpers kept for backward compat with existing callers.
 */
export function matchesPermissionPattern(permission, pattern) {
  if (permission === pattern) return true;

  if (pattern === 'manage:*') {
    return permission.startsWith('manage:') || permission.includes(':manage');
  }

  if (pattern.startsWith('manage:')) {
    const resource = pattern.split(':')[1];
    return permission.includes(`:${resource}`) || permission.startsWith(`${resource}:`);
  }

  return false;
}

export default PERMISSION_MATRIX;
