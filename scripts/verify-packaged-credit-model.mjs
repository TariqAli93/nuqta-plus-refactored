#!/usr/bin/env node
/**
 * scripts/verify-packaged-credit-model.mjs
 *
 * Final guardrail after electron-builder finishes. Confirms that the packaged
 * SERVER build ships the credit-risk model artifacts at the canonical
 * production location:
 *
 *   <release>/win-unpacked/resources/backend/models/credit-score.onnx
 *   <release>/win-unpacked/resources/backend/models/credit-score.meta.json
 *
 * Checks performed:
 *   - both files exist
 *   - both files are non-empty regular files
 *   - meta.json parses as JSON and is an object
 *   - meta.json has a non-empty `feature_order` array
 *   - meta.json has either `version` or `model_version`
 *
 * Exits non-zero on any failure so the build is marked broken. The runtime
 * tolerates a missing model (RULES_ONLY fallback), but a SHIPPED installer
 * that omits the model is a packaging bug — the rule-only fallback is for
 * unexpected runtime conditions, not for production releases.
 *
 * Override the search path with --release=<dir> if you build into a custom
 * output folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, v = 'true'] = a.slice(2).split('=');
    out[k] = v;
  }
  return out;
}

const args = parseArgs(process.argv);
const modelRequired = process.env.CREDIT_MODEL_REQUIRED !== 'false';

// Server build output (matches electron-builder.yml `directories.output`).
const RELEASE_DIR = args.release
  ? path.resolve(ROOT, args.release)
  : path.join(ROOT, 'release');

const PACKAGED_BACKEND = path.join(RELEASE_DIR, 'win-unpacked', 'resources', 'backend');
const MODEL_PATH = path.join(PACKAGED_BACKEND, 'models', 'credit-score.onnx');
const META_PATH = path.join(PACKAGED_BACKEND, 'models', 'credit-score.meta.json');

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error(`[verify-credit-model] ❌ ${msg}`);
}
function ok(msg) {
  console.log(`[verify-credit-model] ✓ ${msg}`);
}

function checkFile(label, abs, { mustBeNonEmpty = true } = {}) {
  if (!fs.existsSync(abs)) {
    fail(`${label} not found: ${path.relative(ROOT, abs)}`);
    return false;
  }
  let st;
  try {
    st = fs.statSync(abs);
  } catch (err) {
    fail(`${label} stat failed: ${err.message}`);
    return false;
  }
  if (!st.isFile()) {
    fail(`${label} is not a regular file: ${path.relative(ROOT, abs)}`);
    return false;
  }
  if (mustBeNonEmpty && st.size === 0) {
    fail(`${label} is empty: ${path.relative(ROOT, abs)}`);
    return false;
  }
  ok(`${label} present (${st.size} bytes): ${path.relative(ROOT, abs)}`);
  return true;
}

if (!fs.existsSync(PACKAGED_BACKEND)) {
  fail(
    `packaged backend directory not found: ${path.relative(ROOT, PACKAGED_BACKEND)}\n` +
      '  electron-builder may have skipped the Windows target, or afterPack ' +
      'failed to populate resources/backend. ' +
      'Override --release=<dir> if your output folder is non-default.'
  );
  process.exit(1);
}

const modelOk = checkFile('credit-score.onnx', MODEL_PATH, { mustBeNonEmpty: modelRequired });
const metaPresent = checkFile('credit-score.meta.json', META_PATH, { mustBeNonEmpty: modelRequired });

if (!modelRequired && (!modelOk || !metaPresent)) {
  console.warn('[verify-credit-model] ⚠ CREDIT_MODEL_REQUIRED=false; missing model artifacts allowed (runtime uses RULES_ONLY fallback)');
  process.exit(0);
}

if (metaPresent) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch (err) {
    fail(`credit-score.meta.json is not valid JSON: ${err.message}`);
    meta = null;
  }
  if (meta) {
    if (typeof meta !== 'object' || Array.isArray(meta)) {
      fail('credit-score.meta.json is not an object');
    } else {
      const featureNames = meta.featureNames ?? meta.feature_order;
      if (!Array.isArray(featureNames) || featureNames.length === 0) {
        fail('credit-score.meta.json missing required field: featureNames (non-empty array)');
      } else {
        ok(`featureNames has ${featureNames.length} entries`);
      }
      const version = meta.modelVersion ?? meta.version ?? meta.model_version;
      if (!version || typeof version !== 'string') {
        fail('credit-score.meta.json missing required field: version (or model_version)');
      } else {
        ok(`model version: ${version}`);
      }
      if (meta.trained_at) ok(`trained_at: ${meta.trained_at}`);
    }
  }
}

if (failures.length > 0) {
  console.error('');
  console.error(`[verify-credit-model] ❌ ${failures.length} check(s) failed`);
  process.exit(1);
}

console.log(`[verify-credit-model] ✅ resources/backend/models is complete`);
