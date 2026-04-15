import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import * as uiAccess from '@/auth/uiAccess.js';

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
        ],
      },
    },

    { title: 'حول البرنامج', icon: 'mdi-information', to: '/about', permission: null },
  ];

  /**
   * Check if a menu item should be visible based on user permissions
   */
  const checkPermission = (permission, userRole) => {
    if (!permission) return true;

    // Map old permissions to role checks
    if (permission === 'view:users' && !uiAccess.canViewUsers(userRole)) return false;
    if (permission === 'view:settings' && !uiAccess.canManageSettings(userRole)) return false;
    if (permission === 'view:roles' || permission === 'view:permissions') {
      // Legacy routes - hide them
      return false;
    }

    // All other view permissions are allowed for authenticated users
    return true;
  };

  /**
   * Filter menu items based on user role and permissions
   */
  const filteredMenu = computed(() => {
    const userRole = authStore.user?.role;
    if (!userRole) return [];

    return menuItems
      .map((item) => {
        // Handle non-group items
        if (!item.group) {
          // Check both permission
          if (!checkPermission(item.permission, userRole)) return null;
          return item;
        }

        // Handle group items (sub items)
        const allowedSubs = item.group.items.filter((sub) => {
          const hasPermission = checkPermission(sub.permission, userRole);
          return hasPermission;
        });

        // If no allowed sub-items, hide the entire group
        if (allowedSubs.length === 0) return null;

        // Return group with filtered sub-items
        return {
          ...item,
          group: { items: allowedSubs },
        };
      })
      .filter(Boolean); // Remove null items
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
