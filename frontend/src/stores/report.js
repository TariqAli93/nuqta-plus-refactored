import { defineStore } from 'pinia';
import api from '@/plugins/axios';

export const useReportStore = defineStore('report', {
  state: () => ({
    loading: false,
    data: null,
    aging: null,
    profit: null,
  }),
  actions: {
    async fetchDashboard(params = {}) {
      this.loading = true;
      try {
        const res = await api.get('/reports/dashboard', { params });
        this.data = res?.data || null;
        return this.data;
      } finally {
        this.loading = false;
      }
    },
    async fetchAging(params = {}) {
      const res = await api.get('/reports/aging', { params });
      this.aging = res?.data || null;
      return this.aging;
    },
    async fetchProfit(params = {}) {
      const res = await api.get('/reports/profit', { params });
      this.profit = res?.data || null;
      return this.profit;
    },
    async exportExcel(params = {}) {
      const blob = await api.get('/reports/export/excel', { params, responseType: 'blob' });
      return blob;
    },
    async exportPdf(params = {}) {
      const blob = await api.get('/reports/export/pdf', { params, responseType: 'blob' });
      return blob;
    },
  },
});
