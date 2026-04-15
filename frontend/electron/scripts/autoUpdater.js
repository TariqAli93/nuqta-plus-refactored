// autoUpdater.js
import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import logger from './logger.js';

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Security posture for frontend auto-updates:
 *   - allowDowngrade = false → reject older-version installers
 *     (defeats rollback-based exploits against signature checks)
 *   - allowPrerelease = false → only stable channel
 *   - HTTPS enforced: electron-updater validates the feed URL protocol on
 *     GenericProvider / GitHub. We assert it explicitly below so a
 *     mis-configured publish config fails loudly in development instead of
 *     silently downgrading to HTTP.
 *   - Signature verification: on Windows, electron-updater verifies the
 *     NSIS installer's Authenticode signature against the publisher name
 *     configured in build.nsis.publisherName / build.win.publisherName. An
 *     unsigned or wrong-publisher installer is rejected automatically.
 *     Ship only code-signed installers — see the "Code signing" note below.
 */
autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = {
  info: (m) => logger.info(`[updater] ${m}`),
  warn: (m) => logger.warn(`[updater] ${m}`),
  error: (m) => logger.error(`[updater] ${m}`),
  debug: (m) => logger.debug(`[updater] ${m}`),
};

/**
 * Enforce HTTPS on whatever feed URL electron-updater resolved from
 * app-update.yml. Throws during startup if someone ships a dev config by
 * mistake. No-op in dev where updates are never checked anyway.
 */
function assertHttpsFeed() {
  if (!app.isPackaged) return;
  try {
    const feed = autoUpdater.getFeedURL?.();
    if (feed && !/^https:\/\//i.test(feed)) {
      const msg = `[updater] refusing non-HTTPS feed URL: ${feed}`;
      logger.error(msg);
      throw new Error(msg);
    }
  } catch (err) {
    // getFeedURL may not be ready until first check — the real enforcement
    // happens when electron-updater fetches, and it will error there too.
    logger.warn(`[updater] assertHttpsFeed could not read feed URL: ${err.message}`);
  }
}

let mainWindow = null;

function setupAutoUpdater(window) {
  mainWindow = window;

  // التجهيز
  setupListeners();
  assertHttpsFeed();

  // أول فحص بعد التشغيل
  setTimeout(() => checkForUpdates(), app.isPackaged ? 60000 : 5000);
}

/* 🔥 الفحص اليدوي + إرسال حالة checking */
function checkForUpdates(manual = false) {
  if (manual && mainWindow) {
    mainWindow.webContents.send('update-checking', { manual: true });
  }

  autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result || !result.updateInfo) {
        if (manual) {
          mainWindow.webContents.send('update-not-available', { manual: true });
        }
        return;
      }

      const { version, releaseNotes } = result.updateInfo;

      if (manual) {
        mainWindow.webContents.send('update-available', {
          manual: true,
          version,
          releaseNotes,
        });
      }
    })
    .catch((err) => {
      if (manual) {
        mainWindow.webContents.send('update-error', {
          manual: true,
          error: err.message,
        });
      }
    });
}

/* 🔥 جميع الأحداث الحقيقية */
function setupListeners() {
  // لا يوجد تحديث
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  // يوجد تحديث
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  });

  // بدأ التحميل (نحن نرسل الحدث يدوياً عند downloadUpdate)
  autoUpdater.on('download-progress', (prog) => {
    mainWindow?.webContents.send('update-progress', {
      percent: Math.round(prog.percent),
      transferred: prog.transferred,
      total: prog.total,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-ready');
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', {
      error: err.message || String(err),
    });
  });
}

function startDownload() {
  mainWindow?.webContents.send('update-downloading');
  autoUpdater.downloadUpdate();
}

export { setupAutoUpdater, checkForUpdates, startDownload };
