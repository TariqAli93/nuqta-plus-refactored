import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useCustomerStore = defineStore('customer', {
  state: () => ({
    customers: [],
    currentCustomer: null,
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
        const response = await api.get('/customers', { params });
        this.customers = response?.data || [];

        // Ensure pagination values are numbers
        if (response?.meta) {
          this.pagination = {
            page: Number(response.meta.page) || this.pagination.page,
            limit: Number(response.meta.limit) || this.pagination.limit,
            total: Number(response.meta.total) || this.pagination.total,
            totalPages: Number(response.meta.totalPages) || this.pagination.totalPages,
          };
        }

        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل العملاء');
        this.customers = [];
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchCustomer(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get(`/customers/${id}`);
        this.currentCustomer = response?.data || null;
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل بيانات العميل');
        this.currentCustomer = null;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchCustomerProfile(id) {
      // Branch-scoped 404 from backend stays a 404 — propagate and let the
      // page render its error state instead of toasting twice.
      const response = await api.get(`/customers/${id}/profile`);
      return response?.data || null;
    },

    async createCustomer(customerData) {
      const notificationStore = useNotificationStore();

      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      const optimisticCustomer = {
        ...customerData,
        id: tempId,
        _optimistic: true,
      };
      this.customers.unshift(optimisticCustomer);

      try {
        const response = await api.post('/customers', customerData);
        const index = this.customers.findIndex((c) => c.id === tempId);
        if (index !== -1) {
          this.customers[index] = response.data;
        }
        notificationStore.success('تم إضافة العميل بنجاح');
        return response;
      } catch (error) {
        this.customers = this.customers.filter((c) => c.id !== tempId);
        // Phone-duplicate is handled by the caller (it shows a confirm
        // dialog, retries with allowDuplicatePhone). Don't toast it here
        // or the user will see the error twice.
        if (error.response?.data?.code !== 'CUSTOMER_PHONE_DUPLICATE') {
          notificationStore.error(error.response?.data?.message || 'فشل إضافة العميل');
        }
        throw error;
      }
    },

    async updateCustomer(id, customerData) {
      const notificationStore = useNotificationStore();

      // Optimistic update
      const index = this.customers.findIndex((c) => c.id === id);
      const originalCustomer = index !== -1 ? { ...this.customers[index] } : null;

      if (index !== -1) {
        this.customers[index] = { ...this.customers[index], ...customerData, _optimistic: true };
      }

      try {
        const response = await api.put(`/customers/${id}`, customerData);
        if (index !== -1) {
          this.customers[index] = response.data;
        }
        notificationStore.success('تم تحديث العميل بنجاح');
        return response;
      } catch (error) {
        if (index !== -1 && originalCustomer) {
          this.customers[index] = originalCustomer;
        }
        if (error.response?.data?.code !== 'CUSTOMER_PHONE_DUPLICATE') {
          notificationStore.error(error.response?.data?.message || 'فشل تحديث العميل');
        }
        throw error;
      }
    },

    async deleteCustomer(id) {
      const notificationStore = useNotificationStore();

      // Optimistic update
      const index = this.customers.findIndex((c) => c.id === id);
      const deletedCustomer = index !== -1 ? { ...this.customers[index] } : null;

      if (index !== -1) {
        this.customers.splice(index, 1);
      }

      try {
        const response = await api.delete(`/customers/${id}`);
        notificationStore.success('تم حذف العميل بنجاح');
        return response;
      } catch (error) {
        if (index !== -1 && deletedCustomer) {
          this.customers.splice(index, 0, deletedCustomer);
        }
        notificationStore.error(error.response?.data?.message || 'فشل حذف العميل');
        throw error;
      }
    },

    getCustomerById(id) {
      if (!this.customers.length) {
        return null;
      }

      return this.customers.find((customer) => customer.id === id);
    },
  },
});
