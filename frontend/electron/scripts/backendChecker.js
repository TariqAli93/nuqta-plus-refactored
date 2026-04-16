/**
 * backendChecker.js
 *
 * Backend lifecycle orchestration from Electron's perspective:
 *   1. Probe /health — already-running detection (avoid duplicate spawns)
 *   2. If port is occupied but /health fails → FOREIGN process → bail out
 *   3. Otherwise spawn via BackendManager
 *   4. Poll /health until ready or startup budget exhausted
 *   5. Verify /version matches EXPECTED_BACKEND_VERSION
 *   6. Return structured { status, version, error? }
 *
 * All network calls are bounded by HEALTH_FETCH_TIMEOUT_MS with AbortController
 * and validate response shape strictly. Malformed / partial / non-JSON bodies
 * are treated as "not healthy" — never crash, never hang.
 */

import net from 'node:net';
import { app } from 'electron';
import {
  BACKEND_HOST,
  BACKEND_PORT,
  HEALTH_ENDPOINT,
  VERSION_ENDPOINT,
  EXPECTED_BACKEND_VERSION,
  ALLOW_MINOR_COMPAT,
  HEALTH_POLL_INTERVAL_MS,
  HEALTH_POLL_MAX_RETRIES,
  HEALTH_FETCH_TIMEOUT_MS,
  PORT_PROBE_TIMEOUT_MS,
} from '../../../packages/shared/index.js';

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const isServiceMode = !isDev;

// ─── Semver compatibility ───────────────────────────────────────────────────

/** Parse a semver-ish string. Returns null on anything we can't match. */
function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

/**
 * Check whether `actual` satisfies `expected` under the current compat policy.
 *   - Default (exact):      major.minor.patch must match
 *   - ALLOW_MINOR_COMPAT:   major.minor must match, patch can drift
 *
 * Unparseable versions fall back to a literal string comparison — safer
 * than pretending compatibility we can't actually verify.
 */
export function isVersionCompatible(actual, expected = EXPECTED_BACKEND_VERSION) {
  const a = parseSemver(actual);
  const e = parseSemver(expected);
  if (!a || !e) return actual === expected;
  if (ALLOW_MINOR_COMPAT) {
    return a.major === e.major && a.minor === e.minor;
  }
  return a.major === e.major && a.minor === e.minor && a.patch === e.patch;
}

// ─── Low-level bounded fetch ────────────────────────────────────────────────

/**
 * Fetch JSON with a hard timeout and strict response-shape checks.
 * Returns { ok: true, body } or { ok: false, reason }.
 * Never throws.
 */
