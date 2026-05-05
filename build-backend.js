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
const SERVICE_SCRIPTS_DIST = path.join(DIST_DIR, 'service');
const SERVICE_EXE_DIST = path.join(SERVICE_SCRIPTS_DIST, `${SERVICE_NAME}.exe`);
const SERVICE_XML_DIST = path.join(SERVICE_SCRIPTS_DIST, `${SERVICE_NAME}.xml`);

// ── Migrations layout ──────────────────────────────────────────────────────
// Source layout (dev):       backend/drizzle/*.sql  +  backend/migrations/migrate-production.js
// Dist layout (production):  backend/migrations/drizzle/*.sql  +  backend/migrations/migrate-production.js
const MIGRATIONS_SRC_DRIZZLE = path.join(SOURCE_DIR, 'drizzle');
const MIGRATIONS_DIST_DIR = path.join(DIST_DIR, 'migrations');
const MIGRATIONS_DIST_DRIZZLE = path.join(MIGRATIONS_DIST_DIR, 'drizzle');
const MIGRATE_SCRIPT_DIST = path.join(MIGRATIONS_DIST_DIR, 'migrate-production.js');

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

  // Reorganise migrations into the production layout:
  //   dist-backend/migrations/migrate-production.js   (already copied by source copy)
  //   dist-backend/migrations/drizzle/<sql + meta>
  //
  // The runtime backend no longer applies migrations — tools\bootstrap.bat
  // runs migrate-production.js with the bundled Node before starting the
  // service. The packaged layout is what the script expects.
  if (!fs.existsSync(MIGRATIONS_SRC_DRIZZLE)) {
    fail(
      `Drizzle migrations not found in source: ${path.relative(ROOT, MIGRATIONS_SRC_DRIZZLE)}.\n` +
        'Run `pnpm --filter backend db:generate` and re-run the build.'
    );
  }
  const stagedDrizzle = path.join(DIST_DIR, 'drizzle');
  if (fs.existsSync(stagedDrizzle)) {
    fs.rmSync(stagedDrizzle, { recursive: true, force: true });
  }
  fs.mkdirSync(MIGRATIONS_DIST_DIR, { recursive: true });
  if (fs.existsSync(MIGRATIONS_DIST_DRIZZLE)) {
    fs.rmSync(MIGRATIONS_DIST_DRIZZLE, { recursive: true, force: true });
  }
  fs.cpSync(MIGRATIONS_SRC_DRIZZLE, MIGRATIONS_DIST_DRIZZLE, { recursive: true });

  const journalPath = path.join(MIGRATIONS_DIST_DRIZZLE, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    fail(`Drizzle journal missing after copy: ${path.relative(ROOT, journalPath)}`);
  }
  const sqlMigrations = fs
    .readdirSync(MIGRATIONS_DIST_DRIZZLE)
    .filter((f) => f.endsWith('.sql'));
  if (sqlMigrations.length === 0) {
    fail(
      `Drizzle migrations folder has no .sql files: ${path.relative(ROOT, MIGRATIONS_DIST_DRIZZLE)}`
    );
  }

  if (!fs.existsSync(MIGRATE_SCRIPT_DIST)) {
    fail(
      `migrate-production.js missing in dist-backend.\nExpected: ${path.relative(
        ROOT,
        MIGRATE_SCRIPT_DIST
      )}\nEnsure backend/migrations/migrate-production.js is committed.`
    );
  }
  log(`✓ migrations bundled (${sqlMigrations.length} SQL files + migrate-production.js)`);
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

  // Verify onnxruntime-node (optional — app works without it via rule-based fallback)
  const ortDir = path.join(DIST_DIR, 'node_modules', 'onnxruntime-node');
  if (fs.existsSync(ortDir)) {
    log('✓ onnxruntime-node installed (ONNX credit scoring enabled)');
  } else {
    warn('onnxruntime-node not found — ONNX credit scoring disabled, rule-based fallback active');
  }
}

// ── Credit-risk model artifacts ─────────────────────────────────────────
// The model + meta sidecar must ship inside the backend bundle. They are
// copied as part of copyBackendSource() (since they live under backend/models/),
// so this step is purely a guard rail — fail loudly if either is missing,
// non-empty, or has a meta.json shape that the runtime won't accept.
function verifyCreditModelArtifacts() {
  const modelPath = path.join(DIST_DIR, 'models', 'credit-score.onnx');
  const metaPath = path.join(DIST_DIR, 'models', 'credit-score.meta.json');

  // Allow opt-out only when explicitly building a no-model image (e.g. for
  // CI smoke tests). Production builds MUST have both artifacts.
  const modelRequired = process.env.CREDIT_MODEL_REQUIRED !== 'false';
  const expectedModel = path.relative(ROOT, modelPath);
  const expectedMeta = path.relative(ROOT, metaPath);

  if (!fs.existsSync(modelPath)) {
    if (!modelRequired) {
      warn(`CREDIT_MODEL_REQUIRED=false — shipping without ${expectedModel}`);
      return;
    }
    fail(
      `Missing credit scoring model files.\nRun:\npnpm run train:credit-model\nExpected:\n- ${expectedModel}\n- ${expectedMeta}`
    );
  }
  if (fs.statSync(modelPath).size === 0) {
    fail(`credit-score.onnx is empty at ${path.relative(ROOT, modelPath)} — re-train.`);
  }

  if (!fs.existsSync(metaPath)) {
    if (!modelRequired) {
      warn(`CREDIT_MODEL_REQUIRED=false — shipping without ${expectedMeta}`);
      return;
    }
    fail(
      `Missing credit scoring model files.\nRun:\npnpm run train:credit-model\nExpected:\n- ${expectedModel}\n- ${expectedMeta}`
    );
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    fail(`credit-score.meta.json is not valid JSON: ${err.message}`);
  }
  if (!meta || typeof meta !== 'object') {
    fail('credit-score.meta.json is not an object');
  }
  if (!Array.isArray(meta.featureNames) || meta.featureNames.length === 0) {
    fail('credit-score.meta.json missing required field: featureNames');
  }
  if (!meta.modelVersion) {
    fail('credit-score.meta.json missing required field: modelVersion');
  }

  log(
    `✓ credit-risk model artifacts present (version=${meta.modelVersion}, ` +
      `features=${meta.featureNames.length})`
  );
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

  if (!fs.existsSync(SERVICE_SCRIPTS_DIST)) {
    fail(
      `Service scripts directory missing in dist-backend: ${SERVICE_SCRIPTS_DIST}\n` +
        'Expected backend/service/*.bat to be copied by copyBackendSource().'
    );
  }

  // 1. Copy WinSW.exe → dist-backend/service/NuqtaPlusBackend.exe
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

  for (const required of [
    'install-service.bat',
    'uninstall-service.bat',
    'start-service.bat',
    'stop-service.bat',
  ]) {
    const abs = path.join(SERVICE_SCRIPTS_DIST, required);
    if (!fs.existsSync(abs)) fail(`Missing service script: service/${required}`);
  }
  // Remove the descriptor template — it's a build-time input only.
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
  verifyCreditModelArtifacts();
  bundleServiceHost();

  log('✅ Backend build complete — dist-backend is ready for packaging');
}

main();
