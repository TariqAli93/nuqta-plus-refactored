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
 *   4. Rebuild better-sqlite3 (prebuild if available, else from source)
 *   5. Verify dist-backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node
 *   6. Verify better-sqlite3 actually loads under the bundled backend Node runtime
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
const BUNDLED_NODE = path.join(DIST_DIR, 'bin', IS_WIN ? 'node.exe' : 'node');

const BETTER_SQLITE_NATIVE = path.join(
  DIST_DIR,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

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
      // Normalise path separators so Windows and POSIX behave the same.
      const rel = path.relative(SOURCE_DIR, src).split(path.sep);
      // Exclude the source backend's node_modules entirely — we install
      // a fresh production tree inside dist-backend below.
      if (rel[0] === 'node_modules') return false;
      // Exclude any lock files that might pollute the install.
      if (rel.length === 1 && rel[0] === 'package-lock.json') return false;
      if (rel.length === 1 && rel[0] === 'pnpm-lock.yaml') return false;
      // Exclude local envs.
      if (rel.length === 1 && rel[0].startsWith('.env')) return false;
      return true;
    },
  });

  // Sanity check the copy.
  for (const rel of REQUIRED_SOURCE_FILES) {
    const abs = path.join(DIST_DIR, rel);
    if (!fs.existsSync(abs)) fail(`Source copy missing required file: ${rel}`);
  }
}

function installProductionDeps() {
  log('Installing production dependencies inside dist-backend...');
  // We deliberately use npm (not pnpm) to get a flat, self-contained
  // node_modules tree with no workspace / symlink tricks — electron-builder
  // and the bundled Node runtime both need a plain tree.
  execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
    cwd: DIST_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (!fs.existsSync(path.join(DIST_DIR, 'node_modules'))) {
    fail('npm install completed but dist-backend/node_modules is missing');
  }
}

function getBundledNodeVersion() {
  if (!fs.existsSync(BUNDLED_NODE)) return null;
  try {
    const out = execSync(`"${BUNDLED_NODE}" -p "process.version"`, {
      encoding: 'utf8',
    }).trim();
    // "v24.8.0" -> "24.8.0"
    return out.replace(/^v/, '');
  } catch {
    return null;
  }
}

