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

  // Bundled Node.js runtime — used by both the service and migrate-production.js
  'bin/node.exe',

  // Production dependencies
  'node_modules',
  'node_modules/pg/package.json',
  'node_modules/drizzle-orm/package.json',
  'node_modules/fastify/package.json',

  // Migration artifacts — applied by tools\bootstrap.bat, NOT by the runtime
  'migrations/migrate-production.js',
  'migrations/drizzle',
  'migrations/drizzle/meta/_journal.json',

  // ── Credit-risk model artifacts ───────────────────────────────────────
  // Both must ship — the runtime falls back to RULES_ONLY if either is
  // missing, but a server installer that omits them is a packaging bug.
  'models/credit-score.onnx',
  'models/credit-score.meta.json',
  'node_modules/onnxruntime-node/package.json',

  // ── Windows Service host (WinSW) ──────────────────────────────────────
  'service/NuqtaPlusBackend.exe',
  'service/NuqtaPlusBackend.xml',
  'service/install-service.bat',
  'service/uninstall-service.bat',
  'service/start-service.bat',
  'service/stop-service.bat',
];

// tools/ scripts live next to resources/ in the install root, not under
// resources/backend. They're verified separately below.
const REQUIRED_TOOLS = [
  'bootstrap.bat',
  'check-service.bat',
  'check-database.bat',
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

  // ── Migrations sanity log ─────────────────────────────────────────────
  // Migrations are applied by tools\bootstrap.bat using migrate-production.js
  // BEFORE the service starts. The runtime backend never reads this folder.
  const migrationsDst = path.join(target, 'migrations', 'drizzle');
  const journalDst = path.join(migrationsDst, 'meta', '_journal.json');
  if (!fs.existsSync(migrationsDst) || !fs.existsSync(journalDst)) {
    throw new Error(
      `[afterPack] migrations missing after copy. Expected ${journalDst}. ` +
        'build-backend.js must populate dist-backend/migrations/drizzle before packaging.'
    );
  }
  const sqlCount = fs
    .readdirSync(migrationsDst)
    .filter((f) => f.toLowerCase().endsWith('.sql')).length;
  console.log(`[afterPack] migrations verified (${sqlCount} .sql files, _journal.json present)`);

  // ── tools\ — bootstrap and diagnostic scripts ─────────────────────────
  // electron-builder's `extraFiles` (configured in electron-builder.yml)
  // is the source of truth for placing tools\*.bat into <appOutDir>\tools.
  // Here we only:
  //   1. Strip any stale resources\tools directory left by a previous build
  //      (tools must NEVER live under resources\ — they are operator-facing
  //      scripts that must be reachable from the install root).
  //   2. Strictly verify the install-root tools tree is complete. Missing
  //      bootstrap.bat fails the build immediately.
  const staleResourcesTools = path.join(target, '..', 'tools');
  // target == <appOutDir>\resources\backend → its parent is <appOutDir>\resources
  const wrongResourcesTools = path.join(appOutDir, 'resources', 'tools');
  if (fs.existsSync(wrongResourcesTools)) {
    console.log(
      `[afterPack] removing stale resources/tools left by a previous build: ${wrongResourcesTools}`
    );
    fs.rmSync(wrongResourcesTools, { recursive: true, force: true });
  }
  void staleResourcesTools; // documented; resources\backend\tools is never created

  const toolsDst = path.join(appOutDir, 'tools');
  if (!fs.existsSync(toolsDst)) {
    throw new Error(
      `[afterPack] tools directory missing at ${toolsDst}. ` +
        'Check the `extraFiles` entry in frontend/electron-builder.yml.'
    );
  }
  const missingTools = [];
  for (const rel of REQUIRED_TOOLS) {
    const abs = path.join(toolsDst, rel);
    if (!fs.existsSync(abs)) missingTools.push(rel);
  }
  if (missingTools.length > 0) {
    throw new Error(
      `[afterPack] packaged tools tree is incomplete. Missing:\n  - ` +
        missingTools.map((m) => `tools/${m}`).join('\n  - ') +
        '\nCheck the `extraFiles` entry in frontend/electron-builder.yml ' +
        'and ensure tools/*.bat are committed in the repo.'
    );
  }
  console.log(
    `[afterPack] tools verified at ${toolsDst} (${REQUIRED_TOOLS.length} scripts present)`
  );

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
