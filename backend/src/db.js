import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import config from './config.js';
import * as schema from './models/index.js';

const { Pool } = pg;

// ── PostgreSQL connection pool ────────────────────────────────────────────
let pool = null;
let dbInstance = null;

/**
 * Bootstrap reason codes — surfaced verbatim through /api/setup/status so the
 * frontend (and an operator reading service logs) can identify the exact root
 * cause of a startup failure without guessing.
 */
export const BOOTSTRAP_REASONS = Object.freeze({
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  WRONG_DATABASE_CONNECTED: 'WRONG_DATABASE_CONNECTED',
  SCHEMA_NOT_READY: 'SCHEMA_NOT_READY',
});

// Tables that must exist after migrations for the app + always-on background
// workers to be considered ready. Names taken verbatim from
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

/**
 * Structured bootstrap state. The runtime backend assumes the database has
 * already been created and the schema migrated by the Windows bootstrap
 * script (tools/bootstrap.bat → backend/migrations/migrate-production.js).
 * This struct only records what the runtime can observe: connection status
 * and schema readiness.
 */
const bootstrap = {
  databaseReady: false,
  schemaReady: false,
  missingTables: [],
  lastError: null,

  reason: null,
  reasonDetails: null,

  configured: {
    host: null,
    port: null,
    database: null,
    user: null,
    via: null, // 'DATABASE_URL' | 'PG_*'
  },

  connection: {
    connected: false,
    attempts: 0,
    lastError: null,
  },

  serverDiagnostics: {
    currentDatabase: null,
    currentUser: null,
    serverAddress: null,
    serverPort: null,
    version: null,
    publicTables: [],
    queryError: null,
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mask the password in a connection-string-like value. Safe to log / return
 * via a diagnostic endpoint.
 */
export function maskConnectionString(input) {
  if (!input || typeof input !== 'string') return input;
  try {
    return input.replace(/(\/\/[^:]+:)([^@]+)(@)/, '$1****$3');
  } catch {
    return input;
  }
}

/**
 * Snapshot the configured connection target into bootstrap.configured. Called
 * once at the start of initDB so /diagnostics can show what we *intended* to
 * connect to even if the connection fails.
 */
function snapshotConfiguredTarget() {
  let host = process.env.PG_HOST || '127.0.0.1';
  let port = parseInt(process.env.PG_PORT || '5432', 10);
  let database = process.env.PG_DATABASE || 'nuqta_db';
  let user = process.env.PG_USER || 'postgres';
  let via = 'PG_*';

  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      host = url.hostname || host;
      port = parseInt(url.port || String(port), 10);
      database = url.pathname.replace(/^\//, '') || database;
      user = decodeURIComponent(url.username) || user;
      via = 'DATABASE_URL';
    } catch {
      // keep PG_* defaults
    }
  }

  bootstrap.configured = { host, port, database, user, via };
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
    poolConfig.ssl = false;
  }

  const p = new Pool(poolConfig);
  p.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
  });
  return p;
}

/**
 * Run the post-connect diagnostic SQL bundle. Populates
 * bootstrap.serverDiagnostics. Best-effort — any individual query failing is
 * tolerated and recorded in `queryError` so callers can still see partial
 * data.
 */
async function runDiagnosticQueries() {
  const diag = bootstrap.serverDiagnostics;
  try {
    const r = await pool.query(`
      SELECT
        current_database() AS current_database,
        current_user       AS current_user,
        host(inet_server_addr()) AS server_address,
        inet_server_port() AS server_port,
        version()          AS version
    `);
    const row = r.rows[0] || {};
    diag.currentDatabase = row.current_database ?? null;
    diag.currentUser = row.current_user ?? null;
    diag.serverAddress = row.server_address ?? null;
    diag.serverPort = row.server_port != null ? Number(row.server_port) : null;
    diag.version = row.version ?? null;

    console.log(
      `[bootstrap] server diagnostics: db=${diag.currentDatabase} user=${diag.currentUser} ` +
        `addr=${diag.serverAddress ?? 'n/a'}:${diag.serverPort ?? 'n/a'}`
    );
  } catch (error) {
    diag.queryError = error.message;
    console.warn(`[bootstrap] diagnostic queries failed: ${error.message}`);
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
    bootstrap.schemaReady = true;
    bootstrap.missingTables = [];
    bootstrap.lastError = null;
    console.log('[bootstrap] schema ready');
    return true;
  }

  bootstrap.schemaReady = false;
  bootstrap.missingTables = missing;
  bootstrap.lastError = `missing tables: ${missing.join(', ')}`;
  console.error(`[bootstrap] schema not ready. Missing tables: ${missing.join(', ')}`);
  return false;
}

/**
 * Compute the highest-priority bootstrap reason from accumulated state.
 * Runtime backend only diagnoses — it never repairs. The bootstrap script
 * (tools/bootstrap.bat) is responsible for creating the database and
 * applying migrations before the service starts.
 */
