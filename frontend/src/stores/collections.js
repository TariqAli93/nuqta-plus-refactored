import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

/**
 * Collections workflow store. Thin wrapper over the /api/installments and
 * /api/collections endpoints. Components own their own loading/error state
 * so the store stays stateless and stays out of the way of refresh logic.
 */
export const useCollectionsStore = defineStore('collections', {
  actions: {
    async listActions(installmentId) {
      const res = await api.get(`/installments/${installmentId}/actions`);
      return res?.data || [];
    },

    async recordAction(installmentId, payload) {
      const toast = useNotificationStore();
      try {
        const res = await api.post(`/installments/${installmentId}/actions`, payload);
        toast.success('تم تسجيل الإجراء');
        return res?.data || null;
      } catch (err) {
        toast.error(err.response?.data?.message || 'فشل تسجيل الإجراء');
        throw err;
      }
    },

    async overdue(params = {}) {
      const res = await api.get('/collections/overdue', { params });
      return {
        data: res?.data || [],
        meta: res?.meta || { page: 1, limit: 50, total: 0, totalPages: 0 },
      };
    },

    async customerHistory(customerId) {
      const res = await api.get(`/collections/customer/${customerId}`);
      return res?.data || [];
    },
  },
});
