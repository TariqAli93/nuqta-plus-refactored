import os from 'os';
import path from 'path';

/**
 * Build a PostgreSQL connection URL from individual components.
 * Priority: DATABASE_URL env > individual PG_* env vars > defaults.
 */
export function buildDatabaseUrl() {
  // If a full connection string is provided, use it directly.
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.PG_HOST || '127.0.0.1';
  const port = process.env.PG_PORT || '5432';
  const database = process.env.PG_DATABASE || 'nuqtaplus';
  const user = process.env.PG_USER || 'nuqtaplus';
  const password = process.env.PG_PASSWORD || 'nuqtaplus';

  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/**
 * Return individual PG connection parameters (used by pg.Pool).
 */
export function getPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  return {
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'nuqtaplus',
    user: process.env.PG_USER || 'nuqtaplus',
    password: process.env.PG_PASSWORD || 'nuqtaplus',
  };
}

/**
 * User data directory — used for config files, logs, and backups.
 * The database itself lives in PostgreSQL, not on disk here.
 */
export function getUserDataDir() {
  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', '@nuqtaplus');
  } else if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', '@nuqtaplus');
  } else {
    return path.join(homeDir, '.config', '@nuqtaplus');
  }
}

export const userDataDir = getUserDataDir();
