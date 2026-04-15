import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useSaleStore = defineStore('sale', {
  state: () => ({
    sales: [],
    currentSale: null,
    loading: false,
    printer: (() => {
      if (typeof window === 'undefined') return null;
      try {
        const stored = localStorage.getItem('selectedPrinter');
        return stored ? JSON.parse(stored) : null;
      } catch {
        // If JSON is invalid, clear it and return null
        localStorage.removeItem('selectedPrinter');
        return null;
      }
    })(),
    pagination: {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    },
  }),

  actions: {
    /**
     * Fetch all sales with optional filters
     * @param {Object} params - Query parameters for filtering
     */
    async fetch(params = {}) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/sales', { params });

        this.sales = response?.data || [];

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
        const errorMessage = error.response?.data?.message || 'فشل تحميل المبيعات';
        notificationStore.error(errorMessage);
        this.sales = [];
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch single sale by ID
     * @param {number} id - Sale ID
     */
    async fetchSale(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        if (!id) {
          throw new Error('Sale ID is required');
        }

        const response = await api.get(`/sales/${id}`);

        this.currentSale = response?.data || null;
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل بيانات المبيعة';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Create new sale
     * @param {Object} saleData - Sale data including items and payment info
     */
    async createSale(saleData) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        // Validate sale data
        if (!saleData.items || saleData.items.length === 0) {
          throw new Error('Sale must have at least one item');
        }

        const response = await api.post('/sales', saleData);

        if (response?.data) {
          this.sales.unshift(response.data);
        }

        notificationStore.success('تم إضافة المبيعة بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل إضافة المبيعة';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Cancel a sale
     * @param {number} id - Sale ID to cancel
     */
    async cancelSale(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        if (!id) {
          throw new Error('Sale ID is required');
        }

        const response = await api.post(`/sales/${id}/cancel`);

        // Update sale status in the list
        const index = this.sales.findIndex((s) => s.id === id);
        if (index !== -1) {
          this.sales[index] = { ...this.sales[index], status: 'cancelled' };
        }

        // Update current sale if it's the one being cancelled
        if (this.currentSale?.id === id) {
          this.currentSale = { ...this.currentSale, status: 'cancelled' };
        }

        notificationStore.success('تم إلغاء المبيعة بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل إلغاء المبيعة';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Remove a sale (for drafts)
     * @param {number} id - Sale ID to remove
     */
    async removeSale(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        if (!id) {
          throw new Error('Sale ID is required');
        }

        const response = await api.delete(`/sales/${id}`);

        // Remove from sales list
        const index = this.sales.findIndex((s) => s.id === id);
        if (index !== -1) {
          this.sales.splice(index, 1);
        }

        notificationStore.success('تم حذف المسودة بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل حذف المسودة';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Get sales report with filters
     * @param {Object} queryParams - Report query parameters
     */
    async getSalesReport(queryParams = {}) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/sales/report', { params: queryParams });

        // Backend returns { success: true, data: report }
        // Axios interceptor already extracts response.data, so response is {success, data, ...}
        return response?.data || response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل تحميل تقرير المبيعات';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async addPayment(paymentData) {
      if (!this.currentSale) {
        throw new Error('No current sale selected');
      }

      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post(`/sales/${this.currentSale.id}/payment`, paymentData);
        // Update the current sale with the new payment
        this.currentSale = response?.data || this.currentSale;
        notificationStore.success('تم إضافة الدفعة بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل إضافة الدفعة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async removePaymentFromCurrentSale(paymentId) {
      if (!this.currentSale) {
        throw new Error('No current sale selected');
      }

      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        await api.delete(`/sales/${this.currentSale.id}/payments/${paymentId}`);
        // Refetch the sale to ensure UI is in sync with server state
        // This is more reliable than manually updating local state
        // Only show success after refetch succeeds, ensuring UI is updated
        await this.fetchSale(this.currentSale.id);
        notificationStore.success('تم حذف الدفعة بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف الدفعة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async deleteSale(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        await api.delete(`/sales/${id}`);
        this.sales = this.sales.filter((s) => s.id !== id);
        notificationStore.success('تم حذف المبيعة بنجاح');
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل حذف المبيعة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async restoreSale(id) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post(`/sales/${id}/restore`);
        const index = this.sales.findIndex((s) => s.id === id);
        if (index !== -1) {
          this.sales[index].status = 'completed';
        }
        notificationStore.success('تم استعادة المبيعة بنجاح');
        return response;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل استعادة المبيعة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    setPrinter(printer) {
      this.printer = printer;
      localStorage.setItem('selectedPrinter', JSON.stringify(printer));
    },

    getPrinter() {
      return this.printer;
    },

    /**
     * Create a draft sale
     * @param {Object} saleData - Sale data
     */
    async createDraft(saleData) {
      try {
        // Prepare draft data (only essential fields)
        const draftData = {
          currency: saleData.currency || 'USD',
          paymentType: saleData.paymentType || 'cash',
          items: (saleData.items || []).map((item) => ({
            productId: item.productId,
            productName: item.productName || '',
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            discount: item.discount || 0,
          })),
          discount: saleData.discount || 0,
          tax: saleData.tax || 0,
          notes: saleData.notes || null,
        };

        // إضافة customerId فقط إذا كان موجوداً
        if (saleData.customerId !== undefined && saleData.customerId !== null) {
          draftData.customerId = saleData.customerId;
        }

        const response = await api.post('/sales/draft', draftData);
        return response;
      } catch (error) {
        // Don't show error notification for draft saves (silent save)
        console.error('Failed to save draft:', error);
        throw error;
      }
    },

    /**
     * Complete a draft sale
     * @param {number} draftId - Draft sale ID
     * @param {Object} saleData - Complete sale data
     */
    async completeDraft(draftId, saleData) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.post(`/sales/draft/${draftId}/complete`, saleData);

        this.currentSale = response?.data || null;
        notificationStore.success('تم إكمال البيع بنجاح');
        return response;
      } catch (error) {
        const errorMessage = error.response?.data?.message || 'فشل إكمال البيع';
        notificationStore.error(errorMessage);
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
