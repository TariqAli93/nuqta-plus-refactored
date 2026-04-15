import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * backendState store
 *
 * Tracks the lifecycle of the local backend service as reported by Electron.
 * In web builds (no window.api) the status stays 'ready' so the app works normally.
 *
 * status: 'starting' | 'ready' | 'error'
 */
export const useBackendStateStore = defineStore('backendState', () => {
  const status = ref('starting');
  const version = ref(null);
  const error = ref(null);

  const isElectron = typeof window !== 'undefined' && typeof window.api !== 'undefined';

  /**
   * Poll window.api.backend.status() until it is no longer 'starting'.
   * Call once on app mount (BackendGate handles this).
   */
  async function initialize() {
    // In a plain web build there is no Electron IPC — backend is assumed ready.
    if (!isElectron) {
      status.value = 'ready';
      return;
    }

    // If Electron already reports ready or error, pick it up immediately.
    try {
      const current = await window.api.backend.status();
      status.value = current;

      if (current === 'ready') {
        version.value = await window.api.backend.version();
        return;
      }

      if (current === 'error') {
        error.value = 'فشل تشغيل الخادم المحلي';
        return;
      }
    } catch (err) {
      status.value = 'error';
      error.value = err.message || 'خطأ في التواصل مع Electron';
      return;
    }

    // Status is still 'starting' — poll until it changes
    await poll();
  }

  async function poll(maxWaitMs = 35000, intervalMs = 1000) {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      try {
        const current = await window.api.backend.status();
        status.value = current;

        if (current === 'ready') {
          version.value = await window.api.backend.version();
          return;
        }

        if (current === 'error') {
          error.value = 'فشل تشغيل الخادم المحلي';
          return;
        }
      } catch (err) {
        status.value = 'error';
        error.value = err.message || 'خطأ في التواصل مع Electron';
        return;
      }
    }

    // Timed out waiting
    status.value = 'error';
    error.value = 'انتهت مهلة انتظار الخادم المحلي';
  }

  /** Trigger a full backend restart via Electron and re-initialise. */
  async function restart() {
    if (!isElectron) return;
    status.value = 'starting';
    error.value = null;
    try {
      await window.electronAPI.restartBackend();
    } catch {
      // restartBackend now goes through ensureBackendRunning in main.js
    }
    await initialize();
  }

  return { status, version, error, initialize, restart };
});
