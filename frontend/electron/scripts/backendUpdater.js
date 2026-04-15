/**
 * backendUpdater.js
 *
 * Safe backend update flow with automatic rollback.
 *
 * Responsibilities:
 *   - stage a new backend bundle into userData (never overwrites running version)
 *   - verify staged bundle integrity
 *   - atomic-ish pointer swap to activate
 *   - restart the backend via the existing BackendManager
 *   - validate post-restart (health + version)
 *   - roll back on ANY failure
 *
 * Non-responsibilities:
 *   - downloading archives from a server (caller passes in a local dir)
 *   - migrations (a hook is exposed; caller decides what to run)
 *   - full-app updates (handled by electron-updater in autoUpdater.js)
 *
 * Full-app updates installed by electron-updater ship a new baseline
 * inside resources/backend/ and do NOT interact with this module.
 * Standalone backend-only updates — e.g. a hot-fix delivered via an
 * internal manifest — use stageBackendUpdate + activateVersion here.
 */

import path from 'path';
import fs from 'fs';
import logger from './logger.js';
import {
  readPointer,
  writePointer,
  clearPointer,
  stagedVersionDir,
  readStagedVersion,
  stagingRoot,
  resolveActiveBackend,
  pruneOldVersions,
  baselineBackendDir,
  readBaselineVersion,
} from './versionManager.js';
import { ensureBackendRunning } from './backendChecker.js';
import {
  trustedRoots,
  ensureDownloadRoot,
  assertPathWithin,
  assertNoSymlinks,
  sha256Directory,
  assertDiskSpace,
  acquireUpdateLock,
  releaseUpdateLock,
  sanitizePath,
  SecurityError,
} from './security.js';

/** Minimum free space we require before staging a new backend bundle. */
const MIN_FREE_BYTES_FOR_STAGING = 500 * 1024 * 1024; // 500 MB

// ── Filesystem helpers ──────────────────────────────────────────────────────

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
    // symlinks intentionally skipped — backend bundles should not contain any
  }
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`removeDir(${dir}) failed: ${err.message}`);
  }
}

// ── Staging ─────────────────────────────────────────────────────────────────

/**
 * Copy a prepared backend bundle into userData/backend-versions/<version>/.
 *
 * Security checks performed:
 *   1. `version` matches a strict semver pattern (defeats `../` names)
 *   2. `sourceDir` is canonicalized and must live inside the downloads root
 *      (trusted origin — defeats arbitrary folder injection)
 *   3. `sourceDir` contains no symlinks (defeats symlink escape)
 *   4. Volume hosting the staging root has at least MIN_FREE_BYTES_FOR_STAGING
 *   5. Final staging dir is validated to sit inside stagingRoot
 *
 * Uses a `.staging` suffix + atomic rename so a crash mid-copy never leaves
 * a partially-written directory where the version manager would find it.
 *
 * @param {string} sourceDir  local directory containing the new backend bundle
 *                            (must live inside <userData>/backend-downloads)
 * @param {string} version    strict semver string the new bundle reports
 * @returns {string}          final directory path
 */
export function stageBackendUpdate(sourceDir, version) {
  if (!isStrictSemver(version)) {
    throw new SecurityError(
      `stageBackendUpdate: invalid version string: ${JSON.stringify(version)}`
    );
  }

  // Trusted origin: sourceDir MUST be under <userData>/backend-downloads.
  // This prevents a compromised renderer or IPC message from pointing the
  // updater at arbitrary directories on disk.
  const downloadRoot = ensureDownloadRoot();
  const safeSource = assertPathWithin(sourceDir, [downloadRoot], 'sourceDir');

  if (!fs.existsSync(safeSource)) {
    throw new SecurityError(`stageBackendUpdate: source not found: ${sanitizePath(safeSource)}`);
  }
  assertNoSymlinks(safeSource, 'sourceDir');

  // Disk space check before we start copying gigabytes around.
  assertDiskSpace(stagingRoot(), MIN_FREE_BYTES_FOR_STAGING);

  // Destination must sit inside stagingRoot — belt-and-braces against a
  // malformed `version` making it past isStrictSemver somehow.
  const finalDir = assertPathWithin(
    stagedVersionDir(version),
    [stagingRoot()],
    'finalDir'
  );
  const tmpDir = `${finalDir}.staging`;

  logger.info(`Staging backend update v${version} from ${sanitizePath(safeSource)}`);

  // Clean any half-written leftovers from a previous failed attempt.
  if (fs.existsSync(tmpDir)) removeDir(tmpDir);
  if (fs.existsSync(finalDir)) {
    throw new SecurityError(
      `stageBackendUpdate: version ${version} is already staged. ` +
        `Remove it first or pick a different version.`
    );
  }

  copyDirRecursive(safeSource, tmpDir);
  fs.renameSync(tmpDir, finalDir);

  logger.info(`Backend update v${version} staged at ${sanitizePath(finalDir)}`);
  return finalDir;
}

