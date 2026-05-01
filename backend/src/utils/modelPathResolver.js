/**
 * Resolve model artifact paths across every runtime layout the backend
 * is shipped in.
 *
 * Layouts (in priority order):
 *
 *   1. Explicit env override
 *        ONNX_MODEL_PATH       → credit-score.onnx
 *        ONNX_MODEL_META_PATH  → credit-score.meta.json
 *
 *   2. Packaged Electron app
 *        <process.resourcesPath>/backend/models/credit-score.onnx
 *        <process.resourcesPath>/backend/models/credit-score.meta.json
 *
 *   3. Windows Service mode (the bundled backend started by WinSW)
 *        Process cwd is wherever the service was registered. We anchor on
 *        __dirname so symlinks / unusual cwd values do not break path
 *        resolution. The backend tree is laid out as:
 *
 *          resources/backend/
 *            src/utils/modelPathResolver.js  ← we live here
 *            models/credit-score.onnx
 *            models/credit-score.meta.json
 *
 *        So `<__dirname>/../../models/<file>` is the canonical location.
 *
 *   4. Local dev / source checkout
 *        backend/src/utils/modelPathResolver.js → backend/models/<file>
 *        — same shape as #3, since the dist tree mirrors the source layout.
 *
 *   5. Last-resort fallbacks
 *        process.cwd()/models/<file>
 *        process.cwd()/backend/models/<file>
 *
 * NEVER trust process.cwd() alone. WinSW may launch the backend from
 * C:\Windows\System32 depending on installation method; cwd is unreliable.
 * The resolver tries the structurally-anchored paths first and falls back
 * to cwd-derived paths only as a last resort, with a warning.
 *
 * Each resolver returns:
 *   {
 *     path:    absolute path that was tried/selected
 *     status:  'found' | 'missing' | 'invalid'
 *     reason?: human-readable message when not found / invalid
 *     candidates: every path that was probed, in order
 *   }
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// File names — kept here so callers don't hardcode them.
export const MODEL_FILENAME = 'credit-score.onnx';
export const META_FILENAME = 'credit-score.meta.json';

const log = (msg) => console.log(`[modelPath] ${msg}`);
const warn = (msg) => console.warn(`[modelPath] ${msg}`);

function isPackagedElectron() {
  // process.resourcesPath is set by Electron in both dev and prod, but in dev
  // it points at Electron's own framework resources, not our app. We treat it
  // as "packaged" only when it looks like an installed app — i.e. the
  // resources/backend directory exists relative to it.
  if (!process.resourcesPath || typeof process.resourcesPath !== 'string') {
    return false;
  }
  return existsSync(join(process.resourcesPath, 'backend'));
}

/** Normalize a candidate to absolute & deduplicate. */
function pushIf(arr, p) {
  if (!p) return;
  const abs = isAbsolute(p) ? p : resolvePath(p);
  if (!arr.includes(abs)) arr.push(abs);
}

/**
 * Build the ordered list of candidate paths for `filename`. The env override
 * (when present) is treated as EXCLUSIVE — if the operator pointed us at a
 * specific file we don't silently fall back, since "model not where I told
 * you" is a configuration error, not a hint.
 *
 * @param {string}   filename            'credit-score.onnx' | 'credit-score.meta.json'
 * @param {string?}  envOverride         path from an env var, if any
 * @returns {string[]}
 */
function buildCandidates(filename, envOverride) {
  if (envOverride) {
    return [isAbsolute(envOverride) ? envOverride : resolvePath(envOverride)];
  }

  const candidates = [];

  // 1. Packaged Electron — resources/backend/models/<filename>
  if (process.resourcesPath) {
    pushIf(candidates, join(process.resourcesPath, 'backend', 'models', filename));
  }

  // 2 & 3. Source-tree-anchored — works for both `dist-backend/...` and
  // `backend/src/utils/...` because the layout is identical.
  pushIf(candidates, join(__dirname, '..', '..', 'models', filename));

  // 4. Last resort — cwd-based. Used only if all anchored paths failed.
  pushIf(candidates, join(process.cwd(), 'models', filename));
  pushIf(candidates, join(process.cwd(), 'backend', 'models', filename));

  return candidates;
}

