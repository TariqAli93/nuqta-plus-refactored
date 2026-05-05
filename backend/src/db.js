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

/**
 * Bootstrap reason codes — surfaced verbatim through /api/setup/status so the
 * frontend (and an operator reading service logs) can identify the exact root
 * cause of a startup failure without guessing.
 */
export const BOOTSTRAP_REASONS = Object.freeze({
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  WRONG_DATABASE_CONNECTED: 'WRONG_DATABASE_CONNECTED',
  INSUFFICIENT_SCHEMA_PRIVILEGES: 'INSUFFICIENT_SCHEMA_PRIVILEGES',
  MIGRATIONS_NOT_ATTEMPTED: 'MIGRATIONS_NOT_ATTEMPTED',
  MIGRATIONS_SKIPPED: 'MIGRATIONS_SKIPPED',
  MIGRATIONS_FOLDER_NOT_FOUND: 'MIGRATIONS_FOLDER_NOT_FOUND',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING: 'MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING',
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
 * Structured bootstrap state. Mutated as the boot pipeline progresses; a
 * shallow clone is exposed via getBootstrapState() and getDiagnostics().
 *
 * Backward-compat fields (databaseReady, migrationsApplied, schemaReady,
 * missingTables, lastError) are kept for existing callers — see
 * server.js / setupService.js / scheduler.js.
 */
const bootstrap = {
  // ── Backward-compat flags (kept stable for existing callers) ────────────
  databaseReady: false,
  migrationsApplied: false,
  schemaReady: false,
  missingTables: [],
  lastError: null,

  // ── Structured diagnostics ──────────────────────────────────────────────
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

  databaseExists: null, // null = unknown (maintenance probe failed)
  databaseCreated: false,

  serverDiagnostics: {
    currentDatabase: null,
    currentUser: null,
    serverAddress: null,
    serverPort: null,
    version: null,
    canCreateInDatabase: null,
    canCreateInPublicSchema: null,
    publicTables: [],
    queryError: null,
  },

  migrations: {
    attempted: false,
    skipped: false,
    skipReason: null,
    folderSelected: null,
    candidates: [],
    completed: false,
    errorCode: null,
    errorMessage: null,
    errorStack: null,
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

/**
 * Build connection config for the "postgres" maintenance database.
 * Used to check/create the target database before connecting to it.
 */
function getMaintenanceConfig() {
  const sslOption = process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false;

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
      // fall through
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

    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rowCount === 0) {
      // CREATE DATABASE cannot use parameterized queries; dbName comes from
      // our own env config, not user input.
      await client.query(`CREATE DATABASE "${dbName}"`);
      bootstrap.databaseExists = true;
      bootstrap.databaseCreated = true;
      console.log(`[bootstrap] database "${dbName}" created`);
    } else {
      bootstrap.databaseExists = true;
      bootstrap.databaseCreated = false;
    }
  } catch (error) {
    bootstrap.databaseExists = null; // unknown — maintenance probe failed
    console.warn(`[bootstrap] could not ensure database exists: ${error.message}`);
  } finally {
    await client.end().catch(() => {});
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
        current_database()                                          AS current_database,
        current_user                                                AS current_user,
        host(inet_server_addr())                                    AS server_address,
        inet_server_port()                                          AS server_port,
        version()                                                   AS version,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_database,
        has_schema_privilege(current_user, 'public', 'CREATE')      AS can_create_in_public_schema
    `);
    const row = r.rows[0] || {};
    diag.currentDatabase = row.current_database ?? null;
    diag.currentUser = row.current_user ?? null;
    diag.serverAddress = row.server_address ?? null;
    diag.serverPort = row.server_port != null ? Number(row.server_port) : null;
    diag.version = row.version ?? null;
    diag.canCreateInDatabase = row.can_create_in_database ?? null;
    diag.canCreateInPublicSchema = row.can_create_in_public_schema ?? null;

    console.log(
      `[bootstrap] server diagnostics: db=${diag.currentDatabase} user=${diag.currentUser} ` +
        `addr=${diag.serverAddress ?? 'n/a'}:${diag.serverPort ?? 'n/a'} ` +
        `canCreate(public)=${diag.canCreateInPublicSchema}`
    );
  } catch (error) {
    diag.queryError = error.message;
    console.warn(`[bootstrap] diagnostic queries failed: ${error.message}`);
  }

  try {
    const t = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    diag.publicTables = t.rows.map((r) => r.table_name);
  } catch (error) {
    diag.queryError = (diag.queryError ? diag.queryError + '; ' : '') + error.message;
  }
}

async function runMigrations(db) {
  const m = bootstrap.migrations;

  // ── Optional global skip via env ───────────────────────────────────────
  if (process.env.MIGRATIONS_DISABLED === '1') {
    m.skipped = true;
    m.skipReason = 'env:MIGRATIONS_DISABLED=1';
    console.log(`[bootstrap] migrations skipped: ${m.skipReason}`);
    return false;
  }

  // ── Privilege precheck ─────────────────────────────────────────────────
  // If the connected user cannot CREATE in the public schema, drizzle migrate
  // is guaranteed to fail. Surface this as a distinct reason so the operator
  // doesn't have to guess from a generic "permission denied" Postgres error.
  if (bootstrap.serverDiagnostics.canCreateInPublicSchema === false) {
    m.skipped = true;
    m.skipReason = 'INSUFFICIENT_SCHEMA_PRIVILEGES';
    bootstrap.reason = BOOTSTRAP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES;
    bootstrap.reasonDetails =
      `User "${bootstrap.serverDiagnostics.currentUser}" lacks CREATE privilege on schema "public" ` +
      `in database "${bootstrap.serverDiagnostics.currentDatabase}".`;
    console.error(`[bootstrap] migrations skipped: ${bootstrap.reasonDetails}`);
    return false;
  }

  // ── Resolve folder ─────────────────────────────────────────────────────
  console.log('[bootstrap] resolving migrations folder');
  const { folder, candidates } = resolveMigrationsFolder();
  m.candidates = candidates;
  m.folderSelected = folder;

  console.log('[bootstrap] migrations folder candidates probed:');
  for (const c of candidates) {
    console.log(
      `  - ${c.path} exists=${c.exists} dir=${c.isDirectory} ` +
        `journal=${c.hasJournal} sqlFiles=${c.sqlFileCount} valid=${c.valid}` +
        (c.error ? ` error=${c.error}` : '')
    );
  }

  if (!folder) {
    m.errorCode = BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND;
    m.errorMessage = `migrations folder not found. Tried ${candidates.length} candidates.`;
    bootstrap.lastError = m.errorMessage;
    console.error(`[bootstrap] ${m.errorMessage}`);
    return false;
  }

  // ── Run migrate() ──────────────────────────────────────────────────────
  console.log(`[bootstrap] migrations attempted=true`);
  console.log(`[bootstrap] migrations folder selected: ${folder}`);
  console.log('[bootstrap] running drizzle migrations');
  m.attempted = true;

  try {
    await migrate(db, { migrationsFolder: folder });
    m.completed = true;
    bootstrap.migrationsApplied = true;
    console.log('[bootstrap] migrations completed');
    return true;
  } catch (error) {
    // Pre-existing tables from a manual install or older migration baseline
    // shouldn't block startup — the schema probe below decides readiness.
    if (error.message?.includes('already exists')) {
      m.completed = true;
      bootstrap.migrationsApplied = true;
      console.log('[bootstrap] migrations completed (some objects already existed)');
      return true;
    }
    m.completed = false;
    m.errorCode = BOOTSTRAP_REASONS.MIGRATION_FAILED;
    m.errorMessage = error.message || String(error);
    m.errorStack = error.stack || null;
    bootstrap.lastError = `migration failed: ${m.errorMessage}`;
    console.error(`[bootstrap] migration failed: ${m.errorMessage}`);
    if (m.errorStack) console.error(m.errorStack);
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
 * Compute the highest-priority bootstrap reason from accumulated state. Called
 * at the end of initDB and again from ensureSchemaReady. Sets bootstrap.reason
 * and bootstrap.reasonDetails so /api/setup/status can return the exact root
 * cause without re-deriving it.
 */
function computeReason() {
  // Privilege/skip-reason explicitly set by runMigrations takes precedence.
  if (
    bootstrap.reason === BOOTSTRAP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES &&
    !bootstrap.schemaReady
  ) {
    return;
  }

  if (!bootstrap.connection.connected) {
    bootstrap.reason = BOOTSTRAP_REASONS.DATABASE_CONNECTION_FAILED;
    bootstrap.reasonDetails = bootstrap.connection.lastError;
    return;
  }

  // Wrong database: configured target doesn't match current_database().
  // Only meaningful when both values are known.
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

  const m = bootstrap.migrations;

  if (m.errorCode === BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND) {
    bootstrap.reason = BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND;
    bootstrap.reasonDetails = m.errorMessage;
    return;
  }

  if (m.errorCode === BOOTSTRAP_REASONS.MIGRATION_FAILED) {
    bootstrap.reason = BOOTSTRAP_REASONS.MIGRATION_FAILED;
    bootstrap.reasonDetails = m.errorMessage;
    return;
  }

  if (m.skipped) {
    bootstrap.reason = BOOTSTRAP_REASONS.MIGRATIONS_SKIPPED;
    bootstrap.reasonDetails = m.skipReason;
    return;
  }

  if (m.attempted && m.completed && bootstrap.missingTables.length > 0) {
    bootstrap.reason = BOOTSTRAP_REASONS.MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING;
    bootstrap.reasonDetails =
      `Migrations completed against folder ${m.folderSelected} but ${bootstrap.missingTables.length} ` +
      `required tables are still missing.`;
    return;
  }

  if (!m.attempted) {
    bootstrap.reason = BOOTSTRAP_REASONS.MIGRATIONS_NOT_ATTEMPTED;
    bootstrap.reasonDetails = m.skipReason || bootstrap.lastError;
    return;
  }

  // Fallback — schema isn't ready and we don't have a more specific reason.
  bootstrap.reason = BOOTSTRAP_REASONS.SCHEMA_NOT_READY;
  bootstrap.reasonDetails = bootstrap.lastError;
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

  console.log('[bootstrap] connecting to database');
  const attempts = Number(process.env.PG_CONNECT_RETRY_ATTEMPTS || 15);
  const delayMs = Number(process.env.PG_CONNECT_RETRY_DELAY_MS || 2000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    bootstrap.connection.attempts = attempt;
    try {
      await ensureDatabase();
      pool = createPool();

      const client = await pool.connect();
      const result = await client.query('SELECT current_database() AS db, version() AS ver');
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
        console.error('Make sure PostgreSQL is running and the connection details are correct.');
        console.error('Set PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD env vars,');
        console.error('or provide a full DATABASE_URL connection string.');
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

  // Run diagnostic SQL right after first successful connect — needed for
  // privilege/wrong-DB checks below and for the /diagnostics endpoint.
  await runDiagnosticQueries();

  // Wrong-database short-circuit: don't try to migrate into the wrong DB.
  const cfgDb = bootstrap.configured.database;
  const curDb = bootstrap.serverDiagnostics.currentDatabase;
  if (cfgDb && curDb && cfgDb !== curDb) {
    bootstrap.reason = BOOTSTRAP_REASONS.WRONG_DATABASE_CONNECTED;
    bootstrap.reasonDetails = `Configured PG_DATABASE="${cfgDb}" but current_database()="${curDb}".`;
    bootstrap.migrations.skipped = true;
    bootstrap.migrations.skipReason = 'WRONG_DATABASE_CONNECTED';
    console.error(`[bootstrap] ${bootstrap.reasonDetails} — refusing to run migrations`);
  }

  // Create Drizzle instance up-front so callers always get a usable handle.
  // Migration / verification failures are surfaced via bootstrap rather than
  // rejecting dbPromise — that lets /api/setup/status correctly report the
  // exact reason instead of masking it as DATABASE_CONNECTION_FAILED.
  const db = drizzle(pool, { schema });
  dbInstance = db;

  // Only run migrations if we haven't already short-circuited.
  if (!bootstrap.migrations.skipped) {
    await runMigrations(db);
  }

  // Verify schema either way — a previous run may have already migrated.
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
 * Backward-compatible snapshot. Includes the legacy flat fields plus the new
 * structured ones. Existing callers (server.js, setupService.js) read the
 * legacy fields; new code can use bootstrap.reason / .migrations / etc.
 */
export const getBootstrapState = () => ({
  databaseReady: bootstrap.databaseReady,
  migrationsApplied: bootstrap.migrationsApplied,
  schemaReady: bootstrap.schemaReady,
  missingTables: [...bootstrap.missingTables],
  lastError: bootstrap.lastError,

  reason: bootstrap.reason,
  reasonDetails: bootstrap.reasonDetails,

  configured: { ...bootstrap.configured },
  connection: { ...bootstrap.connection },
  databaseExists: bootstrap.databaseExists,
  databaseCreated: bootstrap.databaseCreated,
  serverDiagnostics: {
    ...bootstrap.serverDiagnostics,
    publicTables: [...bootstrap.serverDiagnostics.publicTables],
  },
  migrations: {
    ...bootstrap.migrations,
    candidates: bootstrap.migrations.candidates.map((c) => ({ ...c, sqlFiles: [...c.sqlFiles] })),
  },
});

/**
 * Detailed snapshot suitable for the /api/setup/diagnostics endpoint. Same
 * shape as getBootstrapState() plus a few synthesised top-level fields and a
 * masked connection summary that's safe to expose.
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
      databaseExists: state.databaseExists,
      databaseCreated: state.databaseCreated,
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
