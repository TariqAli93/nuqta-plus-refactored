/**
 * Hybrid credit-risk scoring engine.
 *
 *   final_risk = 0.6 * model_risk + 0.4 * rule_risk
 *
 * Both halves return a value in [0, 1] (probability of default). The runtime:
 *
 *   1. Computes rule-based risk from heuristics (delay, debt, active load …).
 *   2. Loads the ONNX logistic-regression model and runs it on the SAME
 *      normalized feature vector used during training.
 *   3. Combines them with the weights above.
 *   4. Maps the final risk to one of LOW / MEDIUM / HIGH.
 *   5. Returns reasons + features so callers (UI, logs) can explain "why"
 *      without exposing model internals.
 *
 * ── Production safety ────────────────────────────────────────────────────
 *   - If the .onnx file is absent or onnxruntime-node fails to load, the
 *     service falls back to rule-based scoring transparently.
 *   - If input features are malformed/null, the engine returns a safe
 *     MEDIUM default instead of throwing.
 *   - Inference NEVER trains or modifies the model file at runtime.
 *
 * ── Model contract ───────────────────────────────────────────────────────
 *   Input:  Float32 tensor [1, F] — normalized features (F from meta file)
 *   Output: Float32 tensor [1, 1] — risk probability in [0, 1]
 *   Where F and the feature order both come from credit-score.meta.json.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Defaults — must agree with the training script ───────────────────────
const DEFAULT_FEATURE_ORDER = [
  'totalSalesOnInstallment',
  'totalPaidOnTime',
  'totalLatePayments',
  'avgDelayDays',
  'maxDelayDays',
  'currentOutstandingDebt',
  'activeInstallmentsCount',
  'completedInstallmentsCount',
];

const DEFAULT_RANGES = {
  totalSalesOnInstallment: { min: 0, max: 100 },
  totalPaidOnTime: { min: 0, max: 100 },
  totalLatePayments: { min: 0, max: 50 },
  avgDelayDays: { min: 0, max: 90 },
  maxDelayDays: { min: 0, max: 180 },
  currentOutstandingDebt: { min: 0, max: 10_000_000 },
  activeInstallmentsCount: { min: 0, max: 20 },
  completedInstallmentsCount: { min: 0, max: 100 },
};

// ── Hybrid + risk-level configuration ────────────────────────────────────
export const HYBRID_CONFIG = {
  MODEL_WEIGHT: 0.6,
  RULE_WEIGHT: 0.4,
  RISK_THRESHOLDS: { low: 0.4, high: 0.7 },
  // Rule signals (probability contributions, summed and clamped to [0, 1])
  RULES: {
    DELAY_60: { threshold: 60, contribution: 0.6 },
    DELAY_30: { threshold: 30, contribution: 0.3 },
    DELAY_14: { threshold: 14, contribution: 0.15 },
    HIGH_DEBT_RATIO: { threshold: 0.5, contribution: 0.25 },
    ACTIVE_OVERLOAD: { threshold: 5, contribution: 0.2 },
    LATE_PAYMENTS: { threshold: 3, contribution: 0.2 },
    LOW_HISTORY: { threshold: 2, contribution: 0.15 },
  },
};

// ── Module-level state ───────────────────────────────────────────────────
let ort = null;
let session = null;
let modelLoaded = false;
let initError = null;

let modelMeta = null;
let featureOrder = DEFAULT_FEATURE_ORDER;
let featureRanges = DEFAULT_RANGES;
let modelVersion = 'rules-only';

// ── Path resolution ──────────────────────────────────────────────────────
function resolveModelPath() {
  if (process.env.ONNX_MODEL_PATH) return process.env.ONNX_MODEL_PATH;
  return join(__dirname, '..', '..', 'models', 'credit-score.onnx');
}

function resolveMetaPath() {
  if (process.env.ONNX_MODEL_META_PATH) return process.env.ONNX_MODEL_META_PATH;
  return join(__dirname, '..', '..', 'models', 'credit-score.meta.json');
}

function loadMeta() {
  const path = resolveMetaPath();
  if (!existsSync(path)) return null;
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(meta.feature_order) && meta.feature_order.length) {
      featureOrder = meta.feature_order;
    }
    if (meta.feature_ranges && typeof meta.feature_ranges === 'object') {
      featureRanges = { ...DEFAULT_RANGES, ...meta.feature_ranges };
    }
    if (typeof meta.version === 'string') {
      modelVersion = meta.version;
    }
    modelMeta = meta;
    return meta;
  } catch (err) {
    console.warn(`[onnx] failed to read meta file: ${err.message}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Load the runtime + model. Safe to call if either is missing — returns
 * false and the engine quietly falls back to rules-only scoring.
 */
