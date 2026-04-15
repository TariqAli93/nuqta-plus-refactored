import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const usePermissionsStore = defineStore('permissions', {
  state: () => ({ list: [], loading: false }),
  actions: {
    async fetch(search) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.get('/permissions', { params: { search } });
        this.list = data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل الصلاحيات');
      } finally {
        this.loading = false;
      }
    },
    async create(payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.post('/permissions', payload);
        await this.fetch();
        notificationStore.success('تم إضافة الصلاحية بنجاح');
        return data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إضافة الصلاحية');
        throw error;
      }
    },
    async update(id, payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.put(`/permissions/${id}`, payload);
        await this.fetch();
        notificationStore.success('تم تحديث الصلاحية بنجاح');
        return data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث الصلاحية');
        throw error;
      }
    },
    async remove(id) {
      const notificationStore = useNotificationStore();
      try {
        await api.delete(`/permissions/${id}`);
        await this.fetch();
        notificationStore.success('تم حذف الصلاحية بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف الصلاحية');
        throw error;
      }
    },
  },
});