function findPrebuildInstallBin() {
  // better-sqlite3 depends on prebuild-install. Depending on how npm hoists,
  // it lives either at the top of dist-backend/node_modules or nested inside
  // better-sqlite3/node_modules. Try both.
  const candidates = [
    path.join(DIST_DIR, 'node_modules', 'prebuild-install', 'bin.js'),
    path.join(
      DIST_DIR,
      'node_modules',
      'better-sqlite3',
      'node_modules',
      'prebuild-install',
      'bin.js'
    ),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function rebuildBetterSqlite() {
  const systemVersion = process.version.replace(/^v/, '');
  const targetVersion = getBundledNodeVersion();

  log(`System Node:  v${systemVersion}`);
  if (targetVersion) log(`Bundled Node: v${targetVersion}`);

  // No bundled runtime reachable (e.g. running on Linux): just rebuild
  // against the system Node so CI smoke tests still pass. The Windows
  // build must then be produced on a Windows box where backend/bin/node.exe
  // is present, and this function will take the branch below instead.
  if (!targetVersion) {
    log('Bundled Node runtime not available; running plain npm rebuild better-sqlite3');
    try {
      execSync('npm rebuild better-sqlite3', { cwd: DIST_DIR, stdio: 'inherit' });
    } catch (err) {
      warn(`Prebuild rebuild failed (${err.message}); falling back to --build-from-source`);
      execSync('npm rebuild better-sqlite3 --build-from-source', {
        cwd: DIST_DIR,
        stdio: 'inherit',
      });
    }
    return;
  }

  // Always rebuild against the bundled Node ABI — we do not care about the
  // system Node ABI, because the .node file will only ever be loaded by
  // backend/bin/node.exe at runtime.
  const betterSqliteDir = path.join(DIST_DIR, 'node_modules', 'better-sqlite3');

  // Strategy 1: download a precompiled prebuild for the target Node version.
  // This is the fast, no-build-tools path and works whenever better-sqlite3
  // publishes a prebuild for win32/x64 at that Node major.
  const prebuildInstallBin = findPrebuildInstallBin();
  if (prebuildInstallBin) {
    log(
      `Downloading better-sqlite3 prebuild for Node v${targetVersion} (win32/x64)...`
    );
    try {
      // Delete the stale .node file first so a failed download cannot leave
      // the wrong-ABI binary in place.
      if (fs.existsSync(BETTER_SQLITE_NATIVE)) {
        fs.rmSync(BETTER_SQLITE_NATIVE, { force: true });
      }
      execSync(
        `node "${prebuildInstallBin}" --runtime=node --target=${targetVersion} --arch=x64 --platform=win32 --verbose`,
        {
          cwd: betterSqliteDir,
          stdio: 'inherit',
        }
      );
      if (fs.existsSync(BETTER_SQLITE_NATIVE)) {
        log(`prebuild-install succeeded for Node v${targetVersion}`);
        return;
      }
      warn('prebuild-install exited cleanly but produced no .node file; falling back');
    } catch (err) {
      warn(
        `prebuild-install for target ${targetVersion} failed (${err.message}); falling back to build-from-source`
      );
    }
  } else {
    warn('prebuild-install binary not found inside dist-backend; falling back to build-from-source');
  }

  // Strategy 2: compile from source against the bundled Node's headers.
  // This needs Python + VS Build Tools on Windows. node-gyp will fetch the
  // correct Node headers automatically based on --target.
  log(
    `Compiling better-sqlite3 from source against Node v${targetVersion} headers...`
  );
  execSync('npm rebuild better-sqlite3 --build-from-source', {
    cwd: DIST_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_runtime: 'node',
      npm_config_target: targetVersion,
      npm_config_target_arch: 'x64',
      npm_config_target_platform: 'win32',
      npm_config_build_from_source: 'true',
    },
  });
}

function verifyNativeBinary() {
  if (!fs.existsSync(BETTER_SQLITE_NATIVE)) {
    fail(
      `Native binary missing: ${path.relative(ROOT, BETTER_SQLITE_NATIVE)}\n` +
        'better-sqlite3 did not produce a compiled .node file. ' +
        'Check that build tools (python, VS Build Tools on Windows) are installed.'
    );
  }
  log(`✓ native binary present: ${path.relative(ROOT, BETTER_SQLITE_NATIVE)}`);
}

function verifyLoadUnderBundledNode() {
  if (!fs.existsSync(BUNDLED_NODE)) {
    if (IS_WIN) {
      // On Windows the bundled runtime is mandatory — fail hard. fail()
      // calls process.exit(1), but we return afterwards anyway so the
      // control flow is explicit and survives any future refactor of fail().
      fail(
        `Bundled Node runtime missing: ${BUNDLED_NODE}\n` +
          'Make sure backend/bin/node.exe is committed to the source tree.'
      );
      return;
    }
    warn(
      `Bundled Node runtime not present on this platform (${process.platform}); ` +
        'skipping runtime load test. The Windows build must still be verified on Windows.'
    );
    return;
  }

  log('Verifying better-sqlite3 loads under the bundled backend Node...');
  try {
    // Run from dist-backend so node resolves ./node_modules/better-sqlite3.
    execSync(
      `"${BUNDLED_NODE}" -e "const d=require('better-sqlite3');const db=new d(':memory:');db.prepare('SELECT 1').get();db.close();console.log('[build-backend] better-sqlite3 loaded OK under bundled node')"`,
      {
        cwd: DIST_DIR,
        stdio: 'inherit',
      }
    );
  } catch (err) {
    fail(
      'better-sqlite3 failed to load under the bundled backend Node runtime. ' +
        'This is almost always an ABI mismatch: the version of node.exe in ' +
        'backend/bin/ does not match the Node major used to compile ' +
        'better-sqlite3. Rebuild better-sqlite3 against the bundled node, or ' +
        'replace backend/bin/node.exe with a matching major version.'
    );
  }
}

function main() {
  log(`Platform: ${process.platform}`);
  log(`Source:   ${SOURCE_DIR}`);
  log(`Dist:     ${DIST_DIR}`);

  cleanDist();
  copyBackendSource();
  installProductionDeps();
  rebuildBetterSqlite();
  verifyNativeBinary();
  verifyLoadUnderBundledNode();

  log('✅ Backend build complete — dist-backend is ready for packaging');
}

main();
