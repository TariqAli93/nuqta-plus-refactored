import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from './notification';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  provider: 'bulksmsiraq',
  apiKeyMasked: '',
  apiKeyConfigured: false,
  senderId: '',
  smsEnabled: true,
  whatsappEnabled: false,
  autoFallbackEnabled: true,
  defaultChannel: 'auto',
  overdueReminderEnabled: true,
  paymentConfirmationEnabled: true,
  bulkMessagingEnabled: false,
  singleCustomerMessagingEnabled: true,
  templates: null,
  lastTestAt: null,
  lastTestStatus: null,
  lastTestMessage: null,
});

/**
 * Pinia store for the messaging/notifications module. Speaks to
 * /api/notifications.
 */
export const useNotificationSettingsStore = defineStore('notificationSettings', () => {
  const settings = ref({ ...DEFAULT_SETTINGS });
  const availableProviders = ref(['bulksmsiraq']);
  const templates = ref([]);
  const logs = ref([]);
  const logsMeta = ref({ total: 0, page: 1, limit: 50, totalPages: 0 });
  const isLoading = ref(false);
  const isSaving = ref(false);
  const isTesting = ref(false);
  const error = ref(null);

  const notificationStore = useNotificationStore();

  const isConfigured = computed(() => settings.value.enabled && settings.value.apiKeyConfigured);

  function applyServerData(payload) {
    if (!payload) return;
    settings.value = {
      ...DEFAULT_SETTINGS,
      ...payload,
      apiKeyMasked: payload.apiKeyMasked || '',
    };
    if (Array.isArray(payload.availableProviders)) {
      availableProviders.value = payload.availableProviders;
    }
    if (Array.isArray(payload.templates)) {
      templates.value = payload.templates;
    }
  }

  async function fetchSettings() {
    isLoading.value = true;
    error.value = null;
    try {
      const { data } = await api.get('/notifications/settings');
      applyServerData(data);
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function saveSettings(patch) {
    isSaving.value = true;
    error.value = null;
    try {
      const { data } = await api.put('/notifications/settings', patch);
      applyServerData(data);
      notificationStore.success('تم حفظ إعدادات المراسلة');
      return data;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      notificationStore.error(error.value || 'فشل حفظ الإعدادات');
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  async function testConnection(apiKey) {
    isTesting.value = true;
    error.value = null;
    try {
      const body = apiKey ? { apiKey } : {};
      const res = await api.post('/notifications/settings/test', body);
      if (res?.success) {
        notificationStore.success('تم الاتصال بمزود الرسائل بنجاح');
      } else {
        notificationStore.error(res?.message || 'فشل اختبار الاتصال');
      }
      // Refresh to pick up lastTestStatus
      await fetchSettings();
      return res;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      notificationStore.error(error.value || 'فشل اختبار الاتصال');
      // Still refresh to surface lastTestStatus
      try {
        await fetchSettings();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      isTesting.value = false;
    }
  }

  async function sendCustomerMessage({ customerId, channel, message }) {
    const res = await api.post('/notifications/send/customer', {
      customerId,
      channel,
      message,
    });
    if (res?.success) {
      notificationStore.success('تم إضافة الرسالة إلى قائمة الإرسال');
    } else {
      notificationStore.error(res?.message || 'تعذر إرسال الرسالة');
    }
    return res;
  }

  async function sendBulkMessage({ customerIds = [], all = false, channel, message }) {
    const res = await api.post('/notifications/send/bulk', {
      customerIds,
      all,
      channel,
      message,
    });
    if (res?.success) {
      notificationStore.success(res.message || 'تم إضافة الرسائل إلى قائمة الإرسال');
    } else {
      notificationStore.error(res?.message || 'تعذر إرسال الرسائل');
    }
    return res;
  }

  async function fetchLogs(filters = {}) {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await api.get('/notifications', { params: filters });
      const list = res?.data || [];
      logs.value = Array.isArray(list) ? list : [];
      logsMeta.value = res?.meta || logsMeta.value;
      return logs.value;
    } catch (err) {
      error.value = err.response?.data?.message || err.message;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function retryNotification(id) {
    const res = await api.post(`/notifications/${id}/retry`);
    if (res?.success) {
      notificationStore.success('سيتم إعادة المحاولة');
      await fetchLogs();
    }
    return res;
  }

  async function processNow() {
    const res = await api.post('/notifications/process-now');
    if (res?.success) {
      await fetchLogs();
    }
    return res;
  }

  async function scanOverdue() {
    const res = await api.post('/notifications/scan-overdue');
    if (res?.success) {
      notificationStore.success('تم فحص الأقساط المتأخرة');
      await fetchLogs();
    }
    return res;
  }

  return {
    // state
    settings,
    availableProviders,
    templates,
    logs,
    logsMeta,
    isLoading,
    isSaving,
    isTesting,
    error,
    isConfigured,
    // actions
    fetchSettings,
    saveSettings,
    testConnection,
    sendCustomerMessage,
    sendBulkMessage,
    fetchLogs,
    retryNotification,
    processNow,
    scanOverdue,
  };
});
