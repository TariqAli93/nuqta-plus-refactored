import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { hasPermission as rbacHasPermission } from '@/auth/permissionMatrix.js';

/**
 * Navigation menu composable.
 *
 * Three top-level sections (Operations / Inventory / Administration) to keep
 * the sidebar short and scannable. Each item can declare:
 *
 *   - `permission`: RBAC permission required (checked via permissionMatrix)
 *   - `feature`:    feature flag that must be enabled
 *   - `roles`:      explicit allow-list of roles (rarely used)
 *   - `group`:      sub-items for a collapsible group
 *
 * A section is hidden entirely when all of its items are hidden.
 */
export function useNavigationMenu() {
  const authStore = useAuthStore();

  const sections = [
    {
      title: 'الرئيسية',
      icon: 'mdi-view-dashboard',
      to: '/',
      permission: null,
    },
    { title: 'نقطة البيع', icon: 'mdi-point-of-sale', to: '/sales/pos', permission: 'create:sales' },

    // ── Operations ─────────────────────────────────────────────────────────
    {
      title: 'العمليات',
      icon: 'mdi-cash-register',
      to: '/operations',
      group: {
        items: [
          
          { title: 'المبيعات', icon: 'mdi-cash-register', to: '/sales', permission: 'view:sales' },
          { title: 'العملاء', icon: 'mdi-account-group', to: '/customers', permission: 'view:customers' },
          {
            title: 'المنتجات',
            icon: 'mdi-package-variant',
            to: '/products',
            permission: 'view:products',
          },
          {
            title: 'التصنيفات',
            icon: 'mdi-shape',
            to: '/categories',
            permission: 'view:categories',
          },
          {
            title: 'التقارير',
            icon: 'mdi-chart-box',
            to: '/reports',
            permission: 'view:reports',
          },
        ],
      },
    },

    // ── Inventory (only when enabled) ──────────────────────────────────────
    {
      title: 'المخزون',
      icon: 'mdi-warehouse',
      to: '/inventory',
      feature: 'inventory',
      permission: 'view:inventory',
      group: {
        items: [
          {
            title: 'نظرة عامة',
            icon: 'mdi-chart-box-outline',
            to: '/inventory',
            permission: 'view:inventory',
          },
          {
            title: 'حركات المخزون',
            icon: 'mdi-history',
            to: '/inventory/movements',
            permission: 'view:inventory',
          },
          {
            title: 'نقل بين المخازن',
            icon: 'mdi-transfer',
            to: '/inventory/transfer',
            permission: 'inventory:transfer',
            feature: 'warehouseTransfers',
          },
          {
            title: 'طلبات النقل',
            icon: 'mdi-check-decagram',
            to: '/inventory/transfers',
            permission: 'inventory:transfer',
            feature: 'warehouseTransfers',
          },
          {
            title: 'منخفض المخزون',
            icon: 'mdi-alert',
            to: '/inventory/low-stock',
            permission: 'view:inventory',
          },
        ],
      },
    },

    // ── Administration (admins only) ───────────────────────────────────────
    {
      title: 'الإدارة',
      icon: 'mdi-tools',
      to: '/admin',
      group: {
        items: [
          { title: 'المستخدمون', icon: 'mdi-account', to: '/users', permission: 'view:users' },
          {
            title: 'الفروع والمخازن',
            icon: 'mdi-store',
            to: '/inventory/settings',
            permission: 'inventory:manage',
            // Only relevant when at least one of the branch/warehouse features is on
            anyFeature: ['multiBranch', 'multiWarehouse'],
          },
          {
            title: 'الإعدادات',
            icon: 'mdi-cog',
            to: '/settings',
            permission: 'view:settings',
          },
          {
            title: 'إعدادات الميزات',
            icon: 'mdi-toggle-switch',
            to: '/settings/feature-flags',
            permission: 'manage_feature_toggles',
          },
        ],
      },
    },

    { title: 'حول البرنامج', icon: 'mdi-information', to: '/about', permission: null },
  ];

  /** True if the menu entry should be visible for the current user. */
  const checkVisibility = (item, userRole) => {
    // Feature flag gate (single flag)
    if (item.feature && authStore.featureFlags?.[item.feature] === false) return false;

    // "anyFeature" gate — show if ANY listed flag is enabled
    if (Array.isArray(item.anyFeature) && item.anyFeature.length > 0) {
      const anyOn = item.anyFeature.some(
        (f) => authStore.featureFlags?.[f] !== false
      );
      if (!anyOn) return false;
    }

    // Role allow-list
    if (Array.isArray(item.roles) && item.roles.length && !item.roles.includes(userRole)) {
      return false;
    }

    // RBAC permission check (falls through to central matrix)
    if (item.permission && !rbacHasPermission(item.permission, userRole)) {
      return false;
    }

    return true;
  };

  const filteredMenu = computed(() => {
    const userRole = authStore.user?.role;
    if (!userRole) return [];

    return sections
      .map((item) => {
        // Non-group: single item
        if (!item.group) {
          return checkVisibility(item, userRole) ? item : null;
        }

        // Group-level flag (e.g. hide the whole Inventory group when inventory is off)
        if (item.feature && authStore.featureFlags?.[item.feature] === false) return null;
        if (item.permission && !rbacHasPermission(item.permission, userRole)) return null;

        const allowedSubs = item.group.items.filter((sub) => checkVisibility(sub, userRole));
        if (allowedSubs.length === 0) return null;
        return { ...item, group: { items: allowedSubs } };
      })
      .filter(Boolean);
  });

  const findMenuItemByPath = (path) => {
    for (const item of sections) {
      if (item.to === path) return item;
      if (item.group) {
        const sub = item.group.items.find((s) => s.to === path);
        if (sub) return sub;
      }
    }
    return null;
  };

  const getPageTitle = (path) => {
    // Longest-prefix match so /inventory/movements still picks up a label
    const exact = findMenuItemByPath(path);
    if (exact) return exact.title;

    const allItems = sections.flatMap((s) => (s.group ? s.group.items : [s]));
    const match = allItems
      .filter((i) => i.to && path.startsWith(i.to))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return match?.title || 'نقطة بلس';
  };

  return {
    menuItems: sections,
    filteredMenu,
    findMenuItemByPath,
    getPageTitle,
  };
}
