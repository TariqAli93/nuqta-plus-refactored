/**
 * scripts/afterPack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Purpose:
 *   Guarantee that the packaged application contains a complete, verified
 *   backend tree at:
 *       <appOutDir>/resources/backend
 *
 * Why a hook instead of `extraResources`?
 *   extraResources copying of a sibling directory that contains a large
 *   `node_modules` tree has historically been flaky in electron-builder
 *   (filter interactions, symlink handling, cross-project `from: "../..."`
 *   paths). We want a deterministic copy that we can audit ourselves, so
 *   we take full responsibility for placing the backend into the packaged
 *   output here, after electron-builder has laid down the base files.
 *
 * This hook:
 *   1. Requires ../dist-backend to already exist and be fully populated
 *      (build-backend.js runs before electron-builder).
 *   2. Removes any stale resources/backend that might have been created
 *      by extraResources or a previous run.
 *   3. Recursively copies dist-backend -> resources/backend.
 *   4. Verifies the critical runtime files exist (server entry, pg driver,
 *      Drizzle migrations, WinSW service host, etc.).
 *
 * The backend uses PostgreSQL via the pure-JS `pg` driver — no native
 * binaries need to be rebuilt or verified.
 *
 * CommonJS (.cjs) is used so it works regardless of the nearest
 * package.json "type" setting.
 */

const fs = require('node:fs');
const path = require('node:path');

