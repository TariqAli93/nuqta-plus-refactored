/**
 * serviceController.js
 *
 * Thin, security-hardened wrapper around the Windows Service Control Manager
 * (sc.exe) and the bundled WinSW host (NuqtaPlusBackend.exe) used to manage
 * the NuqtaPlusBackend service from within the packaged Electron app.
 *
 * Responsibilities:
 *   - Resolve and validate the service binary path (must live under the
 *     trusted baseline backend root).
 *   - Provide install / uninstall / start / stop / restart / query operations.
 *   - Translate sc.exe textual output into a strict state enum.
 *   - Never accept a service name from caller input — the name is a constant
 *     (BACKEND_SERVICE_NAME) so there is zero injection surface from IPC.
 *
 * This module is **only** used in production (packaged) mode. In dev the
 * Electron app spawns Node directly via BackendManager.
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from './logger.js';
import { baselineBackendDir } from './versionManager.js';
import {
  assertExecutable,
  assertPathWithin,
  sanitizePath,
  SecurityError,
} from './security.js';
import { BACKEND_SERVICE_NAME } from '../../../packages/shared/index.js';

/**
 * Strict service-name validator. The name is a hard-coded constant, but we
 * still validate at runtime so any future refactor that introduces caller
 * input is caught immediately.
 */
function assertSafeServiceName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) {
    throw new SecurityError(`unsafe service name: ${JSON.stringify(name)}`);
  }
  return name;
}

const SAFE_SERVICE_NAME = assertSafeServiceName(BACKEND_SERVICE_NAME);

/** Path to the WinSW wrapper exe, validated against the trusted root. */
export function serviceBinaryPath() {
  const baseline = baselineBackendDir();
  const candidate = path.join(baseline, `${SAFE_SERVICE_NAME}.exe`);
  return assertExecutable(candidate, [baseline], 'serviceBinary');
}

