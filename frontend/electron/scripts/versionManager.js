/**
 * versionManager.js
 *
 * Resolves which backend version Electron should spawn, and manages the
 * active-version pointer so updates can be applied safely and rolled back.
 *
 * Layout (production):
 *
 *   <resources>/backend/                    ← baseline, read-only, shipped
 *     bin/node.exe                            (shared Node runtime)
 *     src/server.js                           (baseline backend)
 *     package.json
 *
 *   <userData>/backend-versions/<semver>/   ← staged update(s), writable
 *     src/server.js
 *     package.json
 *     node_modules/...
 *
 *   <userData>/backend-active.json          ← pointer + history
 *     {
 *       "activeVersion": "1.0.13",
 *       "activeSource":  "userData",        // "userData" | "baseline"
 *       "previousVersion": "1.0.12",
 *       "previousSource":  "baseline",
 *       "updatedAt": "2026-04-16T00:00:00Z"
 *     }
 *
 * Resolution rules:
 *   - If a pointer exists and its active path is present on disk → use it
 *   - Else fall back to the baseline shipped in resources/backend
 *   - In dev, everything short-circuits to the repo's flat backend/ dir
 *
 * The shared Node runtime (bin/node.exe) always lives in the baseline
 * resources/backend/bin/ directory — versioned backend bundles do not ship
 * their own node runtime. This is intentional: bumping the Node ABI is a
 * frontend concern (better-sqlite3 is compiled against it) and must be
 * paired with a full-app update.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from './logger.js';
import {
  EXPECTED_BACKEND_VERSION,
  KEEP_BACKEND_VERSIONS,
} from '../../../packages/shared/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

// ── Path primitives ─────────────────────────────────────────────────────────

/** Path to the shipped, read-only baseline backend directory. */
export function baselineBackendDir() {
  if (isDev) {
    // In dev the backend lives in the repo. __dirname bundles to
    // dist-electron/main/ → three levels up = repo root.
    return path.resolve(__dirname, '../../../backend');
  }
  return path.join(process.resourcesPath, 'backend');
}

/** Path to the shared bundled Node runtime (always from baseline). */
export function bundledNodePath() {
  if (isDev) {
    return process.platform === 'win32' ? 'node.exe' : 'node';
  }
  return path.join(baselineBackendDir(), 'bin', 'node.exe');
}

/** Root directory where staged backend updates live (writable). */
export function stagingRoot() {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'backend-versions');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      logger.warn(`stagingRoot mkdir failed: ${err.message}`);
    }
  }
  return dir;
}

/** Path to a specific staged version's directory (may or may not exist). */
export function stagedVersionDir(version) {
  return path.join(stagingRoot(), version);
}

/** Path to the active-version pointer JSON file. */
export function pointerFile() {
  return path.join(app.getPath('userData'), 'backend-active.json');
}

// ── Pointer I/O ─────────────────────────────────────────────────────────────

/**
 * Read the active-version pointer, or null if it does not exist / is corrupt.
 * Corrupt pointer files are logged and treated as "no pointer" so the app
 * falls back to baseline instead of refusing to start.
 */
export function readPointer() {
  const file = pointerFile();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.activeVersion) {
      logger.warn(`Pointer file is malformed — ignoring: ${file}`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`Pointer file read failed (${err.message}) — falling back to baseline`);
    return null;
  }
}

/** Atomic-ish write: write to .tmp then rename. */
export function writePointer(pointer) {
  const file = pointerFile();
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(
    { ...pointer, updatedAt: new Date().toISOString() },
    null,
    2
  );
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, file);
  logger.info(`Backend pointer updated: active=${pointer.activeVersion} (${pointer.activeSource})`);
}

export function clearPointer() {
  const file = pointerFile();
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      logger.info('Backend pointer cleared — falling back to baseline');
    } catch (err) {
      logger.warn(`clearPointer failed: ${err.message}`);
    }
  }
}

