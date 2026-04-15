import axios from 'axios';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notification';
import { useLoadingStore } from '@/stores/loading';
import router from '@/router';
import { buildArabicErrorMessage, extractArabicDetails } from '@/utils/errorTranslator';
import { useErrorDialogStore } from '@/stores/errorDialog';

// Helper to get help link based on error type
const getHelpLinkForError = (error) => {
  const status = error.response?.status;
  const errorType = error.response?.data?.error;

  if (status === 401) {
    return { url: '/auth/login', text: 'تسجيل الدخول' };
  }
  if (status === 403) {
    return { url: '/profile', text: 'التحقق من الصلاحيات' };
  }
  if (status === 404 && error.config?.url?.includes('/products')) {
    return { url: '/products', text: 'عرض المنتجات' };
  }
  if (status === 404 && error.config?.url?.includes('/customers')) {
    return { url: '/customers', text: 'عرض العملاء' };
  }
  if (errorType === 'ValidationError') {
    return { url: '/settings', text: 'التحقق من الإعدادات' };
  }

  return null;
};

const api = axios.create({
  baseURL: 'http://127.0.0.1:3050/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // بدء تتبع الطلب في نظام التحميل
    const loadingStore = useLoadingStore();
    loadingStore.startRequest();

    const authStore = useAuthStore();
    const token = authStore.token;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // If the data is FormData, remove Content-Type header to let browser set it with boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error) => {
    // في حالة خطأ في الطلب، إنهاء تتبع التحميل
    const loadingStore = useLoadingStore();
    loadingStore.endRequest();

    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    // إنهاء تتبع الطلب في حالة النجاح
    const loadingStore = useLoadingStore();
    loadingStore.endRequest();

    return response.data;
  },
  (error) => {
    // إنهاء تتبع الطلب في حالة الخطأ
    const loadingStore = useLoadingStore();
    loadingStore.endRequest();

    const notificationStore = useNotificationStore();

    // Build a precise, user-friendly message from backend response
    const buildMessage = (err) => buildArabicErrorMessage(err);

    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      const authStore = useAuthStore();
      authStore.logout();
      router.push({ name: 'Login' });
      notificationStore.error(
        buildMessage(error) || 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى'
      );
      return Promise.reject(error.response?.data || error.message);
    }

    // Handle 429 Rate Limit
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 40;
      notificationStore.warning(`تم تجاوز حد الطلبات. حاول مرة أخرى بعد ${retryAfter} ثانية`, 6000);
      return Promise.reject(error.response?.data || error.message);
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      notificationStore.error(buildMessage(error) || 'ليس لديك صلاحية للوصول إلى هذا المورد');
      return Promise.reject(error.response?.data || error.message);
    }

    // Handle 404 Not Found
    if (error.response?.status === 404) {
      notificationStore.error(buildMessage(error) || 'المورد المطلوب غير موجود');
      return Promise.reject(error.response?.data || error.message);
    }

    // Handle 500 Server Error
    if (error.response?.status >= 500) {
      notificationStore.error(buildMessage(error) || 'خطأ في الخادم. يرجى المحاولة لاحقاً');
      return Promise.reject(error.response?.data || error.message);
    }

    // Handle Network Error
    if (error.message === 'Network Error') {
      notificationStore.error('فشل الاتصال بالخادم. تحقق من اتصال الإنترنت');
      return Promise.reject(error);
    }

    // Handle Timeout
    if (error.code === 'ECONNABORTED') {
      notificationStore.error('انتهت مهلة الطلب. يرجى المحاولة مرة أخرى');
      return Promise.reject(error);
    }

    // If we have validation details, show detailed dialog
    const details = extractArabicDetails(error);
    if (details.length > 0) {
      const dialog = useErrorDialogStore();
      dialog.show({
        title: 'خطأ في التحقق من البيانات',
        message: buildMessage(error),
        details,
        helpLink:
          error.response?.status === 422
            ? {
                url: '/settings',
                text: 'التحقق من الإعدادات',
              }
            : null,
      });
    } else {
      // Fallback precise message with actionable help
      const message = buildMessage(error);
      const helpLink = getHelpLinkForError(error);

      if (helpLink) {
        notificationStore.showNotification({
          message,
          type: 'error',
          timeout: 6000,
          action: {
            label: helpLink.text,
            onClick: () => {
              if (helpLink.url) {
                router.push(helpLink.url);
              }
            },
          },
        });
      } else {
        notificationStore.error(message);
      }
    }
    return Promise.reject(error.response?.data || error.message);
  }
);

export default api;