export async function initCreditScoreModel() {
  // 1. Sidecar meta — load even if the .onnx is missing so feature_order /
  //    version are still discoverable from rule-only paths.
  loadMeta();

  // 2. ONNX runtime
  try {
    const mod = await import('onnxruntime-node');
    ort = mod.default ?? mod;
  } catch (err) {
    initError = `onnxruntime-node not installed: ${err.message}`;
    console.warn(`[onnx] ${initError}`);
    modelLoaded = false;
    return false;
  }

  // 3. Model file
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
    console.log(
      `[onnx] credit model loaded version=${modelVersion} features=${featureOrder.length}`
    );
    return true;
  } catch (err) {
    initError = `Failed to create session: ${err.message}`;
    console.error(`[onnx] ${initError}`);
    modelLoaded = false;
    session = null;
    return false;
  }
}

export function isCreditScoreModelAvailable() {
  return modelLoaded && session != null;
}

export function getModelVersion() {
  return modelVersion;
}

export function getFeatureOrder() {
  return [...featureOrder];
}

export function getModelStatus() {
  return {
    available: modelLoaded,
    error: initError,
    modelPath: resolveModelPath(),
    metaPath: resolveMetaPath(),
    version: modelVersion,
    featureOrder: [...featureOrder],
    metrics: modelMeta?.metrics ?? null,
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

function isValidMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;
  for (const name of featureOrder) {
    const v = metrics[name];
    if (v == null || !isFinite(Number(v))) return false;
  }
  return true;
}

// ── Risk-level mapping ───────────────────────────────────────────────────
export function riskLevelFromProbability(p) {
  const t = HYBRID_CONFIG.RISK_THRESHOLDS;
  if (p == null || !isFinite(Number(p))) return 'MEDIUM';
  if (p < t.low) return 'LOW';
  if (p > t.high) return 'HIGH';
  return 'MEDIUM';
}

// ── Rule-based scoring ───────────────────────────────────────────────────
/**
 * Pure function — returns risk probability + the list of reasons that
 * contributed. Used both by the hybrid combiner and as a fallback when the
 * ONNX model is unavailable.
 */
export function computeRuleRisk(metrics) {
  const reasons = [];
  let risk = 0;

  if (!isValidMetrics(metrics)) {
    return {
      risk: 0.5,
      reasons: [{ type: 'invalid_input', impact: 'medium' }],
      features: metrics ?? {},
    };
  }

  const cfg = HYBRID_CONFIG.RULES;

  // Delay-based escalation — pick the strongest matching tier only, so a
  // 90-day delay doesn't get triple-penalized.
  if (Number(metrics.maxDelayDays) >= cfg.DELAY_60.threshold) {
    risk += cfg.DELAY_60.contribution;
    reasons.push({ type: 'severe_delays', impact: 'high' });
  } else if (Number(metrics.avgDelayDays) >= cfg.DELAY_30.threshold) {
    risk += cfg.DELAY_30.contribution;
    reasons.push({ type: 'moderate_delays', impact: 'medium' });
  } else if (Number(metrics.avgDelayDays) >= cfg.DELAY_14.threshold) {
    risk += cfg.DELAY_14.contribution;
    reasons.push({ type: 'minor_delays', impact: 'low' });
  }

  // High debt ratio
  const totalValue =
    Number(metrics.totalSalesValue) ||
    // approximation when totalSalesValue isn't provided: use outstanding+1 to avoid div/0
    Number(metrics.currentOutstandingDebt) + 1;
  const debtRatio =
    totalValue > 0 ? Number(metrics.currentOutstandingDebt || 0) / totalValue : 0;
  if (debtRatio >= cfg.HIGH_DEBT_RATIO.threshold) {
    risk += cfg.HIGH_DEBT_RATIO.contribution;
    reasons.push({ type: 'high_debt', impact: 'medium' });
  }

  // Too many active installments
  if (Number(metrics.activeInstallmentsCount || 0) > cfg.ACTIVE_OVERLOAD.threshold) {
    risk += cfg.ACTIVE_OVERLOAD.contribution;
    reasons.push({ type: 'active_overload', impact: 'medium' });
  }

  // Many late payments
  if (Number(metrics.totalLatePayments || 0) >= cfg.LATE_PAYMENTS.threshold) {
    risk += cfg.LATE_PAYMENTS.contribution;
    reasons.push({ type: 'late_payments', impact: 'medium' });
  }

  // Thin file: very little history at all
  if (
    Number(metrics.totalSalesOnInstallment || 0) <= cfg.LOW_HISTORY.threshold &&
    Number(metrics.completedInstallmentsCount || 0) <= cfg.LOW_HISTORY.threshold
  ) {
    risk += cfg.LOW_HISTORY.contribution;
    reasons.push({ type: 'low_history', impact: 'low' });
  }

  return {
    risk: Math.max(0, Math.min(1, risk)),
    reasons,
    features: metrics,
  };
}

// ── ONNX inference ───────────────────────────────────────────────────────
async function runOnnx(metrics) {
  if (!isCreditScoreModelAvailable()) return null;
  try {
    const values = Float32Array.from(featureOrder.map((n) => normalize(n, metrics[n])));
    const tensor = new ort.Tensor('float32', values, [1, featureOrder.length]);
    const inputName = session.inputNames[0];
    const results = await session.run({ [inputName]: tensor });
    const data = results[session.outputNames[0]].data;
    if (!data || data.length === 0) return null;
    const v = Number(data[0]);
    if (!isFinite(v)) return null;
    return Math.max(0, Math.min(1, v));
  } catch (err) {
    // Likely a stale .onnx whose input shape no longer matches feature_order
    // (e.g. left over from a prior training run). Disable the model permanently
    // for this process so we don't spam logs — the hybrid engine falls back to
    // rules-only and the operator can re-run train:credit-model to fix it.
    console.error(
      `[onnx] inference failed; disabling ONNX session — re-train the model. (${err.message})`
    );
    modelLoaded = false;
    initError = `Inference error: ${err.message}`;
    session = null;
    return null;
  }
}

// ── Hybrid orchestrator ──────────────────────────────────────────────────
/**
 * Compute a structured, explainable risk assessment for a customer.
 *
 * Always succeeds — never throws. On invalid input or runtime errors the
 * function returns a safe MEDIUM default so callers don't crash production.
 *
 * @param {object} metrics  unnormalized customer metrics (numbers).
 * @returns {Promise<{
 *   risk_probability: number,
 *   risk_level: 'LOW'|'MEDIUM'|'HIGH',
 *   reasons: Array<{type:string, impact:'low'|'medium'|'high'}>,
 *   features_used: object,
 *   model_version: string,
 *   model_source: 'hybrid'|'rules-only',
 *   score: number,                // 0–100, higher = safer
 *   model_risk?: number,
 *   rule_risk?: number,
 * }>}
 */
export async function assessCreditRisk(metrics) {
  // Defensive validation — never crash on bad inputs.
  if (!isValidMetrics(metrics)) {
    return {
      risk_probability: 0.5,
      risk_level: 'MEDIUM',
      reasons: [{ type: 'invalid_input', impact: 'medium' }],
      features_used: metrics ?? {},
      model_version: modelVersion,
      model_source: 'rules-only',
      score: 50,
    };
  }

  const ruleResult = computeRuleRisk(metrics);
  const modelRisk = await runOnnx(metrics);

  let finalRisk;
  let modelSource;
  if (modelRisk == null) {
    finalRisk = ruleResult.risk;
    modelSource = 'rules-only';
  } else {
    finalRisk =
      HYBRID_CONFIG.MODEL_WEIGHT * modelRisk +
      HYBRID_CONFIG.RULE_WEIGHT * ruleResult.risk;
    modelSource = 'hybrid';
  }

  // Clamp + round to 4 decimals for stable logs / UI.
  finalRisk = +Math.max(0, Math.min(1, finalRisk)).toFixed(4);
  const score = Math.round((1 - finalRisk) * 100);

  return {
    risk_probability: finalRisk,
    risk_level: riskLevelFromProbability(finalRisk),
    reasons: ruleResult.reasons,
    features_used: ruleResult.features,
    model_version: modelVersion,
    model_source: modelSource,
    score,
    model_risk: modelRisk == null ? null : +modelRisk.toFixed(4),
    rule_risk: +ruleResult.risk.toFixed(4),
  };
}

// ── Backwards-compatible thin wrapper ────────────────────────────────────
/**
 * Legacy API used by creditScoringService — returns just { score, riskProbability }.
 * Kept so existing callers don't break.
 */
export async function predictCreditScore(metrics) {
  const r = await assessCreditRisk(metrics);
  return { score: r.score, riskProbability: r.risk_probability };
}
