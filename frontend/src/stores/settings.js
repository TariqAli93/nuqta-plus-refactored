import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from './notification';

export const useSettingsStore = defineStore('settings', () => {
  // State
  const settings = ref({});
  const companyInfo = ref({
    name: '',
    city: '',
    area: '',
    street: '',
    phone: '',
    phone2: '',
    logoUrl: '',
    invoiceType: '',
    invoiceTheme: '',
  });
  const isLoading = ref(false);
  const error = ref(null);

  // Stores
  const notificationStore = useNotificationStore();

  // Helpers
  const setByPath = (obj, path, val) => {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (i === parts.length - 1) {
        cur[p] = val;
      } else {
        cur[p] = cur[p] || {};
        cur = cur[p];
      }
    }
  };

  const deleteByPath = (obj, path) => {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p]) return;
      cur = cur[p];
    }
    delete cur[parts[parts.length - 1]];
  };

  const parseSettingsArray = (settingsArray) => {
    const out = {};
    const arr = Array.isArray(settingsArray) ? settingsArray : [];
    arr.forEach(({ key, value }) => setByPath(out, key, value));
    return out;
  };

  const mergeCompanyFromSettings = (payload) => {
    if (
      payload &&
      typeof payload === 'object' &&
      payload.company &&
      typeof payload.company === 'object'
    ) {
      companyInfo.value = {
        ...companyInfo.value,
        ...payload.company,
      };
    }
  };

  // Getters
  const getSettingValue = computed(() => (key, defaultValue = null) => {
    if (!key) return defaultValue;
    const keys = String(key).split('.');
    let current = settings.value;
    for (const k of keys) {
      if (current && Object.prototype.hasOwnProperty.call(current, k)) {
        current = current[k];
      } else {
        return defaultValue;
      }
    }
    return current ?? defaultValue;
  });

  const companyAddress = computed(() => {
    const parts = [];
    if (companyInfo.value.street) parts.push(companyInfo.value.street);
    if (companyInfo.value.area) parts.push(companyInfo.value.area);
    if (companyInfo.value.city) parts.push(companyInfo.value.city);
    return parts.join(', ');
  });

  // Get available currencies
  const availableCurrencies = computed(() => {
    return ['USD', 'IQD'];
  });

  // Actions
  const fetchSettings = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const body = await api.get('/settings');

      let parsed = {};
      if (Array.isArray(body)) {
        parsed = parseSettingsArray(body);
      } else if (body && Array.isArray(body.data)) {
        parsed = parseSettingsArray(body.data);
      } else if (body && typeof body === 'object') {
        const payload = body.data ?? body;
        if (Array.isArray(payload)) {
          parsed = parseSettingsArray(payload);
        } else if (payload && typeof payload === 'object') {
          const keys = Object.keys(payload);
          const hasDot = keys.some((k) => k.includes('.'));
          if (hasDot) {
            const out = {};
            keys.forEach((k) => setByPath(out, k, payload[k]));
            parsed = out;
          } else {
            parsed = payload;
          }
        }
      }

      settings.value = parsed;
      mergeCompanyFromSettings(parsed);
      return settings.value;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const fetchCompanyInfo = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.get('/settings/company');
      companyInfo.value = {
        name: data?.name || '',
        city: data?.city || '',
        area: data?.area || '',
        street: data?.street || '',
        phone: data?.phone || '',
        phone2: data?.phone2 || '',
        logoUrl: data?.logoUrl || '',
        invoiceType: data?.invoiceType || '',
        invoiceTheme: data?.invoiceTheme || 'classic',
      };
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const saveCompanyInfo = async (payload) => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.put('/settings/company', payload);
      notificationStore.success('تم حفظ معلومات الشركة بنجاح');
      const merged = { ...companyInfo.value, ...(data || payload) };
      companyInfo.value = merged;
      // Keep general settings cache aligned for consumers reading settings.company
      settings.value = {
        ...settings.value,
        company: {
          ...(settings.value.company || {}),
          ...merged,
        },
      };
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const validatePhone = async (phone) => {
    try {
      const { data } = await api.post('/settings/validate/phone', { phone });
      if (typeof data === 'boolean') return data;
      return Boolean(data?.isValid);
    } catch {
      return false;
    }
  };

  const setSetting = async (key, value, description = null) => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.put(`/settings/${key}`, { value, description });
      setByPath(settings.value, key, value);
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const bulkUpdateSettings = async (settingsData) => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.put('/settings/bulk', settingsData);
      // Apply updates locally:
      if (Array.isArray(settingsData)) {
        settingsData.forEach((entry) => {
          if (entry && typeof entry.key === 'string')
            setByPath(settings.value, entry.key, entry.value);
        });
      } else if (settingsData && typeof settingsData === 'object') {
        Object.entries(settingsData).forEach(([k, v]) => setByPath(settings.value, k, v));
      }
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const deleteSetting = async (key) => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.delete(`/settings/${key}`);
      deleteByPath(settings.value, key);
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  // DANGER ZONE: System Reset
  const resetApplication = async (confirmationToken) => {
    isLoading.value = true;
    error.value = null;

    try {
      const res = await api.post('/settings/danger/reset', { confirmationToken });

      if (res?.success) {
        settings.value = {};
        companyInfo.value = {
          name: '',
          city: '',
          area: '',
          street: '',
          phone: '',
          phone2: '',
          logoUrl: '',
          invoiceType: '',
          invoiceTheme: '',
        };
        return res.data;
      }
      throw new Error(res?.message || 'Failed to reset application');
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  // Utility functions
  const clearError = () => {
    error.value = null;
  };

  const resetCompanyInfo = () => {
    companyInfo.value = {
      name: '',
      city: '',
      area: '',
      street: '',
      phone: '',
      phone2: '',
      logoUrl: '',
      invoiceType: '',
    };
  };

  // Currency Settings Actions
  const fetchCurrencySettings = async () => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.get('/settings/currency');
      const currencyData = data || {};
      settings.value = {
        ...settings.value,
        defaultCurrency: currencyData.defaultCurrency,
        usdRate: currencyData.usdRate,
        iqdRate: currencyData.iqdRate,
      };
      return currencyData;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const saveCurrencySettings = async (currencyData) => {
    isLoading.value = true;
    error.value = null;

    try {
      const { data } = await api.put('/settings/currency', currencyData);
      notificationStore.success('تم حفظ إعدادات العملة بنجاح');
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      notificationStore.error('فشل حفظ إعدادات العملة');
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  // Initialize store
  const initialize = async () => {
    try {
      await Promise.all([fetchSettings(), fetchCompanyInfo()]);
    } catch {
      // Silently handle initialization errors
    }
  };

  return {
    // State
    settings,
    companyInfo,
    isLoading,
    error,

    // Getters
    getSettingValue,
    companyAddress,
    availableCurrencies,

    // Actions
    fetchSettings,
    fetchCompanyInfo,
    saveCompanyInfo,
    validatePhone,
    setSetting,
    bulkUpdateSettings,
    deleteSetting,
    resetApplication,
    clearError,
    resetCompanyInfo,
    fetchCurrencySettings,
    saveCurrencySettings,
    initialize,
  };
});
