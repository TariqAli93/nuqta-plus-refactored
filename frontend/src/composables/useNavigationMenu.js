import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import * as uiAccess from '@/auth/uiAccess.js';
import { hasPermission as rbacHasPermission } from '@/auth/permissionMatrix.js';

/**
 * Composable for managing navigation menu items
 * Centralizes menu configuration and permission-based filtering
 */
export function useNavigationMenu() {
  const authStore = useAuthStore();

  // Base menu configuration
  const menuItems = [
    { title: 'الرئيسية', icon: 'mdi-view-dashboard', to: '/', permission: null },

    { title: 'المبيعات', icon: 'mdi-cash-register', to: '/sales', permission: 'view:sales' },
    { title: 'العملاء', icon: 'mdi-account-group', to: '/customers', permission: 'view:customers' },
    {
      title: 'المنتجات',
      icon: 'mdi-package-variant',
      to: '/products',
      permission: 'view:products',
    },
    {
      title: 'المخزون',
      icon: 'mdi-warehouse',
      to: '/inventory',
      permission: null,
      feature: 'inventory',
      group: {
        items: [
          { title: 'نظرة عامة', icon: 'mdi-chart-box-outline', to: '/inventory', permission: null },
          { title: 'حركات المخزون', icon: 'mdi-history', to: '/inventory/movements', permission: null },
          { title: 'نقل بين المخازن', icon: 'mdi-transfer', to: '/inventory/transfer', permission: null, feature: 'warehouseTransfers' },
          { title: 'طلبات النقل', icon: 'mdi-check-decagram', to: '/inventory/transfers', permission: null, feature: 'warehouseTransfers' },
          { title: 'منخفض المخزون', icon: 'mdi-alert', to: '/inventory/low-stock', permission: null },
          { title: 'الفروع والمخازن', icon: 'mdi-store', to: '/inventory/settings', permission: 'view:products' },
        ],
      },
    },
    { title: 'التصنيفات', icon: 'mdi-shape', to: '/categories', permission: 'view:categories' },
    {
      title: 'التقارير',
      icon: 'mdi-chart-box',
      to: '/reports',
      permission: 'view:reports',
    },
    { title: 'التنبيهات', icon: 'mdi-bell', to: '/notifications', permission: 'view:sales' },

    {
      title: 'الادارة',
      icon: 'mdi-tools',
      to: '/admin',
      permission: null,
      group: {
        items: [
          { title: 'المستخدمون', icon: 'mdi-account', to: '/users', permission: 'view:users' },
          { title: 'الأدوار', icon: 'mdi-shield-account', to: '/roles', permission: 'view:roles' },
          {
            title: 'الصلاحيات',
            icon: 'mdi-shield-key',
            to: '/permissions',
            permission: 'view:permissions',
          },
          { title: 'الاعدادات', icon: 'mdi-cog', to: '/settings', permission: 'view:settings' },
          { title: 'إعدادات الميزات', icon: 'mdi-toggle-switch', to: '/settings/feature-flags', permission: 'manage_feature_toggles' },
        ],
      },
    },

    { title: 'حول البرنامج', icon: 'mdi-information', to: '/about', permission: null },
  ];

  /**
   * Check if a menu item should be visible based on user permissions.
   * Also honours feature flags — an item with `feature: 'inventory'` is hidden
   * when the inventory flag is off.
   */
  const checkVisibility = (item, userRole) => {
    // Feature flag gate
    if (item.feature && authStore.featureFlags?.[item.feature] === false) return false;

    const permission = item.permission;
    if (!permission) return true;

    // Legacy UI access helpers for specific permissions
    if (permission === 'view:users' && !uiAccess.canViewUsers(userRole)) return false;
    if (permission === 'view:settings' && !uiAccess.canManageSettings(userRole)) return false;
    if (permission === 'view:roles' || permission === 'view:permissions') return false;

    // Fall back to the central permission matrix (covers new perms like
    // `manage_feature_toggles`, `approve_warehouse_transfer`, …).
    return rbacHasPermission(permission, userRole);
  };

  /**
   * Filter menu items based on user role, permissions, and feature flags.
   */
  const filteredMenu = computed(() => {
    const userRole = authStore.user?.role;
    if (!userRole) return [];

    return menuItems
      .map((item) => {
        if (!item.group) {
          return checkVisibility(item, userRole) ? item : null;
        }

        // Top-level group visibility respects its own feature flag.
        if (item.feature && authStore.featureFlags?.[item.feature] === false) return null;

        const allowedSubs = item.group.items.filter((sub) => checkVisibility(sub, userRole));
        if (allowedSubs.length === 0) return null;
        return { ...item, group: { items: allowedSubs } };
      })
      .filter(Boolean);
  });

  /**
   * Find menu item by route path
   */
  const findMenuItemByPath = (path) => {
    // Check main items
    const mainItem = menuItems.find((item) => item.to === path);
    if (mainItem) return mainItem;

    // Check sub-items
    for (const menuItem of menuItems) {
      if (menuItem.group) {
        const subItem = menuItem.group.items.find((sub) => sub.to === path);
        if (subItem) return subItem;
      }
    }

    return null;
  };

  /**
   * Get page title from route path
   */
  const getPageTitle = (path) => {
    const item = findMenuItemByPath(path);
    return item?.title || 'نقطة بلس';
  };

  return {
    menuItems,
    filteredMenu,
    findMenuItemByPath,
    getPageTitle,
  };
}