async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'malformed-json' };
    }
    if (body === null || typeof body !== 'object') {
      return { ok: false, reason: 'not-object' };
    }
    return { ok: true, body };
  } catch (err) {
    return {
      ok: false,
      reason: err && err.name === 'AbortError' ? 'timeout' : `fetch-error:${err?.message ?? 'unknown'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Health / version probes ────────────────────────────────────────────────

/**
 * Single health probe. Accepts legacy 'healthy' and new 'ok' status values.
 * Strict shape check: body must be an object with a string `status` field.
 */
export async function checkHealth() {
  const r = await fetchJsonWithTimeout(HEALTH_ENDPOINT, HEALTH_FETCH_TIMEOUT_MS);
  if (!r.ok) return false;
  const { status } = r.body;
  return status === 'ok' || status === 'healthy';
}

/**
 * Returns the backend version string, or null on any failure
 * (timeout, malformed response, missing field, empty string).
 */
export async function checkVersion() {
  const r = await fetchJsonWithTimeout(VERSION_ENDPOINT, HEALTH_FETCH_TIMEOUT_MS);
  if (!r.ok) return null;
  const { version } = r.body;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/**
 * Raw TCP probe: is *anything* listening on BACKEND_HOST:BACKEND_PORT?
 * Used to detect foreign processes occupying our port — cases where checkHealth
 * says "no" but the port is still taken (e.g. another unrelated service).
 */
export async function isPortOccupied(port = BACKEND_PORT, host = BACKEND_HOST) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(value);
    };

    const socket = net.connect({ port, host });
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    setTimeout(() => done(false), PORT_PROBE_TIMEOUT_MS);
  });
}

// ─── Retry + poll ───────────────────────────────────────────────────────────

/**
 * Poll /health until the backend is ready or retries are exhausted.
 * Returns true if healthy, false on timeout.
 */
export async function waitUntilHealthy(logger) {
  for (let attempt = 1; attempt <= HEALTH_POLL_MAX_RETRIES; attempt++) {
    if (await checkHealth()) {
      logger.info(`Backend healthy after ${attempt} attempt(s)`);
      return true;
    }
    if (attempt === 1 || attempt % 5 === 0) {
      logger.info(`Backend not ready (${attempt}/${HEALTH_POLL_MAX_RETRIES})`);
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

// ─── Version compatibility ──────────────────────────────────────────────────

/**
 * Verify the running backend version matches EXPECTED_BACKEND_VERSION.
 * Unknown version (endpoint unreachable) is treated as a soft warning, NOT
 * a hard failure — the health check already passed, so the backend is up.
 */
export async function verifyVersion(logger) {
  const version = await checkVersion();

  if (!version) {
    logger.warn('Could not read backend /version — skipping version check');
    return { ok: true, version: 'unknown' };
  }

  if (!isVersionCompatible(version)) {
    const policy = ALLOW_MINOR_COMPAT ? 'major.minor' : 'exact';
    const msg =
      `Version mismatch (${policy}): Electron expects v${EXPECTED_BACKEND_VERSION}, ` +
      `backend reports v${version}`;
    logger.warn(msg);
    return { ok: false, version, error: msg };
  }

  logger.info(`Backend version OK: ${version}`);
  return { ok: true, version };
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * ensureBackendRunning
 *
 * Two paths:
 *   - DEV mode: legacy spawn-and-poll. Electron owns the backend process.
 *   - SERVICE mode (production): the backend is hosted by the Windows
 *     Service NuqtaPlusBackend, started at boot by the SCM. Electron
 *     ONLY checks /health and /version. If /health fails, we ask the
 *     SCM to start the service (covers the rare case where a user
 *     manually stopped it) and re-poll. We NEVER spawn node.exe.
 *
 * @param {BackendManager} backendManager
 * @param {Logger}         logger
 * @returns {{ status: 'ready'|'error', version: string|null, error?: string }}
 */
export async function ensureBackendRunning(backendManager, logger) {
  logger.info(`Checking backend on ${BACKEND_HOST}:${BACKEND_PORT}...`);

  // (a) Already healthy — validate ownership via /version and we're done.
  if (await checkHealth()) {
    logger.info('Backend already running — verifying ownership');
    const { ok, version, error } = await verifyVersion(logger);
    if (!ok) return { status: 'error', version, error };
    if (isServiceMode) backendManager._serviceRunningCached = true;
    return { status: 'ready', version };
  }

  // (b) Port occupied but /health failed → foreign process holding our port.
  if (await isPortOccupied()) {
    const msg =
      `Port ${BACKEND_PORT} is occupied by a foreign process ` +
      `(non-nuqtaplus or incompatible). Close the conflicting app and retry.`;
    logger.error(msg);
    return { status: 'error', version: null, error: msg };
  }

  // (c) Bring the backend up.
  //     SERVICE mode → ask the SCM to start NuqtaPlusBackend.
  //     DEV mode     → spawn the child via BackendManager (legacy).
  if (isServiceMode) {
    try {
      logger.info('[svc] backend not responding — requesting SCM start');
      await backendManager.StartBackend(); // delegates to serviceController
    } catch (err) {
      const msg = `Failed to start NuqtaPlusBackend service: ${err.message}`;
      logger.error(err, { phase: 'svc-start' });
      return { status: 'error', version: null, error: msg };
    }
  } else if (!backendManager.isRunning()) {
    try {
      logger.info('Spawning backend process...');
      await backendManager.StartBackend();
    } catch (err) {
      const msg = `Failed to spawn backend: ${err.message}`;
      logger.error(err, { phase: 'spawn' });
      return { status: 'error', version: null, error: msg };
    }
  } else {
    logger.info('Backend process is running but not yet healthy — waiting...');
  }

  // (d) Wait for healthy
  if (!(await waitUntilHealthy(logger))) {
    const msg = `Backend startup timeout — /health failed after ${HEALTH_POLL_MAX_RETRIES}s`;
    logger.error(msg);
    return { status: 'error', version: null, error: msg };
  }

  // (e) Version check
  const { ok, version, error } = await verifyVersion(logger);
  if (!ok) return { status: 'error', version, error };

  if (isServiceMode) backendManager._serviceRunningCached = true;
  return { status: 'ready', version };
}
