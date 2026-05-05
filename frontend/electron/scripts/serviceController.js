/**
 * serviceController.js
 *
 * Read-only wrapper around the Windows Service Control Manager (sc.exe).
 *
 * Electron NEVER installs, starts, stops, or uninstalls the
 * NuqtaPlusBackend service from JavaScript. That responsibility belongs to:
 *   tools\bootstrap.bat                       → install + start (operator)
 *   backend\service\install-service.bat       → install
 *   backend\service\uninstall-service.bat     → uninstall
 *   backend\service\start-service.bat         → start
 *   backend\service\stop-service.bat          → stop
 *
 * This module exists only so Electron can observe service state for the
 * health probe in backendChecker.js.
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  assertExecutable,
  SecurityError,
} from './security.js';
import { BACKEND_SERVICE_NAME } from '../../../packages/shared/index.js';

function assertSafeServiceName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) {
    throw new SecurityError(`unsafe service name: ${JSON.stringify(name)}`);
  }
  return name;
}

const SAFE_SERVICE_NAME = assertSafeServiceName(BACKEND_SERVICE_NAME);

/**
 * Service state, normalised from sc.exe textual output.
 *   'running' | 'stopped' | 'starting' | 'stopping' | 'paused' |
 *   'unknown' | 'not-installed'
 */
export async function queryServiceState() {
  const { code, stdout } = await runScExe(['query', SAFE_SERVICE_NAME]);
  if (code !== 0) {
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
 * Resolve the absolute path to sc.exe under %SystemRoot%\System32 and
 * validate it lives under that trusted root. Defends against PATH hijacking.
 */
function scExePath() {
  const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!sysRoot) {
    throw new SecurityError('SystemRoot env var is not set — cannot locate sc.exe');
  }
  const candidate = path.join(sysRoot, 'System32', 'sc.exe');
  return assertExecutable(candidate, [sysRoot], 'sc.exe');
}

function runScExe(args) {
  const exe = scExePath();
  return new Promise((resolve) => {
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      return resolve({ code: -1, stdout: 'invalid arguments to runScExe' });
    }
    if (!fs.existsSync(exe)) {
      return resolve({ code: -1, stdout: `executable not found: ${exe}` });
    }
    let stdout = '';
    const child = execFile(
      exe,
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024 },
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
