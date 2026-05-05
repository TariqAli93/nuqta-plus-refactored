import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import config from './config.js';
import * as schema from './models/index.js';
import { resolveMigrationsFolder } from './bootstrap/resolveMigrationsFolder.js';

const { Pool, Client } = pg;

// ── PostgreSQL connection pool ────────────────────────────────────────────
let pool = null;
let dbInstance = null;
let bootstrapState = {
  databaseReady: false,
  migrationsApplied: false,
  schemaReady: false,
  missingTables: [],
  lastError: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve the target database name from environment configuration.
 */
function getTargetDatabaseName() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      // pathname is "/<dbname>"
      return url.pathname.replace(/^\//, '') || 'nuqta_db';
    } catch {
      return 'nuqta_db';
    }
  }
  return process.env.PG_DATABASE || 'nuqta_db';
}

/**
 * Build connection config for the "postgres" maintenance database.
 * Used to check/create the target database before connecting to it.
 */
function getMaintenanceConfig() {
  const sslOption = process.env.PG_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return {
        host: url.hostname || '127.0.0.1',
        port: parseInt(url.port || '5432', 10),
        user: decodeURIComponent(url.username) || 'postgres',
        password: decodeURIComponent(url.password) || 'root',
        database: 'postgres',
        ssl: sslOption,
      };
    } catch {
      // Fall through to individual vars
    }
  }

  return {
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'root',
    database: 'postgres',
    ssl: sslOption,
  };
}

/**
 * Ensure the target database exists. Connects to the "postgres" maintenance
 * database, checks if the target DB is present, and creates it if missing.
 */
