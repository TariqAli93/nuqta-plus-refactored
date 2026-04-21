import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';
import { useAuthStore } from '@/stores/auth';
import { useConnectionStore } from '@/stores/connection';
import { watch } from 'vue';

// Max reconnect delay: 30 seconds
const MAX_RECONNECT_MS = 30000;
const BASE_RECONNECT_MS = 1000;

export const useAlertStore = defineStore('alert', {
  state: () => ({
    overdueInstallments: [],
    lowStockProducts: [],
    outOfStockProducts: [],
    totalAlerts: 0,
    totalOverdueAmount: 0,
    loading: false,
    lastUpdated: null,
    readAlerts: (() => {
      try {
        const stored = localStorage.getItem('readAlerts');
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    })(),

    // Realtime state
    _socket: null,
    isRealtimeConnected: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastEventAt: null,
    hasInitialSnapshot: false,
    // Track IDs from the previous snapshot to detect genuinely new alerts
    _prevAlertIds: new Set(),
    // Watchers to clean up on disconnect
    _unwatchFns: [],
  }),

  getters: {
    hasAlerts: (state) => state.totalAlerts > 0,
    overdueCount: (state) => state.overdueInstallments.length,
    lowStockCount: (state) => state.lowStockProducts.length,
    outOfStockCount: (state) => state.outOfStockProducts.length,
    unreadCount: (state) => {
      let count = 0;
      state.overdueInstallments.forEach((inst) => {
        if (!state.readAlerts.includes(`installment-${inst.id}`)) count++;
      });
      state.outOfStockProducts.forEach((prod) => {
        if (!state.readAlerts.includes(`outofstock-${prod.id}`)) count++;
      });
      state.lowStockProducts.forEach((prod) => {
        if (!state.readAlerts.includes(`lowstock-${prod.id}`)) count++;
      });
      return count;
    },
  },

  actions: {
    /**
     * Fetch all alerts via REST (initial load / fallback / manual refresh).
     */
    async fetchAlerts() {
      this.loading = true;
      const notificationStore = useNotificationStore();

      try {
        const response = await api.get('/alerts');

        if (response.success && response.data) {
          this._applySnapshot(response.data, false);
        }

        return response.data;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل التنبيهات';
        if (!this.isRealtimeConnected) {
          notificationStore.error(errorMessage);
        }
        console.error('Error fetching alerts:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Apply a snapshot from either REST or WebSocket.
     * @param {Object} data - The alert data from alertService.getAllAlerts()
     * @param {boolean} notify - Whether to show notifications for new alerts
     */
    _applySnapshot(data, notify) {
      const newOverdue = data.overdueInstallments?.items || [];
      const newLowStock = data.lowStockProducts?.items || [];
      const newOutOfStock = data.outOfStockProducts?.items || [];

      // Build current ID set for dedup comparison
      const newIds = new Set();
      newOverdue.forEach((i) => newIds.add(`installment-${i.id}`));
      newOutOfStock.forEach((p) => newIds.add(`outofstock-${p.id}`));
      newLowStock.forEach((p) => newIds.add(`lowstock-${p.id}`));

      // Notify only for genuinely new alert IDs (not on initial snapshot)
      if (notify && this.hasInitialSnapshot) {
        const notificationStore = useNotificationStore();
        let newOutOfStockCount = 0;
        let newOverdueCount = 0;

        newOutOfStock.forEach((p) => {
          if (!this._prevAlertIds.has(`outofstock-${p.id}`)) newOutOfStockCount++;
        });
        newOverdue.forEach((i) => {
          if (!this._prevAlertIds.has(`installment-${i.id}`)) newOverdueCount++;
        });

        if (newOutOfStockCount > 0) {
          notificationStore.warning(
            `${newOutOfStockCount} منتج نفد من المخزون`,
            5000
          );
        }
        if (newOverdueCount > 0) {
          notificationStore.warning(
            `${newOverdueCount} قسط متأخر جديد`,
            5000
          );
        }
      }

      this._prevAlertIds = newIds;
      this.overdueInstallments = newOverdue;
      this.lowStockProducts = newLowStock;
      this.outOfStockProducts = newOutOfStock;
      this.totalAlerts = data.totalAlerts || 0;
      this.totalOverdueAmount = data.overdueInstallments?.totalAmount || 0;
      this.lastUpdated = new Date();
      this.hasInitialSnapshot = true;
    },

    // ──────────────────────────────────────────────
    // WebSocket lifecycle
    // ──────────────────────────────────────────────

    /**
     * Open a WebSocket to the backend and authenticate with the JWT.
     * Call this after the user is authenticated.
     */
    connectRealtime() {
      // Prevent duplicate connections
      if (this._socket && this._socket.readyState <= 1) return;

      const authStore = useAuthStore();
      const connectionStore = useConnectionStore();

      if (!authStore.token || !connectionStore.serverBaseUrl) return;

      // Derive ws:// URL from the HTTP base URL
      const httpBase = connectionStore.serverBaseUrl; // e.g. http://127.0.0.1:41732
      const wsBase = httpBase.replace(/^http/, 'ws');
      const wsUrl = `${wsBase}/api/alerts/ws`;

      let socket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        this._scheduleReconnect();
        return;
      }

      this._socket = socket;

      socket.onopen = () => {
        // Send auth message immediately after connection opens
        socket.send(JSON.stringify({ type: 'auth', token: authStore.token }));
        this.reconnectAttempts = 0;
      };

      socket.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      socket.onclose = (event) => {
        this.isRealtimeConnected = false;
        this._socket = null;
        // Don't reconnect if closed intentionally (code 4001 = auth fail, 4003 = permission denied)
        if (event.code >= 4001 && event.code <= 4003) return;
        // Don't reconnect if user logged out
        const auth = useAuthStore();
        if (!auth.isAuthenticated) return;
        this._scheduleReconnect();
      };

      socket.onerror = () => {
        // onerror is always followed by onclose, so reconnect is handled there
      };

      // Watch for token or server URL changes and reconnect
      this._setupWatchers();
    },

    /**
     * Close the WebSocket connection (e.g. on logout).
     */
    disconnectRealtime() {
      this._clearReconnect();
      this._teardownWatchers();

      if (this._socket) {
        this._socket.onclose = null; // prevent reconnect trigger
        this._socket.close();
        this._socket = null;
      }

      this.isRealtimeConnected = false;
      this.hasInitialSnapshot = false;
      this.reconnectAttempts = 0;
    },

    /**
     * Handle an incoming WebSocket message.
     */
    _handleMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'auth') {
        if (msg.success) {
          this.isRealtimeConnected = true;
        } else {
          // Auth failed — don't reconnect
          this.isRealtimeConnected = false;
        }
        return;
      }

      if (msg.type === 'snapshot' && msg.data) {
        this.lastEventAt = new Date();
        // First snapshot after connect: don't notify (it's the initial load)
        const isInitialPush = !this.hasInitialSnapshot;
        this._applySnapshot(msg.data, !isInitialPush);
        return;
      }

      if (msg.type === 'error') {
        console.warn('Alert WS error:', msg.message);
      }
    },

    /**
     * Schedule a reconnect with capped exponential backoff.
     */
    _scheduleReconnect() {
      this._clearReconnect();

      const delay = Math.min(
        BASE_RECONNECT_MS * Math.pow(2, this.reconnectAttempts),
        MAX_RECONNECT_MS
      );
      this.reconnectAttempts++;

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        const authStore = useAuthStore();
        if (authStore.isAuthenticated) {
          this.connectRealtime();
        }
      }, delay);
    },

    _clearReconnect() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    },

    /**
     * Set up watchers that trigger reconnect when token or server URL changes.
     * Only set up once per connection lifecycle.
     */
    _setupWatchers() {
      if (this._unwatchFns.length > 0) return; // already watching

      const authStore = useAuthStore();
      const connectionStore = useConnectionStore();

      // Reconnect when token changes (e.g. re-login)
      const unwatchToken = watch(
        () => authStore.token,
        (newToken) => {
          if (newToken) {
            this.disconnectRealtime();
            this.connectRealtime();
          } else {
            this.disconnectRealtime();
          }
        }
      );

      // Reconnect when server URL changes (client mode)
      const unwatchUrl = watch(
        () => connectionStore.serverBaseUrl,
        () => {
          if (authStore.isAuthenticated) {
            this.disconnectRealtime();
            this.connectRealtime();
          }
        }
      );

      this._unwatchFns = [unwatchToken, unwatchUrl];
    },

    _teardownWatchers() {
      this._unwatchFns.forEach((fn) => fn());
      this._unwatchFns = [];
    },

    // ──────────────────────────────────────────────
    // Read/unread management (unchanged)
    // ──────────────────────────────────────────────

    isRead(alertId) {
      return this.readAlerts.includes(alertId);
    },

    toggleRead(alertId) {
      const index = this.readAlerts.indexOf(alertId);
      if (index > -1) {
        this.readAlerts = this.readAlerts.filter((id) => id !== alertId);
      } else {
        this.readAlerts = [...this.readAlerts, alertId];
      }
      this.saveReadAlerts();
    },

    markAsRead(alertIds) {
      const newReadAlerts = [...this.readAlerts];
      alertIds.forEach((id) => {
        if (!newReadAlerts.includes(id)) {
          newReadAlerts.push(id);
        }
      });
      this.readAlerts = newReadAlerts;
      this.saveReadAlerts();
    },

    markAsUnread(alertId) {
      this.readAlerts = this.readAlerts.filter((id) => id !== alertId);
      this.saveReadAlerts();
    },

    clearReadAlerts() {
      this.readAlerts = [];
      this.saveReadAlerts();
    },

    saveReadAlerts() {
      try {
        localStorage.setItem('readAlerts', JSON.stringify(this.readAlerts));
      } catch (error) {
        console.error('Error saving read alerts:', error);
      }
    },
  },
});
