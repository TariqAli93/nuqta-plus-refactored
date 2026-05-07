/**
 * envLoader.js
 *
 * Replaces the implicit `import 'dotenv/config'` side-effect with an explicit
 * multi-path loader that:
 *
 *   1. Searches a deterministic list of locations.
 *   2. Logs which path was tried and which one was loaded (or that none
 *      were found and defaults are in use).
 *   3. Never throws — a missing .env in production is normal when env vars
 *      are passed via the WinSW XML descriptor or systemd unit instead.
 *
 * Search order (first hit wins):
 *
 *   1. process.env.NUQTA_ENV_FILE                   (explicit override)
 *   2. <process.cwd()>/.env                          (dev: backend/ source)
 *   3. <backend-root>/.env                           (next to package.json)
 *   4. <backend-root>/.env.production                (shipped via build)
 *   5. %PROGRAMDATA%\NuqtaPlus\.env                  (admin override location)
 *   6. ~/.nuqtaplus/.env                             (per-user fallback)
 *
 * Returned object: { tried: [paths], loaded: <path|null> }
 *
 * Must be imported BEFORE any module that reads process.env.* at import time
 * (notably config.js).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function candidatePaths() {
  const list = [];

  if (process.env.NUQTA_ENV_FILE) list.push(process.env.NUQTA_ENV_FILE);

  const cwd = process.cwd();
  list.push(join(cwd, '.env'));

  const backendRoot = resolve(__dirname, '..', '..');
  list.push(join(backendRoot, '.env'));
  list.push(join(backendRoot, '.env.production'));

  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    list.push(join(programData, 'NuqtaPlus', '.env'));
  }

  list.push(join(os.homedir(), '.nuqtaplus', '.env'));

  // De-dupe while preserving order
  const seen = new Set();
  return list.filter((p) => {
    const k = resolve(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function loadEnv() {
  const tried = candidatePaths();
  let loaded = null;

  for (const p of tried) {
    try {
      if (!existsSync(p)) continue;
      const buf = readFileSync(p);
      const parsed = dotenv.parse(buf);
      // Only set vars that are not already set — env vars from the
      // service descriptor or shell take precedence over file values.
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
      loaded = p;
      break;
    } catch {
      // Continue to the next candidate
    }
  }

  return { tried, loaded };
}

// Run immediately on import — must complete before config.js reads env.
const __envResult = loadEnv();
export const envFilesTried = __envResult.tried;
export const envFileLoaded = __envResult.loaded;
