/**
 * UI Access Control Helper
 *
 * This module provides role-based UI access control functions.
 * Since backend no longer enforces authorization, all access control
 * is handled here in the frontend via UI hiding.
 *
 * WARNING: This is frontend-only security. Anyone with a valid token
 * can call any backend endpoint directly. This approach is suitable
 * only for single-machine offline usage or trusted environments.
 *
 * Roles:
 * - admin: Full access to everything
 * - manager: Can manage sales/products/customers/categories, but not users/settings
 * - cashier: Can create sales, read data, but cannot delete or manage users/products
 * - viewer: Read-only access to all resources
 */

/**
 * Check if role can manage users
 */
export function canManageUsers(role) {
  return role === 'admin';
}

/**
 * Check if role can delete sales
 */
export function canDeleteSales(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Check if role can restore cancelled sales
 */
export function canRestoreSales(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Check if role can create/edit/delete products
 */
export function canManageProducts(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Check if role can create/edit/delete categories
 */
export function canManageCategories(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Check if role can create/edit customers
 */
export function canManageCustomers(role) {
  return role === 'admin' || role === 'manager' || role === 'cashier';
}

/**
 * Check if role can delete customers
 */
export function canDeleteCustomers(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Check if role can create sales
 */
export function canCreateSales(role) {
  return role === 'admin' || role === 'manager' || role === 'cashier';
}

/**
 * Check if role can add payments to sales
 */
export function canAddPayments(role) {
  return role === 'admin' || role === 'manager' || role === 'cashier';
}

/**
 * Check if role can view/edit settings
 */
export function canManageSettings(role) {
  return role === 'admin';
}

/**
 * Check if role can view users page
 */
export function canViewUsers(role) {
  return role === 'admin';
}

/**
 * Check if role can view reports
 */
export function canViewReports(role) {
  return role === 'admin' || role === 'manager' || role === 'cashier' || role === 'viewer';
}

/**
 * Check if role has read-only access (viewer)
 */
export function isReadOnly(role) {
  return role === 'viewer';
}

/**
 * Check if role can perform any write operations
 */
export function canWrite(role) {
  return role !== 'viewer';
}

/**
 * Check if role can perform delete operations (any resource)
 */
export function canDelete(role) {
  return role === 'admin' || role === 'manager';
}

/**
 * Get all allowed actions for a role
 */
export function getAllowedActions(role) {
  return {
    canManageUsers: canManageUsers(role),
    canDeleteSales: canDeleteSales(role),
    canRestoreSales: canRestoreSales(role),
    canManageProducts: canManageProducts(role),
    canManageCategories: canManageCategories(role),
    canManageCustomers: canManageCustomers(role),
    canDeleteCustomers: canDeleteCustomers(role),
    canCreateSales: canCreateSales(role),
    canAddPayments: canAddPayments(role),
    canManageSettings: canManageSettings(role),
    canViewUsers: canViewUsers(role),
    canViewReports: canViewReports(role),
    isReadOnly: isReadOnly(role),
    canWrite: canWrite(role),
    canDelete: canDelete(role),
  };
}

export default {
  canManageUsers,
  canDeleteSales,
  canRestoreSales,
  canManageProducts,
  canManageCategories,
  canManageCustomers,
  canDeleteCustomers,
  canCreateSales,
  canAddPayments,
  canManageSettings,
  canViewUsers,
  canViewReports,
  isReadOnly,
  canWrite,
  canDelete,
  getAllowedActions,
};
