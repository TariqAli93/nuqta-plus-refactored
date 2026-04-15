// scripts/bump-version.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_PACKAGE = path.resolve('package.json');
const FRONTEND_PACKAGE = path.resolve('frontend', 'package.json');
const BACKEND_PACKAGE = path.resolve('backend', 'package.json');

/**
 * قراءة package.json ككائن
 */
async function readPackageJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * حفظ package.json مع فورمات مرتب
 */
async function writePackageJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(filePath, json, 'utf8');
}

/**
 * زيادة patch في version: x.y.z => x.y.(z+1)
 */
function bumpPatch(version) {
  if (!version) return '0.0.1';

  const parts = version.split('.');
  const major = parseInt(parts[0] || '0', 10);
  const minor = parseInt(parts[1] || '0', 10);
  const patch = parseInt(parts[2] || '0', 10);

  const nextPatch = patch + 1;
  return `${major}.${minor}.${nextPatch}`;
}

async function main() {
  // 1) اقرأ package.json في الـ root
  const rootPkg = await readPackageJson(ROOT_PACKAGE);

  const currentVersion = rootPkg.version || '0.0.0';
  const nextVersion = bumpPatch(currentVersion);

  // 2) حدث version في root
  rootPkg.version = nextVersion;
  await writePackageJson(ROOT_PACKAGE, rootPkg);

  // 3) حدث version في frontend/backend ليكون نفس الرقم
  const frontendPkg = await readPackageJson(FRONTEND_PACKAGE);
  frontendPkg.version = nextVersion;
  await writePackageJson(FRONTEND_PACKAGE, frontendPkg);

  const backendPkg = await readPackageJson(BACKEND_PACKAGE);
  backendPkg.version = nextVersion;
  await writePackageJson(BACKEND_PACKAGE, backendPkg);

  console.log(`✅ Version updated to ${nextVersion} in:`);
  console.log(`   - ${ROOT_PACKAGE}`);
  console.log(`   - ${FRONTEND_PACKAGE}`);
  console.log(`   - ${BACKEND_PACKAGE}`);
}

main().catch((err) => {
  console.error('❌ Failed to bump version:', err);
  process.exit(1);
});
