import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';
import { hasPermission, matchesPermissionPattern } from '@/auth/permissionMatrix.js';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Aliases between feature-flag names. Lets `can('inventoryTransfers')` and
 * `can('warehouseTransfers')` resolve to the same flag value, so component
 * code can use either naming convention.
 */
const FLAG_ALIASES = Object.freeze({
  inventoryTransfers: 'warehouseTransfers',
  warehouseTransfers: 'inventoryTransfers',
});

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('token') || null,
    isAuthenticated: false,
    isFirstRun: false,
    scope: null,
    featureFlags: {},
    setupMode: 'done',
    // Backend-provided UI capability flags. Frontend treats this as the
    // single source of truth for what to render — never re-derive these
    // from role. See backend/src/services/permissionService.js.
    capabilities: readJSON('capabilities') || {},
  }),

  getters: {
    currentUser: (state) => state.user,
    userRole: (state) => state.user?.role || null,
    isGlobalAdmin: (state) =>
      state.user?.role === 'global_admin' || state.user?.role === 'admin',
    canSwitchBranch: (state) => state.scope?.canSwitchBranch === true,
    canSwitchWarehouse: (state) => state.scope?.canSwitchWarehouse === true,
    assignedBranchId: (state) =>
      state.scope?.branchId ?? state.user?.assignedBranchId ?? null,
    assignedWarehouseId: (state) =>
      state.scope?.warehouseId ?? state.user?.assignedWarehouseId ?? null,
    branchFeatureEnabled() {
      // Prefer scope.branchFeatureEnabled (server-resolved); fall back to
      // the alias-aware feature lookup so a stale cache still answers right.
      if (this.scope?.branchFeatureEnabled !== undefined) {
        return !!this.scope.branchFeatureEnabled;
      }
      return this.hasFeature('multiBranch');
    },
    allowedBranchIds: (state) => state.scope?.allowedBranchIds || [],
    allowedWarehouseIds: (state) => state.scope?.allowedWarehouseIds || [],

    /**
     * `hasFeature(flag)` — returns true when the named feature flag is
     * enabled in the backend-provided featureFlags map. Aliases resolve to
     * the canonical key (warehouseTransfers ↔ inventoryTransfers).
     */
    hasFeature: (state) => (flag) => {
      if (!flag) return false;
      const flags = state.featureFlags || {};
      if (flags[flag] !== undefined) return flags[flag] !== false;
      const alias = FLAG_ALIASES[flag];
      if (alias && flags[alias] !== undefined) return flags[alias] !== false;
      return false;
    },

    // Kept for backward compatibility — uses the alias-aware lookup.
    isFeatureEnabled() {
      return this.hasFeature;
    },

    /**
     * `can(name)` — single source of truth for UI visibility decisions.
     * Resolves to a backend-issued capability flag first, falling back to a
     * feature flag with the same name (e.g. `can('pos')` checks featureFlags.pos
     * when there is no `canUsePos` capability). Returns boolean.
     *
     * Use this in components instead of role checks: components stay agnostic
     * of role and feature topology — the backend tells the frontend what can
     * be rendered.
     */
    can: (state) => (name) => {
      if (!name) return false;
      const caps = state.capabilities || {};
      // Direct capability hit (e.g. canCreateBranch).
      if (caps[name] !== undefined) return caps[name] === true;

      // Feature flag fallback (e.g. can('installments')).
      const flags = state.featureFlags || {};
      if (flags[name] !== undefined) return flags[name] !== false;
      const alias = FLAG_ALIASES[name];
      if (alias && flags[alias] !== undefined) return flags[alias] !== false;
      return false;
    },

    needsSetupWizard: (state) =>
      state.setupMode === 'pending' &&
      (state.user?.role === 'global_admin' || state.user?.role === 'admin'),

    /**
     * Check if user has a specific permission
     * Uses the permission matrix to check if user's role has the permission
     * @param {string|Array} permission - Permission name or array of permissions
     * @returns {boolean} True if user has the permission
     */
    hasPermission: (state) => (permission) => {
      const userRole = state.user?.role;
      if (!userRole) return false;

      const permissionList = Array.isArray(permission) ? permission : [permission];

      return permissionList.some((perm) => {
        // Skip invalid permission values
        if (!perm || typeof perm !== 'string') return false;

        // Check permission using matrix
        if (hasPermission(perm, userRole)) return true;

        // Check for manage:<resource> pattern
        // If checking for 'create:sales' and user has 'manage:sales', allow
        const parts = perm.split(':');
        if (parts.length === 2) {
          const managePerm = `manage:${parts[1]}`;
          if (hasPermission(managePerm, userRole)) return true;
        }

        // Check for manage:* pattern (admin only, but handled by matrix)
        if (matchesPermissionPattern(perm, 'manage:*')) {
          return hasPermission('manage:*', userRole);
        }

        return false;
      });
    },

    /**
     * Check if user has any of the provided permissions
     */
    hasAnyPermission:
      (state) =>
      (permissions = []) => {
        const userRole = state.user?.role;
        if (!userRole) return false;
        return permissions.some((perm) => hasPermission(perm, userRole));
      },

    /**
     * Check if user has all of the provided permissions
     */
    hasAllPermissions:
      (state) =>
      (permissions = []) => {
        const userRole = state.user?.role;
        if (!userRole) return false;
        return permissions.every((perm) => hasPermission(perm, userRole));
      },
  },

  actions: {
    /**
     * Hydrate the store from a `/auth/session`-shaped payload. Used by both
     * login and `refreshSession()` so the persistence layer has a single
     * code path. LocalStorage is treated as an offline cache for resume; it
     * never overrides what the server returned.
     */
    _hydrateFromSession(payload) {
      this.user = payload.user || null;
      this.scope = payload.scope || null;
      this.featureFlags = payload.featureFlags || {};
      this.setupMode = payload.setupMode || 'done';
      this.capabilities = payload.capabilities || {};

      if (this.user) localStorage.setItem('user', JSON.stringify(this.user));
      if (this.scope) localStorage.setItem('scope', JSON.stringify(this.scope));
      localStorage.setItem('featureFlags', JSON.stringify(this.featureFlags));
      localStorage.setItem('capabilities', JSON.stringify(this.capabilities));
    },

    /**
     * Login user with credentials
     * @param {Object} credentials - Username and password
     */
    async login(credentials) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/auth/login', credentials);

        if (!response.data?.token || !response.data?.user) {
          throw new Error('Invalid response from server');
        }

        this.token = response.data.token;
        this.isAuthenticated = true;
        localStorage.setItem('token', response.data.token);
        api.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;

        // Hydrate from the same shape as /auth/session so login + bootstrap
        // share one persistence path.
        this._hydrateFromSession({
          user: response.data.user,
          scope: response.data.scope,
          featureFlags: response.data.featureFlags,
          setupMode: response.data.setupMode,
          capabilities: response.data.capabilities,
        });

        // Hydrate branch + warehouse state in a single, ordered flow so the
        // dashboard/POS sees the right context immediately after login.
        await this.bootstrapSession();

        notificationStore.success('تم تسجيل الدخول بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'فشل تسجيل الدخول';
        notificationStore.error(errorMessage);
        throw error;
      }
    },

    /**
     * Refresh the canonical session/bootstrap payload from the backend and
     * rehydrate featureFlags + capabilities. Call this after a settings
     * change, after the feature-flags page toggles a flag, or any other time
     * the SPA needs to pick up server-side changes WITHOUT a full reload.
     *
     * Stale branch/warehouse state is reconciled by `bootstrapSession()`
     * which the inventory store reset/initialize handles.
     */
    async refreshSession({ resetInventory = true } = {}) {
      if (!this.token) return null;
      try {
        const response = await api.get('/auth/session');
        const payload = response.data || {};
        this._hydrateFromSession(payload);
        if (resetInventory) {
          // Rebuild branch/warehouse context — feature flag changes can flip
          // multiBranch, which changes which warehouses are visible.
          await this.bootstrapSession();
        }
        return payload;
      } catch (error) {
        // Non-fatal: callers can decide to log out on auth failures.
        if (error?.response?.status === 401) {
          this.logout();
        }
        return null;
      }
    },

    /**
     * Single post-auth initialization flow.
     *
     *   loadSettings → loadCurrentUser → resolveActiveBranch → resolveActiveWarehouse
     *
     * The current user, scope and feature flags are already on the store at
     * this point (login response or /auth/profile). This method delegates the
     * branch/warehouse resolution to the inventory store so we have a single
     * source of truth and avoid race conditions where warehouses load before
     * the branch is known.
     */
    async bootstrapSession() {
      if (!this.isAuthenticated) return;
      // Lazy-import to avoid a circular dependency at module load time.
      const { useInventoryStore } = await import('@/stores/inventory');
      const inventoryStore = useInventoryStore();
      try {
        await inventoryStore.initialize({ force: true });
      } catch {
        // Non-fatal: the user can still navigate; individual screens will
        // surface their own errors.
      }
    },

    /**
     * Check authentication status on app load. Hits `/auth/session` so the
     * SPA always boots from the backend's source-of-truth payload — local
     * cache is only used to gate the request, never to decide UI visibility.
     */
    async checkAuth() {
      const token = localStorage.getItem('token');
      if (!token) {
        this.isAuthenticated = false;
        return;
      }

      try {
        this.token = token;
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

        // Fetch the canonical session payload. This validates the token AND
        // hydrates featureFlags/capabilities/scope in one round-trip.
        const session = await this.refreshSession({ resetInventory: false });
        if (!session || !session.user) {
          this.logout();
          return;
        }
        this.isAuthenticated = true;
        // Re-resolve branch/warehouse on app reload too, so a refresh honors
        // a freshly-changed assigned branch or feature flag.
        await this.bootstrapSession();
      } catch {
        // Token is invalid, clear everything
        this.logout();
      }
    },

    /**
     * Get current user profile (legacy `/auth/profile`). Kept for
     * backward-compat; `refreshSession()` is the preferred entry point now.
     */
    async getProfile() {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/auth/profile');

        if (response.data) {
          const { scope, featureFlags, setupMode, capabilities, ...userOnly } = response.data;
          this._hydrateFromSession({
            user: userOnly,
            scope,
            featureFlags,
            setupMode,
            capabilities,
          });
        }

        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل بيانات المستخدم';
        notificationStore.error(errorMessage);
        throw error;
      }
    },

    /**
     * Persist updated feature flags returned from the feature-flags API
     * and re-fetch the canonical session so capabilities + scope reflect
     * the new flag state. This guarantees that ALL feature-flag changes
     * (not just multiBranch) cause an immediate UI refresh.
     */
    async setFeatureFlags(flags) {
      this.featureFlags = flags || {};
      localStorage.setItem('featureFlags', JSON.stringify(this.featureFlags));
      if (!this.isAuthenticated) return;
      // Refresh /auth/session so capabilities (which depend on flags) are
      // recomputed by the backend, and so scope (e.g. allowedWarehouseIds)
      // reflects whether multiBranch / multiWarehouse changed.
      await this.refreshSession();
    },

    /**
     * Logout user and clear ALL session-bound state — including feature flags
     * and capabilities — so the next login can never inherit a stale "feature
     * X is on" assumption from the previous user/session.
     */
    logout() {
      const notificationStore = useNotificationStore();

      this.user = null;
      this.token = null;
      this.isAuthenticated = false;
      this.scope = null;
      this.featureFlags = {};
      this.setupMode = 'done';
      this.capabilities = {};

      // localStorage may also contain stale UI preferences keyed off
      // feature-dependent state (selected branch/warehouse, feature flags
      // cache). Wipe them all so the next session bootstraps cleanly.
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('scope');
      localStorage.removeItem('featureFlags');
      localStorage.removeItem('capabilities');
      localStorage.removeItem('selectedBranchId');
      localStorage.removeItem('selectedWarehouseId');

      // Remove authorization header
      delete api.defaults.headers.common['Authorization'];

      // Clear branch/warehouse state so the next login starts clean.
      // Lazy-imported to avoid a circular dependency.
      import('@/stores/inventory')
        .then((mod) => mod.useInventoryStore().reset())
        .catch(() => {});

      notificationStore.info('تم تسجيل الخروج بنجاح');
    },

    /**
     * Register new user
     */
    async register(userData) {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/auth/register', userData);
        notificationStore.success('تم تسجيل المستخدم بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تسجيل المستخدم');
        throw error;
      }
    },

    /**
     * Fetch initial setup information
     */
    async fetchInitialSetupInfo() {
      try {
        const response = await api.get('/auth/initial-setup');

        // البيانات موجودة مباشرة في response.data
        if (response.data) {
          this.isFirstRun = response.data.isFirstRun;
          return response.data;
        }
        return { isFirstRun: false };
      } catch {
        return { isFirstRun: false };
      }
    },

    async createFirstUser(userData) {
      const response = await api.post('/auth/first-user', userData);
      if (response.data) {
        return response.data;
      }
      throw new Error('Invalid response from server');
    },

    resetAuth() {
      this.user = null;
      this.token = null;
      this.isAuthenticated = false;
      this.isFirstRun = false;

      localStorage.clear();

      // Remove authorization header
      delete api.defaults.headers.common['Authorization'];
    },
  },
});
