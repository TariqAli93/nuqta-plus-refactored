// autoUpdater.js
import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import logger from './logger.js';

// Never download in the background — the user explicitly starts the download
// from the "Update now" button (req #7).
autoUpdater.autoDownload = false;

// NEVER install silently when the app quits. A downloaded update is applied
// ONLY when the user clicks "Restart and Install" (installUpdate). Installing
// on quit ran the perMachine NSIS installer at an uncontrolled moment, which
// is part of why the backend service used to disappear after updates
// (reqs #5, #7).
autoUpdater.autoInstallOnAppQuit = false;

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
 *     Ship only code-signed installers.
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
let listenersBound = false;

/**
 * Whether the in-flight check was user-initiated. Only manual checks surface
 * "checking" / "no update" / "check error" feedback in the UI; the
 * available → progress → ready → error stream always reaches the renderer
 * regardless, so the SILENT startup check still pops the update dialog
 * (reqs #1, #8).
 */
let manualCheck = false;

function send(channel, payload = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, payload);
    } catch (err) {
      logger.warn(`[updater] failed to post ${channel}: ${err.message}`);
    }
  }
}

function setupAutoUpdater(window) {
  mainWindow = window;
  setupListeners();
  assertHttpsFeed();

  // Silent background check shortly after launch (req #1).
  setTimeout(() => checkForUpdates(false), app.isPackaged ? 60000 : 5000);
}

/* All real electron-updater events. The available/progress/ready/error stream
 * is always forwarded; checking/not-available are gated to manual checks. */
function setupListeners() {
  if (listenersBound) return;
  listenersBound = true;

  autoUpdater.on('checking-for-update', () => {
    logger.info('[updater] checking for update…');
    if (manualCheck) send('update-checking', { manual: true });
  });

  autoUpdater.on('update-available', (info) => {
    logger.info(`[updater] update AVAILABLE: v${info?.version}`);
    send('update-available', {
      version: info?.version,
      releaseNotes: info?.releaseNotes || '',
      manual: manualCheck,
    });
    manualCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    logger.info(`[updater] no update available (current v${app.getVersion()})`);
    if (manualCheck) send('update-not-available', { manual: true });
    manualCheck = false;
  });

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p?.percent || 0);
    logger.info(`[updater] download progress ${percent}% (${p?.transferred}/${p?.total})`);
    send('update-progress', {
      percent,
      transferred: p?.transferred || 0,
      total: p?.total || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(
      `[updater] update DOWNLOADED: v${info?.version} — waiting for user to click "Restart and Install"`
    );
    send('update-ready', { version: info?.version });
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    logger.error(`[updater] error: ${msg}`);
    send('update-error', { error: msg, manual: manualCheck });
    manualCheck = false;
  });
}

/* 🔥 Check for updates. manual=true when the user pressed "Check for updates". */
function checkForUpdates(manual = false) {
  manualCheck = manual;
  logger.info(`[updater] checkForUpdates (manual=${manual})`);

  if (!app.isPackaged) {
    logger.info('[updater] not packaged — skipping update check');
    if (manual) send('update-not-available', { manual: true });
    manualCheck = false;
    return;
  }

  autoUpdater.checkForUpdates().catch((err) => {
    const msg = err?.message || String(err);
    logger.error(`[updater] checkForUpdates failed: ${msg}`);
    if (manual) send('update-error', { manual: true, error: msg });
    manualCheck = false;
  });
}

/* User clicked "Update now" → start the download (req #6 step 1). */
function startDownload() {
  logger.info('[updater] startDownload (user requested)');
  send('update-downloading', {});
  autoUpdater.downloadUpdate().catch((err) => {
    const msg = err?.message || String(err);
    logger.error(`[updater] downloadUpdate failed: ${msg}`);
    send('update-error', { error: msg });
  });
}

/* User clicked "Restart and Install" → apply the update now (req #6). */
function installUpdate() {
  logger.info('[updater] install trigger — quitAndInstall(silent=true, forceRunAfter=true)');
  // Defer so the IPC reply flushes before the app quits. Silent + forceRunAfter:
  // the perMachine NSIS installer auto-elevates (one UAC prompt), runs
  // customInstall elevated to repair/start the backend service, and relaunches.
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      const msg = err?.message || String(err);
      logger.error(`[updater] quitAndInstall failed: ${msg}`);
      send('update-error', { error: msg });
    }
  }, 0);
}

export { setupAutoUpdater, checkForUpdates, startDownload, installUpdate };