/** Strict `x.y.z` or `x.y.z-pre` — no path chars, no traversal. */
function isStrictSemver(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(v);
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Integrity-check a staged version before activating it.
 *
 * Checks:
 *   - version string is strict semver
 *   - staged dir exists and is inside stagingRoot
 *   - no symlinks anywhere in the tree
 *   - required files present (src/server.js, package.json)
 *   - package.json#version matches the expected version
 *   - if `expectedHash` is supplied, SHA-256 of the tree matches
 *
 * @param {string} version
 * @param {string} [expectedHash]  optional hex SHA-256 of the directory
 */
export function verifyStagedVersion(version, expectedHash) {
  if (!isStrictSemver(version)) {
    throw new SecurityError(`verifyStagedVersion: invalid version: ${JSON.stringify(version)}`);
  }

  const dir = assertPathWithin(
    stagedVersionDir(version),
    [stagingRoot()],
    'stagedVersionDir'
  );
  if (!fs.existsSync(dir)) {
    throw new SecurityError(`verifyStagedVersion: ${version} is not staged`);
  }

  assertNoSymlinks(dir, 'staged bundle');

  const required = [
    path.join(dir, 'src', 'server.js'),
    path.join(dir, 'package.json'),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) {
      throw new SecurityError(
        `verifyStagedVersion: missing required file ${sanitizePath(file)}`
      );
    }
  }

  const reportedVersion = readStagedVersion(version);
  if (reportedVersion !== version) {
    throw new SecurityError(
      `verifyStagedVersion: package.json reports v${reportedVersion}, expected v${version}`
    );
  }

  if (expectedHash) {
    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
      throw new SecurityError(`verifyStagedVersion: expectedHash is not a SHA-256 hex digest`);
    }
    const { rootHash, fileCount } = sha256Directory(dir);
    const match =
      rootHash.toLowerCase() === expectedHash.toLowerCase();
    if (!match) {
      throw new SecurityError(
        `verifyStagedVersion: SHA-256 mismatch for v${version} ` +
          `(expected ${expectedHash}, got ${rootHash}, ${fileCount} files)`
      );
    }
    logger.info(`Staged backend v${version} SHA-256 OK (${fileCount} files, ${rootHash})`);
  } else {
    logger.warn(
      `Staged backend v${version} accepted WITHOUT hash verification — ` +
        `caller did not supply expectedHash`
    );
  }

  logger.info(`Staged backend v${version} passed verification`);
}

// ── Activation (pointer swap) ───────────────────────────────────────────────

/**
 * Swap the active-version pointer to a staged version, preserving history
 * for rollback. Does NOT restart the backend — caller does that.
 */
export function activateVersion(version) {
  const current = readPointer();
  const activeNow = resolveActiveBackend();

  // History: whatever is running right now becomes "previous"
  const next = {
    activeVersion: version,
    activeSource: 'userData',
    previousVersion: activeNow.version,
    previousSource: activeNow.source, // 'baseline' or 'userData'
  };

  writePointer(next);
  logger.info(
    `Activated backend v${version} (previous: v${next.previousVersion} / ${next.previousSource})`
  );
  return { previous: current };
}

// ── Rollback ────────────────────────────────────────────────────────────────

/**
 * Revert to the pointer's `previousVersion`.
 * If there is no previous record, revert fully to baseline.
 * Does NOT restart the backend — caller does that.
 */
export function rollbackBackend(reason = 'unspecified') {
  const pointer = readPointer();
  logger.warn(`Rollback triggered (reason=${reason})`);

  if (!pointer) {
    logger.warn('Rollback: no pointer present — already on baseline');
    return { rolledBack: false, reason: 'no-pointer' };
  }

  const { previousVersion, previousSource, activeVersion } = pointer;

  if (!previousVersion || previousSource === 'baseline') {
    // Previous state was the shipped baseline — clearing the pointer is
    // the correct revert (resolveActiveBackend falls back to baseline).
    try {
      clearPointer();
    } catch {
      /* noop */
    }
    logger.warn(`Rolled back from v${activeVersion} to baseline`);
    return { rolledBack: true, from: activeVersion, to: 'baseline' };
  }

  // Previous was another staged userData version. Swap pointer directly.
  const next = {
    activeVersion: previousVersion,
    activeSource: previousSource,
    previousVersion: null,
    previousSource: null,
  };
  writePointer(next);
  logger.warn(`Rolled back from v${activeVersion} to v${previousVersion}`);
  return { rolledBack: true, from: activeVersion, to: previousVersion };
}

