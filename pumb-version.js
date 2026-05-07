// scripts/bump-version.mjs
//
// Single source-of-truth bumper for the NuqtaPlus monorepo.
//
// The app version must be identical across FIVE locations, otherwise the
// Electron version-compatibility check fails at runtime with messages like
//   "Version mismatch (exact): Electron expects v1.0.0, backend reports v1.0.7"
//
//   1. package.json#version                       (repo root)
//   2. frontend/package.json#version              (Electron app shell)
//   3. backend/package.json#version               (reported by /version endpoint)
//   4. packages/shared/package.json#version       (manifest, asserted in CI)
//   5. packages/shared/index.js EXPECTED_BACKEND_VERSION constant
//      (imported and bundled into Electron main → drives the runtime check)
//
// Until #4 and #5 were added here, bumping versions left EXPECTED_BACKEND_VERSION
// permanently stuck on its initial value, and Electron started rejecting the
// backend after every patch release.
//
// Usage:
//   node pumb-version.js               # bump patch (x.y.z → x.y.z+1)
//   node pumb-version.js 1.2.3         # set explicit version
//   node pumb-version.js --check       # exit non-zero if any of the five drift

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);

const ROOT_PACKAGE = path.join(ROOT, 'package.json');
const FRONTEND_PACKAGE = path.join(ROOT, 'frontend', 'package.json');
const BACKEND_PACKAGE = path.join(ROOT, 'backend', 'package.json');
const SHARED_PACKAGE = path.join(ROOT, 'packages', 'shared', 'package.json');
const SHARED_INDEX = path.join(ROOT, 'packages', 'shared', 'index.js');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(filePath, json, 'utf8');
}

function bumpPatch(version) {
  if (!version) return '0.0.1';
  const parts = version.split('.');
  const major = parseInt(parts[0] || '0', 10);
  const minor = parseInt(parts[1] || '0', 10);
  const patch = parseInt(parts[2] || '0', 10);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Replace the EXPECTED_BACKEND_VERSION literal in packages/shared/index.js.
 * Matches both single- and double-quoted forms, with or without a trailing
 * semicolon. Throws if the constant cannot be located so a malformed/renamed
 * shared module fails the build instead of silently going stale.
 */
async function updateExpectedBackendVersion(nextVersion) {
  const source = await fs.readFile(SHARED_INDEX, 'utf8');
  const re = /(export\s+const\s+EXPECTED_BACKEND_VERSION\s*=\s*)(['"])([^'"]*)\2/;
  const match = source.match(re);
  if (!match) {
    throw new Error(
      `EXPECTED_BACKEND_VERSION constant not found in ${path.relative(ROOT, SHARED_INDEX)}. ` +
        'The bump-version script can no longer keep Electron in sync — fix the regex or the constant.'
    );
  }
  const updated = source.replace(re, `$1$2${nextVersion}$2`);
  if (updated === source) return false;
  await fs.writeFile(SHARED_INDEX, updated, 'utf8');
  return true;
}

/**
 * Read all five version sources without modifying anything.
 * Returns { root, frontend, backend, shared, expected }.
 */
export async function readAllVersions() {
  const [root, frontend, backend, shared] = await Promise.all([
    readJson(ROOT_PACKAGE),
    readJson(FRONTEND_PACKAGE),
    readJson(BACKEND_PACKAGE),
    readJson(SHARED_PACKAGE),
  ]);
  const sharedSource = await fs.readFile(SHARED_INDEX, 'utf8');
  const expectedMatch = sharedSource.match(
    /export\s+const\s+EXPECTED_BACKEND_VERSION\s*=\s*['"]([^'"]+)['"]/
  );
  return {
    root: root.version || null,
    frontend: frontend.version || null,
    backend: backend.version || null,
    shared: shared.version || null,
    expected: expectedMatch ? expectedMatch[1] : null,
  };
}

async function bumpAll(nextVersion) {
  const rootPkg = await readJson(ROOT_PACKAGE);
  rootPkg.version = nextVersion;
  await writeJson(ROOT_PACKAGE, rootPkg);

  const frontendPkg = await readJson(FRONTEND_PACKAGE);
  frontendPkg.version = nextVersion;
  await writeJson(FRONTEND_PACKAGE, frontendPkg);

  const backendPkg = await readJson(BACKEND_PACKAGE);
  backendPkg.version = nextVersion;
  await writeJson(BACKEND_PACKAGE, backendPkg);

  const sharedPkg = await readJson(SHARED_PACKAGE);
  sharedPkg.version = nextVersion;
  await writeJson(SHARED_PACKAGE, sharedPkg);

  await updateExpectedBackendVersion(nextVersion);

  console.log(`✅ Version updated to ${nextVersion} in:`);
  console.log(`   - ${path.relative(ROOT, ROOT_PACKAGE)}`);
  console.log(`   - ${path.relative(ROOT, FRONTEND_PACKAGE)}`);
  console.log(`   - ${path.relative(ROOT, BACKEND_PACKAGE)}`);
  console.log(`   - ${path.relative(ROOT, SHARED_PACKAGE)}`);
  console.log(`   - ${path.relative(ROOT, SHARED_INDEX)} (EXPECTED_BACKEND_VERSION)`);
}

async function main() {
  const arg = process.argv[2];

  if (arg === '--check' || arg === '-c') {
    const v = await readAllVersions();
    const all = [v.root, v.frontend, v.backend, v.shared, v.expected];
    const consistent = all.every((x) => x === v.root && x !== null);
    console.log('Versions:');
    console.log(`   root              = ${v.root}`);
    console.log(`   frontend          = ${v.frontend}`);
    console.log(`   backend           = ${v.backend}`);
    console.log(`   shared (pkg.json) = ${v.shared}`);
    console.log(`   EXPECTED_BACKEND_VERSION = ${v.expected}`);
    if (!consistent) {
      console.error('❌ Versions are inconsistent.');
      process.exit(1);
    }
    console.log('✅ All five version locations are in sync.');
    return;
  }

  let nextVersion;
  if (arg && SEMVER_RE.test(arg)) {
    nextVersion = arg;
  } else if (arg) {
    console.error(`❌ Invalid version argument: ${arg}. Expected x.y.z or --check.`);
    process.exit(1);
  } else {
    const rootPkg = await readJson(ROOT_PACKAGE);
    nextVersion = bumpPatch(rootPkg.version || '0.0.0');
  }

  await bumpAll(nextVersion);
}

main().catch((err) => {
  console.error('❌ Failed to bump version:', err);
  process.exit(1);
});
