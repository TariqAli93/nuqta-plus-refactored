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
 *   3. Recursively copies dist-backend → resources/backend.
 *   4. Verifies the critical files and native binary exist.
 *
 * CommonJS (.cjs) is used so it works regardless of the nearest
 * package.json "type" setting.
 */

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_AFTER_COPY = [
  'src/server.js',
  'src/db.js',
  'package.json',
  'bin/node.exe',
  'node_modules',
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'node_modules/fastify/package.json',
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
  const distBackend = path.join(repoRoot, 'dist-backend');
  const target = path.join(appOutDir, 'resources', 'backend');

  console.log(`[afterPack] repoRoot    = ${repoRoot}`);
  console.log(`[afterPack] distBackend = ${distBackend}`);
  console.log(`[afterPack] target      = ${target}`);

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

  // Remove whatever electron-builder may have left in resources/backend
  // so we start from a clean slate.
  if (fs.existsSync(target)) {
    console.log('[afterPack] removing stale resources/backend before copy');
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  console.log('[afterPack] copying dist-backend → resources/backend ...');
  fs.cpSync(distBackend, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: false,
  });

  // Post-copy verification — fail the build if anything is missing.
  const missing = [];
  for (const rel of REQUIRED_AFTER_COPY) {
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

  console.log('[afterPack] ✅ resources/backend packaged and verified');
};
