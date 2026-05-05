import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function inspectCandidate(p) {
  const record = {
    path: p,
    exists: false,
    isDirectory: false,
    hasJournal: false,
    sqlFileCount: 0,
    sqlFiles: [],
    valid: false,
    error: null,
  };

  try {
    if (!p || !fs.existsSync(p)) return record;

    record.exists = true;

    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return record;

    record.isDirectory = true;

    const journal = path.join(p, 'meta', '_journal.json');
    record.hasJournal = fs.existsSync(journal);

    const entries = fs.readdirSync(p).filter((f) => f.toLowerCase().endsWith('.sql'));

    record.sqlFileCount = entries.length;
    record.sqlFiles = entries.slice(0, 5);

    record.valid = record.hasJournal && record.sqlFileCount > 0;
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
  }

  return record;
}

function hasDuplicateBackendSegment(p) {
  const parts = path
    .normalize(p)
    .toLowerCase()
    .split(/[\\/]+/);

  return parts.some((part, index) => part === 'backend' && parts[index + 1] === 'backend');
}

export function resolveMigrationsFolder({ envOverride } = {}) {
  const candidatePaths = [];
  const seen = new Set();

  const push = (p) => {
    if (!p) return;

    const abs = path.resolve(p);

    if (hasDuplicateBackendSegment(abs)) return;
    if (seen.has(abs)) return;

    seen.add(abs);
    candidatePaths.push(abs);
  };

  push(envOverride);
  push(process.env.MIGRATIONS_FOLDER);

  // Dev / compiled backend layouts
  push(path.resolve(__dirname, '..', '..', 'drizzle'));
  push(path.resolve(__dirname, '..', 'drizzle'));

  // Electron packaged resources
  if (process.resourcesPath) {
    push(path.join(process.resourcesPath, 'backend', 'drizzle'));
    push(path.join(process.resourcesPath, 'resources', 'backend', 'drizzle'));
  }

  // Service / executable-relative layouts
  if (process.execPath) {
    const execDir = path.dirname(process.execPath);
    push(path.join(execDir, 'drizzle'));
    push(path.join(execDir, '..', 'drizzle'));
  }

  // CWD layouts
  const cwd = process.cwd();
  push(path.resolve(cwd, 'drizzle'));

  if (path.basename(cwd).toLowerCase() !== 'backend') {
    push(path.resolve(cwd, 'backend', 'drizzle'));
  }

  const candidates = candidatePaths.map(inspectCandidate);
  const winner = candidates.find((c) => c.valid) || null;

  return {
    folder: winner ? winner.path : null,
    candidates,
  };
}
