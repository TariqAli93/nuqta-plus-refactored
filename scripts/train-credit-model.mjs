/**
 * scripts/train-credit-model.mjs
 *
 * Trains a tiny logistic-regression credit-default classifier on synthetic
 * customer data and writes it as backend/models/credit-score.onnx, which the
 * backend's onnxCreditScoringService.js loads at startup.
 *
 * Pipeline:
 *   1. Seeded PRNG → ~20k synthetic samples of the 6 features documented in
 *      backend/src/services/onnxCreditScoringService.js (feature order +
 *      ranges).
 *   2. Each sample is given a binary "defaulted" label drawn from a sigmoid of
 *      hand-picked risk weights — late-payment ratio, average delay days,
 *      debt-burden ratio, active-installments overload. Calibrated for
 *      ~25–35% positives.
 *   3. Min-max normalize each feature using the *same* DEFAULT_RANGES the
 *      runtime uses, so no normalization layer ships inside the ONNX graph.
 *   4. Full-batch gradient descent on logistic-regression weights (cross
 *      entropy + small L2). Reports train/val accuracy.
 *   5. Hand-build a minimal ONNX graph — Sigmoid(MatMul(input, W) + B) — and
 *      serialize it via protobufjs using the vendored scripts/onnx.proto
 *      schema. Output shape is [N, 1] in [0, 1], which mapOutput() in the
 *      runtime treats as risk probability.
 *
 * Usage:
 *   pnpm run train:credit-model
 *
 * The output file is committed to the repo: regenerating it should produce a
 * byte-identical artifact as long as the seed and hyperparameters below stay
 * fixed.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration (kept fixed so the artifact is reproducible) ──────────────
const SEED = 0xC0FFEE;
const N_SAMPLES = 20_000;
const VAL_FRACTION = 0.15;
const EPOCHS = 600;
const LEARNING_RATE = 0.5;
const L2 = 1e-3;
const MODEL_OUT = join(__dirname, '..', 'backend', 'models', 'credit-score.onnx');
const PROTO_PATH = join(__dirname, 'onnx.proto');

// Must match backend/src/services/onnxCreditScoringService.js FEATURE_ORDER.
const FEATURE_ORDER = [
  'totalSalesOnInstallment',
  'totalPaidOnTime',
  'totalLatePayments',
  'avgDelayDays',
  'currentOutstandingDebt',
  'activeInstallmentsCount',
];

// Must match DEFAULT_RANGES in the runtime — these are the normalization
// bounds the inference path uses, so training must use identical bounds.
const RANGES = {
  totalSalesOnInstallment: { min: 0, max: 100 },
  totalPaidOnTime: { min: 0, max: 100 },
  totalLatePayments: { min: 0, max: 50 },
  avgDelayDays: { min: 0, max: 90 },
  currentOutstandingDebt: { min: 0, max: 10_000_000 },
  activeInstallmentsCount: { min: 0, max: 20 },
};

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Synthetic data generation ───────────────────────────────────────────────
function sampleFeatures(rng) {
  const totalSales = Math.floor(rng() * 50);
  const finished = Math.floor(rng() * Math.max(1, totalSales * 3));
  const lateRate = rng() * rng();
  const totalLate = Math.floor(finished * lateRate);
  const totalOnTime = Math.max(0, finished - totalLate);
  const avgDelay = totalLate > 0 ? rng() * 60 : rng() * 5;
  const active = Math.floor(rng() * Math.min(15, totalSales + 1));
  const debt = Math.floor(rng() * rng() * 3_000_000);

  return {
    totalSalesOnInstallment: totalSales,
    totalPaidOnTime: totalOnTime,
    totalLatePayments: totalLate,
    avgDelayDays: avgDelay,
    currentOutstandingDebt: debt,
    activeInstallmentsCount: active,
  };
}

function sigmoid(x) {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

// Heuristic "defaulted" label generator. Deliberately uses signals/weights
// that differ from creditScoringService.scoreFromMetrics so the model has
// something non-trivial to learn rather than memorizing the rules.
function labelDefaulted(m, rng) {
  const finished = m.totalPaidOnTime + m.totalLatePayments;
  const lateRatio = finished > 0 ? m.totalLatePayments / finished : 0;
  const delayNorm = Math.min(1, m.avgDelayDays / 60);
  const debtBurden = Math.min(1, m.currentOutstandingDebt / 2_000_000);
  const activeOverload = Math.min(1, m.activeInstallmentsCount / 8);
  const lowHistory = m.totalSalesOnInstallment < 3 ? 1 : 0;

  const logit =
    -2.0 +
    3.5 * lateRatio +
    2.5 * delayNorm +
    1.6 * debtBurden +
    1.4 * activeOverload +
    0.6 * lowHistory;

  return rng() < sigmoid(logit) ? 1 : 0;
}

function normalize(name, value) {
  const r = RANGES[name];
  const v = Number(value) || 0;
  const clamped = Math.max(r.min, Math.min(r.max, v));
  return (clamped - r.min) / (r.max - r.min);
}

function buildDataset(n, rng) {
  const X = new Float32Array(n * FEATURE_ORDER.length);
  const y = new Uint8Array(n);
  let positives = 0;
  for (let i = 0; i < n; i++) {
    const m = sampleFeatures(rng);
    y[i] = labelDefaulted(m, rng);
    positives += y[i];
    for (let j = 0; j < FEATURE_ORDER.length; j++) {
      X[i * FEATURE_ORDER.length + j] = normalize(FEATURE_ORDER[j], m[FEATURE_ORDER[j]]);
    }
  }
  return { X, y, positives };
}

// ── Logistic regression training (full-batch GD) ────────────────────────────
function train(X, y, nFeat) {
  const n = y.length;
  const w = new Float64Array(nFeat);
  let b = 0;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const gradW = new Float64Array(nFeat);
    let gradB = 0;
    let loss = 0;

    for (let i = 0; i < n; i++) {
      let z = b;
      const off = i * nFeat;
      for (let j = 0; j < nFeat; j++) z += w[j] * X[off + j];
      const p = sigmoid(z);
      const eps = 1e-9;
      loss += -(y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps));
      const err = p - y[i];
      gradB += err;
      for (let j = 0; j < nFeat; j++) gradW[j] += err * X[off + j];
    }

    for (let j = 0; j < nFeat; j++) {
      w[j] -= LEARNING_RATE * (gradW[j] / n + L2 * w[j]);
    }
    b -= LEARNING_RATE * (gradB / n);

    if (epoch === 0 || (epoch + 1) % 100 === 0 || epoch === EPOCHS - 1) {
      console.log(
        `  epoch ${String(epoch + 1).padStart(4)} / ${EPOCHS}  loss=${(loss / n).toFixed(5)}`
      );
    }
  }

  return { w, b };
}

function evaluate(X, y, w, b, nFeat) {
  const n = y.length;
  let correct = 0;
  for (let i = 0; i < n; i++) {
    let z = b;
    const off = i * nFeat;
    for (let j = 0; j < nFeat; j++) z += w[j] * X[off + j];
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct++;
  }
  return correct / n;
}

// ── ONNX serialization ──────────────────────────────────────────────────────
function buildOnnxModel(root, weights, bias) {
  const Model = root.lookupType('onnx.ModelProto');
  const Graph = root.lookupType('onnx.GraphProto');
  const Node = root.lookupType('onnx.NodeProto');
  const Tensor = root.lookupType('onnx.TensorProto');
  const ValueInfo = root.lookupType('onnx.ValueInfoProto');
  const TypeProto = root.lookupType('onnx.TypeProto');
  const TensorType = root.lookupType('onnx.TypeProto.Tensor');
  const Shape = root.lookupType('onnx.TensorShapeProto');
  const Dim = root.lookupType('onnx.TensorShapeProto.Dimension');
  const OpsetId = root.lookupType('onnx.OperatorSetIdProto');

  const FLOAT = 1; // TensorProto.DataType.FLOAT

  // Float32 little-endian raw bytes (avoids varint encoding overhead and is
  // what onnxruntime expects when raw_data is set).
  const f32Bytes = (arr) => {
    const buf = new ArrayBuffer(arr.length * 4);
    new Float32Array(buf).set(arr);
    return new Uint8Array(buf);
  };

  // Initializers — W: [6, 1], B: [1]
  const wTensor = Tensor.create({
    dims: [weights.length, 1],
    dataType: FLOAT,
    name: 'W',
    rawData: f32Bytes(Float32Array.from(weights)),
  });
  const bTensor = Tensor.create({
    dims: [1],
    dataType: FLOAT,
    name: 'B',
    rawData: f32Bytes(Float32Array.from([bias])),
  });

  // Nodes
  const matmul = Node.create({
    input: ['input', 'W'],
    output: ['matmul_out'],
    name: 'MatMul_0',
    opType: 'MatMul',
  });
  const add = Node.create({
    input: ['matmul_out', 'B'],
    output: ['logits'],
    name: 'Add_0',
    opType: 'Add',
  });
  const sigmoid = Node.create({
    input: ['logits'],
    output: ['risk'],
    name: 'Sigmoid_0',
    opType: 'Sigmoid',
  });

  // I/O — input [N, 6], output [N, 1]; "N" stays symbolic so callers may batch.
  const makeTensorValueInfo = (name, dims) => {
    const shape = Shape.create({
      dim: dims.map((d) =>
        typeof d === 'string'
          ? Dim.create({ dimParam: d })
          : Dim.create({ dimValue: d })
      ),
    });
    return ValueInfo.create({
      name,
      type: TypeProto.create({
        tensorType: TensorType.create({ elemType: FLOAT, shape }),
      }),
    });
  };

  const inputInfo = makeTensorValueInfo('input', ['N', weights.length]);
  const outputInfo = makeTensorValueInfo('risk', ['N', 1]);

  const graph = Graph.create({
    node: [matmul, add, sigmoid],
    name: 'credit-score-logreg',
    initializer: [wTensor, bTensor],
    input: [inputInfo],
    output: [outputInfo],
  });

  const model = Model.create({
    irVersion: 7, // ONNX IR v7 — supported since onnxruntime 1.6
    producerName: 'nuqtaplus-train-credit-model',
    producerVersion: '1.0.0',
    domain: '',
    modelVersion: 1,
    docString:
      'Logistic-regression credit-default classifier. Input float32[N, 6]; ' +
      'output float32[N, 1] risk probability in [0, 1].',
    graph,
    opsetImport: [OpsetId.create({ domain: '', version: 13 })],
  });

  return Model.encode(model).finish();
}

// ── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  const rng = makeRng(SEED);

  console.log(`[train] generating ${N_SAMPLES} synthetic samples (seed=0x${SEED.toString(16)})`);
  const ds = buildDataset(N_SAMPLES, rng);
  const positiveRate = ds.positives / N_SAMPLES;
  console.log(`[train] positive rate: ${(positiveRate * 100).toFixed(1)}%`);

  // Train/val split (deterministic — first 85% train, last 15% val).
  const nVal = Math.round(N_SAMPLES * VAL_FRACTION);
  const nTrain = N_SAMPLES - nVal;
  const F = FEATURE_ORDER.length;

  const Xtr = ds.X.subarray(0, nTrain * F);
  const ytr = ds.y.subarray(0, nTrain);
  const Xval = ds.X.subarray(nTrain * F);
  const yval = ds.y.subarray(nTrain);

  console.log(`[train] training logistic regression on ${nTrain} samples …`);
  const { w, b } = train(Xtr, ytr, F);

  const trainAcc = evaluate(Xtr, ytr, w, b, F);
  const valAcc = evaluate(Xval, yval, w, b, F);
  console.log(`[train] train accuracy: ${(trainAcc * 100).toFixed(2)}%`);
  console.log(`[train] val   accuracy: ${(valAcc * 100).toFixed(2)}%`);
  console.log(`[train] weights: [${Array.from(w).map((x) => x.toFixed(3)).join(', ')}]`);
  console.log(`[train] bias:    ${b.toFixed(3)}`);

  // Build & write ONNX
  console.log(`[train] loading ${PROTO_PATH}`);
  const root = await protobuf.load(PROTO_PATH);
  const bytes = buildOnnxModel(root, Array.from(w), b);

  mkdirSync(dirname(MODEL_OUT), { recursive: true });
  writeFileSync(MODEL_OUT, bytes);
  console.log(`[train] wrote ${MODEL_OUT} (${bytes.byteLength} bytes)`);
}

main().catch((err) => {
  console.error('[train] failed:', err);
  process.exit(1);
});
