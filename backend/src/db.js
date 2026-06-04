import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname as pathDirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import config, { __envFilesTried, __envFileLoaded } from './config.js';
import * as schema from './models/index.js';
import {
  captureRuntimeContext,
  logBootstrapEvent,
  maskConnectionString,
  getDiagnostics,
} from './utils/bootstrapDiagnostics.js';
import { ensureSearchInfrastructure } from './db/searchInfrastructure.js';

const { Pool, Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// ── PostgreSQL connection pool ────────────────────────────────────────────
let pool = null;
let dbInstance = null;

/**
 * Bootstrap reason codes — surface a specific cause to /api/setup/status and
 * /api/auth/initial-setup at every stage. NEVER null while bootstrap is in
 * progress; that was the root cause of the misleading "database_not_ready"
 * literal returned to clients.
 */
const REASON = Object.freeze({
  NOT_STARTED: 'bootstrap_not_started',
  CONFIG_LOADED: 'config_loaded',
  ENSURING_DATABASE: 'ensuring_database_exists',
  CONNECTING: 'connecting_to_postgres',
  CONNECTED: 'connected',
  RUNNING_MIGRATIONS: 'running_migrations',
  MIGRATIONS_DONE: 'migrations_applied',
  READY: 'ready',
  PG_UNREACHABLE: 'postgresql_unreachable',
  PG_AUTH_FAILED: 'postgresql_authentication_failed',
  PG_DB_MISSING: 'postgresql_database_missing',
  MIGRATIONS_FAILED: 'migrations_failed',
  MIGRATIONS_FOLDER_MISSING: 'migrations_folder_missing',
  UNKNOWN_ERROR: 'unknown_bootstrap_error',
});

let bootstrapState = {
  databaseReady: false,
  migrationsApplied: false,
  // lastError starts non-null so a request that races initDB() never sees a
  // bare "database_not_ready" without context.
  lastError: REASON.NOT_STARTED,
  reasonCode: REASON.NOT_STARTED,
  startedAt: new Date().toISOString(),
  attempts: 0,
};

function setReason(code, errorOrMessage = null) {
  bootstrapState.reasonCode = code;
  if (errorOrMessage instanceof Error) {
    bootstrapState.lastError = `[${code}] ${errorOrMessage.message}`;
  } else if (typeof errorOrMessage === 'string') {
    bootstrapState.lastError = `[${code}] ${errorOrMessage}`;
  } else {
    bootstrapState.lastError = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Capture runtime context AT MODULE LOAD so it's in the bootstrap.log even if
// initDB never gets called.
captureRuntimeContext({
  envFilesTried: __envFilesTried || [],
  envFileLoaded: __envFileLoaded || null,
});

/**
 * Resolve the target database name from environment configuration.
 */
function getTargetDatabaseName() {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return url.pathname.replace(/^\//, '') || 'nuqta_db';
    } catch {
      return 'nuqta_db';
    }
  }
  return process.env.PG_DATABASE || 'nuqta_db';
}

/**
 * Build connection config for the "postgres" maintenance database.
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
        connectionTimeoutMillis: 10_000,
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
    connectionTimeoutMillis: 10_000,
  };
}

/**
 * Map a pg driver error to a coarse reason code.
 *   ECONNREFUSED, ENOTFOUND, ETIMEDOUT, EHOSTUNREACH → unreachable
 *   28P01 (invalid_password), 28000 (invalid_auth_spec) → auth failed
 *   3D000 (invalid_catalog_name) → database missing
 */
function classifyPgError(err) {
  if (!err) return REASON.UNKNOWN_ERROR;
  const code = err.code || err.errno;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'EAI_AGAIN') {
    return REASON.PG_UNREACHABLE;
  }
  if (code === '28P01' || code === '28000') return REASON.PG_AUTH_FAILED;
  if (code === '3D000') return REASON.PG_DB_MISSING;
  return REASON.UNKNOWN_ERROR;
}

/**
 * Ensure the target database exists. Connects to the "postgres" maintenance
 * database, checks if the target DB is present, and creates it if missing.
 */
async function ensureDatabase() {
  const dbName = getTargetDatabaseName();
  const maintConfig = getMaintenanceConfig();

  logBootstrapEvent('info', REASON.ENSURING_DATABASE,
    `Ensuring database "${dbName}" exists`,
    { host: maintConfig.host, port: maintConfig.port, user: maintConfig.user }
  );

  const client = new Client(maintConfig);

  try {
    await client.connect();

    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rowCount === 0) {
      // CREATE DATABASE cannot use parameterized queries — dbName comes from
      // our own env config, not user input.
      await client.query(`CREATE DATABASE "${dbName}"`);
      logBootstrapEvent('info', REASON.ENSURING_DATABASE,
        `Database "${dbName}" created`);
    } else {
      logBootstrapEvent('info', REASON.ENSURING_DATABASE,
        `Database "${dbName}" already exists`);
    }
  } catch (error) {
    // Re-throw with classification so the retry loop can decide what to do.
    const reason = classifyPgError(error);
    logBootstrapEvent('warn', reason,
      `ensureDatabase failed: ${error.message}`,
      { error, code: error.code }
    );
    throw error;
  } finally {
    try { await client.end(); } catch { /* ignore cleanup error */ }
  }
}

