import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getUserDataDir } from '../utils/database.js';
import { getOrCreateMachineId } from '../utils/machineId.js';
import { resolveCloudflaredPath } from '../utils/cloudflaredPath.js';

const MANAGEMENT_API_URL = process.env.MANAGEMENT_API_URL || 'https://manage.codelapps.com';
const LOCAL_SERVICE_URL = process.env.LOCAL_SERVICE_URL || 'http://localhost:41732';
const API_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 3_000;

const REMOTE_DIR = path.join(getUserDataDir(), 'cloudflared');
const CREDENTIALS_FILE = path.join(REMOTE_DIR, 'credentials.json');
const CONFIG_FILE = path.join(REMOTE_DIR, 'config.yml');
const STATE_FILE = path.join(REMOTE_DIR, 'state.json');

const MISSING_BINARY_MSG_AR =
  'cloudflared.exe غير موجود. يرجى إعادة تثبيت البرنامج أو تضمين الملف.';

// Module-level singletons. Backend is a single process, so this is safe.
let cloudflaredProc = null;
let enableInFlight = null;
let logger = console;

function setLogger(log) {
  if (log && typeof log.info === 'function') logger = log;
}

function ensureRemoteDir() {
  if (!existsSync(REMOTE_DIR)) mkdirSync(REMOTE_DIR, { recursive: true });
}

function readState() {
  if (!existsSync(STATE_FILE)) return { enabled: false };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { enabled: false };
  }
}

function writeState(state) {
  ensureRemoteDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function toYamlSafePath(p) {
  // cloudflared on Windows accepts forward slashes (Go's filepath.Clean normalizes
  // them). Forward slashes are also safer in unquoted YAML scalars.
  return p.split(path.sep).join('/');
}

function buildConfigYaml({ tunnelId, hostname, credentialsFile }) {
  return [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${toYamlSafePath(credentialsFile)}`,
    '',
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: ${LOCAL_SERVICE_URL}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const msg = parsed?.error || parsed?.message || `${res.status} ${res.statusText}`;
    const err = new Error(`management API ${url} failed: ${msg}`);
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed;
}

function isProcessAlive(proc) {
  if (!proc || proc.pid == null) return false;
  if (proc.exitCode !== null && proc.exitCode !== undefined) return false;
  return true;
}

function startCloudflared(binaryPath) {
  if (isProcessAlive(cloudflaredProc)) {
    logger.info('[remote-access] cloudflared already running, skipping spawn');
    return cloudflaredProc;
  }

  const proc = spawn(binaryPath, ['tunnel', '--config', CONFIG_FILE, 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  });

  proc.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) logger.info(`[cloudflared] ${line}`);
  });
  proc.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    // cloudflared writes informational logs to stderr; treat as info.
    if (line) logger.info(`[cloudflared] ${line}`);
  });
  proc.on('exit', (code, signal) => {
    logger.info(`[remote-access] cloudflared exited code=${code} signal=${signal}`);
    if (cloudflaredProc === proc) cloudflaredProc = null;
  });
  proc.on('error', (err) => {
    logger.error(`[remote-access] cloudflared spawn error: ${err.message}`);
    if (cloudflaredProc === proc) cloudflaredProc = null;
  });

  cloudflaredProc = proc;
  logger.info(`[remote-access] cloudflared spawned pid=${proc.pid}`);
  return proc;
}

async function stopCloudflared() {
  const proc = cloudflaredProc;
  if (!isProcessAlive(proc)) {
    cloudflaredProc = null;
    return;
  }

  const closed = new Promise((resolve) => {
    const onClose = () => resolve();
    proc.once('exit', onClose);
    proc.once('close', onClose);
  });

  try {
    if (process.platform === 'win32') {
      // /T = kill tree, /F = force. Insurance against any helper processes.
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (err) {
    logger.warn(`[remote-access] kill signal failed: ${err.message}`);
  }

  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
  ]);

  if (isProcessAlive(proc)) {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }

  cloudflaredProc = null;
  logger.info('[remote-access] cloudflared stopped');
}

function buildPublicUrl(subdomain) {
  if (!subdomain) return '';
  if (subdomain.startsWith('http://') || subdomain.startsWith('https://')) return subdomain;
  return `https://${subdomain}`;
}

export async function getStatus() {
  const state = readState();
  const machineId = getOrCreateMachineId();
  // Quiet on getStatus — polled frequently. Verbose logging only on enable.
  const cloudflared = resolveCloudflaredPath();
  return {
    enabled: state.enabled === true,
    running: isProcessAlive(cloudflaredProc),
    subdomain: state.subdomain || '',
    publicUrl: state.publicUrl || buildPublicUrl(state.subdomain),
    tunnelId: state.tunnel_id || '',
    machineId,
    configExists: existsSync(CONFIG_FILE) && existsSync(CREDENTIALS_FILE),
    cloudflaredAvailable: cloudflared.status === 'found',
  };
}

function buildMissingBinaryError(resolution) {
  const lines = (resolution.checked || resolution.candidates || []).map((c) => {
    if (typeof c === 'string') return `  - ${c}`;
    return `  - ${c.path}${c.valid ? ' (FOUND)' : c.note ? ` (${c.note})` : ''}`;
  });
  const message = lines.length
    ? `${MISSING_BINARY_MSG_AR}\nتم فحص المسارات التالية:\n${lines.join('\n')}`
    : MISSING_BINARY_MSG_AR;
  const err = new Error(message);
  err.code = 'CLOUDFLARED_MISSING';
  err.candidates = resolution.candidates;
  err.checked = resolution.checked;
  return err;
}

async function enableInternal() {
  // Verbose log on enable — helps diagnose "cloudflared not found" reports.
  const cloudflared = resolveCloudflaredPath({ log: logger });
  if (cloudflared.status !== 'found') {
    throw buildMissingBinaryError(cloudflared);
  }

  const machineId = getOrCreateMachineId();
  logger.info(`[remote-access] calling management API to enable tunnel (machine=${machineId})`);
  const response = await postJson(`${MANAGEMENT_API_URL}/api/tunnel/enable`, {
    machine_id: machineId,
    local_service_url: LOCAL_SERVICE_URL,
  });

  if (!response || response.enabled !== true) {
    throw new Error('Management API did not return enabled=true');
  }

  const { subdomain, tunnel_id, credentials, config } = response;
  if (!credentials || !tunnel_id) {
    throw new Error('Management API response missing credentials or tunnel_id');
  }

  ensureRemoteDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });

  const hostname = config?.ingress?.[0]?.hostname || subdomain;
  const yaml = buildConfigYaml({
    tunnelId: tunnel_id,
    hostname,
    credentialsFile: CREDENTIALS_FILE,
  });
  writeFileSync(CONFIG_FILE, yaml, { mode: 0o600 });

  const state = {
    enabled: true,
    subdomain,
    tunnel_id,
    machine_id: machineId,
    publicUrl: buildPublicUrl(subdomain),
    updatedAt: new Date().toISOString(),
  };
  writeState(state);

  startCloudflared(cloudflared.path);

  return getStatus();
}

