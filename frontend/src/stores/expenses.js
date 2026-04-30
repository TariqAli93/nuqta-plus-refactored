import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useExpensesStore = defineStore('expenses', {
  state: () => ({
    items: [],
    summary: null,
    loading: false,
    pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
  }),

  actions: {
    async fetch(params = {}) {
      this.loading = true;
      try {
        const res = await api.get('/expenses', { params });
        this.items = res?.data || [];
        if (res?.meta) {
          this.pagination = {
            page: Number(res.meta.page) || 1,
            limit: Number(res.meta.limit) || 25,
            total: Number(res.meta.total) || 0,
            totalPages: Number(res.meta.totalPages) || 0,
          };
        }
        return this.items;
      } finally {
        this.loading = false;
      }
    },

    async fetchSummary(params = {}) {
      const res = await api.get('/expenses/summary', { params });
      this.summary = res?.data || null;
      return this.summary;
    },

    async create(payload) {
      const notify = useNotificationStore();
      const res = await api.post('/expenses', payload);
      notify.success('تم تسجيل المصروف');
      return res?.data;
    },

    async update(id, payload) {
      const notify = useNotificationStore();
      const res = await api.put(`/expenses/${id}`, payload);
      notify.success('تم تحديث المصروف');
      return res?.data;
    },

    async remove(id) {
      const notify = useNotificationStore();
      await api.delete(`/expenses/${id}`);
      notify.success('تم حذف المصروف');
    },
  },
});