/** Best-effort check that the service is registered with the SCM. */
export async function isServiceInstalled() {
  try {
    const { code } = await runScExe(['query', SAFE_SERVICE_NAME]);
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Service state, normalised from sc.exe textual output.
 *   'running' | 'stopped' | 'starting' | 'stopping' | 'paused' |
 *   'unknown' | 'not-installed'
 */
export async function queryServiceState() {
  const { code, stdout } = await runScExe(['query', SAFE_SERVICE_NAME]);
  if (code !== 0) {
    // SC error code 1060 = service does not exist.
    if (/1060/.test(stdout)) return 'not-installed';
    return 'unknown';
  }
  const m = /STATE\s+:\s+\d+\s+([A-Z_]+)/i.exec(stdout);
  if (!m) return 'unknown';
  switch (m[1].toUpperCase()) {
    case 'RUNNING': return 'running';
    case 'STOPPED': return 'stopped';
    case 'START_PENDING': return 'starting';
    case 'STOP_PENDING': return 'stopping';
    case 'PAUSED': return 'paused';
    default: return 'unknown';
  }
}

/**
 * One-shot diagnostics snapshot used by the startup self-heal (main.js).
 * Returns { installed, state } so the caller can distinguish a genuinely
 * MISSING service (needs an elevated repair) from a transient
 * starting/stopping window (just needs more time / a plain start).
 */
export async function getServiceDiagnostics() {
  let installed = false;
  let state = 'unknown';
  try {
    state = await queryServiceState();
    installed = state !== 'not-installed';
  } catch (err) {
    logger.warn(`[svc] getServiceDiagnostics failed: ${err.message}`);
  }
  return { installed, state };
}

/**
 * Start the service via sc.exe. Resolves once the SCM accepts the request
 * and the service has reached RUNNING (or after timeoutMs).
 */
export async function startService({ timeoutMs = 30_000 } = {}) {
  logger.info(`[svc] start ${SAFE_SERVICE_NAME}`);
  const { code, stdout } = await runScExe(['start', SAFE_SERVICE_NAME]);
  // 1056 = An instance of the service is already running.
  if (code !== 0 && !/1056/.test(stdout)) {
    throw new Error(`sc start failed (exit ${code}): ${stdout.trim()}`);
  }
  return waitForState('running', timeoutMs);
}

/**
 * Stop the service via sc.exe. Resolves when the service reports STOPPED
 * or the timeout expires.
 */
export async function stopService({ timeoutMs = 30_000 } = {}) {
  logger.info(`[svc] stop ${SAFE_SERVICE_NAME}`);
  const { code, stdout } = await runScExe(['stop', SAFE_SERVICE_NAME]);
  // 1062 = The service has not been started. 1061 = service cannot accept control messages.
  if (code !== 0 && !/1062|1061/.test(stdout)) {
    logger.warn(`[svc] stop returned exit ${code}: ${stdout.trim()}`);
  }
  return waitForState('stopped', timeoutMs);
}

export async function restartService({ timeoutMs = 30_000 } = {}) {
  await stopService({ timeoutMs });
  return startService({ timeoutMs });
}

/**
 * Install the service (registers it with the SCM via the WinSW wrapper).
 * Requires Administrator. Used by the rarely-needed in-app re-install flow;
 * the normal installation path is the NSIS installer macro.
 */
export async function installService() {
  const exe = serviceBinaryPath();
  logger.info(`[svc] install ${sanitizePath(exe)}`);
  const { code, stdout } = await runWinswExe(['install']);
  if (code !== 0) {
    throw new Error(`WinSW install failed (exit ${code}): ${stdout.trim()}`);
  }
  // Force delayed-auto on by re-issuing the SC config. Idempotent.
  await runScExe(['config', SAFE_SERVICE_NAME, 'start=', 'delayed-auto']);
}

/** Uninstall the service. Requires Administrator. */
export async function uninstallService() {
  logger.info(`[svc] uninstall ${SAFE_SERVICE_NAME}`);
  // Try to stop first — uninstall fails on a running service.
  try {
    await stopService({ timeoutMs: 15_000 });
  } catch (err) {
    logger.warn(`[svc] stop-before-uninstall failed: ${err.message}`);
  }
  const { code, stdout } = await runWinswExe(['uninstall']);
  if (code !== 0 && !/1060/.test(stdout)) {
    logger.warn(`[svc] WinSW uninstall returned exit ${code}: ${stdout.trim()}`);
    // Fall back to sc delete in case WinSW failed for any reason.
    await runScExe(['delete', SAFE_SERVICE_NAME]);
  }
}

/**
 * Self-healing repair entry point. Runs the shipped, self-elevating
 * repair-service.ps1 (which re-launches install-service.cmd via UAC and
 * propagates the real exit code). The Electron app is non-elevated, so the
 * elevation happens inside PowerShell — see backend/service/repair-service.ps1.
 *
 * Returns { ok, code, output }:
 *   ok === true  → service installed and started
 *   code === 1223 → user declined the UAC prompt (cancelled)
 *   other        → install-service.cmd failed (see its exit codes)
 *
 * Requires Administrator only transiently (the UAC prompt); the calling
 * process stays non-elevated. The repair script path is validated against the
 * trusted baseline backend root so no caller input can redirect it.
 */
export async function repairService({ timeoutMs = 180_000 } = {}) {
  const baseline = baselineBackendDir();
  const candidate = path.join(baseline, 'service', 'repair-service.ps1');
  const script = assertPathWithin(candidate, [baseline], 'repair-service.ps1');
  if (!fs.existsSync(script)) {
    throw new Error(`repair script not found: ${sanitizePath(script)}`);
  }
  const ps = powershellPath();
  logger.warn(`[svc] repairService: launching elevated repair via ${sanitizePath(script)}`);
  const { code, stdout } = await runProcess(
    ps,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { timeoutMs }
  );
  const trimmed = (stdout || '').trim();
  if (trimmed) logger.info(`[svc] repairService output: ${trimmed}`);
  logger.info(`[svc] repairService exit code=${code}`);
  return { ok: code === 0, code, output: trimmed };
}

// ─── internals ──────────────────────────────────────────────────────────────

async function waitForState(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  // Poll every 500 ms until the target state or deadline.
  while (Date.now() < deadline) {
    const state = await queryServiceState();
    if (state === target) return state;
    if (state === 'not-installed') {
      throw new Error(`service ${SAFE_SERVICE_NAME} is not installed`);
    }
    await delay(500);
  }
  const final = await queryServiceState();
  throw new Error(
    `timed out waiting for ${SAFE_SERVICE_NAME} to reach ${target} (last state: ${final})`
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the absolute path to sc.exe under %SystemRoot%\System32 and
 * validate it lives under that trusted root. Defends against PATH hijacking.
 */
function scExePath() {
  const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!sysRoot) {
    throw new SecurityError('SystemRoot env var is not set — cannot locate sc.exe');
  }
  const candidate = path.join(sysRoot, 'System32', 'sc.exe');
  // assertExecutable enforces absolute path + file + .exe extension.
  return assertExecutable(candidate, [sysRoot], 'sc.exe');
}

/**
 * Resolve the absolute path to powershell.exe under %SystemRoot% and validate
 * it lives there. Used only by repairService to launch the self-elevating
 * repair script. Defends against PATH hijacking.
 */
function powershellPath() {
  const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!sysRoot) {
    throw new SecurityError('SystemRoot env var is not set — cannot locate powershell.exe');
  }
  const candidate = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return assertExecutable(candidate, [sysRoot], 'powershell.exe');
}

function runScExe(args) {
  const exe = scExePath();
  return runProcess(exe, args);
}

function runWinswExe(args) {
  const exe = serviceBinaryPath();
  return runProcess(exe, args);
}

function runProcess(exe, args, opts = {}) {
  return new Promise((resolve) => {
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      return resolve({ code: -1, stdout: 'invalid arguments to runProcess' });
    }
    if (!fs.existsSync(exe)) {
      return resolve({ code: -1, stdout: `executable not found: ${exe}` });
    }
    let stdout = '';
    const child = execFile(
      exe,
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: opts.timeoutMs || 0 },
      (err, out, errOut) => {
        stdout = `${out || ''}${errOut || ''}`;
        if (err) {
          resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout });
        } else {
          resolve({ code: 0, stdout });
        }
      }
    );
    child.on('error', (err) => {
      resolve({ code: -1, stdout: `${stdout}\n${err.message}` });
    });
  });
}

export { SAFE_SERVICE_NAME as SERVICE_NAME };