function createPool() {
  const poolConfig = {
    ...config.database,
    max: parseInt(process.env.PG_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  if (process.env.PG_SSL === 'true') {
    poolConfig.ssl = { rejectUnauthorized: false };
  } else if (!poolConfig.connectionString && process.env.PG_SSL !== 'true') {
    // Explicit false prevents PG 18's default SSL negotiation from causing
    // ECONNRESET on local connections.
    poolConfig.ssl = false;
  }

  const p = new Pool(poolConfig);

  p.on('error', (err) => {
    logBootstrapEvent('error', 'pool_error',
      `Unexpected PostgreSQL pool error: ${err.message}`,
      { error: err, code: err.code }
    );
  });

  return p;
}

async function initDB() {
  setReason(REASON.CONFIG_LOADED);

  const attempts = Number(process.env.PG_CONNECT_RETRY_ATTEMPTS || 15);
  const delayMs = Number(process.env.PG_CONNECT_RETRY_DELAY_MS || 2000);

  // Resolve migrations folder up-front so the existence check is logged once.
  const migrationsFolder = resolve(__dirname, '..', 'drizzle');
  if (!existsSync(migrationsFolder)) {
    setReason(REASON.MIGRATIONS_FOLDER_MISSING,
      `migrationsFolder not found at ${migrationsFolder}`);
    logBootstrapEvent('error', REASON.MIGRATIONS_FOLDER_MISSING,
      `Drizzle migrations folder missing — packaging defect`,
      { migrationsFolder }
    );
    // Continue anyway — the runtime check after migrate() will retry via raw
    // fallback if drizzle still finds something. But the reason is recorded.
  } else {
    const sqlFiles = readdirSync(migrationsFolder).filter(
      (f) => f.toLowerCase().endsWith('.sql')
    );
    logBootstrapEvent('info', 'migrations_folder_found',
      `Drizzle migrations folder OK`,
      { migrationsFolder, sqlFileCount: sqlFiles.length }
    );
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    bootstrapState.attempts = attempt;
    setReason(REASON.CONNECTING);
    logBootstrapEvent('info', REASON.CONNECTING,
      `Attempt ${attempt}/${attempts} — connecting to PostgreSQL`,
      { host: process.env.PG_HOST || '127.0.0.1',
        port: process.env.PG_PORT || '5432',
        user: process.env.PG_USER || 'postgres',
        database: getTargetDatabaseName(),
        urlSet: !!process.env.DATABASE_URL,
        urlMasked: maskConnectionString(process.env.DATABASE_URL) }
    );

    try {
      await ensureDatabase();
      pool = createPool();

      const client = await pool.connect();
      const result = await client.query(
        'SELECT current_database() AS db, version() AS ver'
      );
      logBootstrapEvent('info', REASON.CONNECTED,
        `Connected to PostgreSQL "${result.rows[0].db}"`,
        { version: String(result.rows[0].ver).slice(0, 80) }
      );
      client.release();

      bootstrapState.databaseReady = true;
      setReason(REASON.CONNECTED);
      break;
    } catch (error) {
      const reason = classifyPgError(error);
      setReason(reason, error);

      logBootstrapEvent('error', reason,
        `Attempt ${attempt}/${attempts} failed: ${error.message}`,
        { error, code: error.code, address: error.address, port: error.port }
      );

      if (pool) {
        try { await pool.end(); } catch { /* ignore */ }
      }
      pool = null;

      if (attempt === attempts) {
        logBootstrapEvent('error', reason,
          `PostgreSQL bootstrap permanently failed after ${attempts} attempts. ` +
          `Verify PostgreSQL is running and credentials are correct. ` +
          `Set DATABASE_URL or PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE ` +
          `via the WinSW service descriptor or %PROGRAMDATA%\\NuqtaPlus\\.env.`,
          { error }
        );
        throw error;
      }

      await sleep(delayMs);
    }
  }

  // ── Migrations ─────────────────────────────────────────────────────────
  setReason(REASON.RUNNING_MIGRATIONS);
  const db = drizzle(pool, { schema });

  let drizzleMigrateError = null;
  try {
    logBootstrapEvent('info', REASON.RUNNING_MIGRATIONS,
      'Applying drizzle migrations', { migrationsFolder });
    await migrate(db, { migrationsFolder });
    logBootstrapEvent('info', REASON.MIGRATIONS_DONE,
      'Drizzle migrations applied successfully');
    bootstrapState.migrationsApplied = true;
  } catch (error) {
    if (error.message?.includes('already exists')) {
      logBootstrapEvent('warn', REASON.MIGRATIONS_DONE,
        'Migrations skipped — tables already exist');
      bootstrapState.migrationsApplied = true;
    } else {
      drizzleMigrateError = error;
      logBootstrapEvent('warn', REASON.MIGRATIONS_FAILED,
        `Drizzle migrate() failed: ${error.message}`,
        { error });
    }
  }

  // Verify drizzle actually created the core schema. On packaged builds with
  // sparse meta/ snapshots, drizzle's migrate() may return without doing
  // anything. Fall back to running raw SQL.
  let usersTablePresent = false;
  try {
    const tableCheck = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1"
    );
    usersTablePresent = tableCheck.rowCount > 0;
  } catch (checkErr) {
    // Pool/connection died after the initial probe — surface this clearly.
    setReason(REASON.PG_UNREACHABLE, checkErr);
    logBootstrapEvent('error', REASON.PG_UNREACHABLE,
      `users-table existence check failed: ${checkErr.message}`,
      { error: checkErr });
    throw checkErr;
  }

  if (!usersTablePresent) {
    logBootstrapEvent('warn', REASON.MIGRATIONS_FAILED,
      'users table missing after drizzle migrate — running SQL files manually as fallback',
      { migrationsFolder });
    try {
      await runRawMigrations(pool, migrationsFolder);
      bootstrapState.migrationsApplied = true;
      setReason(REASON.MIGRATIONS_DONE);
    } catch (fallbackErr) {
      setReason(REASON.MIGRATIONS_FAILED, fallbackErr);
      logBootstrapEvent('error', REASON.MIGRATIONS_FAILED,
        `Raw migration fallback failed: ${fallbackErr.message}`,
        { error: fallbackErr });
      throw fallbackErr;
    }
  } else if (drizzleMigrateError) {
    // drizzle threw but tables exist → the failure was non-fatal. Promote to
    // a warning instead of bringing down the whole bootstrap.
    logBootstrapEvent('warn', REASON.MIGRATIONS_DONE,
      `Drizzle reported an error but users table is present — proceeding (${drizzleMigrateError.message})`);
    bootstrapState.migrationsApplied = true;
  }

  // ── Search infrastructure ────────────────────────────────────────────────
  // Idempotent: pg_trgm extension, nuqta_normalize() functions, generated
  // search_* columns, and trigram/btree indexes powering the search system.
  // Never throws — degraded search is preferable to a failed bootstrap.
  try {
    const searchInfra = await ensureSearchInfrastructure(pool);
    logBootstrapEvent('info', REASON.MIGRATIONS_DONE,
      'Search infrastructure ensured',
      { trgm: searchInfra.trgm, applied: searchInfra.applied, failed: searchInfra.failed });
  } catch (searchErr) {
    logBootstrapEvent('warn', REASON.MIGRATIONS_DONE,
      `Search infrastructure setup encountered an error (continuing): ${searchErr.message}`,
      { error: searchErr });
  }

  setReason(REASON.READY);
  logBootstrapEvent('info', REASON.READY,
    'Bootstrap complete — backend is ready to serve requests',
    {
      databaseReady: bootstrapState.databaseReady,
      migrationsApplied: bootstrapState.migrationsApplied,
      attempts: bootstrapState.attempts,
    });

  dbInstance = db;
  return db;
}

/**
 * Manually execute every `*.sql` file in the migrations folder, in order.
 * Used as a recovery path when drizzle's migrate() returns without
 * creating tables (e.g. packaged build with incomplete meta snapshots).
 */
async function runRawMigrations(pool, migrationsFolder) {
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder does not exist: ${migrationsFolder}`);
  }

  const files = readdirSync(migrationsFolder)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .sql migration files found in ${migrationsFolder}`);
  }

  for (const file of files) {
    const sql = readFileSync(join(migrationsFolder, file), 'utf-8');
    const statements = sql
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        if (
          err.message?.includes('already exists') ||
          err.code === '42P07' || // duplicate_table
          err.code === '42710' || // duplicate_object
          err.code === '42701'    // duplicate_column
        ) {
          continue;
        }
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    logBootstrapEvent('info', 'raw_migration_applied',
      `Applied (raw): ${file}`);
  }
  logBootstrapEvent('info', REASON.MIGRATIONS_DONE,
    `All ${files.length} migrations applied via raw fallback`);
}

