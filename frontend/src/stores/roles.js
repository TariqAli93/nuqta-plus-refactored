import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useRolesStore = defineStore('roles', {
  state: () => ({ list: [], loading: false }),
  actions: {
    async fetch() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.get('/roles');
        this.list = data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل الأدوار');
      } finally {
        this.loading = false;
      }
    },
    async create(payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.post('/roles', payload);
        await this.fetch();
        notificationStore.success('تم إضافة الدور بنجاح');
        return data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إضافة الدور');
        throw error;
      }
    },
    async update(id, payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.put(`/roles/${id}`, payload);
        await this.fetch();
        notificationStore.success('تم تحديث الدور بنجاح');
        return data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث الدور');
        throw error;
      }
    },
    async remove(id) {
      const notificationStore = useNotificationStore();
      try {
        await api.delete(`/roles/${id}`);
        await this.fetch();
        notificationStore.success('تم حذف الدور بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف الدور');
        throw error;
      }
    },
    async getPermissions(roleId) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.get(`/roles/${roleId}/permissions`);
        return data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل صلاحيات الدور');
        throw error;
      }
    },
    async assignPermissions(roleId, permissionIds) {
      const notificationStore = useNotificationStore();
      try {
        await api.post(`/roles/${roleId}/permissions`, { permissionIds });
        notificationStore.success('تم تعيين الصلاحيات بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تعيين الصلاحيات');
        throw error;
      }
    },
  },
});
