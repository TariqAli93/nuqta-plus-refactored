import { defineStore } from 'pinia';

export const useNotificationStore = defineStore('notification', {
  state: () => ({
    show: false,
    message: '',
    type: 'info', // success, error, warning, info
    timeout: 4000,
    position: 'top',
    lastMessage: '',
    lastAt: 0,
    action: null, // { label, onClick }
  }),

  actions: {
    showNotification({ message, type = 'info', timeout = 4000, action = null }) {
      const now = Date.now();
      // Suppress duplicate notifications fired within 800ms
      if (message === this.lastMessage && now - this.lastAt < 800) {
        return;
      }
      this.message = message;
      this.type = type;
      this.timeout = timeout;
      this.action = action;
      this.show = true;
      this.lastMessage = message;
      this.lastAt = now;
    },

    success(message, timeout = 3000) {
      this.showNotification({ message, type: 'success', timeout });
    },

    error(message, timeout = 5000) {
      this.showNotification({ message, type: 'error', timeout });
    },

    warning(message, timeout = 4000) {
      this.showNotification({ message, type: 'warning', timeout });
    },

    info(message, timeout = 3000) {
      this.showNotification({ message, type: 'info', timeout });
    },

    hide() {
      this.show = false;
      this.action = null;
    },
  },
});
