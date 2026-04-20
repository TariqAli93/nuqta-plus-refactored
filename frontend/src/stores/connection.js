import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

const STORAGE_KEY = 'nuqtaplus_server_connection';
const DEFAULT_PORT = 41732;
const LOCAL_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const TEST_TIMEOUT = 5000;

/**
 * Connection store — manages how the frontend reaches the backend API.
 *
 * Server mode: always uses the local backend URL (http://127.0.0.1:41732).
 * Client mode: uses a user-configured server URL saved in localStorage.
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

  // Computed API base URL
  const apiBaseUrl = computed(() => {
    if (isServerMode) {
      return `${LOCAL_URL}/api`;
    }
    if (!serverHost.value) return null;
    return `http://${serverHost.value}:${serverPort.value}/api`;
  });

  const serverBaseUrl = computed(() => {
    if (isServerMode) return LOCAL_URL;
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
        return !!config.host;
      }
    } catch {
      // corrupt data — ignore
    }
    return false;
  }

  /**
   * Save connection config to localStorage.
   */
  function saveConnection(host, port) {
    serverHost.value = host;
    serverPort.value = port || DEFAULT_PORT;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host, port: serverPort.value }));
  }

  /**
   * Clear saved connection.
   */
  function clearConnection() {
    serverHost.value = '';
    serverPort.value = DEFAULT_PORT;
    isConnected.value = false;
    serverInfo.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Test connectivity to a server at the given host:port.
   * Returns { success, info?, error? }
   */
  async function testConnection(host, port) {
    const url = `http://${host}:${port || DEFAULT_PORT}/server-info`;
    connectionError.value = null;

    try {
      const response = await axios.get(url, { timeout: TEST_TIMEOUT });
      const info = response.data;

      if (info && info.mode === 'server') {
        return { success: true, info };
      }
      return { success: false, error: 'الجهاز المتصل ليس خادم Nuqta Plus' };
    } catch (err) {
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
   * Connect to the saved server (or a new one).
   * Saves on success, returns the result.
   */
  async function connect(host, port) {
    const result = await testConnection(host, port);

    if (result.success) {
      saveConnection(host, port);
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
    connect,
    verifySavedConnection,
  };
});
