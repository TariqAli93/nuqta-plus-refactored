/**
 * scripts/verify-packaged-backend.js
 *
 * Final guardrail after electron-builder finishes. Confirms that the
 * unpacked Windows build contains a complete backend tree under
 * resources/backend. If the afterPack hook was skipped or the build
 * output was tampered with, this script fails the build.
 *
 * Runs against:
 *   release/win-unpacked/resources/backend
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PACKAGED_BACKEND = path.join(
  ROOT,
  'release',
  'win-unpacked',
  'resources',
  'backend'
);

const REQUIRED = [
  'src/server.js',
  'src/db.js',
  'package.json',
  'bin/node.exe',
  'node_modules',
  'node_modules/pg/package.json',
  'node_modules/fastify/package.json',
  'node_modules/drizzle-orm/package.json',
];

function fail(msg) {
  console.error(`[verify-packaged-backend] ❌ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(PACKAGED_BACKEND)) {
  fail(
    `packaged backend directory not found: ${path.relative(ROOT, PACKAGED_BACKEND)}\n` +
      'electron-builder may have skipped the Windows target, or the ' +
      'afterPack hook failed to produce resources/backend.'
  );
}

const missing = [];
for (const rel of REQUIRED) {
  const abs = path.join(PACKAGED_BACKEND, rel);
  if (!fs.existsSync(abs)) {
    missing.push(rel);
  } else {
    console.log(`[verify-packaged-backend] ✓ resources/backend/${rel}`);
  }
}

if (missing.length > 0) {
  fail(
    'packaged backend is incomplete. Missing:\n  - ' +
      missing.map((m) => `resources/backend/${m}`).join('\n  - ')
  );
}

console.log('[verify-packaged-backend] ✅ release/win-unpacked/resources/backend is complete');
