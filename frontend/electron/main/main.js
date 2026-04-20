import { fileURLToPath } from 'node:url';
import path, { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
global.__dirname = __dirname;
global.__filename = __filename;

import { activate, checkStored } from '../licenseSystem/client-activation.js';
import { getMachineId } from '../licenseSystem/machine-id.js';

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { promises as fs } from 'fs-extra';
import logger from '../scripts/logger.js';
import BackendManager from '../scripts/backendManager.js';
import { ensureBackendRunning, checkVersion } from '../scripts/backendChecker.js';
import {
  resolveActiveBackend,
  readPointer,
  listStagedVersions,
  pruneOldVersions,
} from '../scripts/versionManager.js';
import {
  applyBackendUpdate,
  rollbackBackend,
} from '../scripts/backendUpdater.js';
import {
  ensureDownloadRoot,
  trustedRoots,
  sanitizePath,
} from '../scripts/security.js';
import { setupAutoUpdater, checkForUpdates, startDownload } from '../scripts/autoUpdater.js';
import { autoUpdater } from 'electron-updater';
import { createLockFile } from '../scripts/firstRun.js';
import { generateReceiptHtml } from '../scripts/receiptBuilder.js';

// --- المتغيرات العامة ---
const isDev = !app.isPackaged;

/**
 * Application mode: 'server' or 'client'.
 * - server: spawns and manages the local backend + PostgreSQL
 * - client: connects to a remote server over LAN, no local backend
 * Set via NUQTA_APP_MODE env var at build time (defaults to 'server').
 */
const APP_MODE = process.env.NUQTA_APP_MODE || 'server';
const isServerMode = APP_MODE === 'server';
const isClientMode = APP_MODE === 'client';

let mainWindow = null;
let splashWindow = null;
let activationWindow = null;
let isQuitting = false;
let backendReady = false;
let splashTimeout = null;

/** Lifecycle state reported to the Vue frontend via window.api.backend.status() */
let backendStatus = 'starting'; // 'starting' | 'ready' | 'error'

const backendManager = new BackendManager();

// ── Backend lifecycle event wiring ──────────────────────────────────────────
// The manager emits crash / restart / failure events. We translate them into
// backendStatus transitions and push live updates to the renderer via
// 'backend:statusChanged' so BackendGate can react without polling.

function broadcastBackendStatus(extra = {}) {
  const payload = { status: backendStatus, ...extra };
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (target) {
    try {
      target.webContents.send('backend:statusChanged', payload);
    } catch (err) {
      logger.warn(`broadcastBackendStatus failed: ${err.message}`);
    }
  }
}

backendManager.on('started', ({ pid }) => {
  logger.info(`[bm] backend started pid=${pid}`);
});

backendManager.on('crash', ({ code, signal }) => {
  logger.warn(`[bm] backend crash code=${code} signal=${signal} — entering 'starting'`);
  backendStatus = 'starting';
  broadcastBackendStatus({ reason: 'crash', code, signal });
});

backendManager.on('restart-scheduled', ({ attempt, cooldownMs }) => {
  logger.info(`[bm] restart scheduled attempt=${attempt} in ${cooldownMs}ms`);
});

backendManager.on('restart-success', async ({ attempt }) => {
  logger.info(`[bm] restart-success attempt=${attempt} — re-verifying health`);
  // The child is spawned, but we still need /health to pass before we can
  // mark ready. ensureBackendRunning handles both the poll and version check.
  try {
    const { status, error } = await ensureBackendRunning(backendManager, logger);
    backendStatus = status;
    broadcastBackendStatus({ reason: 'restart-complete', attempt, error });
  } catch (err) {
    logger.error(err, { phase: 'post-restart-verify' });
    backendStatus = 'error';
    broadcastBackendStatus({ reason: 'restart-verify-failed', error: err.message });
  }
});

backendManager.on('permanent-failure', async ({ attempts }) => {
  logger.error(`[bm] permanent-failure after ${attempts} attempts`);

  // Auto-rollback: if the crashing backend was a staged userData version,
  // revert to the previous version and try one more time. We only attempt
  // this once — if the rollback also fails we stay in permanent error.
  const active = resolveActiveBackend();
  const pointer = readPointer();
  const canRollback =
    active.source === 'userData' &&
    pointer &&
    (pointer.previousVersion || pointer.previousSource === 'baseline');

  if (canRollback) {
    logger.warn(`[rollback] auto-rollback from v${active.version} (crash loop)`);
    backendStatus = 'starting';
    broadcastBackendStatus({ reason: 'auto-rollback-begin', from: active.version });

    const rb = rollbackBackend('crash-loop');
    backendManager.resetRestartPolicy();

    const result = await ensureBackendRunning(backendManager, logger);
    backendStatus = result.status;
    broadcastBackendStatus({
      reason: 'auto-rollback-complete',
      rolledBackTo: rb.to,
      status: result.status,
      error: result.error,
    });

    if (result.status === 'ready') {
      logger.warn(`[rollback] recovered on v${result.version}`);
      return;
    }
    logger.error(`[rollback] post-rollback still unhealthy: ${result.error}`);
  }

  backendStatus = 'error';
  broadcastBackendStatus({ reason: 'permanent-failure', attempts });
});

backendManager.on('error', (err) => {
  logger.error(err, { phase: 'backendManager-error' });
});

// --- منع تشغيل أكثر من نسخة ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const target = mainWindow || activationWindow;
    if (target) {
      if (target.isMinimized()) target.restore();
      target.focus();
    }
  });
}

