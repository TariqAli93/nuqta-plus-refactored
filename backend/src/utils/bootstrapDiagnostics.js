/**
 * bootstrapDiagnostics.js
 *
 * Centralized startup diagnostics for the NuqtaPlus backend.
 *
 * Production deployments run as a Windows Service (LocalSystem), so console
 * output is invisible to the end user. This module:
 *
 *   1. Captures every meaningful runtime fact (cwd, __dirname, env presence,
 *      path resolutions, file existence, masked DB config) into a structured
 *      record.
 *   2. Mirrors the record to stderr (picked up by WinSW's *.err.log) and to a
 *      persistent log file under %PROGRAMDATA%\NuqtaPlus\logs\bootstrap.log.
 *      The log file is the *only* signal an admin has when troubleshooting a
 *      packaged installation.
 *   3. Exposes the latest record via getDiagnostics() so /api/setup/diagnostics
 *      can return it to the UI without any I/O.
 *
 * No third-party dependencies — runs even before npm install. Safe to import
 * from any module without circular concerns (depends only on node:fs/os/path).
 */

import { existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWindows = process.platform === 'win32';

/**
 * Compute the persistent log directory. We deliberately do NOT use the
 * service's working directory because non-admin uninstall/upgrade flows can
 * wipe it. %PROGRAMDATA%\NuqtaPlus survives reinstalls.
 */
function resolveLogDir() {
  if (process.env.NUQTA_LOG_DIR) return process.env.NUQTA_LOG_DIR;
  if (isWindows) {
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    return join(programData, 'NuqtaPlus', 'logs');
  }
  return join(os.homedir(), '.nuqtaplus', 'logs');
}

const LOG_DIR = resolveLogDir();
const LOG_FILE = join(LOG_DIR, 'bootstrap.log');

let latestSnapshot = {
  startedAt: new Date().toISOString(),
  events: [],
  runtime: {},
};

function ensureLogDir() {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function writeLine(line) {
  // Always to stderr (WinSW captures stderr to NuqtaPlusBackend.err.log)
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    /* ignore — stderr could be closed in extreme cases */
  }
  // Then mirror to the persistent log file
  if (ensureLogDir()) {
    try {
      appendFileSync(LOG_FILE, `${line}\n`, { encoding: 'utf8' });
    } catch {
      /* ignore — disk full / permission denied */
    }
  }
}

/**
 * Mask passwords and secrets in DB connection strings before logging.
 *   postgresql://user:pass@host:5432/db → postgresql://user:***@host:5432/db
 */
export function maskConnectionString(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  return value.replace(/(:\/\/[^:@/]+:)[^@]+(@)/, '$1***$2');
}

/**
 * One-shot capture of the runtime context. Called by db.js BEFORE any
 * connection attempt so the log explains exactly what the process saw.
 */
export function captureRuntimeContext({ envFilesTried = [], envFileLoaded = null } = {}) {
  const ctx = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    execPath: process.execPath,
    moduleDir: __dirname,
    isPackaged: !!process.env.NUQTA_RUN_MODE && process.env.NUQTA_RUN_MODE !== 'dev',
    runMode: process.env.NUQTA_RUN_MODE || 'unknown',
    nodeEnv: process.env.NODE_ENV || '(unset)',
    user: os.userInfo().username,
    homedir: os.homedir(),

    // Path resolutions critical for production
    resolvedMigrationsFolder: resolve(__dirname, '..', '..', 'drizzle'),
    migrationsFolderExists: false,
    migrationsFolderFileCount: 0,

    // env loading
    envFilesTried,
    envFileLoaded,

    // DB config (masked)
    db: {
      DATABASE_URL: maskConnectionString(process.env.DATABASE_URL || null),
      PG_HOST: process.env.PG_HOST || '(default 127.0.0.1)',
      PG_PORT: process.env.PG_PORT || '(default 5432)',
      PG_DATABASE: process.env.PG_DATABASE || '(default nuqta_db)',
      PG_USER: process.env.PG_USER || '(default postgres)',
      PG_PASSWORD: process.env.PG_PASSWORD ? '***' : '(default root)',
      PG_SSL: process.env.PG_SSL || '(default false)',
      PG_CONNECT_RETRY_ATTEMPTS: process.env.PG_CONNECT_RETRY_ATTEMPTS || '(default 15)',
      PG_CONNECT_RETRY_DELAY_MS: process.env.PG_CONNECT_RETRY_DELAY_MS || '(default 2000)',
    },

    // Critical paths (resolved relative to this module)
    paths: {
      backendRoot: resolve(__dirname, '..', '..'),
      srcRoot: resolve(__dirname, '..'),
      drizzleRoot: resolve(__dirname, '..', '..', 'drizzle'),
      packageJson: resolve(__dirname, '..', '..', 'package.json'),
      envInBaseDir: resolve(__dirname, '..', '..', '.env'),
      envProductionInBaseDir: resolve(__dirname, '..', '..', '.env.production'),
    },
  };

  // File existence + count
  try {
    if (existsSync(ctx.resolvedMigrationsFolder)) {
      ctx.migrationsFolderExists = true;
      ctx.migrationsFolderFileCount = readdirSync(ctx.resolvedMigrationsFolder)
        .filter((f) => f.toLowerCase().endsWith('.sql')).length;
    }
  } catch {
    /* ignore */
  }

  // existence flags for each path of interest
  ctx.pathsExist = {};
  for (const [k, p] of Object.entries(ctx.paths)) {
    try {
      ctx.pathsExist[k] = existsSync(p);
    } catch {
      ctx.pathsExist[k] = false;
    }
  }

  latestSnapshot.runtime = ctx;

  // Emit a structured banner so admins can grep for it
  writeLine('');
  writeLine(`=== [bootstrap] NuqtaPlus backend startup @ ${ctx.timestamp} ===`);
  writeLine(`[bootstrap] pid=${ctx.pid} node=${ctx.nodeVersion} platform=${ctx.platform}/${ctx.arch}`);
  writeLine(`[bootstrap] runMode=${ctx.runMode} nodeEnv=${ctx.nodeEnv} user=${ctx.user}`);
  writeLine(`[bootstrap] cwd=${ctx.cwd}`);
  writeLine(`[bootstrap] execPath=${ctx.execPath}`);
  writeLine(`[bootstrap] moduleDir=${ctx.moduleDir}`);
  writeLine(`[bootstrap] backendRoot=${ctx.paths.backendRoot} (exists=${ctx.pathsExist.backendRoot})`);
  writeLine(
    `[bootstrap] migrationsFolder=${ctx.resolvedMigrationsFolder} (exists=${ctx.migrationsFolderExists}, sqlFiles=${ctx.migrationsFolderFileCount})`
  );
  writeLine(`[bootstrap] envFilesTried=${JSON.stringify(envFilesTried)}`);
  writeLine(`[bootstrap] envFileLoaded=${envFileLoaded || '(none — using defaults)'}`);
  writeLine(`[bootstrap] DB DATABASE_URL=${ctx.db.DATABASE_URL || '(unset — falling back to PG_* / defaults)'}`);
  writeLine(
    `[bootstrap] DB host=${ctx.db.PG_HOST} port=${ctx.db.PG_PORT} db=${ctx.db.PG_DATABASE} user=${ctx.db.PG_USER} pwSet=${process.env.PG_PASSWORD ? 'yes' : 'no'} ssl=${ctx.db.PG_SSL}`
  );
  writeLine(`[bootstrap] retry attempts=${ctx.db.PG_CONNECT_RETRY_ATTEMPTS} delayMs=${ctx.db.PG_CONNECT_RETRY_DELAY_MS}`);
  writeLine('');

  return ctx;
}