export async function enable() {
  if (enableInFlight) return enableInFlight;
  enableInFlight = (async () => {
    try {
      return await enableInternal();
    } finally {
      enableInFlight = null;
    }
  })();
  return enableInFlight;
}

export async function disable() {
  await stopCloudflared();

  const machineId = getOrCreateMachineId();
  let warning = null;
  try {
    await postJson(`${MANAGEMENT_API_URL}/api/tunnel/disable`, {
      machine_id: machineId,
    });
  } catch (err) {
    warning = 'remote_api_disable_failed';
    logger.warn(`[remote-access] disable API call failed: ${err.message}`);
  }

  const prev = readState();
  writeState({
    ...prev,
    enabled: false,
    updatedAt: new Date().toISOString(),
  });

  const status = await getStatus();
  if (warning) status.warning = warning;
  return status;
}

export async function resumeIfPreviouslyEnabled({ log } = {}) {
  if (log) setLogger(log);

  const state = readState();
  if (state.enabled !== true) {
    logger.info('[remote-access] auto-resume: state.enabled is false, nothing to do');
    return { resumed: false, reason: 'not_enabled' };
  }
  if (!existsSync(CONFIG_FILE) || !existsSync(CREDENTIALS_FILE)) {
    logger.warn('[remote-access] auto-resume: config or credentials missing, skipping');
    return { resumed: false, reason: 'config_missing' };
  }
  const cloudflared = resolveCloudflaredPath({ log: logger });
  if (cloudflared.status !== 'found') {
    logger.warn('[remote-access] auto-resume: cloudflared binary not found, skipping');
    return { resumed: false, reason: 'binary_missing' };
  }

  startCloudflared(cloudflared.path);
  logger.info('[remote-access] auto-resume: spawned cloudflared');
  return { resumed: true };
}

export async function shutdown() {
  await stopCloudflared();
}

export const __private = {
  buildConfigYaml,
  toYamlSafePath,
  MISSING_BINARY_MSG_AR,
};