// ── Files that MUST exist after copy for the backend to run ──────────────
const REQUIRED_AFTER_COPY = [
  // Core server
  'src/server.js',
  'src/db.js',
  'package.json',

  // Bundled Node.js runtime
  'bin/node.exe',

  // Production dependencies
  'node_modules',
  'node_modules/pg/package.json',
  'node_modules/drizzle-orm/package.json',
  'node_modules/fastify/package.json',

  // Drizzle migration files
  'drizzle',

  // ── Credit-risk model artifacts ───────────────────────────────────────
  // Both must ship — the runtime falls back to RULES_ONLY if either is
  // missing, but a server installer that omits them is a packaging bug.
  'models/credit-score.onnx',
  'models/credit-score.meta.json',
  'node_modules/onnxruntime-node/package.json',

  // ── Windows Service host (WinSW) ──────────────────────────────────────
  'NuqtaPlusBackend.exe',
  'NuqtaPlusBackend.xml',
  'service/install-service.cmd',
  'service/uninstall-service.cmd',
  'service/start-service.cmd',
  'service/stop-service.cmd',
  'service/restart-service.cmd',
  'service/status-service.cmd',
  'service/verify-version.ps1',
  'service/free-port.ps1',
  'service/stop-wait.ps1',
  'service/repair-service.ps1',
];

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  // Only repackage backend for the Windows build (the primary target).
  // If you ever add mac/linux targets, mirror the logic here.
  if (electronPlatformName !== 'win32') {
    console.log(
      `[afterPack] skipping backend copy for platform=${electronPlatformName}`
    );
    return;
  }

  // packager.projectDir === <repo>/frontend (electron-builder runs in frontend/)
  const repoRoot = path.resolve(packager.projectDir, '..');
  const modelRequired = process.env.CREDIT_MODEL_REQUIRED !== 'false';
  const distBackend = path.join(repoRoot, 'dist-backend');
  const target = path.join(appOutDir, 'resources', 'backend');

  console.log(`[afterPack] repoRoot    = ${repoRoot}`);
  console.log(`[afterPack] distBackend = ${distBackend}`);
  console.log(`[afterPack] target      = ${target}`);

  // ── Pre-flight: dist-backend must already be built ─────────────────────
  if (!fs.existsSync(distBackend)) {
    throw new Error(
      `[afterPack] dist-backend does not exist at ${distBackend}. ` +
        'Run `node build-backend.js` (or `pnpm run build:backend`) before packaging.'
    );
  }

  const distNodeModules = path.join(distBackend, 'node_modules');
  if (!fs.existsSync(distNodeModules)) {
    throw new Error(
      `[afterPack] dist-backend/node_modules is missing. ` +
        'build-backend.js did not complete successfully.'
    );
  }

  // Quick sanity check: pg driver must be present (PostgreSQL is the sole DB)
  const pgDir = path.join(distBackend, 'node_modules', 'pg');
  if (!fs.existsSync(pgDir)) {
    throw new Error(
      `[afterPack] pg driver not found in dist-backend/node_modules. ` +
        'The backend requires PostgreSQL — ensure "pg" is in backend/package.json dependencies.'
    );
  }

  // ── Copy dist-backend -> resources/backend ─────────────────────────────
  // Remove whatever electron-builder may have left in resources/backend
  // so we start from a clean slate.
  if (fs.existsSync(target)) {
    console.log('[afterPack] removing stale resources/backend before copy');
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  console.log('[afterPack] copying dist-backend -> resources/backend ...');
  fs.cpSync(distBackend, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: false,
  });

  // ── Post-copy verification ─────────────────────────────────────────────
  // Fail the build if anything required for PostgreSQL-based runtime is missing.
  const requiredAfterCopy = modelRequired
    ? REQUIRED_AFTER_COPY
    : REQUIRED_AFTER_COPY.filter(
        (p) => p !== 'models/credit-score.onnx' && p !== 'models/credit-score.meta.json'
      );
  const missing = [];
  for (const rel of requiredAfterCopy) {
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[afterPack] packaged backend is incomplete. Missing:\n  - ` +
        missing.map((m) => `resources/backend/${m}`).join('\n  - ')
    );
  }

  // ── Verify NuqtaPlusBackend.xml carries DB connection env vars ────────
  // Without these, the backend silently falls back to in-code defaults and
  // produces opaque "database_not_ready" responses on customer machines.
  const xmlPath = path.join(target, 'NuqtaPlusBackend.xml');
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const requiredEnvNames = [
    'PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
    'JWT_SECRET', 'NUQTA_LOG_DIR',
  ];
  const missingEnv = requiredEnvNames.filter(
    (n) => !new RegExp(`<env\\s+name="${n}"`).test(xmlContent)
  );
  if (missingEnv.length > 0) {
    throw new Error(
      `[afterPack] NuqtaPlusBackend.xml is missing required <env> entries:\n  - ` +
        missingEnv.join('\n  - ') +
        `\nUpdate backend/service/NuqtaPlusBackend.xml.tmpl and rebuild.`
    );
  }
  console.log(
    `[afterPack] ✓ NuqtaPlusBackend.xml carries all required env vars (${requiredEnvNames.join(', ')})`
  );

  // ── Verify .env.production.example was emitted by build-backend.js ────
  const envExample = path.join(target, '.env.production.example');
  if (!fs.existsSync(envExample)) {
    throw new Error(
      `[afterPack] missing resources/backend/.env.production.example — ` +
        `build-backend.js did not emit the env template. Re-run the backend build.`
    );
  }
  console.log('[afterPack] ✓ .env.production.example present');

  // ── Final cross-check: packaged backend version must equal Electron's ──
  // EXPECTED_BACKEND_VERSION. This catches the case where build-backend.js
  // copied a stale package.json or where verify:versions was bypassed.
  // Without this, customers see runtime errors like:
  //   "Version mismatch (exact): Electron expects vA, backend reports vB"
  try {
    const packagedPkg = JSON.parse(
      fs.readFileSync(path.join(target, 'package.json'), 'utf8')
    );
    const sharedSrc = fs.readFileSync(
      path.join(repoRoot, 'packages', 'shared', 'index.js'),
      'utf8'
    );
    const m = sharedSrc.match(
      /export\s+const\s+EXPECTED_BACKEND_VERSION\s*=\s*['"]([^'"]+)['"]/
    );
    const expected = m ? m[1] : null;
    if (!expected) {
      throw new Error(
        'EXPECTED_BACKEND_VERSION constant not found in packages/shared/index.js'
      );
    }
    if (packagedPkg.version !== expected) {
      throw new Error(
        `packaged backend reports v${packagedPkg.version} but Electron expects ` +
          `v${expected}. Run \`pnpm run bump-version <x.y.z>\` to sync all five ` +
          `version locations, then \`pnpm run clean && pnpm run build:server\`.`
      );
    }
    console.log(
      `[afterPack] ✓ packaged backend version matches EXPECTED_BACKEND_VERSION (${expected})`
    );
  } catch (err) {
    throw new Error(`[afterPack] version cross-check failed: ${err.message}`);
  }

  // Informational: ONNX runtime (optional — runtime gracefully degrades
  // to RULES_ONLY if missing).
  const ortPackaged = fs.existsSync(path.join(target, 'node_modules', 'onnxruntime-node'));
  console.log(
    `[afterPack] ONNX runtime: ${ortPackaged ? '✓ present' : '– not present (rule-based fallback)'}`
  );
  if (!modelRequired) {
    console.warn('[afterPack] CREDIT_MODEL_REQUIRED=false — packaged runtime will use rule-based fallback if model is absent');
    return;
  }

  // Cross-check the meta sidecar shape so a stale or corrupt file fails the
  // build right here, not at customer install time.
  try {
    const metaAbs = path.join(target, 'models', 'credit-score.meta.json');
    const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
    const featureNames = meta.featureNames ?? meta.feature_order;
    if (!Array.isArray(featureNames) || !featureNames.length) {
      throw new Error('featureNames missing or empty');
    }
    if (!meta.modelVersion && !meta.version) {
      throw new Error('modelVersion missing');
    }
    console.log(
      `[afterPack] credit-score model: ✓ version=${meta.modelVersion ?? meta.version} ` +
        `features=${featureNames.length}`
    );
  } catch (err) {
    throw new Error(
      `[afterPack] credit-score.meta.json failed validation: ${err.message}`
    );
  }

  console.log('[afterPack] backend packaged and verified (PostgreSQL runtime)');
};