// --- نافذة البرنامج الرئيسية ---
function createWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 600,
    minHeight: 700,
    show: false,
    icon: isDev ? join(__dirname, '../../build/icon.png') : join(__dirname, '../build/icon.png'),
    webPreferences: {
      devTools: isDev,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  });

  // Do not automatically show the main window here; we'll control showing it
  mainWindow.once('ready-to-show', () => {
    setupAutoUpdater(mainWindow);
    // mark as ready — actual show will be handled by the startup flow when backend is ready and after the splash delay
    mainWindow.__readyToShow = true;
    tryToShowMainWindowAfterSplash();
  });

  mainWindow.removeMenu();

  // Add error handlers for debugging
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error(
      `Main window failed to load: ${errorCode} - ${errorDescription} - ${validatedURL}`
    );
    // Path resolution is handled in the main load logic above
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('Main window finished loading');
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Try multiple path resolution strategies for production
    // Note: In packaged apps, extraResources are in process.resourcesPath, not app.asar
    const tryLoadIndex = async () => {
      // Strategy 1: Try resources path first (for extraResources - most reliable in packaged apps)
      try {
        const resourcesPath = process.resourcesPath;
        const indexPath = path.join(resourcesPath, 'dist-electron', 'dist', 'index.html');
        logger.info(`Trying to load from resources path: ${indexPath}`);
        await mainWindow.loadFile(indexPath);
        logger.info('Successfully loaded from resources path');
        return;
      } catch (err) {
        logger.warn(`Failed to load from resources path: ${err.message}`);
      }

      // Strategy 2: Relative path from main.js location (works if files are in app.asar)
      try {
        const relativePath = path.join(__dirname, '../../dist/index.html');
        logger.info(`Trying to load from relative path: ${relativePath}`);
        await mainWindow.loadFile(relativePath);
        logger.info('Successfully loaded from relative path');
        return;
      } catch (err) {
        logger.warn(`Failed to load from relative path: ${err.message}`);
      }

      // Strategy 3: Using app.getAppPath() (for unpacked apps)
      let lastError;
      try {
        const appPath = app.getAppPath();
        const indexPath = path.join(appPath, 'dist-electron', 'dist', 'index.html');
        logger.info(`Trying to load from app path: ${indexPath}`);
        await mainWindow.loadFile(indexPath);
        logger.info('Successfully loaded from app path');
        return;
      } catch (err) {
        lastError = err;
        logger.warn(`Failed to load from app path: ${err.message}`);
      }

      // All strategies failed
      logger.error(
        `All path resolution strategies failed. Last error: ${lastError?.message || 'unknown'}`
      );
      throw new Error('Failed to locate index.html file');
    };

    tryLoadIndex().catch((err) => {
      logger.error(`Failed to load index.html after all attempts: ${err.message}`);
    });
  }

  // Handle window close with confirmation
  mainWindow.on('close', async (event) => {
    // If already quitting (user confirmed), allow close
    if (isQuitting) {
      return;
    }

    // Prevent default close behavior
    event.preventDefault();

    // Show confirmation dialog
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['إلغاء', 'إغلاق'],
      defaultId: 0, // Cancel is default
      cancelId: 0,
      title: 'تأكيد الإغلاق',
      message: 'هل أنت متأكد من إغلاق التطبيق؟',
      detail: 'قد يكون الإغلاق عن طريق الخطأ. هل تريد المتابعة؟',
      noLink: true,
    });

    // If user clicked "إغلاق" (Close), proceed with quit
    if (response === 1) {
      isQuitting = true;
      if (isServerMode) {
        await backendManager.CleanupBackendProcess();
      }
      // Close the window (this will trigger the 'closed' event)
      mainWindow.close();
    }
    // If user clicked "إلغاء" (Cancel), do nothing - window stays open
  });

  mainWindow.on('closed', async () => {
    logger.info('Main window closed');
    mainWindow = null;
    if (isServerMode) {
      await backendManager.CleanupBackendProcess();
    }
  });

  // Block all new window requests (Ctrl+click, middle-click, target="_blank", etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn(`Blocked new window request: ${url}`);
    return { action: 'deny' };
  });

  // Block navigation to external URLs (allow only dev server and file:// protocol)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = url.startsWith('http://localhost:5173');
    const isFileProtocol = url.startsWith('file://');
    if (!isDevServer && !isFileProtocol) {
      event.preventDefault();
      logger.warn(`Blocked navigation to: ${url}`);
      shell.openExternal(url);
    }
  });

  // IPC: Install update
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('getPrinters', async () => {
    try {
      // Try to get printers from main window first
      let targetWindow = mainWindow;

      // If main window is not available, try to get any available window
      if (!targetWindow || targetWindow.isDestroyed()) {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
          targetWindow = allWindows[0];
        } else {
          logger.warn('No windows available for getting printers');
          return [];
        }
      }

      // Ensure webContents is ready
      if (!targetWindow.webContents) {
        logger.warn('WebContents not available');
        return [];
      }

      // Ensure the window is ready - getPrinters() might need the window to be shown
      // Try to get printers - this is a synchronous method
      let printers;
      try {
        printers = await targetWindow.webContents.getPrintersAsync();
      } catch (getPrintersError) {
        logger.error('Error calling getPrinters():', getPrintersError);
        // If getPrinters fails, it might be because the window needs to be shown
        // Try showing it temporarily (if not already shown)
        if (!targetWindow.isVisible()) {
          logger.info('Window not visible, attempting to show temporarily');
          targetWindow.show();
          // Wait a bit for the window to be ready
          await new Promise((resolve) => setTimeout(resolve, 100));
          printers = await targetWindow.webContents.getPrintersAsync();
          // Hide again if it wasn't the main window
          if (targetWindow !== mainWindow) {
            targetWindow.hide();
          }
        } else {
          throw getPrintersError;
        }
      }

      logger.info(`Found ${printers.length} printers`);
      logger.debug('Printers from Electron', { printers });

      if (!printers || printers.length === 0) {
        logger.warn('No printers found on system');
        return [];
      }

      const formattedPrinters = printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        description: printer.description || '',
        status: printer.status || 0,
        isDefault: printer.isDefault || false,
      }));

      return formattedPrinters;
    } catch (error) {
      logger.error('Error getting printers:', error);
      return [];
    }
  });

  ipcMain.handle('print-receipt', async (_event, { printerName, receiptData, companyInfo }) => {
    try {
      if (!receiptData) throw new Error('Receipt data is required');
      if (!companyInfo) throw new Error('Company info is required');

      // Constants
      const PIXELS_PER_MM = 3.78;
      const PAPER_SIZE_CONFIGS = {
        'roll-58': { widthMM: 58, heightMM: 297, margins: { marginType: 'none' } },
        'roll-80': { widthMM: 80, heightMM: 297, margins: { marginType: 'none' } },
        'roll-88': { widthMM: 88, heightMM: 297, margins: { marginType: 'none' } },
        a4: { widthMM: 210, heightMM: 297, margins: { marginType: 'default' } },
        a5: { widthMM: 148, heightMM: 210, margins: { marginType: 'default' } },
      };

      // Get paper size configuration based on invoice type
      const invoiceType = companyInfo.invoiceType || 'roll-80';
      const invoiceTheme = companyInfo.invoiceTheme || 'classic';
      const paperConfig = PAPER_SIZE_CONFIGS[invoiceType] || PAPER_SIZE_CONFIGS['roll-80'];

      logger.debug('Printing receipt', {
        printerName,
        invoiceType,
        invoiceTheme,
        paperConfig,
        receiptDataLength: receiptData?.length,
      });

      // Generate HTML content from receipt data
      const htmlContent = generateReceiptHtml(receiptData, invoiceType, invoiceTheme);

      // Create a hidden window for printing
      const printWindow = new BrowserWindow({
        show: false,
        width: Math.round(paperConfig.widthMM * PIXELS_PER_MM),
        height: Math.round(paperConfig.heightMM * PIXELS_PER_MM),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // Load the HTML content
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

      // Wait for fonts and content to be legally ready
      try {
        await printWindow.webContents.executeJavaScript('document.fonts.ready');
      } catch (err) {
        logger.warn('Error waiting for fonts:', err);
        // Fallback to small timeout if font check fails
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Print options
      const printOptions = {
        silent: true,
        printBackground: true,
        deviceName: printerName || undefined,
        pageSize: {
          width: paperConfig.widthMM * 1000, // Convert mm to microns
          height: paperConfig.heightMM * 1000,
        },
        margins: paperConfig.margins,
      };

      // Print the content
      return new Promise((resolve) => {
        printWindow.webContents.print(printOptions, (success, errorType) => {
          // Close window after print attempt
          // Use setTimeout to ensure print job is sent to spooler before closing
          setTimeout(() => {
            if (!printWindow.isDestroyed()) {
              printWindow.close();
            }
          }, 100);

          if (success) {
            logger.info('Receipt printed successfully');
            resolve({ success: true, message: 'تمت الطباعة بنجاح' });
          } else {
            logger.error('Print failed:', errorType);
            resolve({
              success: false,
              error: `فشل في الطباعة: ${errorType || 'خطأ غير معروف'}`,
            });
          }
        });
      });
    } catch (error) {
      logger.error('Error printing receipt:', error);
      return {
        success: false,
        error: error.message || 'فشل في الطباعة',
      };
    }
  });

  ipcMain.handle('preview-receipt', async (_event, { receiptData, companyInfo }) => {
    try {
      if (!receiptData) throw new Error('Receipt data is required');
      if (!companyInfo) throw new Error('Company info is required');

      // Constants
      const PIXELS_PER_MM = 3.78;
      const PAPER_SIZE_CONFIGS = {
        'roll-58': { widthMM: 58, heightMM: 297, margins: { marginType: 'none' } },
        'roll-80': { widthMM: 80, heightMM: 297, margins: { marginType: 'none' } },
        'roll-88': { widthMM: 88, heightMM: 297, margins: { marginType: 'none' } },
        a4: { widthMM: 210, heightMM: 297, margins: { marginType: 'default' } },
        a5: { widthMM: 148, heightMM: 210, margins: { marginType: 'default' } },
      };

      // Get paper size configuration based on invoice type
      const invoiceType = companyInfo.invoiceType || 'roll-80';
      const invoiceTheme = companyInfo.invoiceTheme || 'classic';
      const paperConfig = PAPER_SIZE_CONFIGS[invoiceType] || PAPER_SIZE_CONFIGS['roll-80'];

      logger.debug('Previewing receipt', {
        invoiceType,
        invoiceTheme,
        paperConfig,
        receiptDataLength: receiptData?.length,
      });

      // Generate HTML content from receipt data
      const htmlContent = generateReceiptHtml(receiptData, invoiceType, invoiceTheme);

      // Create a window for preview
      const printWindow = new BrowserWindow({
        show: false,
        width: Math.round(paperConfig.widthMM * PIXELS_PER_MM),
        height: Math.round(paperConfig.heightMM * PIXELS_PER_MM),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // Load a blank page first
      await printWindow.loadURL('about:blank');

      // Write HTML content directly to avoid data URL length limits
      await printWindow.webContents.executeJavaScript(`
        document.open();
        document.write(${JSON.stringify(htmlContent)});
        document.close();
      `);

      // Wait for fonts and content to be ready
      try {
        await printWindow.webContents.executeJavaScript('document.fonts.ready');
      } catch (err) {
        logger.warn('Error waiting for fonts:', err);
        // Fallback to small timeout if font check fails
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Show window after content is loaded
      printWindow.show();

      return {
        success: true,
        message: 'تمت الطباعة بنجاح',
      };
    } catch (error) {
      logger.error('Error printing receipt:', error);
      return {
        success: false,
        error: error.message || 'فشل في الطباعة',
      };
    }
  });

  ipcMain.handle('cut-paper', async () => {
    try {
      logger.debug('Cutting paper command received');
      return { success: true };
    } catch (error) {
      logger.error('Error cutting paper:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('kick-drawer', async () => {
    try {
      logger.debug('Kicking cash drawer command received');
      return { success: true };
    } catch (error) {
      logger.error('Error kicking cash drawer:', error);
      return { success: false, error: error.message };
    }
  });
}

// --- نافذة التفعيل ---
function createActivationWindow() {
  if (activationWindow) return;

  activationWindow = new BrowserWindow({
    width: 600,
    height: 650,
    resizable: false,
    center: true,
    frame: true,
    show: false,
    title: 'تفعيل نقطة بلس',
    icon: isDev ? join(__dirname, '../../build/icon.png') : join(__dirname, '../build/icon.png'),
    webPreferences: {
      devTools: isDev,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  });

  activationWindow.removeMenu();

  const loadActivationWindow = async () => {
    if (isDev) {
      // Dev: Vite dev server + createWebHistory → plain path URL
      await activationWindow.loadURL('http://localhost:5173/activation');
      return;
    }

    // Production: createWebHashHistory → loadFile with { hash: '/activation' }
    try {
      const p = path.join(process.resourcesPath, 'dist-electron', 'dist', 'index.html');
      logger.info(`Trying activation from resources path: ${p}`);
      await activationWindow.loadFile(p, { hash: '/activation' });
      logger.info('Loaded activation window from resources path');
      return;
    } catch (err) {
      logger.warn(`Failed activation resources path: ${err.message}`);
    }

    try {
      const p = path.join(__dirname, '../../dist/index.html');
      logger.info(`Trying activation from relative path: ${p}`);
      await activationWindow.loadFile(p, { hash: '/activation' });
      logger.info('Loaded activation window from relative path');
      return;
    } catch (err) {
      logger.warn(`Failed activation relative path: ${err.message}`);
    }

    try {
      const appPath = app.getAppPath();
      const p = path.join(appPath, 'dist-electron', 'dist', 'index.html');
      logger.info(`Trying activation from app path: ${p}`);
      await activationWindow.loadFile(p, { hash: '/activation' });
      logger.info('Loaded activation window from app path');
    } catch (err) {
      logger.error(`Failed to load activation window: ${err.message}`);
    }
  };

  loadActivationWindow().catch((err) => {
    logger.error(`Activation window load error: ${err.message}`);
  });

  activationWindow.once('ready-to-show', () => {
    activationWindow.show();
    activationWindow.focus();
  });

  activationWindow.on('closed', () => {
    activationWindow = null;
  });
}

// --- نافذة الـ Splash ---
function createSplashWindow() {
  if (splashWindow) return;

  splashWindow = new BrowserWindow({
    width: 1200,
    height: 650,
    resizable: false,
    frame: false,
    center: true,
    transparent: true,
    show: false,
    icon: isDev ? join(__dirname, '../../build/icon.png') : join(__dirname, '../build/icon.png'),
    webPreferences: {
      devTools: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  });

  splashWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      logger.error(
        `Splash window failed to load: ${errorCode} - ${errorDescription} - ${validatedURL}`
      );
    }
  );

  splashWindow.webContents.on('did-finish-load', () => {
    logger.info('Splash window finished loading');
  });

  if (isDev) {
    splashWindow.loadFile(path.join(__dirname, '../../splash.html'));
  } else {
    const tryLoadSplash = async () => {
      try {
        const resourcesPath = process.resourcesPath;
        const splashPath = path.join(resourcesPath, 'dist-electron', 'dist', 'splash.html');
        logger.info(`Trying to load splash from resources path: ${splashPath}`);
        await splashWindow.loadFile(splashPath);
        logger.info('Successfully loaded splash from resources path');
        return;
      } catch (err) {
        logger.warn(`Failed to load splash from resources path: ${err.message}`);
      }

      try {
        const relativePath = path.join(__dirname, '../../dist/splash.html');
        logger.info(`Trying to load splash from relative path: ${relativePath}`);
        await splashWindow.loadFile(relativePath);
        logger.info('Successfully loaded splash from relative path');
        return;
      } catch (err) {
        logger.warn(`Failed to load splash from relative path: ${err.message}`);
      }

      let lastError;
      try {
        const appPath = app.getAppPath();
        const splashPath = path.join(appPath, 'dist-electron', 'dist', 'splash.html');
        logger.info(`Trying to load splash from app path: ${splashPath}`);
        await splashWindow.loadFile(splashPath);
        logger.info('Successfully loaded splash from app path');
        return;
      } catch (err) {
        lastError = err;
        logger.warn(`Failed to load splash from app path: ${err.message}`);
      }

      logger.error(
        `All splash path resolution strategies failed. Last error: ${lastError?.message || 'unknown'}`
      );
      throw new Error('Failed to locate splash.html file');
    };

    tryLoadSplash().catch((err) => {
      logger.error(`Failed to load splash.html after all attempts: ${err.message}`);
    });
  }

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    splashWindow.__shownAt = Date.now();
  });

  splashWindow.on('closed', () => (splashWindow = null));
}

function tryToShowMainWindowAfterSplash() {
  if (!mainWindow) return;
  if (!mainWindow.__readyToShow) return;
  if (!backendReady) return;

  if (splashTimeout) {
    clearTimeout(splashTimeout);
    splashTimeout = null;
  }

  const showMainWindow = () => {
    splashTimeout = null;

    if (splashWindow) {
      try {
        splashWindow.destroy();
      } catch (err) {
        logger.warn('Error destroying splash window', err);
      }
      splashWindow = null;
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  };

  if (splashWindow && splashWindow.__shownAt) {
    const minSplashTime = 7000;
    const timeSinceShown = Date.now() - splashWindow.__shownAt;
    const timeLeft = minSplashTime - timeSinceShown;

    if (timeLeft > 0) {
      logger.info(`Splash shown. Waiting ${timeLeft}ms before showing main window`);
      splashTimeout = setTimeout(showMainWindow, timeLeft);
    } else {
      logger.info('Splash minimum time already reached, showing main window');
      showMainWindow();
    }
  } else {
    logger.warn('Splash timing not available, showing main window immediately');
    showMainWindow();
  }
}

// --- تشغيل التطبيق الرئيسي بعد التحقق من الترخيص ---
async function startNormalApp() {
  createSplashWindow();
  createWindow();

  if (isServerMode) {
    // Server mode: spawn and manage the local backend
    const result = await ensureBackendRunning(backendManager, logger);
    backendStatus = result.status;
    broadcastBackendStatus({ reason: 'startup', version: result.version, error: result.error });

    if (result.status === 'ready') {
      logger.info(`Backend ready — version: ${result.version}`);
    } else {
      logger.error(`Backend failed to start: ${result.error}`);
    }
  } else {
    // Client mode: no local backend — mark as ready immediately.
    // The Vue frontend handles server connection via the setup screen.
    logger.info('Client mode — skipping local backend startup');
    backendStatus = 'ready';
    broadcastBackendStatus({ reason: 'client-mode' });
  }

  backendReady = true;
  tryToShowMainWindowAfterSplash();
}

// --- IPC: تفعيل الترخيص ---
ipcMain.handle('activate-license', async (_event, input) => {
  try {
    // input: { type: 'file', path: '...' } | { type: 'key', key: '...' }
    const licenseInput = input.type === 'file' ? input.path : input.key;
    const result = activate(licenseInput);

    if (result.valid) {
      logger.info('License activated successfully');

      // Start the main app FIRST so at least one window exists before
      // the activation window is destroyed — otherwise window-all-closed
      // fires with zero windows and the app quits before the main window opens.
      await startNormalApp();

      if (activationWindow && !activationWindow.isDestroyed()) {
        activationWindow.destroy();
        activationWindow = null;
      }

      return { success: true, license: result.license };
    } else {
      logger.warn('License activation failed:', result.error);
      return { success: false, error: result.error, details: result.details };
    }
  } catch (err) {
    logger.error('License activation error:', err);
    return { success: false, error: err.message };
  }
});

// --- IPC: فتح مربع حوار لاختيار ملف الترخيص ---
ipcMain.handle('license:browseFile', async () => {
  const result = await dialog.showOpenDialog(activationWindow || null, {
    title: 'اختر ملف الترخيص',
    filters: [{ name: 'License File', extensions: ['lic', 'json'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, filePath: result.filePaths[0] };
});

// --- IPC: معرّف الجهاز (للعرض في نافذة التفعيل فقط) ---
ipcMain.handle('license:getMachineId', () => {
  try {
    return { success: true, machineId: getMachineId() };
  } catch (err) {
    logger.error('Failed to get machine ID:', err);
    return { success: false, machineId: null };
  }
});

// --- IPC: حالة الترخيص الحالية ---
ipcMain.handle('license:status', () => {
  try {
    const result = checkStored();
    const machineId = getMachineId();
    return {
      success: true,
      valid: result.valid,
      error: result.error || null,
      license: result.valid ? result.license : null,
      machineId,
    };
  } catch (err) {
    logger.error('Failed to get license status:', err);
    return { success: false, valid: false, error: err.message, license: null, machineId: null };
  }
});

app.whenReady().then(async () => {
  if (isQuitting) return;

  // --- التحقق من الترخيص قبل فتح أي نافذة ---
  let licenseValid = false;
  try {
    const result = checkStored();
    licenseValid = result.valid;
    if (!result.valid) {
      logger.warn(`License check failed: ${result.error}`);
    } else {
      logger.info('License is valid, starting app normally');
    }
  } catch (err) {
    logger.error(`License check threw: ${err.message}`);
    licenseValid = false;
  }

  if (licenseValid) {
    await startNormalApp();
  } else {
    createActivationWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isQuitting) {
      if (mainWindow === null && activationWindow === null) {
        createActivationWindow();
      }
    }
  });
});

// --- عند إغلاق جميع النوافذ ---
app.on('window-all-closed', async () => {
  isQuitting = true;
  if (isServerMode) {
    backendManager.removeAllListeners('crash');
    backendManager.removeAllListeners('restart-scheduled');
    await backendManager.CleanupBackendProcess();
  }
  app.quit();
});

// --- before quit ---
app.on('before-quit', async (event) => {
  if (isQuitting) return;

  isQuitting = true;
  event.preventDefault();

  if (splashTimeout) {
    clearTimeout(splashTimeout);
    splashTimeout = null;
  }

  if (isServerMode) {
    backendManager.removeAllListeners('crash');
    backendManager.removeAllListeners('restart-scheduled');
    await backendManager.CleanupBackendProcess();
  }
  app.quit();
});

// --- will quit ---
app.on('will-quit', async () => {
  if (isServerMode) {
    await backendManager.CleanupBackendProcess();
  }
});

// --- IPC: معلومات التطبيق ---
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);
ipcMain.handle('app:getMode', () => APP_MODE);

// --- IPC: Client-mode connection config ---
// Stores server-connection.json in userData for client-mode apps.
const connectionConfigPath = join(app.getPath('userData'), 'server-connection.json');

ipcMain.handle('connection:load', async () => {
  try {
    const data = await fs.readFile(connectionConfigPath, 'utf8');
    return { success: true, config: JSON.parse(data) };
  } catch {
    return { success: true, config: null };
  }
});

ipcMain.handle('connection:save', async (_e, config) => {
  try {
    await fs.writeFile(connectionConfigPath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('connection:clear', async () => {
  try {
    await fs.unlink(connectionConfigPath);
  } catch {
    // file didn't exist — that's fine
  }
  return { success: true };
});

// --- Dialog ---
ipcMain.handle('dialog:showSaveDialog', async (_e, options) =>
  dialog.showSaveDialog(mainWindow, options)
);

ipcMain.handle('dialog:showOpenDialog', async (_e, options) =>
  dialog.showOpenDialog(mainWindow, options)
);

// --- File System ---
ipcMain.handle('file:saveFile', async (_e, filePath, data) => {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await fs.writeFile(filePath, buffer);
  return { success: true };
});

ipcMain.handle('file:readFile', async (_e, filePath) => {
  return await fs.readFile(filePath);
});

// --- حالة الـ backend (للـ preload window.api) ---

/** Returns current lifecycle status: 'starting' | 'ready' | 'error' */
ipcMain.handle('backend:getStatus', () => backendStatus);

/** Fetch /version from the running backend and return the version string */
ipcMain.handle('backend:getVersion', async () => {
  try {
    const version = await checkVersion();
    return version || 'unknown';
  } catch (err) {
    logger.warn(`backend:getVersion failed: ${err.message}`);
    return 'unknown';
  }
});

// --- التحكم في backend (يدوي فقط — server mode only) ---
ipcMain.handle('backend:start', async () => {
  if (!isServerMode) return { ok: false, error: 'Not available in client mode' };
  await backendManager.StartBackend();
  return { ok: true };
});

ipcMain.handle('backend:stop', async () => {
  if (!isServerMode) return { ok: false, error: 'Not available in client mode' };
  await backendManager.StopBackend();
  return { ok: true };
});

ipcMain.handle('backend:restart', async () => {
  if (!isServerMode) return { ok: false, error: 'Not available in client mode' };
  backendStatus = 'starting';
  broadcastBackendStatus({ reason: 'manual-restart-begin' });
  await backendManager.StopBackend();
  // Manual restart is a user-initiated recovery — clear the crash budget so
  // the next spawn isn't blocked by a prior permanent-failure state.
  backendManager.resetRestartPolicy();
  const result = await ensureBackendRunning(backendManager, logger);
  backendStatus = result.status;
  broadcastBackendStatus({ reason: 'manual-restart-complete', error: result.error });
  return { ok: result.status === 'ready', status: backendStatus, error: result.error };
});

// ── Backend version management IPC ──────────────────────────────────────────

/** Returns { active: {...}, pointer, staged: [...] } for diagnostics/admin UIs. */
ipcMain.handle('backend:getVersionInfo', () => {
  return {
    active: resolveActiveBackend(),
    pointer: readPointer(),
    staged: listStagedVersions(),
  };
});

/**
 * Where trusted download archives must be placed before calling applyUpdate.
 * Anything outside this directory is rejected by the updater's origin check.
 */
ipcMain.handle('backend:getDownloadRoot', () => {
  try {
    return { ok: true, path: sanitizePath(ensureDownloadRoot()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/**
 * Apply a backend-only update. Caller is responsible for having downloaded
 * and extracted the new bundle INTO <userData>/backend-downloads/<sub>/ —
 * any other sourceDir is rejected by the updater's security checks.
 */
ipcMain.handle(
  'backend:applyUpdate',
  async (_e, { sourceDir, version, expectedHash } = {}) => {
    if (!sourceDir || !version) {
      return { ok: false, error: 'sourceDir and version are required' };
    }
    logger.info(`[ipc] backend:applyUpdate v${version}`);
    backendStatus = 'starting';
    broadcastBackendStatus({ reason: 'update-begin', version });

    const result = await applyBackendUpdate({
      sourceDir,
      version,
      expectedHash,
      backendManager,
    });

    backendStatus = result.ok ? 'ready' : result.rolledBack ? 'ready' : 'error';
    broadcastBackendStatus({
      reason: result.ok ? 'update-success' : 'update-failed',
      version,
      rolledBack: !!result.rolledBack,
      error: result.error,
    });
    return result;
  }
);

/** Manual rollback trigger (admin / recovery). */
ipcMain.handle('backend:rollback', async () => {
  logger.warn('[ipc] backend:rollback requested');
  await backendManager.CleanupBackendProcess();
  backendManager.resetRestartPolicy();
  const rb = rollbackBackend('manual');
  const result = await ensureBackendRunning(backendManager, logger);
  backendStatus = result.status;
  broadcastBackendStatus({
    reason: 'manual-rollback-complete',
    rolledBackTo: rb.to,
    error: result.error,
  });
  return { ok: result.status === 'ready', rolledBackTo: rb.to, error: result.error };
});

/** Prune old staged versions (keeps current + previous by default). */
ipcMain.handle('backend:pruneVersions', () => {
  try {
    pruneOldVersions();
    return { ok: true, staged: listStagedVersions() };
  } catch (err) {
    logger.error(err, { phase: 'prune' });
    return { ok: false, error: err.message };
  }
});

// ── PostgreSQL-aware backup/restore IPC handlers ───────────────────────────
// These delegate to the backend API rather than manipulating .db files.
// The backend uses pg_dump / pg_restore under the hood.

const BACKEND_URL = 'http://127.0.0.1:41732';

/** Helper: get a valid JWT token from the renderer's localStorage (via webContents). */
async function getAuthToken() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    return await mainWindow.webContents.executeJavaScript(
      `localStorage.getItem('token')`,
      true
    );
  } catch {
    return null;
  }
}

ipcMain.handle('backup:restore', async (_e, filename) => {
  if (!isServerMode) return { ok: false, error: 'Restore is only available in server mode' };
  try {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const { default: http } = await import('http');
    const url = `${BACKEND_URL}/api/settings/backups/${encodeURIComponent(filename)}/restore`;

    const result = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 400) throw new Error(result.body?.message || 'Restore failed');
    return { ok: true };
  } catch (error) {
    logger.error('Failed to restore backup:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('backup:export', async (_e, filename) => {
  if (!isServerMode) return { ok: false, error: 'Export is only available in server mode' };
  try {
    const os = await import('os');

    const getUserDataDir = () => {
      const platform = process.platform;
      const homeDir = os.homedir();
      if (platform === 'win32') return path.join(homeDir, 'AppData', 'Roaming', '@nuqtaplus');
      if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', '@nuqtaplus');
      return path.join(homeDir, '.config', '@nuqtaplus');
    };

    const backupDir = path.join(getUserDataDir(), 'backups');
    const sourcePath = path.join(backupDir, filename);

    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error('ملف النسخة الاحتياطية غير موجود');
    }

    const { canceled, filePath: destPath } = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ النسخة الاحتياطية',
      defaultPath: filename,
      filters: [{ name: 'Database Backup', extensions: ['dump'] }],
    });

    if (canceled || !destPath) return { ok: false, reason: 'canceled' };
    await fs.copyFile(sourcePath, destPath);
    return { ok: true };
  } catch (error) {
    logger.error('Failed to export backup:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('backup:import', async () => {
  if (!isServerMode) return { ok: false, error: 'Import is only available in server mode' };
  try {
    const os = await import('os');

    const getUserDataDir = () => {
      const platform = process.platform;
      const homeDir = os.homedir();
      if (platform === 'win32') return path.join(homeDir, 'AppData', 'Roaming', '@nuqtaplus');
      if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', '@nuqtaplus');
      return path.join(homeDir, '.config', '@nuqtaplus');
    };

    // 1. Show Open Dialog to select backup file (.dump format for PostgreSQL)
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'استيراد نسخة احتياطية',
      filters: [{ name: 'Database Backup', extensions: ['dump'] }],
      properties: ['openFile'],
    });

    if (canceled || !filePaths.length) return { ok: false, reason: 'canceled' };

    const sourcePath = filePaths[0];
    const backupDir = path.join(getUserDataDir(), 'backups');

    // Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // 2. Copy the selected file into the backups directory
    const importedFilename = `backup-imported-${Date.now()}.dump`;
    const destPath = path.join(backupDir, importedFilename);
    await fs.copyFile(sourcePath, destPath);

    // 3. Restore via backend API
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const { default: http } = await import('http');
    const url = `${BACKEND_URL}/api/settings/backups/${encodeURIComponent(importedFilename)}/restore`;

    const result = await new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 400) throw new Error(result.body?.message || 'Import restore failed');
    return { ok: true };
  } catch (error) {
    logger.error('Failed to import backup:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('database:clear', async () => {
  if (!isServerMode) return { ok: false, error: 'Database clear is only available in server mode' };
  try {
    // Call the backend reset API which truncates all tables
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const { default: http } = await import('http');
    const url = `${BACKEND_URL}/api/reset`;

    const result = await new Promise((resolve, reject) => {
      const req = http.request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status >= 400) throw new Error(result.body?.message || 'Database clear failed');

    logger.info('Database cleared via backend API');
    return { ok: true };
  } catch (error) {
    logger.error('Failed to clear database:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('app:close', () => {
  isQuitting = true;
  backendManager.CleanupBackendProcess();
  backendReady = false;
  app.quit();
  app.exit(0);
});

// --- Export backup and reset database ---
ipcMain.handle('backup:exportAndCreateNewDatabase', async (_e) => {
  if (!isServerMode) return { ok: false, error: 'Only available in server mode' };
  try {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');

    const { default: http } = await import('http');

    // 1. Create a backup via backend API
    const createResult = await new Promise((resolve, reject) => {
      const req = http.request(`${BACKEND_URL}/api/settings/backups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (createResult.status >= 400) throw new Error('Failed to create backup');
    const backupInfo = createResult.body;

    // 2. Let user choose where to save the export
    const saveLocation = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ النسخة الاحتياطية',
      defaultPath: backupInfo.filename || `nuqtaplus-backup-${new Date().toISOString().slice(0, 10)}.dump`,
      filters: [{ name: 'Database Backup', extensions: ['dump'] }],
    });

    if (saveLocation.canceled || !saveLocation.filePath) {
      return { ok: false, reason: 'canceled' };
    }

    // Copy the backup file to user's chosen location
    if (backupInfo.path) {
      await fs.copyFile(backupInfo.path, saveLocation.filePath);
    }

    // 3. Reset the database via backend API
    const resetResult = await new Promise((resolve, reject) => {
      const req = http.request(`${BACKEND_URL}/api/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (resetResult.status >= 400) {
      logger.warn('Database reset failed after backup export:', resetResult.body);
    }

    // 4. Relaunch the app
    BrowserWindow.getAllWindows().forEach((win) => win.destroy());
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (error) {
    logger.error('Failed to export backup and create new database:', error);
    return { ok: false, error: error.message };
  }
});

// --- فتح رابط خارجي ---
ipcMain.handle('shell:openExternal', async (_e, url) => {
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('update:check', () => {
  checkForUpdates(true); // manual check only
});

ipcMain.handle('update:download', () => {
  startDownload();
});

// ---- First Run Setup ----
ipcMain.handle('firstRun:createLock', () => {
  try {
    createLockFile();
    logger.info('Lock file created successfully');
    return { success: true };
  } catch (error) {
    logger.error('Failed to create lock file:', error);
    return { success: false, error: error.message };
  }
});
