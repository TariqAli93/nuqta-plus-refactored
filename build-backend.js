/**
 * build-backend.js
 *
 * Builds a self-contained backend artifact in ./dist-backend that will later
 * be copied verbatim into the packaged Electron app at:
 *   <app>/resources/backend
 *
 * Pipeline:
 *   1. Clean ./dist-backend
 *   2. Copy ./backend sources (excluding node_modules)
 *   3. Install production dependencies via npm
 *   4. Bundle Windows Service host (WinSW)
 *
 * The `pg` driver is pure JavaScript — no native rebuild step is needed.
 *
 * On any failure this script exits with a non-zero code so the electron
 * packaging step is never reached with a broken backend.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, 'backend');
const DIST_DIR = path.join(ROOT, 'dist-backend');
const IS_WIN = process.platform === 'win32';

// ── Windows Service host (WinSW) ───────────────────────────────────────────
const SERVICE_NAME = 'NuqtaPlusBackend';
const WINSW_SOURCE = path.join(ROOT, 'tools', 'winsw', 'WinSW-x64.exe');
const SERVICE_TEMPLATE_DIR = path.join(SOURCE_DIR, 'service');
const SERVICE_XML_TEMPLATE = path.join(SERVICE_TEMPLATE_DIR, `${SERVICE_NAME}.xml.tmpl`);
const SERVICE_EXE_DIST = path.join(DIST_DIR, `${SERVICE_NAME}.exe`);
const SERVICE_XML_DIST = path.join(DIST_DIR, `${SERVICE_NAME}.xml`);
const SERVICE_SCRIPTS_DIST = path.join(DIST_DIR, 'service');

const REQUIRED_SOURCE_FILES = [
  'src/server.js',
  'src/db.js',
  'package.json',
];

const log = (msg) => console.log(`[build-backend] ${msg}`);
const warn = (msg) => console.warn(`[build-backend] ⚠ ${msg}`);
const fail = (msg) => {
  console.error(`[build-backend] ❌ ${msg}`);
  process.exit(1);
};

function cleanDist() {
  if (fs.existsSync(DIST_DIR)) {
    log('Cleaning dist-backend...');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

function copyBackendSource() {
  log('Copying backend source → dist-backend (excluding node_modules)...');
  if (!fs.existsSync(SOURCE_DIR)) {
    fail(`Backend source directory not found: ${SOURCE_DIR}`);
  }

  fs.cpSync(SOURCE_DIR, DIST_DIR, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const rel = path.relative(SOURCE_DIR, src).split(path.sep);
      if (rel[0] === 'node_modules') return false;
      if (rel.length === 1 && rel[0] === 'package-lock.json') return false;
      if (rel.length === 1 && rel[0] === 'pnpm-lock.yaml') return false;
      if (rel.length === 1 && rel[0].startsWith('.env')) return false;
      return true;
    },
  });

  for (const rel of REQUIRED_SOURCE_FILES) {
    const abs = path.join(DIST_DIR, rel);
    if (!fs.existsSync(abs)) fail(`Source copy missing required file: ${rel}`);
  }
}

function installProductionDeps() {
  log('Installing production dependencies inside dist-backend...');
  execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
    cwd: DIST_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (!fs.existsSync(path.join(DIST_DIR, 'node_modules'))) {
    fail('npm install completed but dist-backend/node_modules is missing');
  }

  // Verify pg driver is present
  const pgDir = path.join(DIST_DIR, 'node_modules', 'pg');
  if (!fs.existsSync(pgDir)) {
    fail('pg module not found in dist-backend/node_modules — check backend/package.json dependencies');
  }
  log('✓ pg driver installed');
}

function bundleServiceHost() {
  log('Bundling Windows Service host (WinSW)...');

  if (!fs.existsSync(WINSW_SOURCE)) {
    fail(
      `WinSW binary missing: ${WINSW_SOURCE}\n` +
        'Run `pnpm fetch:winsw` to download and verify it, then re-run this build.\n' +
        'See scripts/fetch-winsw.js for the pinned version and supply-chain checks.'
    );
  }

  if (!fs.existsSync(SERVICE_XML_TEMPLATE)) {
    fail(
      `Service descriptor template missing: ${SERVICE_XML_TEMPLATE}\n` +
        'Expected backend/service/NuqtaPlusBackend.xml.tmpl to be committed.'
    );
  }

  // 1. Copy WinSW.exe → dist-backend/NuqtaPlusBackend.exe
  fs.copyFileSync(WINSW_SOURCE, SERVICE_EXE_DIST);
  log(`✓ ${path.relative(ROOT, SERVICE_EXE_DIST)}`);

  // 2. Render the XML descriptor with the backend version baked in.
  const backendPkg = JSON.parse(
    fs.readFileSync(path.join(DIST_DIR, 'package.json'), 'utf8')
  );
  const tmpl = fs.readFileSync(SERVICE_XML_TEMPLATE, 'utf8');
  const rendered = tmpl.replace(/\$\{BACKEND_VERSION\}/g, backendPkg.version || '0.0.0');
  fs.writeFileSync(SERVICE_XML_DIST, rendered, 'utf8');
  log(`✓ ${path.relative(ROOT, SERVICE_XML_DIST)} (v${backendPkg.version})`);

  // 3. Sanity check the service scripts directory.
  if (!fs.existsSync(SERVICE_SCRIPTS_DIST)) {
    fail(
      `Service scripts directory missing in dist-backend: ${SERVICE_SCRIPTS_DIST}\n` +
        'Expected backend/service/*.cmd to be copied by copyBackendSource().'
    );
  }
  for (const required of [
    'install-service.cmd',
    'uninstall-service.cmd',
    'start-service.cmd',
    'stop-service.cmd',
    'restart-service.cmd',
    'status-service.cmd',
  ]) {
    const abs = path.join(SERVICE_SCRIPTS_DIST, required);
    if (!fs.existsSync(abs)) fail(`Missing service script: service/${required}`);
  }
  // Remove template — not needed at runtime.
  const distTmpl = path.join(SERVICE_SCRIPTS_DIST, `${SERVICE_NAME}.xml.tmpl`);
  if (fs.existsSync(distTmpl)) fs.rmSync(distTmpl, { force: true });

  log('✓ service host bundled');
}

function main() {
  log(`Platform: ${process.platform}`);
  log(`Source:   ${SOURCE_DIR}`);
  log(`Dist:     ${DIST_DIR}`);

  cleanDist();
  copyBackendSource();
  installProductionDeps();
  bundleServiceHost();

  log('✅ Backend build complete — dist-backend is ready for packaging');
}

main();