/**
 * Append a structured event with optional error info to the diagnostics log.
 * Events are kept on the snapshot (last 100) so /api/setup/diagnostics can
 * stream them.
 */
export function logBootstrapEvent(level, code, message, details = {}) {
  const event = {
    ts: new Date().toISOString(),
    level,
    code,
    message,
    details,
  };

  latestSnapshot.events.push(event);
  if (latestSnapshot.events.length > 100) latestSnapshot.events.shift();

  const line = `[bootstrap:${level}] [${code}] ${message}${
    Object.keys(details).length ? ' ' + JSON.stringify(details) : ''
  }`;
  writeLine(line);

  // Print stack trace for any error-level event with an Error attached
  if (level === 'error' && details && details.error instanceof Error && details.error.stack) {
    writeLine(`[bootstrap:error] STACK ${details.error.stack}`);
  }
}

/**
 * Latest diagnostics snapshot. Includes runtime context + most recent events.
 * Returned by /api/setup/diagnostics. NEVER includes secrets.
 */
export function getDiagnostics() {
  return {
    ...latestSnapshot,
    logFile: LOG_FILE,
    logDir: LOG_DIR,
  };
}

export const BOOTSTRAP_LOG_FILE = LOG_FILE;
export const BOOTSTRAP_LOG_DIR = LOG_DIR;
