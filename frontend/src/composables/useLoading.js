import { useLoadingStore } from '@/stores/loading';
import { ref, nextTick } from 'vue';

/**
 * Composable لاستخدام نظام التحميل بسهولة
 * @returns {Object} كائن يحتوي على دوال وحالة التحميل
 */
export function useLoading() {
  const loadingStore = useLoadingStore();

  /**
   * تنفيذ دالة مع إظهار مؤشر التحميل
   * @param {Function} asyncFunction - الدالة غير المتزامنة المراد تنفيذها
   * @param {Object} options - خيارات إضافية
   * @returns {Promise} نتيجة تنفيذ الدالة
   */
  const withLoading = async (asyncFunction, options = {}) => {
    const {
      showManual = true, // إظهار مؤشر التحميل يدوياً
      minDuration = 300, // الحد الأدنى لمدة التحميل (لتجنب الوميض)
      onError = null, // دالة معالجة الأخطاء
      onSuccess = null, // دالة معالجة النجاح
      onFinally = null, // دالة تنفذ في النهاية
    } = options;

    const startTime = Date.now();

    if (showManual) {
      loadingStore.setManualLoading(true);
    }

    try {
      const result = await asyncFunction();

      if (onSuccess && typeof onSuccess === 'function') {
        await onSuccess(result);
      }

      return result;
    } catch (error) {
      if (onError && typeof onError === 'function') {
        await onError(error);
      } else {
        throw error;
      }
    } finally {
      // ضمان الحد الأدنى لمدة التحميل
      const elapsedTime = Date.now() - startTime;
      const remainingTime = minDuration - elapsedTime;

      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      }

      if (showManual) {
        loadingStore.setManualLoading(false);
      }

      if (onFinally && typeof onFinally === 'function') {
        await onFinally();
      }
    }
  };

  /**
   * تحميل البيانات مع إدارة حالة التحميل والأخطاء
   * @param {Function} fetchFunction - دالة جلب البيانات
   * @param {Object} options - خيارات إضافية
   * @returns {Object} كائل يحتوي على البيانات وحالة التحميل والأخطاء
   */
  const useAsyncData = (fetchFunction, options = {}) => {
    const data = ref(null);
    const error = ref(null);
    const isLoading = ref(false);
    const isSuccess = ref(false);

    const {
      immediate = true, // التنفيذ التلقائي عند الإنشاء
      resetOnExecute = true, // إعادة تعيين البيانات عند التنفيذ
      throwOnError = false, // رمي الخطأ أم تخزينه فقط
    } = options;

    /**
     * تنفيذ عملية جلب البيانات
     */
    const execute = async (...args) => {
      if (resetOnExecute) {
        data.value = null;
        error.value = null;
        isSuccess.value = false;
      }

      isLoading.value = true;

      try {
        const result = await fetchFunction(...args);
        data.value = result;
        isSuccess.value = true;
        return result;
      } catch (err) {
        error.value = err;
        isSuccess.value = false;

        if (throwOnError) {
          throw err;
        }

        return null;
      } finally {
        isLoading.value = false;
      }
    };

    /**
     * إعادة تعيين الحالة
     */
    const reset = () => {
      data.value = null;
      error.value = null;
      isLoading.value = false;
      isSuccess.value = false;
    };

    /**
     * تحديث البيانات
     */
    const refresh = () => execute();

    // التنفيذ التلقائي إذا كان مطلوباً
    if (immediate) {
      nextTick(() => execute());
    }

    return {
      data,
      error,
      isLoading,
      isSuccess,
      execute,
      refresh,
      reset,
    };
  };

  /**
   * تأخير التنفيذ مع إظهار مؤشر التحميل
   * @param {number} duration - مدة التأخير بالميللي ثانية
   * @param {string} message - رسالة التحميل
   */
  const delayWithLoading = async (duration = 1000, _message = 'جاري المعالجة...') => {
    loadingStore.setManualLoading(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, duration));
    } finally {
      loadingStore.setManualLoading(false);
    }
  };

  /**
   * تجميع عدة طلبات مع إظهار مؤشر تحميل واحد
   * @param {Array} promises - مصفوفة من الوعود
   * @param {Object} options - خيارات إضافية
   */
  const withBatchLoading = async (promises, options = {}) => {
    const {
      concurrent = true, // تنفيذ متزامن أم تسلسلي
      failFast = false, // إيقاف عند أول خطأ
    } = options;

    loadingStore.setManualLoading(true);

    try {
      if (concurrent) {
        return failFast ? await Promise.all(promises) : await Promise.allSettled(promises);
      } else {
        const results = [];

        for (const promise of promises) {
          try {
            const result = await promise;
            results.push({ status: 'fulfilled', value: result });
          } catch (error) {
            if (failFast) {
              throw error;
            }
            results.push({ status: 'rejected', reason: error });
          }
        }

        return results;
      }
    } finally {
      loadingStore.setManualLoading(false);
    }
  };

  return {
    // حالة التحميل
    isLoading: loadingStore.isLoading,
    activeRequests: loadingStore.activeRequests,

    // دوال التحكم المباشر
    startLoading: () => loadingStore.setManualLoading(true),
    stopLoading: () => loadingStore.setManualLoading(false),
    clearAllLoading: loadingStore.clearAllLoading,
    showLoadingFor: loadingStore.showLoadingFor,

    // دوال مساعدة متقدمة
    withLoading,
    useAsyncData,
    delayWithLoading,
    withBatchLoading,
  };
}

/**
 * Composable مبسط للاستخدام السريع
 */
export function useSimpleLoading() {
  const { isLoading, startLoading, stopLoading } = useLoading();

  return { isLoading, startLoading, stopLoading };
}
