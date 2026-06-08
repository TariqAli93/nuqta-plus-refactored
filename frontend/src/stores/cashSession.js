import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

/**
 * Backend error codes (from accountingPeriodService) → clear Arabic messages,
 * so a 422 from the shift/period guards is never shown raw. The backend already
 * sends a localized `message`, but mapping by stable `code` keeps the wording
 * consistent and lets the frontend pre-checks reuse the exact same strings.
 */
export const SHIFT_ERROR_MESSAGES = Object.freeze({
  ACCOUNTING_PERIOD_DISABLED: 'نظام القيد المحاسبي غير مفعل. يجب تفعيله قبل فتح الوردية.',
  NO_OPEN_ACCOUNTING_PERIOD: 'لا يوجد قيد محاسبي مفتوح. يجب فتح قيد محاسبي لإتمام عمليات البيع.',
  // Backend also emits ACCOUNTING_PERIOD_REQUIRED for "no open period" — alias it.
  ACCOUNTING_PERIOD_REQUIRED: 'لا يوجد قيد محاسبي مفتوح. يجب فتح قيد محاسبي لإتمام عمليات البيع.',
  NO_OPEN_ACCOUNTING_PERIOD_FOR_BRANCH: 'لا يوجد قيد محاسبي مفتوح لهذا الفرع.',
  ACCOUNTING_PERIOD_CLOSED: 'القيد المحاسبي مغلق. افتح قيداً جديداً لإتمام عمليات البيع.',
  SHIFT_CLOSED: 'الوردية مغلقة. افتح وردية جديدة لإتمام البيع.',
  SHIFT_REQUIRED: 'لا توجد وردية مفتوحة ضمن قيد محاسبي مفتوح — افتح وردية أولاً.',
  NO_EFFECTIVE_BRANCH: 'لا يوجد فرع افتراضي للنظام. يرجى إعداد فرع افتراضي أولاً.',
});

/** Map an axios error to a localized message: code map → backend message → fallback. */
export function resolveShiftErrorMessage(err, fallback) {
  const code = err?.response?.data?.code;
  if (code && SHIFT_ERROR_MESSAGES[code]) return SHIFT_ERROR_MESSAGES[code];
  return err?.response?.data?.message || fallback;
}

/**
 * Pinia store for cash sessions / shift closing.
 *
 * `current` mirrors the open session for the acting user (or null). The POS
 * screen consults this before allowing a cash checkout. List/view fetches
 * power the shift report screen.
 */
export const useCashSessionStore = defineStore('cashSession', {
  state: () => ({
    current: null,
    sessions: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    loading: false,
    fetching: false,
  }),

  getters: {
    hasOpenSession: (state) => !!state.current && state.current.status === 'open',
  },

  actions: {
    /** Load the user's open session into `current`. Silent on 404/null. */
    async fetchCurrent() {
      this.fetching = true;
      try {
        const response = await api.get('/cash-sessions/current');
        this.current = response?.data || null;
        return this.current;
      } catch {
        // Don't toast — the POS screen handles the "no open session" state.
        this.current = null;
        return null;
      } finally {
        this.fetching = false;
      }
    },

    async openSession({ openingCash, currency = 'USD', notes = null, branchId = null } = {}) {
      this.loading = true;
      const notify = useNotificationStore();
      try {
        const payload = {
          openingCash: Number(openingCash) || 0,
          currency,
          notes,
        };
        if (branchId) payload.branchId = Number(branchId);
        const response = await api.post('/cash-sessions/open', payload);
        this.current = response?.data || null;
        notify.success('تم فتح الوردية');
        return this.current;
      } catch (err) {
        // Map backend 422 codes (ACCOUNTING_PERIOD_DISABLED, etc.) to clear
        // Arabic — never surface a raw 422.
        notify.error(resolveShiftErrorMessage(err, 'فشل فتح الوردية'));
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async closeSession(id, { closingCash, notes = null } = {}) {
      this.loading = true;
      const notify = useNotificationStore();
      try {
        const response = await api.post(`/cash-sessions/${id}/close`, {
          closingCash: Number(closingCash) || 0,
          notes,
        });
        const closed = response?.data || null;
        this.current = null;
        notify.success('تم إغلاق الوردية');
        return closed;
      } catch (err) {
        notify.error(resolveShiftErrorMessage(err, 'فشل إغلاق الوردية'));
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchList(params = {}) {
      this.loading = true;
      const notify = useNotificationStore();
      try {
        const response = await api.get('/cash-sessions', { params });
        this.sessions = response?.data || [];
        if (response?.meta) {
          this.pagination = {
            page: Number(response.meta.page) || 1,
            limit: Number(response.meta.limit) || 20,
            total: Number(response.meta.total) || 0,
            totalPages: Number(response.meta.totalPages) || 0,
          };
        }
        return response;
      } catch (err) {
        const msg = err?.response?.data?.message || 'فشل تحميل الورديات';
        notify.error(msg);
        this.sessions = [];
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async fetchById(id) {
      this.loading = true;
      try {
        const response = await api.get(`/cash-sessions/${id}`);
        return response?.data || null;
      } finally {
        this.loading = false;
      }
    },
  },
});
