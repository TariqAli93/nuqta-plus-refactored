import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useAlertStore = defineStore('alert', {
  state: () => ({
    overdueInstallments: [],
    lowStockProducts: [],
    outOfStockProducts: [],
    totalAlerts: 0,
    totalOverdueAmount: 0,
    loading: false,
    lastUpdated: null,
    pollingInterval: null,
    readAlerts: (() => {
      // Load read alerts from localStorage
      try {
        const stored = localStorage.getItem('readAlerts');
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    })(),
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
     * Fetch all alerts from the backend
     */
    async fetchAlerts() {
      this.loading = true;
      const notificationStore = useNotificationStore();

      try {
        const response = await api.get('/alerts');

        if (response.success && response.data) {
          this.overdueInstallments = response.data.overdueInstallments?.items || [];
          this.lowStockProducts = response.data.lowStockProducts?.items || [];
          this.outOfStockProducts = response.data.outOfStockProducts?.items || [];
          this.totalAlerts = response.data.totalAlerts || 0;
          this.totalOverdueAmount = response.data.overdueInstallments?.totalAmount || 0;
          this.lastUpdated = new Date();
        }

        return response.data;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل التنبيهات';
        // Don't show error notification for polling - only log it
        if (!this.pollingInterval) {
          notificationStore.error(errorMessage);
        }
        console.error('Error fetching alerts:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Start polling for alerts every 60 seconds
     */
    startPolling() {
      // Clear any existing polling
      this.stopPolling();

      // Fetch immediately
      this.fetchAlerts();

      // Set up interval for polling every 60 seconds
      this.pollingInterval = setInterval(() => {
        this.fetchAlerts();
      }, 60000); // 60 seconds
    },

    /**
     * Stop polling for alerts
     */
    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    },

    /**
     * Check if an alert is marked as read
     * @param {string} alertId - Alert identifier
     * @returns {boolean}
     */
    isRead(alertId) {
      return this.readAlerts.includes(alertId);
    },

    /**
     * Toggle read status of an alert
     * @param {string} alertId - Alert identifier
     */
    toggleRead(alertId) {
      const index = this.readAlerts.indexOf(alertId);
      if (index > -1) {
        // Remove from read alerts
        this.readAlerts = this.readAlerts.filter((id) => id !== alertId);
      } else {
        // Add to read alerts
        this.readAlerts = [...this.readAlerts, alertId];
      }
      this.saveReadAlerts();
    },

    /**
     * Mark alerts as read
     * @param {string[]} alertIds - Array of alert identifiers
     */
    markAsRead(alertIds) {
      // Create a new array to ensure reactivity
      const newReadAlerts = [...this.readAlerts];
      alertIds.forEach((id) => {
        if (!newReadAlerts.includes(id)) {
          newReadAlerts.push(id);
        }
      });
      this.readAlerts = newReadAlerts;
      this.saveReadAlerts();
    },

    /**
     * Mark an alert as unread
     * @param {string} alertId - Alert identifier
     */
    markAsUnread(alertId) {
      this.readAlerts = this.readAlerts.filter((id) => id !== alertId);
      this.saveReadAlerts();
    },

    /**
     * Clear all read alerts
     */
    clearReadAlerts() {
      this.readAlerts = [];
      this.saveReadAlerts();
    },

    /**
     * Save read alerts to localStorage
     */
    saveReadAlerts() {
      try {
        localStorage.setItem('readAlerts', JSON.stringify(this.readAlerts));
      } catch (error) {
        console.error('Error saving read alerts:', error);
      }
    },
  },
});
