import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useUsersStore = defineStore('users', {
  state: () => ({
    list: [],
    page: 1,
    limit: 10,
    total: 0,
    loading: false,
    filters: { search: '', role: null, isActive: null },
    current: null,
  }),
  actions: {
    async fetch() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const params = { page: this.page, limit: this.limit };
        if (this.filters.search) params.search = this.filters.search;
        if (this.filters.role) params.role = this.filters.role;
        if (this.filters.isActive !== null) params.isActive = this.filters.isActive;
        const { data } = await api.get('/users', { params });
        this.list = data.data;
        this.total = data.total;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل المستخدمين');
      } finally {
        this.loading = false;
      }
    },
    async getById(id) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.get(`/users/${id}`);
        this.current = data.data;
        return this.current;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل بيانات المستخدم');
        throw error;
      }
    },
    async create(payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.post('/users', payload);
        await this.fetch();
        notificationStore.success('تم إضافة المستخدم بنجاح');
        return data.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إضافة المستخدم');
        throw error;
      }
    },
    async update(id, payload) {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.put(`/users/${id}`, payload);
        await this.fetch();
        notificationStore.success('تم تحديث المستخدم بنجاح');
        return data.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث المستخدم');
        throw error;
      }
    },
    async remove(id) {
      const notificationStore = useNotificationStore();
      try {
        await api.delete(`/users/${id}`);
        await this.fetch();
        notificationStore.success('تم حذف المستخدم بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف المستخدم');
        throw error;
      }
    },
    async resetPassword(id, password) {
      const notificationStore = useNotificationStore();
      try {
        await api.post(`/users/${id}/reset-password`, { password });
        notificationStore.success('تم إعادة تعيين كلمة المرور بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إعادة تعيين كلمة المرور');
        throw error;
      }
    },

    async checkFirstUser() {
      const notificationStore = useNotificationStore();
      try {
        const { data } = await api.get('/users/check-first-user');
        return data.exists;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل التحقق من المستخدم الأول');
        throw error;
      }
    },

    async getUserPermissions() {
      const notificationStore = useNotificationStore();
      try {
        const users = this.list;

        // If no users loaded, fetch current user permissions from user object
        if (users.length === 0) {
          const { data } = await api.get('/auth/profile');
          return data.permissions || [];
        }
        const currentUser = users.find((u) => u.isCurrent);
        return currentUser ? currentUser.permissions || [] : [];
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل جلب أذونات المستخدم');
        throw error;
      }
    },
  },
});
