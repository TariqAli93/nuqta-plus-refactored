const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_CHANNELS = [
  'update-checking',
  'update-not-available',
  'update-available',
  'update-downloading',
  'update-progress',
  'update-ready',
  'update-error',
];

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- App Info ----
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // ---- File dialogs ----
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),

  // ---- File IO ----
  saveFile: (path, data) => ipcRenderer.invoke('file:saveFile', path, data),
  readFile: (path) => ipcRenderer.invoke('file:readFile', path),

  // ---- Backend control ----
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  stopBackend: () => ipcRenderer.invoke('backend:stop'),
  startBackend: () => ipcRenderer.invoke('backend:start'),

  // ---- Window helpers ----
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  setSize: (width, height) => ipcRenderer.invoke('window:auto-resize', { width, height }),

  // ---- Register update listeners safely ----
  on(channel, callback) {
    if (!UPDATE_CHANNELS.includes(channel)) return null;

    const handler = (event, args) => {
      callback({
        channel,
        payload: args?.payload ?? args ?? null,
        manual: args?.manual ?? false,
        timestamp: Date.now(),
      });
    };

    ipcRenderer.on(channel, handler);

    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // ---- Remove all listeners (used when component unmounts) ----
  removeUpdateListeners() {
    UPDATE_CHANNELS.forEach((c) => ipcRenderer.removeAllListeners(c));
  },

  // ---- Manual trigger from Vue ----
  checkUpdatesManually: () => ipcRenderer.invoke('update:check'),

  // ---- First run setup ----
  createLockFile: () => ipcRenderer.invoke('firstRun:createLock'),

  getPrinters: () => ipcRenderer.invoke('getPrinters'),
  printReceipt: (receiptData) => ipcRenderer.invoke('print-receipt', receiptData),
  previewReceipt: (receiptData) => ipcRenderer.invoke('preview-receipt', receiptData),

  cutPaper: () => ipcRenderer.invoke('cut-paper'),
  kickDrawer: () => ipcRenderer.invoke('kick-drawer'),

  restoreBackup: (filename) => ipcRenderer.invoke('backup:restore', filename),
  exportBackup: (filename) => ipcRenderer.invoke('backup:export', filename),
  exportAndCreateNewDatabase: () => ipcRenderer.invoke('backup:exportAndCreateNewDatabase'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  clearDatabase: () => ipcRenderer.invoke('database:clear'),
  closeApp: () => ipcRenderer.invoke('app:close'),

  // ---- fallback invoke ----
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});

contextBridge.exposeInMainWorld('splashAPI', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
});

/**
 * window.api — backend lifecycle API consumed by the Vue frontend.
 *
 * status()  → Promise<'starting' | 'ready' | 'error'>
 * version() → Promise<string>   e.g. "1.0.12"
 */
contextBridge.exposeInMainWorld('api', {
  backend: {
    status: () => ipcRenderer.invoke('backend:getStatus'),
    version: () => ipcRenderer.invoke('backend:getVersion'),
    /**
     * Subscribe to live lifecycle transitions pushed from main.
     * Payload shape: { status: 'starting'|'ready'|'error', reason?, ...extra }
     * Returns an unsubscribe function.
     */
    onStatusChanged: (callback) => {
      const handler = (_event, payload) => {
        try {
          callback(payload);
        } catch (err) {
          // Never let a renderer-side handler error propagate back into main.
          // eslint-disable-next-line no-console
          console.error('[backend:statusChanged] handler threw:', err);
        }
      };
      ipcRenderer.on('backend:statusChanged', handler);
      return () => ipcRenderer.removeListener('backend:statusChanged', handler);
    },
  },
});

// License activation API (safe — no crypto/fs/machineId exposed)
contextBridge.exposeInMainWorld('licenseAPI', {
  activate: (input) => ipcRenderer.invoke('activate-license', input),
  browseFile: () => ipcRenderer.invoke('license:browseFile'),
  getMachineId: () => ipcRenderer.invoke('license:getMachineId'),
  getStatus: () => ipcRenderer.invoke('license:status'),
});
