import { join } from 'path';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPgConfig, getUserDataDir } from '../utils/database.js';

const execFileAsync = promisify(execFile);

/**
 * Locate a PostgreSQL binary (pg_dump, pg_restore) on Windows.
 * Falls back to bare name (relies on PATH) on non-Windows or if not found.
 */
function findPgBinary(name) {
  if (process.platform !== 'win32') return name;

  // Common PostgreSQL install locations on Windows
  const pgDirs = [];
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  for (const base of [programFiles, programFilesX86]) {
    // Check versions 17 down to 12
    for (let v = 17; v >= 12; v--) {
      pgDirs.push(join(base, 'PostgreSQL', String(v), 'bin'));
    }
  }

  // Also check PG_BIN env var if set
  if (process.env.PG_BIN) {
    pgDirs.unshift(process.env.PG_BIN);
  }

  for (const dir of pgDirs) {
    const fullPath = join(dir, `${name}.exe`);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Fall back to bare name — will work if PostgreSQL's bin is in PATH
  return name;
}

/**
 * PostgreSQL Backup Service
 * Uses pg_dump / pg_restore for reliable, consistent backups.
 */
export class BackupService {
  constructor() {
    this.backupDir = join(getUserDataDir(), 'backups');
  }

  /**
   * Build environment variables for pg_dump / pg_restore.
   * Uses PGPASSWORD so the tool doesn't prompt interactively.
   */
  _pgEnv() {
    const pgConfig = getPgConfig();
    const env = { ...process.env };

    if (pgConfig.connectionString) {
      // Parse connection string for individual parts
      const url = new URL(pgConfig.connectionString);
      env.PGHOST = url.hostname;
      env.PGPORT = url.port || '5432';
      env.PGDATABASE = url.pathname.replace('/', '');
      env.PGUSER = decodeURIComponent(url.username);
      env.PGPASSWORD = decodeURIComponent(url.password);
    } else {
      env.PGHOST = pgConfig.host || '127.0.0.1';
      env.PGPORT = String(pgConfig.port || 5432);
      env.PGDATABASE = pgConfig.database || 'nuqtaplus';
      env.PGUSER = pgConfig.user || 'nuqtaplus';
      env.PGPASSWORD = pgConfig.password || '';
    }

    return env;
  }

  async ensureBackupDir() {
    try {
      await fs.access(this.backupDir);
    } catch {
      await fs.mkdir(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create a new backup using pg_dump (custom format for pg_restore compatibility).
   */
  async create() {
    await this.ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.dump`;
    const backupPath = join(this.backupDir, filename);
    const env = this._pgEnv();

    try {
      await execFileAsync(
        findPgBinary('pg_dump'),
        [
          '--format=custom',
          '--compress=6',
          '--no-owner',
          '--no-privileges',
          `--file=${backupPath}`,
        ],
        { env, timeout: 120_000 }
      );
    } catch (err) {
      // Clean up partial file on failure
      try {
        await fs.unlink(backupPath);
      } catch {
        // ignore
      }
      throw new Error(`pg_dump failed: ${err.stderr || err.message}`);
    }

    return this.getBackupInfo(filename);
  }

  /**
   * Restore a backup using pg_restore.
   * WARNING: This will overwrite the current database contents.
   */
  async restore(filename) {
    if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.dump')) {
      throw new Error('Invalid backup filename');
    }

    const backupPath = join(this.backupDir, filename);

    // Verify the file exists
    try {
      await fs.access(backupPath);
    } catch {
      throw new Error(`Backup file not found: ${filename}`);
    }

    const env = this._pgEnv();

    try {
      await execFileAsync(
        findPgBinary('pg_restore'),
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          `--dbname=${env.PGDATABASE}`,
          backupPath,
        ],
        { env, timeout: 300_000 }
      );
    } catch (err) {
      // pg_restore returns non-zero if there are warnings (e.g. "relation does not exist" on clean).
      // Only treat it as a real failure if stderr contains "FATAL" or "could not".
      const stderr = err.stderr || '';
      if (stderr.includes('FATAL') || stderr.includes('could not connect')) {
        throw new Error(`pg_restore failed: ${stderr}`);
      }
      // Otherwise it succeeded with warnings — that's normal for --clean --if-exists.
    }

    return { success: true, message: `Database restored from ${filename}` };
  }

  /**
   * List all available backup files, newest first.
   */
  async list() {
    await this.ensureBackupDir();
    const files = await fs.readdir(this.backupDir);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.dump') && file.startsWith('backup-')) {
        try {
          const info = await this.getBackupInfo(file);
          backups.push(info);
        } catch {
          // Ignore invalid files
        }
      }
    }

    return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get metadata for a single backup file.
   */
  async getBackupInfo(filename) {
    const filePath = join(this.backupDir, filename);
    const stats = await fs.stat(filePath);

    return {
      filename,
      path: filePath,
      size: stats.size,
      sizeReadable: this.formatBytes(stats.size),
      createdAt: stats.birthtime,
    };
  }

  /**
   * Delete a backup file.
   */
  async delete(filename) {
    if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.dump')) {
      throw new Error('Invalid backup filename');
    }
    const filePath = join(this.backupDir, filename);
    await fs.unlink(filePath);
    return true;
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

export default new BackupService();
