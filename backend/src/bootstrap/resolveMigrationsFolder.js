import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isValidMigrationsDir(dir) {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) return false;
    if (!fs.statSync(dir).isDirectory()) return false;
    const journal = path.join(dir, 'meta', '_journal.json');
    return fs.existsSync(journal);
  } catch {
    return false;
  }
}

/**
 * Resolve the Drizzle migrations folder across dev, packaged, and service
 * runtimes. Returns the first candidate that exists and contains a valid
 * `meta/_journal.json`. Returns null if none match — callers should treat
 * that as a fatal packaging bug.
 *
 * Search order:
 *   1. <db.js>/../../drizzle                     (dev + dist-backend layout)
 *   2. process.resourcesPath/backend/drizzle     (Electron afterPack target)
 *   3. process.resourcesPath/resources/backend/drizzle (legacy nesting)
 *   4. <process.execPath dir>/drizzle            (WinSW %BASE%/drizzle)
 *   5. process.cwd()/drizzle                     (last resort)
 */
export function resolveMigrationsFolder({ envOverride } = {}) {
  const tried = [];
  const candidates = [];

  if (envOverride) candidates.push(envOverride);
  if (process.env.MIGRATIONS_FOLDER) candidates.push(process.env.MIGRATIONS_FOLDER);

  // db.js sits at <root>/src/db.js → migrations at <root>/drizzle.
  // This file sits at <root>/src/bootstrap/resolveMigrationsFolder.js, so
  // walk up two levels.
  candidates.push(path.resolve(__dirname, '..', '..', 'drizzle'));

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'backend', 'drizzle'));
    candidates.push(path.join(process.resourcesPath, 'resources', 'backend', 'drizzle'));
  }

  if (process.execPath) {
    // node.exe at the backend root (rare): <root>/node.exe
    candidates.push(path.join(path.dirname(process.execPath), 'drizzle'));
    // Bundled node at <root>/bin/node.exe — used by the WinSW service host.
    candidates.push(
      path.join(path.dirname(process.execPath), '..', 'drizzle')
    );
  }

  candidates.push(path.resolve(process.cwd(), 'drizzle'));
  // Service host may set cwd one level up from the backend root.
  candidates.push(path.resolve(process.cwd(), 'backend', 'drizzle'));

  for (const c of candidates) {
    if (!c) continue;
    const abs = path.resolve(c);
    tried.push(abs);
    if (isValidMigrationsDir(abs)) {
      return { folder: abs, tried };
    }
  }

  return { folder: null, tried };
}
