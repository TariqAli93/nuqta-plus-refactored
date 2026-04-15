/**
 * security.js
 *
 * Central security primitives for the Electron-side update + spawn paths.
 *
 * This module is intentionally dependency-free (std lib only) so it can be
 * audited easily and will never pull in untrusted transitive code.
 *
 * Contents:
 *   - Path safety:      assertPathWithin, assertNoSymlinks, trustedRoots()
 *   - Hashing:          sha256File, sha256Directory
 *   - Executable guard: assertExecutable
 *   - Disk space:       assertDiskSpace
 *   - Update lock:      acquireUpdateLock, releaseUpdateLock
 *   - Log sanitization: sanitizeForLog
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import logger from './logger.js';

// ─── Trusted root directories ───────────────────────────────────────────────

/**
 * Directories the app is allowed to read from / write to / execute from.
 * Everything outside these roots is considered untrusted.
 *
 *   baseline   → <resources>/backend      (shipped, read-only)
 *   staging    → <userData>/backend-versions
 *   downloads  → <userData>/backend-downloads  (only trusted source for updates)
 *   logs       → <userData>/logs
 */
export function trustedRoots() {
  const resources = process.resourcesPath || '';
  const userData = app ? app.getPath('userData') : '';
  return {
    baselineBackend: resources ? path.join(resources, 'backend') : null,
    stagingRoot: userData ? path.join(userData, 'backend-versions') : null,
    downloadRoot: userData ? path.join(userData, 'backend-downloads') : null,
    logsRoot: userData ? path.join(userData, 'logs') : null,
    userData,
    resources,
  };
}

/** Create the downloads root if missing. Returns the path. */
export function ensureDownloadRoot() {
  const { downloadRoot } = trustedRoots();
  if (!downloadRoot) throw new Error('userData not available yet');
  if (!fs.existsSync(downloadRoot)) {
    fs.mkdirSync(downloadRoot, { recursive: true });
  }
  return downloadRoot;
}

// ─── Path safety ────────────────────────────────────────────────────────────

/**
 * Canonicalize a path and assert that it lives inside one of the allowed roots.
 * Resolves symlinks via realpath — protects against symlink escapes.
 *
 * Throws SecurityError on any violation.
 */
export function assertPathWithin(candidate, allowedRoots, label = 'path') {
  if (typeof candidate !== 'string' || !candidate) {
    throw new SecurityError(`${label} is not a string`);
  }

  const roots = (Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots]).filter(Boolean);
  if (roots.length === 0) {
    throw new SecurityError(`${label}: no allowed roots configured`);
  }

  // Resolve real path where possible (follows symlinks). For non-existent
  // targets (e.g. a file we're about to create) resolve the deepest existing
  // ancestor and combine — still defeats ../ traversal.
  const real = safeRealpath(candidate);
  const normReal = path.resolve(real);

  for (const root of roots) {
    const realRoot = safeRealpath(root);
    const normRoot = path.resolve(realRoot);
    // Append sep so /foo/bar-baz is not matched by /foo/bar
    const rootWithSep = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
    if (normReal === normRoot || normReal.startsWith(rootWithSep)) {
      return normReal;
    }
  }

  throw new SecurityError(
    `${label} escapes allowed roots: ${candidate} (resolved to ${normReal})`
  );
}

/**
 * Best-effort realpath that falls back to resolving ancestors when the
 * target does not exist yet. We never leak the raw input on failure.
 */
function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return path.resolve(p);
    try {
      return path.join(fs.realpathSync(parent), path.basename(p));
    } catch {
      return path.resolve(p);
    }
  }
}

/**
 * Walk a directory and fail if ANY entry is a symlink. Update bundles must
 * be pure file trees — symlinks are a classic vector for escaping a sandbox.
 */
