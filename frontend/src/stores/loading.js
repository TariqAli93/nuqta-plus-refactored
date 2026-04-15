import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useLoadingStore = defineStore('loading', () => {
  // متغير لتتبع عدد الطلبات النشطة
  const activeRequests = ref(0);

  // متغير للتحكم في إظهار/إخفاء مؤشر التحميل يدوياً
  const manualLoading = ref(false);

  // حالة التحميل الإجمالية
  const isLoading = computed(() => activeRequests.value > 0 || manualLoading.value);

  /**
   * بدء طلب جديد - يزيد من عداد الطلبات النشطة
   */
  const startRequest = () => {
    activeRequests.value++;
  };

  /**
   * إنهاء طلب - يقلل من عداد الطلبات النشطة
   */
  const endRequest = () => {
    if (activeRequests.value > 0) {
      activeRequests.value--;
    }
  };

  /**
   * تعيين حالة التحميل يدوياً
   * @param {boolean} loading - حالة التحميل
   */
  const setManualLoading = (loading) => {
    manualLoading.value = loading;
  };

  /**
   * إيقاف جميع حالات التحميل (طوارئ)
   */
  const clearAllLoading = () => {
    activeRequests.value = 0;
    manualLoading.value = false;
  };

  /**
   * تشغيل مؤشر التحميل لفترة محددة
   * @param {number} duration - المدة بالميللي ثانية
   */
  const showLoadingFor = (duration = 1000) => {
    setManualLoading(true);
    setTimeout(() => {
      setManualLoading(false);
    }, duration);
  };

  return {
    // State
    activeRequests: computed(() => activeRequests.value),
    isLoading,

    // Actions
    startRequest,
    endRequest,
    setManualLoading,
    clearAllLoading,
    showLoadingFor,
  };
});