async function ensureDatabase() {
  const dbName = getTargetDatabaseName();
  const maintConfig = getMaintenanceConfig();

  const client = new Client(maintConfig);

  try {
    await client.connect();

    // Check if database exists
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rowCount === 0) {
      // Database does not exist — create it.
      // Note: CREATE DATABASE cannot use parameterized queries,
      // but dbName comes from our own env config, not user input.
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created successfully`);
    }
  } catch (error) {
    // If we can't connect to the maintenance DB at all, let it fall through
    // to the main connection logic which has better error messages.
    console.warn(`Could not ensure database exists: ${error.message}`);
  } finally {
    await client.end();
  }
}

function createPool() {
  const poolConfig = {
    ...config.database,
    // Pool sizing tuned for a desktop / small-LAN server.
    max: parseInt(process.env.PG_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  // SSL configuration:
  //   - PG_SSL=true  → connect with SSL (rejectUnauthorized=false for self-signed certs)
  //   - PG_SSL=false or unset → no SSL (safe for local / LAN connections)
  //   - DATABASE_URL with ?sslmode=require → handled by pg driver automatically
  if (process.env.PG_SSL === 'true') {
    poolConfig.ssl = { rejectUnauthorized: false };
  } else if (!poolConfig.connectionString && process.env.PG_SSL !== 'true') {
    // Explicit false prevents PG 18's default SSL negotiation from causing ECONNRESET
    poolConfig.ssl = false;
  }

  const p = new Pool(poolConfig);

  p.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });

  return p;
}

// Tables that must exist after migrations for the app + always-on background
// workers to be considered ready. Names are taken verbatim from
// src/models/schema.js — do not invent.
//
// `notification_settings` and the `credit_*` tables are listed because the
// notification queue worker and credit-scoring scheduler boot unconditionally
// and would otherwise crash on a partially-migrated database.
const REQUIRED_TABLES = [
  'users',
  'settings',
  'products',
  'customers',
  'sales',
  'sale_items',
  'categories',
  'branches',
  'warehouses',
  'notification_settings',
  'credit_events',
  'credit_snapshots',
  'credit_scores',
];

async function runMigrations(db) {
  console.log('[bootstrap] resolving migrations folder');
  const { folder, tried } = resolveMigrationsFolder();

  if (!folder) {
    const msg =
      'migrations folder not found. Tried:\n  - ' + tried.join('\n  - ');
    console.error(`[bootstrap] ${msg}`);
    bootstrapState.lastError = 'migrations folder not found';
    return false;
  }

  console.log(`[bootstrap] migrations folder: ${folder}`);
  console.log('[bootstrap] running migrations');

  try {
    await migrate(db, { migrationsFolder: folder });
    console.log('[bootstrap] migrations complete');
    bootstrapState.migrationsApplied = true;
    return true;
  } catch (error) {
    // Pre-existing tables from a manual install or older migration baseline
    // shouldn't block startup — the schema probe below decides readiness.
    if (error.message?.includes('already exists')) {
      console.log('[bootstrap] migrations skipped — objects already exist');
      bootstrapState.migrationsApplied = true;
      return true;
    }
    console.error(`[bootstrap] migration failed: ${error.message}`);
    bootstrapState.lastError = error.message;
    return false;
  }
}

async function verifySchema() {
  console.log('[bootstrap] verifying schema');
  const placeholders = REQUIRED_TABLES.map((_, i) => `$${i + 1}`).join(',');
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const present = new Set(result.rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));

  if (missing.length === 0) {
    bootstrapState.schemaReady = true;
    bootstrapState.missingTables = [];
    bootstrapState.lastError = null;
    console.log('[bootstrap] schema ready');
    return true;
  }

  bootstrapState.schemaReady = false;
  bootstrapState.missingTables = missing;
  bootstrapState.lastError = `missing tables: ${missing.join(', ')}`;
  console.error(`[bootstrap] schema not ready. Missing tables: ${missing.join(', ')}`);
  return false;
}

/**
 * Re-run the schema probe on demand (e.g. before FirstRun) so a transient
 * boot-time failure can be re-evaluated without restarting the process.
 * Returns the latest bootstrap state snapshot.
 */
export async function ensureSchemaReady() {
  if (!pool) {
    return { ...bootstrapState };
  }
  try {
    await verifySchema();
  } catch (error) {
    bootstrapState.schemaReady = false;
    bootstrapState.lastError = error.message;
    console.error(`[bootstrap] schema probe failed: ${error.message}`);
  }
  return { ...bootstrapState };
}

async function initDB() {
  console.log('[bootstrap] connecting to database');
  const attempts = Number(process.env.PG_CONNECT_RETRY_ATTEMPTS || 15);
  const delayMs = Number(process.env.PG_CONNECT_RETRY_DELAY_MS || 2000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await ensureDatabase();
      pool = createPool();

      const client = await pool.connect();
      const result = await client.query('SELECT current_database() AS db, version() AS ver');
      console.log(`[bootstrap] database connected: ${result.rows[0].db}`);
      client.release();
      bootstrapState.databaseReady = true;
      bootstrapState.lastError = null;
      break;
    } catch (error) {
      bootstrapState.lastError = error.message;
      if (pool) {
        try {
          await pool.end();
        } catch {
          // ignore cleanup errors
        }
      }
      pool = null;

      if (attempt === attempts) {
        console.error('Failed to connect to PostgreSQL:', error.message);
        console.error('Make sure PostgreSQL is running and the connection details are correct.');
        console.error('Set PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD env vars,');
        console.error('or provide a full DATABASE_URL connection string.');
        throw error;
      }

      console.warn(
        `PostgreSQL is not ready yet (attempt ${attempt}/${attempts}): ${error.message}. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  // Create Drizzle instance up-front so callers always get a usable handle.
  // Migration / verification failures are surfaced via bootstrapState rather
  // than rejecting dbPromise — that lets /api/setup/status correctly report
  // SCHEMA_NOT_READY instead of masking it as DATABASE_CONNECTION_FAILED.
  const db = drizzle(pool, { schema });
  dbInstance = db;

  const migrated = await runMigrations(db);
  if (migrated) {
    await verifySchema();
  } else {
    // Still attempt schema verification — if a previous run already migrated,
    // the tables may all be present even though this boot couldn't locate
    // the folder.
    try {
      await verifySchema();
    } catch (error) {
      bootstrapState.schemaReady = false;
      bootstrapState.lastError = error.message;
      console.error(`[bootstrap] schema probe failed: ${error.message}`);
    }
  }

  return db;
}

// ── Exports ───────────────────────────────────────────────────────────────

/** Async initialized db promise — awaited once at startup. */
export const dbPromise = initDB();

/** Helper to get the cached db instance (resolves promise once). */
export const getDb = async () => {
  if (dbInstance) return dbInstance;
  dbInstance = await dbPromise;
  return dbInstance;
};

/** Get the raw pg.Pool for operations that need direct SQL (backup, etc.). */
export const getPool = async () => {
  if (!pool) await dbPromise;
  return pool;
};

export const getBootstrapState = () => ({ ...bootstrapState });

/** Convenience predicate for workers/schedulers gating on a usable schema. */
export const isSchemaReady = () =>
  bootstrapState.databaseReady && bootstrapState.schemaReady;

/**
 * Gracefully close the pool. Called during server shutdown.
 */
export const closeDatabase = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
    console.log('PostgreSQL pool closed');
  }
};

/**
 * No-op kept for backward compatibility with existing service code.
 * PostgreSQL commits automatically — no manual save needed.
 */
export const saveDatabase = () => {};

export default dbPromise;