// ── Baseline metadata ───────────────────────────────────────────────────────

/**
 * Read the baseline backend's version string from its package.json.
 * Used when no pointer is set — whatever ships with the installer wins.
 * Falls back to EXPECTED_BACKEND_VERSION if the file is unreadable.
 */
export function readBaselineVersion() {
  try {
    const pkg = path.join(baselineBackendDir(), 'package.json');
    if (!fs.existsSync(pkg)) return EXPECTED_BACKEND_VERSION;
    const { version } = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    return version || EXPECTED_BACKEND_VERSION;
  } catch (err) {
    logger.warn(`readBaselineVersion failed (${err.message}) — using expected`);
    return EXPECTED_BACKEND_VERSION;
  }
}

/** Read a staged version's reported version from its own package.json. */
export function readStagedVersion(version) {
  try {
    const pkg = path.join(stagedVersionDir(version), 'package.json');
    if (!fs.existsSync(pkg)) return null;
    const { version: v } = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    return v || null;
  } catch {
    return null;
  }
}

// ── Active-path resolution ──────────────────────────────────────────────────

/**
 * Resolve the backend directory Electron should spawn from.
 * Returns { cwd, serverScript, version, source }.
 *
 * Guarantees:
 *   - Always returns a usable path (falls back to baseline on any error)
 *   - Logs a warning if the pointer references a missing directory
 */
export function resolveActiveBackend() {
  if (isDev) {
    const dir = baselineBackendDir();
    return {
      cwd: dir,
      serverScript: path.join(dir, 'src', 'server.js'),
      version: 'dev',
      source: 'dev',
    };
  }

  const pointer = readPointer();

  if (pointer && pointer.activeSource === 'userData') {
    const dir = stagedVersionDir(pointer.activeVersion);
    const serverScript = path.join(dir, 'src', 'server.js');
    if (fs.existsSync(serverScript)) {
      return {
        cwd: dir,
        serverScript,
        version: pointer.activeVersion,
        source: 'userData',
      };
    }
    logger.warn(
      `Pointer references missing staged version ${pointer.activeVersion} — reverting to baseline`
    );
    // Pointer is stale — clear it so we don't keep tripping on it.
    clearPointer();
  }

  const dir = baselineBackendDir();
  return {
    cwd: dir,
    serverScript: path.join(dir, 'src', 'server.js'),
    version: readBaselineVersion(),
    source: 'baseline',
  };
}

// ── Discovery / cleanup ─────────────────────────────────────────────────────

/** List all versions currently present in the staging root. */
export function listStagedVersions() {
  try {
    return fs
      .readdirSync(stagingRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Remove staged versions older than the current active + previous pair.
 * Always keeps `KEEP_BACKEND_VERSIONS` (default 2) of the most recently
 * modified directories, plus whatever versions the pointer references.
 */
export function pruneOldVersions(keep = KEEP_BACKEND_VERSIONS) {
  const pointer = readPointer();
  const protectedVersions = new Set();
  if (pointer?.activeVersion && pointer.activeSource === 'userData') {
    protectedVersions.add(pointer.activeVersion);
  }
  if (pointer?.previousVersion && pointer.previousSource === 'userData') {
    protectedVersions.add(pointer.previousVersion);
  }

  const root = stagingRoot();
  let entries;
  try {
    entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const full = path.join(root, d.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        return { name: d.name, full, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return;
  }

  const kept = new Set();
  for (const entry of entries) {
    if (protectedVersions.has(entry.name)) {
      kept.add(entry.name);
      continue;
    }
    if (kept.size < keep) {
      kept.add(entry.name);
      continue;
    }
    try {
      fs.rmSync(entry.full, { recursive: true, force: true });
      logger.info(`Pruned old staged backend version: ${entry.name}`);
    } catch (err) {
      logger.warn(`Failed to prune ${entry.name}: ${err.message}`);
    }
  }
}
