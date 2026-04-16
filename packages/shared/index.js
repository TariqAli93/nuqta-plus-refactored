/**
 * @nuqtaplus/shared
 *
 * Canonical constants shared between:
 *   - backend/src/config.js       (reads BACKEND_PORT for default)
 *   - frontend/electron/scripts/  (imported directly — bundled by Rollup)
 *   - frontend/src/plugins/axios  (port mirrored inline; keep in sync manually)
 *
 * Backend and Electron use ES module imports via relative paths.
 * Vue/Vite frontend mirrors the port in axios.js to avoid Vite root-boundary issues.
 */

export const BACKEND_PORT = 41731;
export const BACKEND_HOST = '127.0.0.1';
export const BACKEND_BASE_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
export const BACKEND_API_BASE_URL = `${BACKEND_BASE_URL}/api`;

/**
 * Windows Service identity for the production backend.
 * Must match service/NuqtaPlusBackend.xml#id and the NSIS installer macro.
 * Strict identifier — never derived from user input or filesystem state.
 */
export const BACKEND_SERVICE_NAME = 'NuqtaPlusBackend';

export const HEALTH_ENDPOINT = `${BACKEND_BASE_URL}/health`;
export const VERSION_ENDPOINT = `${BACKEND_BASE_URL}/version`;

/**
 * Must match backend/package.json#version.
 * Electron will refuse to start if the running backend reports a different version.
 */
export const EXPECTED_BACKEND_VERSION = '1.0.12';

/**
 * Version compatibility policy.
 *   false → exact match required (default, safest)
 *   true  → same major.minor is accepted regardless of patch
 *
 * Major-version bumps always require a frontend update — the front-end
 * ships its expected backend contract and must be rebuilt on breaking changes.
 */
export const ALLOW_MINOR_COMPAT = false;

/** Keep only the N most recent staged backend versions in userData. */
export const KEEP_BACKEND_VERSIONS = 2;

/** Per-request health/version fetch timeout. Tight by design — backend
 *  responses are trivial JSON, so anything >2 s indicates trouble. */
export const HEALTH_FETCH_TIMEOUT_MS = 2000;

/** Startup health-poll config. 30 retries × 1 s = 30 s total startup budget. */
export const HEALTH_POLL_INTERVAL_MS = 1000;
export const HEALTH_POLL_MAX_RETRIES = 30;
export const BACKEND_STARTUP_TIMEOUT_MS = HEALTH_POLL_INTERVAL_MS * HEALTH_POLL_MAX_RETRIES;

/** Crash-restart policy. Bounded — never restart in an infinite loop.
 *  - MAX_ATTEMPTS: how many restarts inside one RESTART_WINDOW before giving up
 *  - COOLDOWN_MS:  delay between a crash and the next spawn attempt
 *  - WINDOW_MS:    attempt counter resets after this quiet period */
export const BACKEND_RESTART_MAX_ATTEMPTS = 3;
export const BACKEND_RESTART_COOLDOWN_MS = 2000;
export const BACKEND_RESTART_WINDOW_MS = 60_000;

/** SIGTERM grace period before SIGKILL during graceful shutdown. */
export const BACKEND_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

/** TCP probe timeout for foreign-process port detection. */
export const PORT_PROBE_TIMEOUT_MS = 500;
