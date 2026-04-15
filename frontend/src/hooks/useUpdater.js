import { ref, onMounted, onUnmounted } from 'vue';

export function useUpdater() {
  const isAvailable = ref(false);
  const isDownloading = ref(false);
  const progress = ref(0);
  const error = ref(null);
  const isReady = ref(false);
  const isDowngrade = ref(false);

  const messages = {
    available: ref(''),
    downloading: ref(''),
    ready: ref(''),
  };

  function registerListener(channel, handler) {
    if (window.electronAPI?.on) {
      // returns an off function (optional)
      return window.electronAPI.on(channel, handler);
    }
    return null;
  }

  onMounted(() => {
    registerListener('update-available', (data) => {
      isAvailable.value = true;
      const payload = data?.payload ?? data;
      messages.available.value = payload?.releaseNotes || payload?.version || '';
      isDowngrade.value = !!payload?.isDowngrade;
    });

    registerListener('update-downloading', (data) => {
      isDownloading.value = true;
      const payload = data?.payload ?? data;
      messages.downloading.value = payload?.message || '';
    });

    registerListener('update-progress', (data) => {
      const payload = data?.payload ?? data;
      progress.value = payload?.percent ?? payload?.percent ?? 0;
    });

    registerListener('update-checking', () => {
      // mark as idle/checking
      isDownloading.value = false;
      isAvailable.value = false;
      progress.value = 0;
    });

    registerListener('update-not-available', () => {
      isAvailable.value = false;
      isDownloading.value = false;
      progress.value = 0;
    });

    registerListener('update-ready', (data) => {
      isReady.value = true;
      const payload = data?.payload ?? data;
      messages.ready.value = payload?.message || '';
    });

    registerListener('update-error', (err) => {
      const payload = err?.payload ?? err;
      error.value = payload?.error || payload || null;
    });
  });

  onUnmounted(() => {
    // Try to remove update listeners to avoid leaks if the preload provided helper
    if (window.electronAPI?.removeUpdateListeners) {
      window.electronAPI.removeUpdateListeners();
    }
  });

  return {
    isAvailable,
    isDownloading,
    progress,
    error,
    isReady,
    messages,
    isDowngrade,
  };
}
