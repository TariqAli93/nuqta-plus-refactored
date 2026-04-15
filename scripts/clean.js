/**
 * scripts/clean.js
 *
 * Removes all build artifacts so every production build starts from a
 * known-empty state. Run from the repository root via `pnpm run clean`.
 *
 * Targets (all relative to repo root):
 *   - dist-backend           (backend artifact produced by build-backend.js)
 *   - release                (electron-builder output)
 *   - frontend/dist          (vite renderer output)
 *   - frontend/dist-electron (vite-plugin-electron main/preload output)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'dist-backend',
  'release',
  'frontend/dist',
  'frontend/dist-electron',
];

let removed = 0;
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    console.log(`[clean] 🧹 removing ${rel}`);
    fs.rmSync(abs, { recursive: true, force: true });
    removed += 1;
  } else {
    console.log(`[clean] · ${rel} (already absent)`);
  }
}

console.log(`[clean] ✅ done (${removed} path${removed === 1 ? '' : 's'} removed)`);
