/**
 * ONNX-based credit scoring inference service.
 *
 * Loads a pre-trained ONNX model for local CPU inference via onnxruntime-node.
 * No remote service, no Python — runs entirely inside the Node.js backend.
 *
 * ── Model contract ───────────────────────────────────────────────────────
 *   Input:  Float32 tensor [1, 6] — normalized customer behavior features
 *   Output: one of:
 *     • [1, 1] with value in [0, 1]   → risk probability
 *     • [1, 1] with value in (1, 100] → direct credit score
 *     • [1, 2]                        → [safe_prob, risk_prob]
 *
 * ── Feature order (must match training pipeline) ─────────────────────────
 *   0: totalSalesOnInstallment
 *   1: totalPaidOnTime
 *   2: totalLatePayments
 *   3: avgDelayDays
 *   4: currentOutstandingDebt
 *   5: activeInstallmentsCount
 *
 * ── Model file placement ─────────────────────────────────────────────────
 *   Development:  backend/models/credit-score.onnx
 *   Production:   resources/backend/models/credit-score.onnx
 *   Override:     ONNX_MODEL_PATH env var
 *
 * To replace the model later, drop a new .onnx file in the same path and
 * restart the backend. No code changes needed as long as the input/output
 * contract is preserved.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Feature normalization ────────────────────────────────────────────────
// Ranges MUST match the normalization used during model training.
// Override at runtime via ONNX_NORMALIZATION env var (JSON object).
const DEFAULT_RANGES = {
  totalSalesOnInstallment: { min: 0, max: 100 },
  totalPaidOnTime: { min: 0, max: 100 },
  totalLatePayments: { min: 0, max: 50 },
  avgDelayDays: { min: 0, max: 90 },
  currentOutstandingDebt: { min: 0, max: 10_000_000 },
  activeInstallmentsCount: { min: 0, max: 20 },
};

const FEATURE_ORDER = [
  'totalSalesOnInstallment',
  'totalPaidOnTime',
  'totalLatePayments',
  'avgDelayDays',
  'currentOutstandingDebt',
  'activeInstallmentsCount',
];

let ort = null; // onnxruntime-node module (dynamically imported)
let session = null; // InferenceSession singleton
let modelLoaded = false;
let initError = null;
let featureRanges = DEFAULT_RANGES;

// ── Path resolution ──────────────────────────────────────────────────────

function resolveModelPath() {
  if (process.env.ONNX_MODEL_PATH) return process.env.ONNX_MODEL_PATH;
  // backend/src/services/ → backend/models/
  return join(__dirname, '..', '..', 'models', 'credit-score.onnx');
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Initialize the ONNX runtime and load the credit-score model.
 * Safe to call even if onnxruntime-node is not installed or the model file
 * is missing — both cases are logged and the service reports "not available".
 *
 * @returns {Promise<boolean>} true if model loaded successfully
 */
export async function initCreditScoreModel() {
  // 1. Dynamically import onnxruntime-node (may not be installed)
  try {
    const mod = await import('onnxruntime-node');
    ort = mod.default ?? mod;
  } catch (err) {
    initError = `onnxruntime-node not installed: ${err.message}`;
    console.warn(`[onnx] ${initError}`);
    modelLoaded = false;
    return false;
  }

  // 2. Load normalization config override
  if (process.env.ONNX_NORMALIZATION) {
    try {
      featureRanges = { ...DEFAULT_RANGES, ...JSON.parse(process.env.ONNX_NORMALIZATION) };
    } catch {
      console.warn('[onnx] invalid ONNX_NORMALIZATION env — using defaults');
    }
  }

  // 3. Load the model file
  const modelPath = resolveModelPath();
  if (!existsSync(modelPath)) {
    initError = `Model file not found: ${modelPath}`;
    console.warn(`[onnx] ${initError} — rule-based fallback active`);
    modelLoaded = false;
    return false;
  }

  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
    modelLoaded = true;
    initError = null;
    console.log(`[onnx] credit-score model loaded (${modelPath})`);
    console.log(`[onnx]   inputs:  [${session.inputNames}]`);
    console.log(`[onnx]   outputs: [${session.outputNames}]`);
    return true;
  } catch (err) {
    initError = `Failed to create session: ${err.message}`;
    console.error(`[onnx] ${initError}`);
    modelLoaded = false;
    session = null;
    return false;
  }
}

/** @returns {boolean} */
export function isCreditScoreModelAvailable() {
  return modelLoaded && session != null;
}

/** Diagnostic info for admin/health endpoints. */
export function getModelStatus() {
  return {
    available: modelLoaded,
    error: initError,
    modelPath: resolveModelPath(),
  };
}

// ── Normalization ────────────────────────────────────────────────────────

function normalize(name, value) {
  const range = featureRanges[name];
  if (!range || range.max === range.min) return 0;
  const v = Number(value) || 0;
  const clamped = Math.max(range.min, Math.min(range.max, v));
  return (clamped - range.min) / (range.max - range.min);
}

// ── Inference ────────────────────────────────────────────────────────────

/**
 * Run inference on a single customer's metrics.
 *
 * @param {object} metrics — the 6 feature values (raw, unnormalized)
 * @returns {Promise<{score: number, riskProbability: number}>}
 * @throws if model is not available or input is invalid
 */
export async function predictCreditScore(metrics) {
  if (!isCreditScoreModelAvailable()) {
    throw new Error('ONNX model not available');
  }

  // Validate numeric inputs
  for (const name of FEATURE_ORDER) {
    const v = metrics[name];
    if (v == null || !isFinite(Number(v))) {
      throw new Error(`Invalid metric "${name}": ${v}`);
    }
  }

  // Build [1, 6] float32 input tensor
  const values = Float32Array.from(
    FEATURE_ORDER.map((n) => normalize(n, metrics[n]))
  );
  const tensor = new ort.Tensor('float32', values, [1, FEATURE_ORDER.length]);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: tensor });
  const output = results[session.outputNames[0]].data;

  return mapOutput(output);
}

// ── Output mapping ───────────────────────────────────────────────────────

/**
 * Adapt to different model output shapes:
 *   [1] value in [0, 1]   → risk probability, score = (1 - risk) * 100
 *   [1] value in (1, 100] → direct credit score
 *   [2+] values           → treat index 1 as risk probability
 */
function mapOutput(data) {
  let riskProbability;

  if (data.length === 1) {
    const v = Number(data[0]);
    if (v > 1) {
      // Direct score output [0–100]
      const score = Math.round(Math.max(0, Math.min(100, v)));
      return { score, riskProbability: +(1 - score / 100).toFixed(4) };
    }
    // Risk probability [0–1]
    riskProbability = Math.max(0, Math.min(1, v));
  } else if (data.length >= 2) {
    // [safe_prob, risk_prob]
    riskProbability = Math.max(0, Math.min(1, Number(data[1])));
  } else {
    riskProbability = 0.5; // unknown shape — neutral default
  }

  const score = Math.round((1 - riskProbability) * 100);
  return {
    score: Math.max(0, Math.min(100, score)),
    riskProbability: +riskProbability.toFixed(4),
  };
}
