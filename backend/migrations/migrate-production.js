/**
 * backend/migrations/migrate-production.js
 *
 * Standalone migration runner for the packaged Windows install. Invoked by
 * tools\bootstrap.bat using the bundled Node runtime:
 *
 *   "%BACKEND%\bin\node.exe" "%BACKEND%\migrations\migrate-production.js"
 *
 * Requirements at the customer machine:
 *   - PostgreSQL 18 reachable via DATABASE_URL (or PG_* env vars)
 *   - The database itself already exists (bootstrap.bat handles createdb)
 *
 * Does NOT require:
 *   - npm / pnpm / drizzle-kit / TypeScript / source tree
 *   - System-installed Node.js (we use the bundled bin\node.exe)
 *
 * Migration SQL files are read from a sibling drizzle/ directory:
 *   backend\migrations\migrate-production.js
 *   backend\migrations\drizzle\meta\_journal.json
 *   backend\migrations\drizzle\*.sql
 *
 * Exit codes:
 *   0  migrations applied successfully (or already up to date)
 *   1  migration failed
 *   2  migrations folder is missing or invalid
 *   3  database connection failed
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (msg) => console.log(`[migrate] ${msg}`);
const fail = (code, msg) => {
  console.error(`[migrate] ERROR: ${msg}`);
  process.exit(code);
};

function maskUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/(\/\/[^:]+:)([^@]+)(@)/, '$1****$3');
}

function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'nuqta_db',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'root',
  };
}

function describeTarget() {
  if (process.env.DATABASE_URL) {
    return `DATABASE_URL=${maskUrl(process.env.DATABASE_URL)}`;
  }
  const host = process.env.PG_HOST || 'localhost';
  const port = process.env.PG_PORT || '5432';
  const database = process.env.PG_DATABASE || 'nuqta_db';
  const user = process.env.PG_USER || 'postgres';
  return `${user}@${host}:${port}/${database}`;
}

function resolveMigrationsFolder() {
  const folder = path.join(__dirname, 'drizzle');
  const journal = path.join(folder, 'meta', '_journal.json');

  if (!fs.existsSync(folder)) {
    fail(2, `migrations folder not found: ${folder}`);
  }
  if (!fs.existsSync(journal)) {
    fail(2, `migrations journal not found: ${journal}`);
  }
  const sqlFiles = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.sql'));
  if (sqlFiles.length === 0) {
    fail(2, `migrations folder has no .sql files: ${folder}`);
  }
  log(`folder: ${folder} (${sqlFiles.length} SQL files)`);
  return folder;
}

async function main() {
  log(`target: ${describeTarget()}`);
  const folder = resolveMigrationsFolder();

  const pool = new Pool(buildConnectionConfig());
  pool.on('error', (err) => {
    console.error(`[migrate] pool error: ${err.message}`);
  });

  try {
    const client = await pool.connect();
    try {
      const r = await client.query('SELECT current_database() AS db');
      log(`connected: ${r.rows[0].db}`);
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end().catch(() => {});
    fail(3, `database connection failed: ${error.message}`);
  }

  const db = drizzle(pool);

  try {
    log('running migrations');
    await migrate(db, { migrationsFolder: folder });
    log('migrations completed');
  } catch (error) {
    if (error.message?.includes('already exists')) {
      log('migrations completed (some objects already existed)');
    } else {
      console.error(error.stack || error.message);
      await pool.end().catch(() => {});
      fail(1, `migration failed: ${error.message}`);
    }
  } finally {
    await pool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
