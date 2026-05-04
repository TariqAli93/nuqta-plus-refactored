import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import * as schema from './models/index.js';

const { Pool, Client } = pg;

// ── PostgreSQL connection pool ────────────────────────────────────────────
let pool = null;
let dbInstance = null;
let bootstrapState = {
  databaseReady: false,
  migrationsApplied: false,
  schemaReady: false,
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

async function initDB() {
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

  // Create Drizzle instance
  const db = drizzle(pool, { schema });

  // Run pending migrations
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = pathDirname(__filename);
  const migrationsFolder = join(__dirname, '../drizzle');

  try {
    await migrate(db, { migrationsFolder });
    console.log('[bootstrap] migrations applied');
    bootstrapState.migrationsApplied = true;
  } catch (error) {
    // If migration fails because tables exist, it's okay
    if (error.message?.includes('already exists')) {
      console.log('[bootstrap] migrations skipped - tables already exist');
      bootstrapState.migrationsApplied = true;
    } else {
      bootstrapState.lastError = error.message;
      throw error;
    }
  }

  // Verify required tables actually exist after migration so the setup status
  // endpoint can distinguish "DB up but schema broken" from "no admin yet".
  try {
    const probe = await pool.query(
      `SELECT to_regclass('public.users') AS users_tbl,
              to_regclass('public.settings') AS settings_tbl`
    );
    const row = probe.rows[0] || {};
    if (row.users_tbl && row.settings_tbl) {
      bootstrapState.schemaReady = true;
      console.log('[bootstrap] schema ready');
    } else {
      bootstrapState.schemaReady = false;
      bootstrapState.lastError = 'required tables missing after migration';
      console.error('[bootstrap] schema NOT ready — missing tables');
    }
  } catch (error) {
    bootstrapState.schemaReady = false;
    bootstrapState.lastError = error.message;
    console.error(`[bootstrap] schema probe failed: ${error.message}`);
  }

  dbInstance = db;
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
