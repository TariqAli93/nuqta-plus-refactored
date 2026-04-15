// logger.js
//
// Structured logger for the Electron main process.
//
// Features:
//   - Levels: DEBUG, INFO, WARN, ERROR
//   - Timestamped lines, JSON-friendly payloads
//   - File output to %APPDATA%/<AppName>/logs/app-YYYY-MM-DD.log  (Windows)
//                   ~/Library/Application Support/<AppName>/logs/ (macOS)
//                   ~/.config/<AppName>/logs/                     (Linux)
//   - Size-based rotation + age-based cleanup
//   - Dev:  also mirrors to the Electron terminal
//   - Prod: file only (no console noise in packaged builds)
//
// This logger is intentionally created as a singleton at import time so every
// module (main.js, backendManager, backendChecker, preload bridge errors
// funnelled via IPC) writes to the same stream.

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const COLORS = { DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };
const RESET = '\x1b[0m';

/**
 * Redact potentially sensitive substrings before the line hits disk.
 *   - home directory path → `~`
 *   - crude pattern-based redaction of token/password/apikey values
 *
 * Keep this function self-contained (no imports) so logger.js has zero
 * internal dependencies besides std lib + electron.
 */
const HOME_DIR = (() => {
  try {
    return os.homedir();
  } catch {
    return '';
  }
})();

const SECRET_VALUE_PATTERN =
  /\b(password|secret|token|authorization|apikey|api_key|licensekey)\s*[:=]\s*["']?([^\s"',}]+)/gi;

function redactLine(line) {
  let out = line;
  if (HOME_DIR) out = out.split(HOME_DIR).join('~');
  out = out.replace(SECRET_VALUE_PATTERN, (_m, key) => `${key}=[REDACTED]`);
  return out;
}

class Logger {
  constructor(options = {}) {
    // Resolve userData before `app.whenReady()` — supported since Electron 9.
    const userDataPath = app ? app.getPath('userData') : process.cwd();
    this.logDir = path.join(userDataPath, 'logs');
    try {
      if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
    } catch (err) {
      // Nothing we can do — fall back to in-memory no-op stream.
      // Better to keep the app alive than crash on a filesystem error.
      // eslint-disable-next-line no-console
      console.error('[logger] Failed to create log directory:', err);
    }

    this.levelEnabled = {
      DEBUG: options.debug ?? true,
      INFO: options.info ?? true,
      WARN: options.warn ?? true,
      ERROR: options.error ?? true,
    };

    // Dev = app not packaged. In dev we mirror to console AND file so the
    // developer sees live output in the terminal without losing persistence.
    const isDev = app ? !app.isPackaged : process.env.NODE_ENV !== 'production';
    this.enableConsole = options.console ?? isDev;

    this.maxFileSize = options.maxFileSize ?? 2 * 1024 * 1024; // 2 MB
    this.maxFiles = options.maxFiles ?? 3;

    this.baseFilename = `app-${new Date().toISOString().split('T')[0]}.log`;
    this.logFile = path.join(this.logDir, this.baseFilename);
    try {
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    } catch (err) {
      this.stream = null;
      // eslint-disable-next-line no-console
      console.error('[logger] Failed to open log stream:', err);
    }

    this.cleanOldLogs(options.daysToKeep ?? 7);
  }

  /** Rotate current log file when it grows past `maxFileSize`. */
  rotateIfNeeded() {
    if (!this.stream) return;
    try {
      if (!fs.existsSync(this.logFile)) return;
      const { size } = fs.statSync(this.logFile);
      if (size < this.maxFileSize) return;

      this.stream.end();
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const older = path.join(this.logDir, `${this.baseFilename}.${i}`);
        const newer = path.join(this.logDir, `${this.baseFilename}.${i + 1}`);
        if (fs.existsSync(older)) fs.renameSync(older, newer);
      }
      const rotated = path.join(this.logDir, `${this.baseFilename}.1`);
      fs.renameSync(this.logFile, rotated);
      this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    } catch {
      /* rotation is best-effort */
    }
  }

  /** Core write. Never throws — logging failures must not crash the app. */
  write(level, message, data = null) {
    if (!this.levelEnabled[level]) return;

    const timestamp = new Date().toISOString();
    const payload = data ? `\n${this._safeStringify(data)}` : '';
    const rawLine = `[${timestamp}] [${level}] ${message}${payload}\n`;
    const line = redactLine(rawLine);

    this.rotateIfNeeded();

    if (this.stream) {
      try {
        this.stream.write(line);
      } catch {
        /* disk full / stream closed — ignore */
      }
    }

    if (this.enableConsole) {
      try {
        const color = COLORS[level] || '';
        // eslint-disable-next-line no-console
        (level === 'ERROR' ? console.error : console.log)(`${color}${line.trimEnd()}${RESET}`);
      } catch {
        /* ignore */
      }
    }
  }

  _safeStringify(data) {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  debug(msg, data) {
    this.write('DEBUG', msg, data);
  }
  info(msg, data) {
    this.write('INFO', msg, data);
  }
  warn(msg, data) {
    this.write('WARN', msg, data);
  }

  /**
   * Accepts an Error, a string, or an arbitrary object. Always captures the
   * stack when available — this is the main diagnostic surface in production,
   * so we deliberately include as much structured detail as we can.
   */
  error(err, context = {}) {
    let message = '';

    if (err instanceof Error) {
      message += `${err.name}: ${err.message}\n`;
      if (err.stack) message += `Stack:\n${err.stack}\n`;
      if (err.cause) message += `Cause: ${this._safeStringify(err.cause)}\n`;
      if (err.code) message += `Code: ${err.code}\n`;
      if (Array.isArray(err.issues)) {
        message += 'Issues:\n';
        err.issues.forEach((i, idx) => {
          const pathStr = Array.isArray(i.path) ? i.path.join('.') : '?';
          message += `  ${idx + 1}. ${pathStr} → ${i.message}\n`;
        });
      }
    } else if (err && typeof err === 'object') {
      message += this._safeStringify(err);
    } else {
      message += String(err);
    }

    if (context && Object.keys(context).length) {
      message += `\nContext:\n${this._safeStringify(context)}\n`;
    }

    this.write('ERROR', message);
  }

  setLevel(level, enabled) {
    if (LEVELS.includes(level)) this.levelEnabled[level] = enabled;
  }

  /** Delete .log files older than `daysToKeep`. Best-effort. */
  cleanOldLogs(daysToKeep = 7) {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const full = path.join(this.logDir, file);
        try {
          const { mtimeMs } = fs.statSync(full);
          if (mtimeMs < cutoff) fs.unlinkSync(full);
        } catch {
          /* skip */
        }
      }
    } catch {
      /* log dir may not exist yet — ignore */
    }
  }

  async close() {
    return new Promise((resolve) => {
      if (!this.stream) return resolve();
      this.stream.end(() => resolve());
    });
  }
}

const logger = new Logger();
export default logger;
