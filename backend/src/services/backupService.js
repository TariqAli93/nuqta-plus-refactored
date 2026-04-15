import { join } from 'path';
import { promises as fs } from 'fs';
import { getSqlite } from '../db.js';
import config from '../config.js';
import { dirname } from 'path';

// We need a stable place to store backups.
// Since backend is pure node, we can store relative to DB or in a specific folder.
// config.database.path comes from process.env.DATABASE_PATH or valid default.

export class BackupService {
  constructor() {
    this.dbPath = config.database.path;
    this.backupDir = join(dirname(this.dbPath), 'backups');
  }

  async ensureBackupDir() {
    try {
      await fs.access(this.backupDir);
    } catch {
      await fs.mkdir(this.backupDir, { recursive: true });
    }
  }

  async create() {
    await this.ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.db`;
    const backupPath = join(this.backupDir, filename);

    const sqlite = await getSqlite();

    // better-sqlite3 backup API
    // https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise
    await sqlite.backup(backupPath);

    return await this.getBackupInfo(filename);
  }

  async list() {
    await this.ensureBackupDir();
    const files = await fs.readdir(this.backupDir);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.db') && file.startsWith('backup-')) {
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

  async getBackupInfo(filename) {
    const filePath = join(this.backupDir, filename);
    const stats = await fs.stat(filePath);

    return {
      filename: filename,
      path: filePath,
      size: stats.size,
      sizeReadable: this.formatBytes(stats.size),
      createdAt: stats.birthtime,
    };
  }

  async delete(filename) {
    if (!filename || !filename.startsWith('backup-') || !filename.endsWith('.db')) {
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
