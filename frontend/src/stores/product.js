import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useProductStore = defineStore('product', {
  state: () => ({
    products: [],
    currentProduct: null,
    loading: false,
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    },
  }),

  actions: {
    async fetch(params = {}) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/products', { params });
        this.products = response?.data || [];

        // Ensure pagination values are numbers
        if (response?.meta) {
          const newPagination = {
            page: Number(response.meta.page) || this.pagination.page,
            limit: Number(response.meta.limit) || this.pagination.limit,
            total: Number(response.meta.total) || this.pagination.total,
            totalPages: Number(response.meta.totalPages) || this.pagination.totalPages,
          };
          // Set flag to prevent recursive changePage calls
          if (typeof window !== 'undefined' && window.isUpdatingFromAPI !== undefined) {
            window.isUpdatingFromAPI = true;
          }
          this.pagination = newPagination;
          // Clear flag after a microtask to allow Vue reactivity to settle
          if (typeof window !== 'undefined') {
            Promise.resolve().then(() => {
              if (window.isUpdatingFromAPI !== undefined) {
                window.isUpdatingFromAPI = false;
              }
            });
          }
        }

        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل المنتجات');
        this.products = [];
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchProduct(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get(`/products/${id}`);

        this.currentProduct = response?.data || null;
        console.log(this.currentProduct);
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل بيانات المنتج');
        this.currentProduct = null;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async createProduct(productData) {
      const notificationStore = useNotificationStore();

      // Optimistic update: Add temporary product immediately
      const tempId = `temp-${Date.now()}`;
      const optimisticProduct = {
        ...productData,
        id: tempId,
        _optimistic: true,
      };
      this.products.unshift(optimisticProduct);

      try {
        const response = await api.post('/products', productData);
        // Replace optimistic product with real one
        const index = this.products.findIndex((p) => p.id === tempId);
        if (index !== -1) {
          this.products[index] = response.data;
        }
        notificationStore.success('تم إضافة المنتج بنجاح');
        return response;
      } catch (error) {
        // Rollback: Remove optimistic product on error
        this.products = this.products.filter((p) => p.id !== tempId);
        notificationStore.error(error.response?.data?.message || 'فشل إضافة المنتج');
        throw error;
      }
    },

    async updateProduct(id, productData) {
      const notificationStore = useNotificationStore();

      // Optimistic update: Update product immediately
      const index = this.products.findIndex((p) => p.id === id);
      const originalProduct = index !== -1 ? { ...this.products[index] } : null;

      if (index !== -1) {
        this.products[index] = { ...this.products[index], ...productData, _optimistic: true };
      }

      try {
        const response = await api.put(`/products/${id}`, productData);
        if (index !== -1) {
          this.products[index] = response.data;
        }
        notificationStore.success('تم تحديث المنتج بنجاح');
        return response;
      } catch (error) {
        // Rollback: Restore original product on error
        if (index !== -1 && originalProduct) {
          this.products[index] = originalProduct;
        }
        notificationStore.error(error.response?.data?.message || 'فشل تحديث المنتج');
        throw error;
      }
    },

    async deleteProduct(id) {
      const notificationStore = useNotificationStore();

      // Optimistic update: Remove product immediately
      const index = this.products.findIndex((p) => p.id === id);
      const deletedProduct = index !== -1 ? { ...this.products[index] } : null;

      if (index !== -1) {
        this.products.splice(index, 1);
      }

      try {
        const response = await api.delete(`/products/${id}`);
        notificationStore.success('تم حذف المنتج بنجاح');
        return response;
      } catch (error) {
        // Rollback: Restore product on error
        if (index !== -1 && deletedProduct) {
          this.products.splice(index, 0, deletedProduct);
        }
        notificationStore.error(error.response?.data?.message || 'فشل حذف المنتج');
        throw error;
      }
    },

    async fetchLowStock() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/products/low-stock');

        return response.data;
      } catch (error) {
        notificationStore.error(
          error.response?.data?.message || 'فشل تحميل المنتجات منخفضة المخزون'
        );
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
