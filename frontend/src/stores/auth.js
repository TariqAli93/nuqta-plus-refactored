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
 * Aliases between feature-flag names. Lets `hasFeature('inventoryTransfers')`
 * and `hasFeature('warehouseTransfers')` resolve to the same flag value, so
 * component code can use either naming convention.
 */
const FLAG_ALIASES = Object.freeze({
  inventoryTransfers: 'warehouseTransfers',
  warehouseTransfers: 'inventoryTransfers',
});

function normalizeFeatureAlias(flag) {
  if (!flag) return flag;
  return FLAG_ALIASES[flag] || flag;
}

// Concurrency latch for refreshSession. Lives on the module (not the store
// state) because it's a transient promise — surfacing it as state would mark
// the entire store dirty on every refresh and trigger reactivity loops.
let _hydrationPromise = null;

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

    // ── Hydration lifecycle ────────────────────────────────────────────────
    // `isHydrated` flips to true ONLY after a successful /auth/session load.
    // UI gating helpers (`can`, `hasFeature`) return false until then so a
    // route guard or button never flashes "allowed" before the server has
    // confirmed the user's capabilities.
    isHydrated: false,
    isHydrating: false,
    hydrationError: null,
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
     * `hasFeature(flag)` — strict lookup against the backend-provided
     * featureFlags map. Defaults to `false` when the flag isn't present
     * (i.e. before hydration) so unauthorized UI never flashes.
     *
     * Aliases resolve to the canonical key
     * (warehouseTransfers ↔ inventoryTransfers).
     */
    hasFeature: (state) => (flag) => {
      if (!flag) return false;
      const flags = state.featureFlags || {};
      // Strict equality: anything other than `=== true` (incl. undefined,
      // null, or an unhydrated empty object) is treated as disabled. This
      // is the "default deny" rule the spec calls for.
      if (flags[flag] === true) return true;
      const alias = FLAG_ALIASES[flag];
      if (alias && flags[alias] === true) return true;
      return false;
    },

    /**
     * `can(capabilityName)` — single source of truth for UI visibility
     * decisions. Strictly checks the backend-issued capabilities map; never
     * falls back to role checks or feature flags.
     *
     * Returns `false` for any capability not explicitly true (including
     * before hydration), matching the "default deny" rule.
     */
    can: (state) => (capabilityName) => {
      if (!capabilityName) return false;
      const caps = state.capabilities || {};
      return caps[capabilityName] === true;
    },

    /**
     * `canUse(featureName, capabilityName)` — combined feature + capability
     * gate. Use this in components instead of writing
     * `hasFeature(x) && can(y)` everywhere.
     */
    canUse() {
      return (featureName, capabilityName) =>
        this.hasFeature(featureName) && this.can(capabilityName);
    },

    /** Spec-aligned alias of `canUse`. */
    featureAndCapability() {
      return (featureName, capabilityName) =>
        this.canUse(featureName, capabilityName);
    },

    /**
     * `canAny([...])` — true when the user has at least one of the listed
     * capabilities. Mirrors `hasAnyPermission` but reads capabilities, not
     * the role-based permission matrix.
     */
    canAny() {
      return (capabilityNames = []) =>
        Array.isArray(capabilityNames) && capabilityNames.some((n) => this.can(n));
    },

    /**
     * `canAll([...])` — true when ALL listed capabilities are granted.
     */
    canAll() {
      return (capabilityNames = []) =>
        Array.isArray(capabilityNames) &&
        capabilityNames.length > 0 &&
        capabilityNames.every((n) => this.can(n));
    },

    needsSetupWizard: (state) =>
      state.setupMode === 'pending' &&
      (state.user?.role === 'global_admin' || state.user?.role === 'admin'),

    /**
     * Check if user has a specific permission (RBAC matrix). Kept for
     * backwards-compat with existing callers; prefer `can()` for new code.
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
     * Reset every piece of session-bound state to its empty/initial value.
     * Called by `logout()` and whenever hydration reveals an invalid token.
     * After this returns, every UI gating helper resolves to `false`.
     */
    clearSessionState() {
      this.user = null;
      this.token = null;
      this.isAuthenticated = false;
      this.scope = null;
      this.featureFlags = {};
      this.setupMode = 'done';
      this.capabilities = {};
      this.isHydrated = false;
      this.isHydrating = false;
      this.hydrationError = null;

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

      delete api.defaults.headers.common['Authorization'];
      _hydrationPromise = null;
    },

    /**
     * Login user with credentials. The backend's login response already
     * carries the canonical session payload, so we hydrate from it directly
     * and skip a follow-up /auth/session round-trip.
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

        const hasSessionPayload =
          response.data.featureFlags && response.data.capabilities;
        if (hasSessionPayload) {
          // Hydrate from the login response — same shape as /auth/session.
          this._hydrateFromSession({
            user: response.data.user,
            scope: response.data.scope,
            featureFlags: response.data.featureFlags,
            setupMode: response.data.setupMode,
            capabilities: response.data.capabilities,
          });
          this.isHydrated = true;
          this.hydrationError = null;
        } else {
          // Defensive: if the server changes its mind about including the
          // session payload in /auth/login, fetch it explicitly.
          await this.refreshSession({ force: true, resetInventory: false });
        }

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
     * Fetch `/auth/session` and rehydrate featureFlags + capabilities.
     *
     * Concurrency: callers that race (e.g. App.vue's storage listener and a
     * router guard at the same time) get the same in-flight promise instead
     * of triggering parallel requests.
     *
     * Lifecycle:
     *   - sets isHydrating=true while loading
     *   - flips isHydrated=true ONLY after _hydrateFromSession succeeds
     *   - records hydrationError on failure
     *   - clears session state on 401 (invalid token)
     *
     * Options:
     *   - force: bypass the in-flight de-dupe
     *   - resetInventory: re-run bootstrapSession() on success (default true)
     */
    async refreshSession({ force = false, resetInventory = true } = {}) {
      if (!this.token) {
        // No token — guarantee the store is in the cleared state and exit.
        if (this.isAuthenticated || this.isHydrated) this.clearSessionState();
        return null;
      }

      if (_hydrationPromise && !force) {
        return _hydrationPromise;
      }

      this.isHydrating = true;
      this.hydrationError = null;

      _hydrationPromise = (async () => {
        try {
          const response = await api.get('/auth/session');
          const payload = response.data || {};
          this._hydrateFromSession(payload);
          this.isAuthenticated = true;
          this.isHydrated = true;

          if (resetInventory) {
            // Rebuild branch/warehouse context — feature flag changes can
            // flip multiBranch, which changes which warehouses are visible.
            // Failure here is non-fatal; UI still renders from the new caps.
            try {
              await this.bootstrapSession();
            } catch {
              /* non-fatal */
            }
          }
          return payload;
        } catch (error) {
          this.hydrationError = error;
          if (error?.response?.status === 401) {
            // Invalid token — wipe everything so the SPA re-renders unauth UI.
            this.clearSessionState();
          }
          // Network/server errors keep the existing token + state so a
          // retry can succeed without forcing the user back to login.
          return null;
        } finally {
          this.isHydrating = false;
          _hydrationPromise = null;
        }
      })();

      return _hydrationPromise;
    },

    /**
     * Single post-auth initialization flow.
     *
     *   loadSettings → loadCurrentUser → resolveActiveBranch → resolveActiveWarehouse
     *
     * The current user, scope and feature flags are already on the store at
     * this point (login response or /auth/session). This method delegates the
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
     * Check authentication status on app load. Defers to `refreshSession()`
     * so the boot path uses the same hydration latch as every other caller.
     */
    async checkAuth() {
      const token = localStorage.getItem('token');
      if (!token) {
        this.isAuthenticated = false;
        this.isHydrated = false;
        return;
      }

      this.token = token;
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // Single round-trip: validates the token AND hydrates featureFlags +
      // capabilities + scope. `refreshSession` flips isHydrated on success.
      await this.refreshSession({ resetInventory: false });

      // Re-resolve branch/warehouse on app reload too, so a refresh honors
      // a freshly-changed assigned branch or feature flag.
      if (this.isAuthenticated) {
        await this.bootstrapSession();
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
          this.isHydrated = true;
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
     *
     * Forces a fresh fetch (bypassing the de-dupe) because the caller
     * likely just wrote the toggle to the backend and needs the latest
     * server-derived capabilities.
     */
    async setFeatureFlags(flags) {
      this.featureFlags = flags || {};
      localStorage.setItem('featureFlags', JSON.stringify(this.featureFlags));
      if (!this.isAuthenticated) return;
      await this.refreshSession({ force: true });
    },

    /**
     * Logout user and clear ALL session-bound state — including feature flags
     * and capabilities — so the next login can never inherit a stale "feature
     * X is on" assumption from the previous user/session.
     */
    logout() {
      const notificationStore = useNotificationStore();

      this.clearSessionState();

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
      this.clearSessionState();
      this.isFirstRun = false;
    },
  },
});

// Re-export the alias normalizer so callers (e.g. router meta) can resolve
// canonical names without re-importing the store.
export { normalizeFeatureAlias, FLAG_ALIASES };