function computeReason() {
  if (!bootstrap.connection.connected) {
    bootstrap.reason = BOOTSTRAP_REASONS.DATABASE_CONNECTION_FAILED;
    bootstrap.reasonDetails = bootstrap.connection.lastError;
    return;
  }

  const cfgDb = bootstrap.configured.database;
  const curDb = bootstrap.serverDiagnostics.currentDatabase;
  if (cfgDb && curDb && cfgDb !== curDb && !bootstrap.schemaReady) {
    bootstrap.reason = BOOTSTRAP_REASONS.WRONG_DATABASE_CONNECTED;
    bootstrap.reasonDetails =
      `Configured PG_DATABASE="${cfgDb}" but current_database()="${curDb}".`;
    return;
  }

  if (bootstrap.schemaReady) {
    bootstrap.reason = null;
    bootstrap.reasonDetails = null;
    return;
  }

  bootstrap.reason = BOOTSTRAP_REASONS.SCHEMA_NOT_READY;
  bootstrap.reasonDetails =
    bootstrap.lastError ||
    'Database schema is not ready. Run tools\\bootstrap.bat as Administrator to apply migrations.';
}

/**
 * Re-run the schema probe on demand (e.g. before FirstRun) so a transient
 * boot-time failure can be re-evaluated without restarting the process.
 * Returns the latest bootstrap state snapshot.
 */
export async function ensureSchemaReady() {
  if (!pool) {
    return getBootstrapState();
  }
  try {
    await verifySchema();
  } catch (error) {
    bootstrap.schemaReady = false;
    bootstrap.lastError = error.message;
    console.error(`[bootstrap] schema probe failed: ${error.message}`);
  }
  computeReason();
  return getBootstrapState();
}

async function initDB() {
  snapshotConfiguredTarget();
  console.log(
    `[bootstrap] target: ${bootstrap.configured.user}@${bootstrap.configured.host}:` +
      `${bootstrap.configured.port}/${bootstrap.configured.database} (via ${bootstrap.configured.via})`
  );
  console.log(
    '[bootstrap] runtime assumes database+schema were prepared by tools\\bootstrap.bat'
  );

  console.log('[bootstrap] connecting to database');
  const attempts = Number(process.env.PG_CONNECT_RETRY_ATTEMPTS || 15);
  const delayMs = Number(process.env.PG_CONNECT_RETRY_DELAY_MS || 2000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    bootstrap.connection.attempts = attempt;
    try {
      pool = createPool();

      const client = await pool.connect();
      const result = await client.query('SELECT current_database() AS db');
      console.log(`[bootstrap] database connected: ${result.rows[0].db}`);
      client.release();

      bootstrap.databaseReady = true;
      bootstrap.connection.connected = true;
      bootstrap.connection.lastError = null;
      bootstrap.lastError = null;
      break;
    } catch (error) {
      bootstrap.connection.lastError = error.message;
      bootstrap.lastError = error.message;
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
        console.error('Make sure PostgreSQL is running and tools\\bootstrap.bat has been run.');
        bootstrap.connection.connected = false;
        computeReason();
        throw error;
      }

      console.warn(
        `PostgreSQL is not ready yet (attempt ${attempt}/${attempts}): ${error.message}. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  await runDiagnosticQueries();

  const db = drizzle(pool, { schema });
  dbInstance = db;

  try {
    await verifySchema();
  } catch (error) {
    bootstrap.schemaReady = false;
    bootstrap.lastError = error.message;
    console.error(`[bootstrap] schema probe failed: ${error.message}`);
  }

  computeReason();

  if (bootstrap.reason) {
    console.warn(
      `[bootstrap] reason=${bootstrap.reason}` +
        (bootstrap.reasonDetails ? ` (${bootstrap.reasonDetails})` : '')
    );
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

/**
 * Snapshot of the runtime bootstrap state, surfaced through
 * /api/setup/status and /api/setup/diagnostics.
 */
export const getBootstrapState = () => ({
  databaseReady: bootstrap.databaseReady,
  schemaReady: bootstrap.schemaReady,
  missingTables: [...bootstrap.missingTables],
  lastError: bootstrap.lastError,

  reason: bootstrap.reason,
  reasonDetails: bootstrap.reasonDetails,

  configured: { ...bootstrap.configured },
  connection: { ...bootstrap.connection },
  serverDiagnostics: {
    ...bootstrap.serverDiagnostics,
    publicTables: [...bootstrap.serverDiagnostics.publicTables],
  },
});

/**
 * Detailed snapshot suitable for the /api/setup/diagnostics endpoint.
 * Diagnostic only — never repairs anything.
 */
export const getDiagnostics = () => {
  const state = getBootstrapState();
  const diag = state.serverDiagnostics;

  return {
    ...state,
    requiredTables: [...REQUIRED_TABLES],
    maskedDatabaseUrl: process.env.DATABASE_URL
      ? maskConnectionString(process.env.DATABASE_URL)
      : null,
    summary: {
      databaseConnected: state.connection.connected,
      databaseName: state.configured.database,
      databaseUser: state.configured.user,
      databaseHost: state.configured.host,
      databasePort: state.configured.port,
      currentDatabase: diag.currentDatabase,
      currentUser: diag.currentUser,
      serverAddress:
        diag.serverAddress && diag.serverPort
          ? `${diag.serverAddress}:${diag.serverPort}`
          : null,
      schemaReady: state.schemaReady,
      missingTables: state.missingTables,
      reason: state.reason,
      reasonDetails: state.reasonDetails,
    },
  };
};

/** Convenience predicate for workers/schedulers gating on a usable schema. */
export const isSchemaReady = () =>
  bootstrap.databaseReady && bootstrap.schemaReady;

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
