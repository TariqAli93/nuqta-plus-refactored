import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';
import { hasPermission, matchesPermissionPattern } from '@/auth/permissionMatrix.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('token') || null,
    isAuthenticated: false,
    isFirstRun: false,
  }),

  getters: {
    currentUser: (state) => state.user,
    userRole: (state) => state.user?.role || null,

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
        this.user = response.data.user;
        this.isAuthenticated = true;

        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));

        // Update axios default headers with new token
        api.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;

        notificationStore.success('تم تسجيل الدخول بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'فشل تسجيل الدخول';
        notificationStore.error(errorMessage);
        throw error;
      }
    },

    /**
     * Check authentication status on app load
     */
    async checkAuth() {
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');

      if (token && user) {
        try {
          // Set token first for API calls
          this.token = token;
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

          // Verify token is still valid by fetching profile (sets this.user from API)
          await this.getProfile();
          this.isAuthenticated = true;
        } catch {
          // Token is invalid, clear everything
          this.logout();
        }
      } else {
        // No token or user, ensure logged out state
        this.isAuthenticated = false;
      }
    },

    /**
     * Get current user profile
     */
    async getProfile() {
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/auth/profile');

        if (response.data) {
          this.user = response.data;
          localStorage.setItem('user', JSON.stringify(response.data));
        }

        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل بيانات المستخدم';
        notificationStore.error(errorMessage);
        throw error;
      }
    },

    /**
     * Logout user and clear session
     */
    logout() {
      const notificationStore = useNotificationStore();

      this.user = null;
      this.token = null;
      this.isAuthenticated = false;

      localStorage.removeItem('token');
      localStorage.removeItem('user');

      // Remove authorization header
      delete api.defaults.headers.common['Authorization'];

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