// ── Full apply + validate flow ──────────────────────────────────────────────

/**
 * Full backend update lifecycle (lock-protected):
 *   0. acquire update lock (exclusive; auto-cleans stale locks)
 *   1. stage the source bundle (if not already staged)
 *   2. verify integrity (files + version + SHA-256)
 *   3. stop the running backend cleanly
 *   4. swap the pointer
 *   5. start the new version
 *   6. validate health + version
 *   7. on failure → rollback + restart → report
 *   8. release the lock in a finally block regardless of outcome
 *
 * @param {object}   opts
 * @param {string}   opts.sourceDir     path to the new bundle (must live under
 *                                      <userData>/backend-downloads)
 * @param {string}   opts.version       strict semver of the new bundle
 * @param {string}   [opts.expectedHash]  SHA-256 hex digest of the bundle
 * @param {object}   opts.backendManager live BackendManager instance
 * @returns {{ ok, version, rolledBack?, error? }}
 */
export async function applyBackendUpdate({ sourceDir, version, expectedHash, backendManager }) {
  logger.info(`[updater] applyBackendUpdate: requested v${version}`);

  // 0 — lock
  try {
    acquireUpdateLock();
  } catch (err) {
    logger.error(err, { phase: 'acquire-lock', version });
    return { ok: false, version, rolledBack: false, error: err.message };
  }

  try {
    return await _applyBackendUpdateLocked({ sourceDir, version, expectedHash, backendManager });
  } finally {
    releaseUpdateLock();
  }
}

async function _applyBackendUpdateLocked({ sourceDir, version, expectedHash, backendManager }) {
  // 1 + 2 — stage + verify
  try {
    if (!fs.existsSync(stagedVersionDir(version))) {
      stageBackendUpdate(sourceDir, version);
    } else {
      logger.info(`[updater] v${version} already staged — skipping copy`);
    }
    verifyStagedVersion(version, expectedHash);
  } catch (err) {
    logger.error(err, { phase: 'stage-or-verify', version });
    return { ok: false, version, rolledBack: false, error: err.message };
  }

  // 3 — stop current
  logger.info('[updater] stopping current backend...');
  await backendManager.CleanupBackendProcess();
  backendManager.resetRestartPolicy();

  // 4 — swap pointer
  activateVersion(version);

  // 5 + 6 — start + validate (ensureBackendRunning handles both)
  logger.info('[updater] starting new backend and validating...');
  const result = await ensureBackendRunning(backendManager, logger);

  if (result.status === 'ready') {
    logger.info(`[updater] update to v${version} succeeded`);
    pruneOldVersions();
    return { ok: true, version };
  }

  // 7 — failure → rollback
  logger.error(`[updater] validation failed (${result.error}) — rolling back`);
  await backendManager.CleanupBackendProcess();
  backendManager.resetRestartPolicy();
  const rb = rollbackBackend('update-validation-failed');

  logger.info('[updater] restarting post-rollback...');
  const postRollback = await ensureBackendRunning(backendManager, logger);

  if (postRollback.status !== 'ready') {
    // Double failure — previous version is also broken. Permanent error.
    logger.error(
      `[updater] post-rollback validation FAILED (${postRollback.error}) — previous version unhealthy`
    );
    return {
      ok: false,
      version,
      rolledBack: true,
      error: `Update failed AND rollback validation failed: ${postRollback.error}`,
    };
  }

  logger.warn(`[updater] rolled back to ${rb.to} — system recovered`);
  return {
    ok: false,
    version,
    rolledBack: true,
    error: `Update to v${version} failed: ${result.error}. Rolled back to ${rb.to}.`,
  };
}

// ── Migration hook (stub) ───────────────────────────────────────────────────

/**
 * Hook point for future backend migrations (e.g. DB schema updates that
 * must run once after an update). Called AFTER the new backend is healthy.
 *
 * Not implemented — the backend is responsible for running migrations on
 * startup (drizzle-orm handles this already). This function exists as a
 * documented seam for future changes that need to run additional work from
 * the Electron side — e.g. copying files, moving user data, prompting for
 * consent — before the new version is considered "live".
 *
 * @param {string} version  the version being migrated to
 */
// eslint-disable-next-line no-unused-vars
export async function runPostUpdateMigrations(version) {
  // Intentionally empty. Reserved for future use.
}

// ── Convenience re-exports ──────────────────────────────────────────────────

export { resolveActiveBackend, readBaselineVersion, baselineBackendDir };
