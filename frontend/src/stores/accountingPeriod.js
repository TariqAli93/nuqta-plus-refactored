import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

/**
 * Accounting periods (القيد المحاسبي). Thin wrapper over /api/accounting-periods
 * — all rules/snapshot live on the backend; this store just fetches and acts.
 */
export const useAccountingPeriodStore = defineStore('accountingPeriod', {
  state: () => ({
    periods: [],
    current: null, // open period for the caller scope (live preview), or null
    loading: false,
  }),

  getters: {
    openPeriods: (state) => state.periods.filter((p) => p.status === 'open'),
    closedPeriods: (state) => state.periods.filter((p) => p.status === 'closed'),
  },

  actions: {
    async fetchAll(filters = {}) {
      this.loading = true;
      try {
        const res = await api.get('/accounting-periods', { params: filters });
        this.periods = res?.data || [];
        return this.periods;
      } finally {
        this.loading = false;
      }
    },

    async fetchCurrent(branchId) {
      const res = await api.get('/accounting-periods/current', {
        params: branchId ? { branchId } : {},
      });
      this.current = res?.data || null;
      return this.current;
    },

    async fetchById(id) {
      const res = await api.get(`/accounting-periods/${id}`);
      return res?.data || null;
    },

    async open(payload) {
      const notify = useNotificationStore();
      try {
        const res = await api.post('/accounting-periods', payload);
        notify.success(res?.message || 'تم فتح القيد المحاسبي');
        await this.fetchAll();
        return res?.data;
      } catch (error) {
        notify.error(error?.response?.data?.message || error?.message || 'تعذّر فتح القيد');
        throw error;
      }
    },

    async close(id, payload = {}) {
      const notify = useNotificationStore();
      try {
        const res = await api.post(`/accounting-periods/${id}/close`, payload);
        notify.success(res?.message || 'تم إغلاق القيد المحاسبي');
        await this.fetchAll();
        return res?.data;
      } catch (error) {
        notify.error(error?.response?.data?.message || error?.message || 'تعذّر إغلاق القيد');
        throw error;
      }
    },
  },
});
