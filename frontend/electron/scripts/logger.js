// logger.js
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Advanced Logger for Electron (main process)
 * Features:
 * - Levels: DEBUG, INFO, WARN, ERROR
 * - Optional console output
 * - File rotation by size
 * - Automatic cleanup of old logs
 */
class Logger {
  constructor(options = {}) {
    // Setup paths
    const userDataPath = app ? app.getPath('userData') : process.cwd();
    this.logDir = path.join(userDataPath, 'logs');
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });

    // Logger options
    this.levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    this.levelEnabled = {
      DEBUG: options.debug ?? true,
      INFO: options.info ?? true,
      WARN: options.warn ?? true,
      ERROR: options.error ?? true,
    };
    this.enableConsole = options.console ?? false;
    this.maxFileSize = options.maxFileSize || 5 * 1024 * 1024; // 5 MB default
    this.maxFiles = options.maxFiles || 5;

    // Current log file
    this.baseFilename = `app-${new Date().toISOString().split('T')[0]}.log`;
    this.logFile = path.join(this.logDir, this.baseFilename);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });

    // Cleanup old logs
    this.cleanOldLogs(options.daysToKeep ?? 7);
  }

  /**
   * Rotate log file if exceeds max size
   */
  rotateIfNeeded() {
    try {
      const stats = fs.statSync(this.logFile);
      if (stats.size >= this.maxFileSize) {
        this.stream.end();
        for (let i = this.maxFiles - 1; i >= 1; i--) {
          const old = path.join(this.logDir, `${this.baseFilename}.${i}`);
          const next = path.join(this.logDir, `${this.baseFilename}.${i + 1}`);
          if (fs.existsSync(old)) fs.renameSync(old, next);
        }
        const rotated = path.join(this.logDir, `${this.baseFilename}.1`);
        if (fs.existsSync(this.logFile)) fs.renameSync(this.logFile, rotated);
        this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
      }
    } catch (err) {
      // Silently handle rotation error
    }
  }

  /**
   * Generic write function
   */
  write(level, message, data = null) {
    if (!this.levelEnabled[level]) return;
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;

    this.rotateIfNeeded();

    try {
      this.stream.write(line);
      if (this.enableConsole) {
        const color =
          {
            DEBUG: '\x1b[36m',
            INFO: '\x1b[32m',
            WARN: '\x1b[33m',
            ERROR: '\x1b[31m',
          }[level] || '';
      }
    } catch (err) {
      // Silently handle write error
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
  error(err, context = {}) {
    let message = '';
    if (err instanceof Error) {
      // عرض مختصر من نوع الخطأ والرسالة
      message += `${err.name}: ${err.message}\n`;

      // لو يحتوي على stack
      if (err.stack) message += `Stack:\n${err.stack}\n`;

      // لو يحتوي على تفاصيل Zod
      if (err.issues) {
        message += 'Issues:\n';
        err.issues.forEach((i, idx) => {
          message += `  ${idx + 1}. ${i.path.join('.')} → ${i.message} (expected ${i.expected}, got ${i.received})\n`;
        });
      }
    } else if (typeof err === 'object') {
      // أي كائن آخر (مثلاً JSON)
      message += JSON.stringify(err, null, 2);
    } else {
      message += String(err);
    }

    // أضف السياق إن وجد (مثلاً reqId)
    if (Object.keys(context).length) {
      message += `\nContext:\n${JSON.stringify(context, null, 2)}\n`;
    }

    this.write('ERROR', message);
  }

  /**
   * Manual enable/disable for levels
   */
  setLevel(level, enabled) {
    if (this.levels.includes(level)) this.levelEnabled[level] = enabled;
  }

  /**
   * Clean logs older than X days
   */
  cleanOldLogs(daysToKeep = 7) {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;
      files.forEach((file) => {
        const fullPath = path.join(this.logDir, file);
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > maxAge) fs.unlinkSync(fullPath);
      });
    } catch (error) {
      this.write('ERROR', 'Failed to clean old logs', { error: error.message });
    }
  }

  /**
   * Graceful shutdown
   */
  async close() {
    return new Promise((resolve) => {
      this.stream.end(() => resolve());
    });
  }
}

// Export singleton instance
const logger = new Logger({
  debug: true, // Enable DEBUG in dev
  console: false, // No console output by default
  maxFileSize: 2 * 1024 * 1024, // 2MB
  maxFiles: 3,
});

export default logger;
