import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getUserDataDir } from './database.js';

const REMOTE_DIR = path.join(getUserDataDir(), 'cloudflared');
const MACHINE_ID_FILE = path.join(REMOTE_DIR, 'machine-id');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached = null;

export function getOrCreateMachineId() {
  if (cached) return cached;

  if (!existsSync(REMOTE_DIR)) {
    mkdirSync(REMOTE_DIR, { recursive: true });
  }

  if (existsSync(MACHINE_ID_FILE)) {
    const raw = readFileSync(MACHINE_ID_FILE, 'utf8').trim();
    if (UUID_RE.test(raw)) {
      cached = raw;
      return cached;
    }
  }

  const id = randomUUID();
  writeFileSync(MACHINE_ID_FILE, id, { mode: 0o600 });
  cached = id;
  return cached;
}

export function getMachineIdPath() {
  return MACHINE_ID_FILE;
}
