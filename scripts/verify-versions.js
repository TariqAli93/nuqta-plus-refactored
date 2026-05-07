/**
 * scripts/verify-versions.js
 *
 * Build-time guard against version drift.
 *
 * The Electron version-compatibility check (frontend/electron/scripts/backendChecker.js)
 * compares the running backend's reported version against EXPECTED_BACKEND_VERSION,
 * imported from packages/shared/index.js. If any of the five canonical sources
 * fall out of sync, packaged installers crash on launch with:
 *   "Version mismatch (exact): Electron expects vA, backend reports vB"
 *
 * This script is the gate that prevents that mismatch from ever shipping.
 *
 * Sources checked (must all be identical):
 *   1. package.json#version                        (repo root)
 *   2. frontend/package.json#version
 *   3. backend/package.json#version
 *   4. packages/shared/package.json#version
 *   5. packages/shared/index.js EXPECTED_BACKEND_VERSION
 *
 * Optional cross-checks (only when the artifact exists):
 *   6. dist-backend/package.json#version           (after build:backend)
 *   7. release/win-unpacked/resources/backend/package.json#version (after package)
 *
 * Exit code 0 → all consistent; non-zero → drift, with a diff printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

function readJsonVersion(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { rel, version: null, exists: false };
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { rel, version: json.version || null, exists: true };
  } catch (err) {
    return { rel, version: null, exists: true, error: err.message };
  }
}

function readExpectedBackendVersion() {
  const rel = 'packages/shared/index.js';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    return { rel, version: null, exists: false };
  }
  const source = fs.readFileSync(abs, 'utf8');
  const m = source.match(
    /export\s+const\s+EXPECTED_BACKEND_VERSION\s*=\s*['"]([^'"]+)['"]/
  );
  if (!m) {
    return {
      rel,
      version: null,
      exists: true,
      error:
        'EXPECTED_BACKEND_VERSION constant not found — the bump pipeline can no longer keep ' +
        'Electron and backend in sync. Restore the export or update verify-versions.js.',
    };
  }
  return { rel: `${rel} (EXPECTED_BACKEND_VERSION)`, version: m[1], exists: true };
}

function fail(msg) {
  console.error(`[verify-versions] ❌ ${msg}`);
  process.exit(1);
}

const required = [
  readJsonVersion('package.json'),
  readJsonVersion('frontend/package.json'),
  readJsonVersion('backend/package.json'),
  readJsonVersion('packages/shared/package.json'),
  readExpectedBackendVersion(),
];

// These only exist after build/package — verify them when present, ignore otherwise.
const optional = [
  readJsonVersion('dist-backend/package.json'),
  readJsonVersion('release/win-unpacked/resources/backend/package.json'),
].filter((e) => e.exists);

const failures = required.filter((e) => e.error);
for (const f of failures) {
  console.error(`[verify-versions] ❌ ${f.rel}: ${f.error}`);
}
if (failures.length > 0) process.exit(1);

const missing = required.filter((e) => !e.version);
if (missing.length > 0) {
  for (const m of missing) {
    console.error(`[verify-versions] ❌ ${m.rel}: missing/empty version field`);
  }
  process.exit(1);
}

const truth = required[0].version; // root package.json
const all = [...required, ...optional];

let ok = true;
console.log('[verify-versions] expected version (from root package.json):', truth);
for (const entry of all) {
  const sym = entry.version === truth ? '✓' : '✗';
  console.log(`[verify-versions] ${sym} ${entry.rel}: ${entry.version}`);
  if (entry.version !== truth) ok = false;
}

if (!ok) {
  fail(
    'Version drift detected — the Electron app will refuse to start with this build.\n' +
      '   Fix: run `pnpm run bump-version <x.y.z>` (or `node pumb-version.js`) to sync all five locations,\n' +
      '   then re-run `pnpm run clean` and `pnpm run build:server`.'
  );
}

console.log('[verify-versions] ✅ all version locations are consistent');