export function assertNoSymlinks(dir, label = 'directory') {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      throw new SecurityError(`${label}: cannot read ${current}: ${err.message}`);
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SecurityError(`${label}: symlink detected at ${full}`);
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

// ─── Executable guard ───────────────────────────────────────────────────────

/**
 * Assert that a command is safe to spawn:
 *   - absolute path
 *   - exists on disk
 *   - lives inside an allowed root
 *   - is a regular file (not a symlink, not a directory)
 *
 * On Windows, we also require the `.exe` extension.
 */
export function assertExecutable(cmdPath, allowedRoots, label = 'executable') {
  if (!path.isAbsolute(cmdPath)) {
    throw new SecurityError(`${label} must be an absolute path: ${cmdPath}`);
  }
  if (process.platform === 'win32' && !/\.exe$/i.test(cmdPath)) {
    throw new SecurityError(`${label} must end in .exe on Windows: ${cmdPath}`);
  }

  const resolved = assertPathWithin(cmdPath, allowedRoots, label);

  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (err) {
    throw new SecurityError(`${label} not found: ${resolved} (${err.message})`);
  }
  if (stat.isSymbolicLink()) {
    throw new SecurityError(`${label} is a symlink: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new SecurityError(`${label} is not a regular file: ${resolved}`);
  }

  return resolved;
}

// ─── Hashing ────────────────────────────────────────────────────────────────

/** SHA-256 of a single file, returned as lowercase hex. */
export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let bytesRead;
    // eslint-disable-next-line no-cond-assign
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Deterministic directory hash. Produces:
 *   - manifest: `${sha256}  ${relPath}\n` lines sorted by relPath
 *   - rootHash: sha256 of the manifest
 *
 * Ignoring order is critical: filesystem readdir order is not stable, so
 * sorting is required for reproducible hashing across machines.
 *
 * Symlinks are rejected via assertNoSymlinks before hashing.
 */
export function sha256Directory(dir) {
  assertNoSymlinks(dir, 'hash target');

  const files = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const full = path.join(dir, rel);
    const entries = fs.readdirSync(full, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }

  files.sort();

  const lines = files.map((rel) => {
    const hex = sha256File(path.join(dir, rel));
    // Normalize path separators — hashes must match on both dev (\) and CI (/)
    const normalized = rel.split(path.sep).join('/');
    return `${hex}  ${normalized}`;
  });
  const manifest = lines.join('\n') + '\n';
  const rootHash = crypto.createHash('sha256').update(manifest).digest('hex');

  return { rootHash, manifest, fileCount: files.length };
}

// ─── Disk space ─────────────────────────────────────────────────────────────

/**
 * Require at least `requiredBytes` free on the volume hosting `dir`.
 * Best-effort: if fs.statfs is unavailable or the platform is unusual, we
 * log a warning and continue (not a hard fail — we prefer not to block
 * legitimate updates on edge-case environments).
 */
export function assertDiskSpace(dir, requiredBytes) {
  if (typeof fs.statfsSync !== 'function') {
    logger.warn(`assertDiskSpace: fs.statfsSync unavailable — skipping disk check`);
    return;
  }
  let stat;
  try {
    stat = fs.statfsSync(dir);
  } catch (err) {
    logger.warn(`assertDiskSpace: statfs failed (${err.message}) — skipping`);
    return;
  }
  const free = BigInt(stat.bavail) * BigInt(stat.bsize);
  const needed = BigInt(requiredBytes);
  if (free < needed) {
    throw new SecurityError(
      `insufficient disk space at ${dir}: ${free} bytes free, ${needed} required`
    );
  }
}

// ─── Update lock ────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

function lockFilePath() {
  return path.join(app.getPath('userData'), 'backend-update.lock');
}

function pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we can't signal it
    return err.code === 'EPERM';
  }
}

/**
 * Acquire an exclusive update lock. Throws SecurityError if another update
 * is in progress and the lock is fresh + the holder is still alive.
 * Auto-cleans stale locks (dead PID or mtime > 10 min).
 */
export function acquireUpdateLock() {
  const lockPath = lockFilePath();

  if (fs.existsSync(lockPath)) {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      /* corrupt lock — treat as stale */
    }

    const mtime = (() => {
      try {
        return fs.statSync(lockPath).mtimeMs;
      } catch {
        return 0;
      }
    })();

    const isFresh = Date.now() - mtime < LOCK_STALE_MS;
    const holderAlive = parsed && pidAlive(parsed.pid);

    if (isFresh && holderAlive) {
      throw new SecurityError(
        `another update is in progress (pid=${parsed.pid}, started=${parsed.startedAt})`
      );
    }

    logger.warn(
      `Removing stale update lock (fresh=${isFresh}, alive=${holderAlive}, pid=${parsed?.pid})`
    );
    try {
      fs.unlinkSync(lockPath);
    } catch (err) {
      throw new SecurityError(`cannot remove stale lock: ${err.message}`);
    }
  }

  const payload = { pid: process.pid, startedAt: new Date().toISOString() };
  // wx = exclusive create. If two updates race, exactly one wins.
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: 'wx' });
  } catch (err) {
    throw new SecurityError(`failed to acquire update lock: ${err.message}`);
  }
  logger.info(`Update lock acquired (pid=${process.pid})`);
  return lockPath;
}

export function releaseUpdateLock() {
  const lockPath = lockFilePath();
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      logger.info('Update lock released');
    }
  } catch (err) {
    logger.warn(`releaseUpdateLock failed: ${err.message}`);
  }
}

// ─── Log sanitization ───────────────────────────────────────────────────────

const HOME = (() => {
  try {
    return os.homedir();
  } catch {
    return '';
  }
})();

// Redact obvious secret-looking fields in structured logging payloads.
const SECRET_KEY_PATTERN = /password|secret|token|authorization|apikey|api_key|licensekey/i;

/**
 * Sanitize a value for logging:
 *   - redact home directory in strings → `~`
 *   - redact values under secret-looking keys in objects
 *   - leave primitives otherwise untouched
 */
export function sanitizeForLog(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;

  if (typeof value === 'string') {
    return HOME ? value.split(HOME).join('~') : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizeForLog(v, depth + 1);
    }
  }
  return out;
}

/** Shorthand for redacting a single path string. */
export function sanitizePath(p) {
  return typeof p === 'string' && HOME ? p.split(HOME).join('~') : p;
}

// ─── SecurityError ──────────────────────────────────────────────────────────

export class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecurityError';
  }
}
