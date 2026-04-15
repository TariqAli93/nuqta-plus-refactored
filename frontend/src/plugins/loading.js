/**
 * Plugin نظام التحميل المتقدم
 * يوفر نظام تحميل مركزي ومتكامل مع Axios
 */

import { useLoadingStore } from '@/stores/loading';

export default {
  install(app) {
    // إضافة الخصائص العامة للتطبيق
    app.config.globalProperties.$loading = {
      start: () => {
        const store = useLoadingStore();
        store.setManualLoading(true);
      },

      stop: () => {
        const store = useLoadingStore();
        store.setManualLoading(false);
      },

      clear: () => {
        const store = useLoadingStore();
        store.clearAllLoading();
      },

      showFor: (duration = 1000) => {
        const store = useLoadingStore();
        store.showLoadingFor(duration);
      },
    };

    // توفير composable على مستوى التطبيق
    app.provide('loading', useLoadingStore());

    // تهيئة نظام التحميل
    const loadingStore = useLoadingStore();

    // تنظيف التحميل عند بدء التطبيق
    loadingStore.clearAllLoading();
  },
};
