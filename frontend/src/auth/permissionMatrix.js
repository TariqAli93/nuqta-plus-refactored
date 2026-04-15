/**
 * Frontend Permission Matrix
 * Mirrors the backend permission matrix for client-side permission checks
 * This ensures UI visibility matches backend authorization
 */

const PERMISSION_MATRIX = {
  // Sales permissions
  'sales:create': ['admin', 'manager', 'cashier'],
  'sales:read': ['admin', 'manager', 'cashier', 'viewer'],
  'sales:update': ['admin', 'manager', 'cashier'],
  'sales:delete': ['admin', 'manager'],

  // Products permissions
  'products:create': ['admin', 'manager'],
  'products:read': ['admin', 'manager', 'cashier', 'viewer'],
  'products:update': ['admin', 'manager'],
  'products:delete': ['admin', 'manager'],

  // Customers permissions
  'customers:create': ['admin', 'manager', 'cashier'],
  'customers:read': ['admin', 'manager', 'cashier', 'viewer'],
  'customers:update': ['admin', 'manager', 'cashier'],
  'customers:delete': ['admin', 'manager'],

  // Categories permissions
  'categories:create': ['admin', 'manager'],
  'categories:read': ['admin', 'manager', 'cashier', 'viewer'],
  'categories:update': ['admin', 'manager'],
  'categories:delete': ['admin', 'manager'],

  // Frontend view permissions
  'view:dashboard': ['admin', 'manager', 'cashier', 'viewer'],
  'view:sales': ['admin', 'manager', 'cashier', 'viewer'],
  'view:products': ['admin', 'manager', 'cashier', 'viewer'],
  'view:customers': ['admin', 'manager', 'cashier', 'viewer'],
  'view:categories': ['admin', 'manager', 'cashier', 'viewer'],
  'view:reports': ['admin', 'manager', 'cashier', 'viewer'],
  'view:users': ['admin'],
  'view:settings': ['admin'],
  'view:roles': ['admin'], // Legacy - only admin can view
  'view:permissions': ['admin'], // Legacy - only admin can view

  // Frontend action permissions
  'create:sales': ['admin', 'manager', 'cashier'],
  'manage:sales': ['admin', 'manager'],
  'delete:sales': ['admin', 'manager'],
  'create:products': ['admin', 'manager'],
  'manage:products': ['admin', 'manager'],
  'create:customers': ['admin', 'manager', 'cashier'],
  'manage:customers': ['admin', 'manager'],
  'update:customers': ['admin', 'manager', 'cashier'],
  'update:products': ['admin', 'manager'],
  'read:reports': ['admin', 'manager', 'cashier', 'viewer'],

  // User management (admin only)
  'users:create': ['admin'],
  'users:read': ['admin'],
  'users:update': ['admin'],
  'users:delete': ['admin'],
  'users:manage': ['admin'],

  // Settings (admin only)
  'settings:read': ['admin'],
  'settings:update': ['admin'],
  'settings:manage': ['admin'],
  'settings:create': ['admin'],
  'settings:delete': ['admin'],
};

/**
 * Check if a role has a specific permission
 * @param {string} permission - Permission string
 * @param {string} role - User role
 * @returns {boolean} True if role has permission
 */
export function hasPermission(permission, role) {
  if (!permission || !role) return false;

  // Admin has all permissions
  if (role === 'admin') return true;

  // Check permission matrix
  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) {
    // Unknown permission - deny by default
    return false;
  }

  return allowedRoles.includes(role);
}

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {Array<string>} Array of permission strings
 */
export function getRolePermissions(role) {
  if (!role) return [];

  // Admin has all permissions
  if (role === 'admin') {
    return Object.keys(PERMISSION_MATRIX);
  }

  // Return permissions where role is included
  return Object.keys(PERMISSION_MATRIX).filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role)
  );
}

/**
 * Check if permission matches a pattern (for manage:* style checks)
 */
export function matchesPermissionPattern(permission, pattern) {
  if (permission === pattern) return true;

  // Handle manage:* pattern
  if (pattern === 'manage:*') {
    return permission.startsWith('manage:') || permission.includes(':manage');
  }

  // Handle manage:<resource> pattern
  if (pattern.startsWith('manage:')) {
    const resource = pattern.split(':')[1];
    return permission.includes(`:${resource}`) || permission.startsWith(`${resource}:`);
  }

  return false;
}

export default PERMISSION_MATRIX;
