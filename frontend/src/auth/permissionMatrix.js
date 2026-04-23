/**
 * Frontend Permission Matrix — mirrors backend/src/auth/permissionMatrix.js.
 *
 * Used by `useAuthStore.hasPermission`, `useNavigationMenu`, and router guards
 * to decide what to show. Backend is still the authority on every mutation.
 */

export const ROLES = Object.freeze({
  GLOBAL_ADMIN: 'global_admin',
  ADMIN: 'admin',
  BRANCH_ADMIN: 'branch_admin',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  VIEWER: 'viewer',
});

const GLOBAL = [ROLES.GLOBAL_ADMIN, ROLES.ADMIN];
const BRANCH_ADMIN = [...GLOBAL, ROLES.BRANCH_ADMIN];
const MANAGER = [...BRANCH_ADMIN, ROLES.MANAGER];
const CASHIER = [...MANAGER, ROLES.CASHIER];
const ALL = [...CASHIER, ROLES.VIEWER];

const PERMISSION_MATRIX = {
  // Sales
  'sales:create': CASHIER,
  'sales:read': ALL,
  'sales:update': CASHIER,
  'sales:delete': MANAGER,

  // Products
  'products:create': MANAGER,
  'products:read': ALL,
  'products:update': MANAGER,
  'products:delete': [...GLOBAL, ROLES.MANAGER],

  // Customers
  'customers:create': CASHIER,
  'customers:read': ALL,
  'customers:update': CASHIER,
  'customers:delete': MANAGER,

  // Categories
  'categories:create': MANAGER,
  'categories:read': ALL,
  'categories:update': MANAGER,
  'categories:delete': [...GLOBAL, ROLES.MANAGER],

  // Frontend view permissions
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

  // Frontend action aliases
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

  // User management
  'users:create': BRANCH_ADMIN,
  'users:read': BRANCH_ADMIN,
  'users:update': BRANCH_ADMIN,
  'users:delete': GLOBAL,
  'users:manage': BRANCH_ADMIN,

  // Settings
  'settings:read': GLOBAL,
  'settings:update': GLOBAL,
  'settings:manage': GLOBAL,
  'settings:create': GLOBAL,
  'settings:delete': GLOBAL,
  'settings:read_public': ALL,

  // Audit log
  'audit:read': GLOBAL,
  'audit:delete': GLOBAL,

  // Inventory
  'inventory:read': ALL,
  'inventory:adjust': MANAGER,
  'inventory:transfer': CASHIER,
  'inventory:manage': BRANCH_ADMIN,

  // Branch / warehouse scope
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

/** Check if a role has a specific permission. */
export function hasPermission(permission, role) {
  if (!permission || !role) return false;
  if (isGlobalRole(role)) return true;

  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

/** Get all permissions for a role. */
export function getRolePermissions(role) {
  if (!role) return [];
  if (isGlobalRole(role)) return Object.keys(PERMISSION_MATRIX);

  return Object.keys(PERMISSION_MATRIX).filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role)
  );
}

/** Pattern helpers kept for backward compat. */
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