/**
 * Pick the first candidate that exists and is a non-empty regular file.
 *
 * @param {string[]} candidates
 * @returns {{path:string|null, status:'found'|'missing'|'invalid', reason?:string}}
 */
function pickExisting(candidates) {
  let invalidReason = null;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      if (!st.isFile()) {
        invalidReason = `not a file: ${p}`;
        continue;
      }
      if (st.size === 0) {
        invalidReason = `empty file: ${p}`;
        continue;
      }
      return { path: p, status: 'found' };
    } catch (err) {
      invalidReason = `stat failed for ${p}: ${err.message}`;
    }
  }
  if (invalidReason) {
    return { path: null, status: 'invalid', reason: invalidReason };
  }
  return {
    path: null,
    status: 'missing',
    reason: 'no candidate path exists on disk',
  };
}

/**
 * Resolve the ONNX model file. Always returns an object — never throws.
 */
export function resolveOnnxModelPath() {
  const candidates = buildCandidates(MODEL_FILENAME, process.env.ONNX_MODEL_PATH);
  const picked = pickExisting(candidates);

  if (picked.status === 'found') {
    log(
      `ONNX model resolved: ${picked.path} ` +
        `(${isPackagedElectron() ? 'packaged' : 'source/dev'})`
    );
  } else {
    warn(`ONNX model ${picked.status}: ${picked.reason}`);
    warn('  candidates tried:');
    for (const c of candidates) warn(`    - ${c}`);
  }

  return { ...picked, candidates };
}

/**
 * Resolve the meta sidecar JSON. Returns the parsed object alongside the
 * file path when valid, or status='invalid' with a parse-error reason.
 */
export function resolveModelMetaPath() {
  const candidates = buildCandidates(META_FILENAME, process.env.ONNX_MODEL_META_PATH);
  const picked = pickExisting(candidates);

  if (picked.status !== 'found') {
    warn(`Meta JSON ${picked.status}: ${picked.reason}`);
    warn('  candidates tried:');
    for (const c of candidates) warn(`    - ${c}`);
    return { ...picked, candidates, meta: null };
  }

  // File exists — try to parse and shape-check it.
  let raw;
  try {
    raw = readFileSync(picked.path, 'utf8');
  } catch (err) {
    return {
      path: picked.path,
      status: 'invalid',
      reason: `read failed: ${err.message}`,
      candidates,
      meta: null,
    };
  }

  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (err) {
    return {
      path: picked.path,
      status: 'invalid',
      reason: `JSON parse failed: ${err.message}`,
      candidates,
      meta: null,
    };
  }

  if (!meta || typeof meta !== 'object') {
    return {
      path: picked.path,
      status: 'invalid',
      reason: 'meta JSON is not an object',
      candidates,
      meta: null,
    };
  }

  log(`Meta JSON resolved: ${picked.path} (version=${meta.version ?? 'unknown'})`);
  return { path: picked.path, status: 'found', candidates, meta };
}

/**
 * Convenience: resolve both at once and report a combined status. Useful for
 * callers that want a single up-or-down check at startup.
 *
 * @param {string[]} expectedFeatureOrder  the runtime FEATURE_ORDER —
 *        when supplied, the meta's `feature_order` must match exactly
 *        for the result to be marked `found`.
 */
export function resolveCreditModelArtifacts(expectedFeatureOrder = null) {
  const model = resolveOnnxModelPath();
  const meta = resolveModelMetaPath();

  // Cross-validate feature order if the caller asked for it.
  if (
    Array.isArray(expectedFeatureOrder) &&
    meta.status === 'found' &&
    (Array.isArray(meta.meta?.featureNames) || Array.isArray(meta.meta?.feature_order))
  ) {
    const a = expectedFeatureOrder.join(',');
    const b = (meta.meta.featureNames ?? meta.meta.feature_order).join(',');
    if (a !== b) {
      meta.status = 'invalid';
      meta.reason = `feature_order mismatch (expected [${a}], got [${b}])`;
      warn(meta.reason);
    }
  }

  let combined;
  if (model.status === 'found' && meta.status === 'found') combined = 'found';
  else if (model.status === 'invalid' || meta.status === 'invalid') combined = 'invalid';
  else combined = 'missing';

  return {
    status: combined,
    model,
    meta,
    packaged: isPackagedElectron(),
  };
}
