import { defineStore } from 'pinia';
import api from '@/plugins/axios';

export const useResetStore = defineStore('reset', {
  actions: {
    /**
     * Reset the database by calling the backend API
     */
    async resetDatabase() {
      try {
        const response = await api.post('/reset/database');
        return response;
      } catch (error) {
        throw new Error(error.response?.data?.message || 'فشل في تصفير قاعدة البيانات');
      }
    },
  },
});
