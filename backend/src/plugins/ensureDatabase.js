import fs from 'fs';
import path from 'path';
import fp from 'fastify-plugin';
import { fileURLToPath } from 'url';

export function resolveFromEnv(envValue) {
  if (!envValue) return null;

  const v = String(envValue).trim();

  if (v === ':memory:') return ':memory:';

  if (v.startsWith('file:')) {
    try {
      return fileURLToPath(v);
    } catch {
      const stripped = v.replace(/^file:/, '');
      return path.isAbsolute(stripped) ? stripped : path.resolve(process.cwd(), stripped);
    }
  }

  if (v.startsWith('sqlite:')) {
    const stripped = v.replace(/^sqlite:/, '');
    const clean = stripped.split('?')[0];
    return path.isAbsolute(clean) ? clean : path.resolve(process.cwd(), clean);
  }

  return path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
}

async function ensureDatabasePlugin(fastify, opts) {
  const { defaultFile = path.resolve(process.cwd(), 'data', 'nuqtaplus.db') } = opts || {};
  const envSource = process.env.DATABASE_URL || process.env.DB_FILE || process.env.SQLITE_FILE;
  const resolved = resolveFromEnv(envSource) || defaultFile;

  if (resolved === ':memory:') {
    fastify.log.warn('Using in-memory SQLite database (:memory:). No file will be created.');
    fastify.decorate('dbFile', ':memory:');
    return;
  }

  const dbFile = resolved;
  const dir = path.dirname(dbFile);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      fastify.log.info({ dir }, 'Created database directory');
    }

    // Create backups directory
    const backupsDir = path.join(dir, 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      fastify.log.info({ backupsDir }, 'Created backups directory');
    }

    if (!fs.existsSync(dbFile)) {
      fs.writeFileSync(dbFile, '');
      fastify.log.info({ dbFile }, 'Created new SQLite database file');
    } else {
      fastify.log.info({ dbFile }, 'SQLite database file exists');
    }

    // ✅ ضبط متغير البيئة (DATABASE_URL)
    if (!process.env.DATABASE_URL) {
      const fileUrl =
        process.platform === 'win32'
          ? new URL(`file:///${dbFile.replace(/\\/g, '/')}`)
          : new URL(`file://${dbFile}`);
      process.env.DATABASE_URL = fileUrl.toString();
    }
  } catch (err) {
    fastify.log.error({ err, dbFile }, 'Failed to ensure database file');
    throw err;
  }
}

export default fp(ensureDatabasePlugin, { name: 'ensure-database' });
