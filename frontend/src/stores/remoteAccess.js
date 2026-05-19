import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/plugins/axios';
import { useNotificationStore } from './notification';

export const REMOTE_ACCESS_LABELS = Object.freeze({
  sectionTitle: 'الوصول الخارجي',
  enable: 'تفعيل الوصول الخارجي',
  disable: 'تعطيل الوصول الخارجي',
  publicUrl: 'الرابط الخارجي',
  copy: 'نسخ الرابط',
  copied: 'تم نسخ الرابط',
  active: 'مفعل',
  inactive: 'غير مفعل',
  pending: 'جاري التفعيل...',
  pendingDisable: 'جاري التعطيل...',
  error: 'حدث خطأ أثناء التفعيل',
  binaryMissing:
    'cloudflared.exe غير موجود. يرجى إعادة تثبيت البرنامج أو تضمين الملف.',
  disableWarning:
    'تم تعطيل الوصول المحلي ولكن تعذر إبلاغ الخادم الخارجي. حاول مرة أخرى لاحقاً.',
  description:
    'يتيح لك تفعيل الوصول الخارجي فتح نقطة بلس عبر الإنترنت من أي شبكة باستخدام رابط آمن.',
});

export const useRemoteAccessStore = defineStore('remoteAccess', () => {
  const enabled = ref(false);
  const running = ref(false);
  const subdomain = ref('');
  const publicUrl = ref('');
  const tunnelId = ref('');
  const machineId = ref('');
  const configExists = ref(false);
  const cloudflaredAvailable = ref(true);

  const loading = ref(false);
  const error = ref(null);

  const notificationStore = useNotificationStore();

  const statusLabel = computed(() => {
    if (loading.value) return REMOTE_ACCESS_LABELS.pending;
    return enabled.value ? REMOTE_ACCESS_LABELS.active : REMOTE_ACCESS_LABELS.inactive;
  });

  const statusColor = computed(() => {
    if (loading.value) return 'info';
    return enabled.value ? 'success' : 'grey';
  });

  function applyStatus(data) {
    if (!data || typeof data !== 'object') return;
    enabled.value = data.enabled === true;
    running.value = data.running === true;
    subdomain.value = data.subdomain || '';
    publicUrl.value = data.publicUrl || (data.subdomain ? `https://${data.subdomain}` : '');
    tunnelId.value = data.tunnelId || '';
    machineId.value = data.machineId || '';
    configExists.value = data.configExists === true;
    cloudflaredAvailable.value = data.cloudflaredAvailable !== false;
  }

  function extractErrorMessage(err) {
    const body = err?.response?.data || err;
    if (body?.code === 'CLOUDFLARED_MISSING') return REMOTE_ACCESS_LABELS.binaryMissing;
    return (
      body?.error ||
      body?.message ||
      err?.message ||
      REMOTE_ACCESS_LABELS.error
    );
  }

  async function getRemoteAccessStatus() {
    error.value = null;
    try {
      const res = await api.get('/tunnel/status');
      const data = res?.data || res;
      applyStatus(data);
      return data;
    } catch (err) {
      error.value = extractErrorMessage(err);
      throw err;
    }
  }

  async function enableRemoteAccess() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.post('/tunnel/enable');
      const data = res?.data || res;
      applyStatus(data);
      notificationStore.success(REMOTE_ACCESS_LABELS.active);
      return data;
    } catch (err) {
      error.value = extractErrorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function disableRemoteAccess() {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.post('/tunnel/disable');
      const data = res?.data || res;
      applyStatus(data);
      if (data?.warning === 'remote_api_disable_failed') {
        notificationStore.warning(REMOTE_ACCESS_LABELS.disableWarning);
      } else {
        notificationStore.success(REMOTE_ACCESS_LABELS.inactive);
      }
      return data;
    } catch (err) {
      error.value = extractErrorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function clearError() {
    error.value = null;
  }

  return {
    // State
    enabled,
    running,
    subdomain,
    publicUrl,
    tunnelId,
    machineId,
    configExists,
    cloudflaredAvailable,
    loading,
    error,
    // Getters
    statusLabel,
    statusColor,
    // Actions
    getRemoteAccessStatus,
    enableRemoteAccess,
    disableRemoteAccess,
    clearError,
  };
});
