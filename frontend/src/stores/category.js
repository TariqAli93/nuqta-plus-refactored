import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useCategoryStore = defineStore('category', {
  state: () => ({
    categories: [],
    currentCategory: null,
    loading: false,
    pagination: {
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 0,
    },
  }),

  actions: {
    async fetchCategories(params = {}) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/categories', { params });
        // معالجة التنسيقات المختلفة للاستجابة
        if (response.data?.data && Array.isArray(response.data.data)) {
          this.categories = response.data.data;
        } else if (Array.isArray(response.data)) {
          this.categories = response.data;
        } else {
          this.categories = [];
        }
        
        // Ensure pagination values are numbers
        if (response?.data?.meta) {
          this.pagination = {
            page: Number(response.data.meta.page) || this.pagination.page,
            limit: Number(response.data.meta.limit) || this.pagination.limit,
            total: Number(response.data.meta.total) || this.pagination.total,
            totalPages: Number(response.data.meta.totalPages) || this.pagination.totalPages,
          };
        }
        
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل الفئات');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchCategory(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get(`/categories/${id}`);
        this.currentCategory = response.data;
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل بيانات الفئة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async createCategory(categoryData) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post('/categories', categoryData);
        // استخراج بيانات التصنيف من الاستجابة
        const newCategory = response.data?.data || response.data;
        if (newCategory && !this.categories.find((c) => c.id === newCategory.id)) {
          this.categories.unshift(newCategory);
        }
        notificationStore.success('تم إضافة الفئة بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إضافة الفئة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateCategory(id, categoryData) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.put(`/categories/${id}`, categoryData);
        const index = this.categories.findIndex((c) => c.id === id);
        if (index !== -1) {
          this.categories[index] = response.data;
        }
        notificationStore.success('تم تحديث الفئة بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث الفئة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async deleteCategory(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.delete(`/categories/${id}`);
        this.categories = this.categories.filter((c) => c.id !== id);
        notificationStore.success('تم حذف الفئة بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف الفئة');
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
