import { defineStore } from 'pinia';
import api from '@/plugins/axios';
import { useNotificationStore } from '@/stores/notification';

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
      } catch (err) {
        // Don't toast — the POS screen handles the "no open session" state.
        this.current = null;
        return null;
      } finally {
        this.fetching = false;
      }
    },

    async openSession({ openingCash, currency = 'USD', notes = null } = {}) {
      this.loading = true;
      const notify = useNotificationStore();
      try {
        const response = await api.post('/cash-sessions/open', {
          openingCash: Number(openingCash) || 0,
          currency,
          notes,
        });
        this.current = response?.data || null;
        notify.success('تم فتح الوردية');
        return this.current;
      } catch (err) {
        const msg = err?.response?.data?.message || 'فشل فتح الوردية';
        notify.error(msg);
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
        const msg = err?.response?.data?.message || 'فشل إغلاق الوردية';
        notify.error(msg);
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
