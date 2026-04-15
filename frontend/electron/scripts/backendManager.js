/**
 * backendManager.js
 *
 * Owns the lifecycle of the spawned backend child process.
 *
 * Responsibilities:
 *   - Spawn with correct dev/prod paths, env, and stdio strategy
 *   - Distinguish intentional shutdown vs crash via an `intentionalShutdown` flag
 *   - Bounded crash-restart policy (max N attempts per window, cooldown between)
 *   - Graceful SIGTERM → SIGKILL shutdown with a hard timeout
 *   - Capture child stdout/stderr to a per-day log file in production
 *     (safe: file descriptor, no in-process pipe buffer to drain)
 *
 * Emits (EventEmitter):
 *   'started'              { pid }
 *   'exit'                 { code, signal, intentional: true }   — clean stop
 *   'crash'                { code, signal }                      — unexpected exit
 *   'restart-scheduled'    { attempt, cooldownMs }
 *   'restart-success'      { attempt }
 *   'permanent-failure'    { attempts }                          — gave up
 *   'error'                Error                                 — spawn error
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { app } from 'electron';
import logger from './logger.js';
import { resolveActiveBackend, bundledNodePath } from './versionManager.js';
import {
  assertExecutable,
  assertPathWithin,
  trustedRoots,
  sanitizePath,
} from './security.js';
import {
  BACKEND_RESTART_MAX_ATTEMPTS,
  BACKEND_RESTART_COOLDOWN_MS,
  BACKEND_RESTART_WINDOW_MS,
  BACKEND_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
} from '../../../packages/shared/index.js';

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

export default class BackendManager extends EventEmitter {
  constructor() {
    super();
    this.backendProcess = null;
    this.backendPID = null;

    // Crash-detection state
    this.intentionalShutdown = false;
    this.permanentlyFailed = false;

    // Bounded restart policy state
    this.restartAttempts = 0;
    this.firstRestartAt = 0;
    this.restartTimer = null;

    // Child-output capture (production only)
    this.backendLogFd = null;
  }

  isRunning() {
    return !!(
      this.backendProcess &&
      !this.backendProcess.killed &&
      typeof this.backendProcess.pid === 'number'
    );
  }

  // ── stdio capture helpers (production) ────────────────────────────────────

  /**
   * Open a per-day file descriptor for capturing child stdout+stderr.
   * Using openSync + fd (not a WriteStream) sidesteps the 'open' race and
   * avoids any in-process pipe buffer that could deadlock the child.
   */
  _openBackendLogFd() {
    try {
      const userDataPath = app.getPath('userData');
      const logDir = path.join(userDataPath, 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      const dateTag = new Date().toISOString().split('T')[0];
      const logFile = path.join(logDir, `backend-${dateTag}.log`);
      this.backendLogFd = fs.openSync(logFile, 'a');

      // Header so multi-restart logs are easy to follow in the file
      const header = `\n[${new Date().toISOString()}] --- backend spawn ---\n`;
      fs.writeSync(this.backendLogFd, header);

      return this.backendLogFd;
    } catch (err) {
      logger.warn(`Failed to open backend log fd: ${err.message}`);
      return null;
    }
  }

  _closeBackendLogFd() {
    if (this.backendLogFd != null) {
      try {
        fs.closeSync(this.backendLogFd);
      } catch {
        /* ignore */
      }
      this.backendLogFd = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async StartBackend() {
    if (this.permanentlyFailed) {
      throw new Error(
        'Backend is in permanent-failure state — restart attempts exhausted. Call resetRestartPolicy() to retry.'
      );
    }

    if (this.isRunning()) {
      logger.warn('Backend is already running — skipping spawn');
      return;
    }

    // Path resolution is delegated to versionManager so the same spawn logic
    // works for baseline (shipped) and userData-staged versions identically.
    // In dev mode versionManager returns the repo's flat backend/ dir.
    const active = resolveActiveBackend();
    const serverScript = active.serverScript;
    const cwd = active.cwd;

    let command;
    let args;

    if (isDev) {
      command = bundledNodePath(); // 'node.exe' / 'node'
      args = ['--watch', serverScript];
      logger.info(`Starting backend in dev mode from: ${cwd}`);
    } else {
      // Production spawn — EVERY path that will be fed to child_process.spawn
      // must be validated against an allow-list of trusted roots. This
      // defeats arbitrary-binary execution even if versionManager or the
      // pointer file are somehow tampered with.
      const { baselineBackend, stagingRoot: stagingRootDir } = trustedRoots();
      const trustedScriptRoots = [baselineBackend, stagingRootDir].filter(Boolean);

      const bundledNode = bundledNodePath();
      let safeNode;
      let safeScript;
      try {
        // The Node runtime must live inside <resources>/backend/bin/
        safeNode = assertExecutable(bundledNode, [baselineBackend], 'bundledNode');
        // The server script must live inside baseline OR the staging root
        safeScript = assertPathWithin(serverScript, trustedScriptRoots, 'serverScript');
      } catch (err) {
        logger.error(err, { phase: 'spawn-path-validation' });
        throw err;
      }

      if (!fs.existsSync(safeScript)) {
        const msg = `Backend server script not found: ${sanitizePath(safeScript)}`;
        logger.error(msg);
        throw new Error(msg);
      }

      command = safeNode;
      args = [safeScript];

      logger.info(
        `Starting backend v${active.version} (${active.source}) from: ${sanitizePath(cwd)}`
      );
      logger.info(`Using bundled Node.js: ${sanitizePath(safeNode)}`);
    }

    // NODE_ENV must be injected — packaged Electron inherits no env, so the
    // backend would otherwise default to 'development' (pino-pretty, debug
    // plugin, etc.).
    const spawnEnv = {
      ...process.env,
      NODE_ENV: isDev ? 'development' : 'production',
    };

    // stdio strategy:
    //   dev  → 'inherit' so backend logs appear in the Electron terminal
    //   prod → ['ignore', fd, fd] directly to a log file, or 'ignore' as
    //          a safe fallback. NEVER 'pipe' without a drain.
    let stdio;
    if (isDev) {
      stdio = 'inherit';
    } else {
      const fd = this._openBackendLogFd();
      stdio = fd != null ? ['ignore', fd, fd] : 'ignore';
    }

    // Reset the intentional-shutdown flag — any exit from this point is
    // considered a crash until StopBackend/CleanupBackendProcess sets it.
    this.intentionalShutdown = false;

    try {
      this.backendProcess = spawn(command, args, {
        cwd,
        stdio,
        detached: !isDev,
        env: spawnEnv,
      });
    } catch (err) {
      this._closeBackendLogFd();
      logger.error(err, { phase: 'spawn', command });
      throw err;
    }

    this.backendPID = this.backendProcess.pid;
    logger.info(`Backend PID: ${this.backendPID}`);

    this.backendProcess.on('error', (err) => {
      logger.error(err, { phase: 'child-error', pid: this.backendPID });
      this.emit('error', err);
    });

    this.backendProcess.on('exit', (code, signal) => {
      const wasIntentional = this.intentionalShutdown;
      const pid = this.backendPID;

      logger.info(
        `Backend exited (pid=${pid}, code=${code}, signal=${signal}, intentional=${wasIntentional})`
      );

      this.backendProcess = null;
      this.backendPID = null;
      this._closeBackendLogFd();

      if (wasIntentional) {
        this.emit('exit', { code, signal, intentional: true });
        return;
      }

      // Unexpected exit — classify as crash and schedule a restart.
      logger.error(`Backend crashed (code=${code}, signal=${signal})`);
      this.emit('crash', { code, signal });
      this._scheduleRestart();
    });

    this.emit('started', { pid: this.backendPID });
    logger.info('Backend server started');
  }

  // ── Crash-restart policy ──────────────────────────────────────────────────

  _scheduleRestart() {
    if (this.intentionalShutdown || this.permanentlyFailed) return;

    const now = Date.now();

    // Reset the attempt counter if we're outside the tracking window.
    if (now - this.firstRestartAt > BACKEND_RESTART_WINDOW_MS) {
      this.restartAttempts = 0;
      this.firstRestartAt = now;
    }

    if (this.restartAttempts >= BACKEND_RESTART_MAX_ATTEMPTS) {
      logger.error(
        `Backend restart attempts exhausted (${BACKEND_RESTART_MAX_ATTEMPTS}) — permanent failure`
      );
      this.permanentlyFailed = true;
      this.emit('permanent-failure', { attempts: this.restartAttempts });
      return;
    }

    this.restartAttempts += 1;
    const attempt = this.restartAttempts;

    logger.warn(
      `Scheduling backend restart attempt ${attempt}/${BACKEND_RESTART_MAX_ATTEMPTS} in ${BACKEND_RESTART_COOLDOWN_MS}ms`
    );
    this.emit('restart-scheduled', { attempt, cooldownMs: BACKEND_RESTART_COOLDOWN_MS });

    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.intentionalShutdown || this.permanentlyFailed) return;

      try {
        logger.info(`Backend restart attempt ${attempt}: spawning...`);
        await this.StartBackend();
        this.emit('restart-success', { attempt });
      } catch (err) {
        logger.error(err, { phase: 'restart', attempt });
        // Spawn failed — the child never started, so 'exit' will not fire.
        // Re-schedule manually to keep the policy consistent.
        this._scheduleRestart();
      }
    }, BACKEND_RESTART_COOLDOWN_MS);
  }

  /**
   * Reset the restart counter so a subsequent StartBackend() call will
   * succeed after a permanent-failure state (used by the manual
   * `backend:restart` IPC handler).
   */
  resetRestartPolicy() {
    this.restartAttempts = 0;
    this.firstRestartAt = 0;
    this.permanentlyFailed = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  async StopBackend() {
    if (!this.isRunning()) {
      logger.warn('StopBackend: process not running — skip.');
      return;
    }

    this.intentionalShutdown = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    try {
      logger.info(`Stopping backend (PID: ${this.backendProcess.pid})...`);
      await this.ShutDownBackendGracefully();
      logger.info('Backend stopped successfully');
    } catch (err) {
      logger.warn(`StopBackend failed: ${err.message}`);
    }

    this.backendProcess = null;
  }

  async ShutDownBackendGracefully() {
    if (!this.backendProcess || this.backendProcess.killed) {
      logger.warn('ShutDownBackendGracefully: backend not running');
      return;
    }

    const proc = this.backendProcess;
    logger.info('Gracefully shutting down backend (SIGTERM → SIGKILL fallback)...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn(
          `Backend did not exit within ${BACKEND_GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms — forcing SIGKILL`
        );
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        resolve();
      }, BACKEND_GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      proc.once('exit', () => {
        clearTimeout(timeout);
        logger.info('Backend exited gracefully');
        resolve();
      });

      try {
        proc.kill('SIGTERM');
      } catch (err) {
        clearTimeout(timeout);
        logger.warn(`SIGTERM failed: ${err.message}`);
        resolve();
      }
    });
  }

  async CleanupBackendProcess() {
    if (!this.isRunning()) {
      // Still wipe any lingering restart timer from a previous failure so we
      // don't fire a zombie spawn during app shutdown.
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      logger.warn('Cleanup requested but backend is not running — skip.');
      return;
    }

    this.intentionalShutdown = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    try {
      logger.info(`Cleaning up backend (PID: ${this.backendProcess.pid})...`);
      await this.ShutDownBackendGracefully();
      logger.info('Backend cleanup complete');
    } catch (err) {
      logger.warn(`Backend cleanup issue (ignored): ${err.message}`);
    }

    this.backendProcess = null;
    this._closeBackendLogFd();
  }
}
