import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

const STORAGE_KEY = 'nuqtaplus_server_connection';
const DEFAULT_PORT = 41732;
const LOCAL_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const TEST_TIMEOUT_LOCAL = 2000;
const TEST_TIMEOUT_REMOTE = 5000;

/**
 * Connection store — manages how the frontend reaches the backend API.
 *
 * Server mode: always uses the local backend URL (http://127.0.0.1:41732).
 * Client mode: uses a user-configured (or mDNS-discovered) server URL.
 *
 * The store tracks the *resolved* connection (host/port + last-used mode) so
 * the rest of the app can stay agnostic to how it was selected.
 */
export const useConnectionStore = defineStore('connection', () => {
  /* global __NUQTA_APP_MODE__ */
  const appMode = typeof __NUQTA_APP_MODE__ !== 'undefined' ? __NUQTA_APP_MODE__ : 'server';

  const isClientMode = appMode === 'client';
  const isServerMode = appMode === 'server';

  // Persisted connection for client mode
  const serverHost = ref('');
  const serverPort = ref(DEFAULT_PORT);
  const isConnected = ref(false);
  const serverInfo = ref(null);
  const connectionError = ref(null);

  // Last-used mode for diagnostics / UI hints. One of:
  // 'local' (manual IP), 'mdns', 'manual', 'remote'.
  const lastConnectionMode = ref(null);
  // Direct override URL — set when the user explicitly chose a remote
  // Cloudflare tunnel URL instead of a LAN address.
  const overrideUrl = ref('');
  // Stable identifier of the selected server (machineId from mDNS).
  const selectedServerMachineId = ref('');
  const selectedServerName = ref('');

  // Computed API base URL
  const apiBaseUrl = computed(() => {
    if (isServerMode) {
      return `${LOCAL_URL}/api`;
    }
    if (overrideUrl.value) {
      return `${overrideUrl.value.replace(/\/$/, '')}/api`;
    }
    if (!serverHost.value) return null;
    return `http://${serverHost.value}:${serverPort.value}/api`;
  });

  const serverBaseUrl = computed(() => {
    if (isServerMode) return LOCAL_URL;
    if (overrideUrl.value) return overrideUrl.value.replace(/\/$/, '');
    if (!serverHost.value) return null;
    return `http://${serverHost.value}:${serverPort.value}`;
  });

  /**
   * Load saved connection from localStorage.
   * Returns true if a saved config exists.
   */
  function loadSavedConnection() {
    if (isServerMode) {
      isConnected.value = true;
      return true;
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const config = JSON.parse(saved);
        serverHost.value = config.host || '';
        serverPort.value = config.port || DEFAULT_PORT;
        overrideUrl.value = config.overrideUrl || '';
        selectedServerMachineId.value = config.machineId || '';
        selectedServerName.value = config.name || '';
        lastConnectionMode.value = config.mode || null;
        return !!(config.host || config.overrideUrl);
      }
    } catch {
      // corrupt data — ignore
    }
    return false;
  }

  /**
   * Persist current connection to localStorage.
   *
   * Accepts either (host, port) for backwards compatibility, or an object:
   *   { host, port, overrideUrl, machineId, name, mode }
   */
  function saveConnection(hostOrConfig, port) {
    if (typeof hostOrConfig === 'object' && hostOrConfig !== null) {
      const cfg = hostOrConfig;
      serverHost.value = cfg.host || '';
      serverPort.value = cfg.port || DEFAULT_PORT;
      overrideUrl.value = cfg.overrideUrl || '';
      selectedServerMachineId.value = cfg.machineId || '';
      selectedServerName.value = cfg.name || '';
      if (cfg.mode) lastConnectionMode.value = cfg.mode;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          host: serverHost.value,
          port: serverPort.value,
          overrideUrl: overrideUrl.value,
          machineId: selectedServerMachineId.value,
          name: selectedServerName.value,
          mode: lastConnectionMode.value,
        })
      );
      return;
    }

    // Legacy (host, port) signature.
    serverHost.value = hostOrConfig;
    serverPort.value = port || DEFAULT_PORT;
    overrideUrl.value = '';
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        host: serverHost.value,
        port: serverPort.value,
        mode: lastConnectionMode.value || 'manual',
      })
    );
  }

  /**
   * Clear saved connection.
   */
  function clearConnection() {
    serverHost.value = '';
    serverPort.value = DEFAULT_PORT;
    overrideUrl.value = '';
    selectedServerMachineId.value = '';
    selectedServerName.value = '';
    lastConnectionMode.value = null;
    isConnected.value = false;
    serverInfo.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Test connectivity to a server URL (full http(s) URL).
   * Tries `/health` first (preferred) and falls back to `/server-info`.
   * Returns { success, info?, error? }
   */
  async function testServerUrl(url, { timeout } = {}) {
    if (!url) return { success: false, error: 'لا يوجد عنوان للخادم' };
    const isHttps = url.startsWith('https://');
    const effectiveTimeout = timeout ?? (isHttps ? TEST_TIMEOUT_REMOTE : TEST_TIMEOUT_LOCAL);
    const cleanUrl = url.replace(/\/$/, '');

    try {
      // Preferred: /server-info — already implemented in backend, gives us identity.
      const response = await axios.get(`${cleanUrl}/server-info`, { timeout: effectiveTimeout });
      const info = response.data;
      if (info && (info.mode === 'server' || info.service)) {
        return { success: true, info };
      }
      return { success: false, error: 'الجهاز المتصل ليس خادم Nuqta Plus' };
    } catch (err) {
      // Fallback: try /health — gives us liveness even if /server-info ever moves.
      try {
        const res = await axios.get(`${cleanUrl}/health`, { timeout: effectiveTimeout });
        if (res.data && (res.data.status === 'healthy' || res.data.status === 'ok')) {
          return { success: true, info: res.data };
        }
      } catch {
        /* swallow — fall through to original error handling */
      }

      if (err.code === 'ECONNABORTED') {
        return { success: false, error: 'انتهت مهلة الاتصال — تأكد من عنوان الخادم' };
      }
      if (err.message === 'Network Error') {
        return { success: false, error: 'لا يمكن الوصول إلى الخادم — تحقق من الشبكة والعنوان' };
      }
      return { success: false, error: `فشل الاتصال: ${err.message}` };
    }
  }

  /**
   * Test connectivity to a server at the given host:port (local LAN).
   */
  async function testConnection(host, port) {
    const url = `http://${host}:${port || DEFAULT_PORT}`;
    connectionError.value = null;
    return testServerUrl(url, { timeout: TEST_TIMEOUT_LOCAL });
  }

  /**
   * Connect to a server by host/port (or full URL). Saves on success.
   */
  async function connect(host, port, opts = {}) {
    const mode = opts.mode || 'manual';
    const result = await testConnection(host, port);

    if (result.success) {
      saveConnection({
        host,
        port: port || DEFAULT_PORT,
        overrideUrl: '',
        machineId: opts.machineId || '',
        name: opts.name || '',
        mode,
      });
      isConnected.value = true;
      serverInfo.value = result.info;
      connectionError.value = null;
    } else {
      isConnected.value = false;
      connectionError.value = result.error;
    }

    return result;
  }

  /**
   * Connect using a full remote URL (e.g. https://shop-xxxx.codelapps.com).
   * Used for the optional Cloudflare-tunnel fallback path.
   */
  async function connectRemoteUrl(url, opts = {}) {
    connectionError.value = null;
    if (!url) {
      return { success: false, error: 'الرابط الخارجي مطلوب' };
    }
    // Only http:// for local addresses, https:// for remote.
    const trimmed = url.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      return { success: false, error: 'الرابط يجب أن يبدأ بـ http:// أو https://' };
    }
    if (trimmed.startsWith('http://')) {
      // Treat http:// as a local URL — extract host/port.
      try {
        const u = new URL(trimmed);
        const host = u.hostname;
        const port = Number(u.port) || DEFAULT_PORT;
        return connect(host, port, { ...opts, mode: opts.mode || 'manual' });
      } catch {
        return { success: false, error: 'صيغة الرابط غير صحيحة' };
      }
    }

    const result = await testServerUrl(trimmed, { timeout: TEST_TIMEOUT_REMOTE });
    if (result.success) {
      saveConnection({
        host: '',
        port: DEFAULT_PORT,
        overrideUrl: trimmed,
        machineId: opts.machineId || '',
        name: opts.name || '',
        mode: 'remote',
      });
      isConnected.value = true;
      serverInfo.value = result.info;
      connectionError.value = null;
    } else {
      isConnected.value = false;
      connectionError.value = result.error;
    }
    return result;
  }

  /**
   * Verify that the currently saved connection is still reachable.
   */
  async function verifySavedConnection() {
    if (isServerMode) {
      isConnected.value = true;
      return true;
    }

    if (overrideUrl.value) {
      const result = await testServerUrl(overrideUrl.value, { timeout: TEST_TIMEOUT_REMOTE });
      isConnected.value = result.success;
      if (result.success) {
        serverInfo.value = result.info;
      } else {
        connectionError.value = result.error;
      }
      return result.success;
    }

    if (!serverHost.value) {
      isConnected.value = false;
      return false;
    }

    const result = await testConnection(serverHost.value, serverPort.value);
    isConnected.value = result.success;
    if (result.success) {
      serverInfo.value = result.info;
    } else {
      connectionError.value = result.error;
    }
    return result.success;
  }

  /**
   * Whether the app needs the server setup screen.
   * True only in client mode when no valid connection exists.
   */
  const needsSetup = computed(() => {
    return isClientMode && !isConnected.value;
  });

  return {
    // State
    appMode,
    isClientMode,
    isServerMode,
    serverHost,
    serverPort,
    overrideUrl,
    selectedServerMachineId,
    selectedServerName,
    lastConnectionMode,
    isConnected,
    serverInfo,
    connectionError,
    apiBaseUrl,
    serverBaseUrl,
    needsSetup,

    // Actions
    loadSavedConnection,
    saveConnection,
    clearConnection,
    testConnection,
    testServerUrl,
    connect,
    connectRemoteUrl,
    verifySavedConnection,
  };
});