// ── Exports ───────────────────────────────────────────────────────────────

/** Async initialized db promise — awaited once at startup. */
export const dbPromise = initDB().catch((err) => {
  // Make sure we have something specific in lastError BEFORE the unhandled
  // rejection bubbles. Without this, downstream code would still see
  // bootstrap.lastError set to a stage code, but the message could be empty.
  if (!bootstrapState.lastError || bootstrapState.lastError === REASON.NOT_STARTED) {
    setReason(REASON.UNKNOWN_ERROR, err);
  }
  // Do NOT re-throw here — the route layer surfaces bootstrapState.lastError.
  // Returning undefined keeps getDb() resolving to undefined, which downstream
  // code already handles (it checks bootstrap.databaseReady first).
  return undefined;
});

/** Helper to get the cached db instance (resolves promise once). */
export const getDb = async () => {
  if (dbInstance) return dbInstance;
  dbInstance = await dbPromise;
  return dbInstance;
};

export const getPool = async () => {
  if (!pool) await dbPromise;
  return pool;
};

/**
 * Snapshot of bootstrap state. NEVER returns null lastError while
 * databaseReady is false — that was the source of the bare "database_not_ready"
 * response that prompted this overhaul.
 */
export const getBootstrapState = () => ({ ...bootstrapState });

/**
 * Full diagnostics including runtime context, recent events, and bootstrap
 * state. Used by /api/setup/diagnostics to give admins everything they need
 * to troubleshoot a packaged install without remoting in.
 */
export const getBootstrapDiagnostics = () => {
  const diagnostics = getDiagnostics();
  return {
    state: { ...bootstrapState },
    runtime: diagnostics.runtime,
    events: diagnostics.events,
    logFile: diagnostics.logFile,
    logDir: diagnostics.logDir,
  };
};

/**
 * Gracefully close the pool. Called during server shutdown.
 */
export const closeDatabase = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
    logBootstrapEvent('info', 'shutdown', 'PostgreSQL pool closed');
  }
};

/** No-op kept for backward compatibility with existing service code. */
export const saveDatabase = () => {};

export default dbPromise;
