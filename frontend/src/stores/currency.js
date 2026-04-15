import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

export const useCurrencyStore = defineStore('currency', {
  state: () => ({
    currencies: [],
    baseCurrency: null,
    loading: false,
    exchangeRate: null,
  }),

  getters: {
    activeCurrencies: (state) => state.currencies?.filter((c) => c.isActive) || [],
    iqd: (state) => state.currencies?.find((c) => c.currencyCode === 'IQD') || null,
    usd: (state) => state.currencies?.find((c) => c.currencyCode === 'USD') || null,
  },

  actions: {
    async fetchCurrencies() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/currencies');

        this.currencies = response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل العملات');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchActiveCurrencies() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/currencies/active');
        this.currencies = response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل العملات النشطة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async fetchBaseCurrency() {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get('/currencies/base');
        this.baseCurrency = response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحميل العملة الأساسية');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async getCurrencyByCode(currencyCode) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.get(`/currencies/${currencyCode}`);
        notificationStore.success('تم جلب بيانات العملة بنجاح');
        return response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل جلب بيانات العملة');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateExchangeRate(currencyCode, exchangeRate) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        // '/:code/exchange-rate'
        const response = await api.patch(`/currencies/${currencyCode}/exchange-rate`, {
          exchangeRate,
        });

        // Update local state if currencies are loaded
        if (this.currencies && this.currencies.length > 0) {
          const index = this.currencies.findIndex((c) => c.currencyCode === currencyCode);
          if (index !== -1) {
            this.currencies[index] = response.data;
          }
        }

        notificationStore.success('تم تحديث سعر الصرف بنجاح');
        return response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث سعر الصرف');
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async updateCurrency(currencyCode, data) {
      this.loading = true;
      const notificationStore = useNotificationStore();
      try {
        const response = await api.put(`/currencies/${currencyCode}`, data);

        // Update local state if currencies are loaded
        if (this.currencies && this.currencies.length > 0) {
          const index = this.currencies.findIndex((c) => c.currencyCode === currencyCode);
          if (index !== -1) {
            this.currencies[index] = response.data;
          }
        }

        notificationStore.success('تم تحديث العملة بنجاح');
        return response.data;
      } catch (error) {
        notificationStore.error(error.response?.data?.message || 'فشل تحديث العملة');
        throw error;
      } finally {
        this.loading = false;
      }
    },
  },
});
