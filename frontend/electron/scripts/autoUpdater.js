// autoUpdater.js
import { autoUpdater } from 'electron-updater';
import { app } from 'electron';

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;

function setupAutoUpdater(window) {
  mainWindow = window;

  // التجهيز
  setupListeners();

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
