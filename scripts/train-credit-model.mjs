/**
 * scripts/train-credit-model.mjs
 *
 * Train the credit-default classifier on REAL snapshot data from the
 * credit_snapshots table and emit:
 *   - backend/models/credit-score.onnx        (logistic regression)
 *   - backend/models/credit-score.meta.json   (version + metrics + features)
 *
 * The runtime (onnxCreditScoringService) loads both files at startup. If the
 * model is missing, it falls back to rule-based scoring — never crashes.
 *
 * ── Pipeline ───────────────────────────────────────────────────────────────
 *   1. Load snapshots from credit_snapshots, ordered by snapshot_date.
 *      (No synthetic data anywhere.)
 *   2. Time-based split: first (1 - VAL_FRACTION) of dates → train,
 *      remainder → validation. This emulates how the model is used in
 *      production — it always predicts the future from the past.
 *   3. Min-max normalize using fixed RANGES that match
 *      backend/src/services/onnxCreditScoringService.js. The ONNX graph is
 *      pure linear-then-sigmoid; normalization happens at the runtime edge.
 *   4. Full-batch GD on logistic regression with cross-entropy + L2.
 *   5. Compute accuracy, precision, recall, AUC on the validation set.
 *   6. Serialize a minimal ONNX (Sigmoid(MatMul(x, W) + B)) graph + a meta
 *      JSON sidecar.
 *
 * ── Build only ─────────────────────────────────────────────────────────────
 *   This script must NEVER be invoked at runtime. Production reads the .onnx
 *   file and trusts it.
 *
 * Usage:
 *   pnpm run train:credit-model
 *   pnpm run train:credit-model -- --dataset=./snapshots.json
 *   pnpm run train:credit-model -- --window=90 --val=0.2
 */

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ───────────────────────────────────────────────────────────
const MODEL_OUT = join(__dirname, '..', 'backend', 'models', 'credit-score.onnx');
const META_OUT = join(__dirname, '..', 'backend', 'models', 'credit-score.meta.json');
const PROTO_PATH = join(__dirname, 'onnx.proto');
const DEFAULT_VAL_FRACTION = 0.2;
const EPOCHS = 600;
const LEARNING_RATE = 0.5;
const L2 = 1e-3;

// IMPORTANT: keep aligned with backend/src/services/onnxCreditScoringService.js
const FEATURE_ORDER = [
  'totalSalesOnInstallment',
  'totalPaidOnTime',
  'totalLatePayments',
  'avgDelayDays',
  'maxDelayDays',
  'currentOutstandingDebt',
  'activeInstallmentsCount',
  'completedInstallmentsCount',
];

const RANGES = {
  totalSalesOnInstallment: { min: 0, max: 100 },
  totalPaidOnTime: { min: 0, max: 100 },
  totalLatePayments: { min: 0, max: 50 },
  avgDelayDays: { min: 0, max: 90 },
  maxDelayDays: { min: 0, max: 180 },
  currentOutstandingDebt: { min: 0, max: 10_000_000 },
  activeInstallmentsCount: { min: 0, max: 20 },
  completedInstallmentsCount: { min: 0, max: 100 },
};

// ── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, v = 'true'] = a.slice(2).split('=');
    out[k] = v;
  }
  return out;
}

// ── Math helpers ────────────────────────────────────────────────────────────
function sigmoid(x) {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

function normalize(name, value) {
  const r = RANGES[name];
  if (!r || r.max === r.min) return 0;
  const v = Number(value) || 0;
  const clamped = Math.max(r.min, Math.min(r.max, v));
  return (clamped - r.min) / (r.max - r.min);
}

// ── Dataset loading ─────────────────────────────────────────────────────────
async function loadFromDb() {
  // Imported lazily so the script can run from a JSON file without DB.
  const { loadSnapshotsForTraining } = await import(
    '../backend/src/services/creditDatasetService.js'
  );
  return await loadSnapshotsForTraining();
}

async function loadFromFile(path) {
  if (!existsSync(path)) throw new Error(`Dataset file not found: ${path}`);
  const raw = await readFile(path, 'utf8');
  if (path.endsWith('.csv')) {
    const [header, ...lines] = raw.trim().split(/\r?\n/);
    const cols = header.split(',');
    return lines.map((line) => {
      const parts = line.split(',');
      const r = Object.fromEntries(cols.map((c, i) => [c, parts[i]]));
      return {
        id: Number(r.id),
        customerId: Number(r.customer_id),
        snapshotDate: r.snapshot_date,
        totalSalesOnInstallment: Number(r.total_sales_on_installment),
        totalPaidOnTime: Number(r.total_paid_on_time),
        totalLatePayments: Number(r.total_late_payments),
        avgDelayDays: Number(r.avg_delay_days),
        maxDelayDays: Number(r.max_delay_days),
        currentOutstandingDebt: Number(r.current_outstanding_debt),
        activeInstallmentsCount: Number(r.active_installments_count),
        completedInstallmentsCount: Number(r.completed_installments_count),
        labelDefaulted: r.label_defaulted === '1' || r.label_defaulted === 'true',
      };
    });
  }
  return JSON.parse(raw);
}

async function atomicWriteFile(targetPath, data) {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, targetPath);
}

// Time-based split: sort by snapshot_date and split at the (1-valFrac) quantile.
function timeBasedSplit(rows, valFraction) {
  const sorted = [...rows].sort((a, b) =>
    String(a.snapshotDate).localeCompare(String(b.snapshotDate))
  );
  const cut = Math.max(1, Math.floor(sorted.length * (1 - valFraction)));
  return { train: sorted.slice(0, cut), val: sorted.slice(cut) };
}

function buildXY(rows) {
  const F = FEATURE_ORDER.length;
  const X = new Float32Array(rows.length * F);
  const y = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    y[i] = r.labelDefaulted ? 1 : 0;
    for (let j = 0; j < F; j++) {
      X[i * F + j] = normalize(FEATURE_ORDER[j], r[FEATURE_ORDER[j]]);
    }
  }
  return { X, y };
}

// ── Training loop ──────────────────────────────────────────────────────────
function train(X, y, F, posWeight) {
  const n = y.length;
  const w = new Float64Array(F);
  let b = 0;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const gradW = new Float64Array(F);
    let gradB = 0;
    let loss = 0;

    for (let i = 0; i < n; i++) {
      let z = b;
      const off = i * F;
      for (let j = 0; j < F; j++) z += w[j] * X[off + j];
      const p = sigmoid(z);
      const eps = 1e-9;
      const yi = y[i];
      const wi = yi === 1 ? posWeight : 1; // class-imbalance weighting
      loss += -wi * (yi * Math.log(p + eps) + (1 - yi) * Math.log(1 - p + eps));
      const err = wi * (p - yi);
      gradB += err;
      for (let j = 0; j < F; j++) gradW[j] += err * X[off + j];
    }

    for (let j = 0; j < F; j++) {
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

// ── Metrics ────────────────────────────────────────────────────────────────
function predictProbs(X, y, w, b, F) {
  const n = y.length;
  const probs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = b;
    const off = i * F;
    for (let j = 0; j < F; j++) z += w[j] * X[off + j];
    probs[i] = sigmoid(z);
  }
  return probs;
}

function classificationMetrics(probs, y, threshold = 0.5) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < y.length; i++) {
    const pred = probs[i] >= threshold ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 1 && y[i] === 0) fp++;
    else if (pred === 0 && y[i] === 0) tn++;
    else fn++;
  }
  const accuracy = y.length ? (tp + tn) / y.length : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { accuracy, precision, recall, f1, tp, fp, tn, fn };
}

// AUC via the rank statistic — handles tied scores correctly:
//   AUC = (sum_of_ranks_of_positives - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)
function computeAuc(probs, y) {
  const n = y.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => probs[a] - probs[b]);
  // assign average ranks for ties
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && probs[idx[j + 1]] === probs[idx[i]]) j++;
    const avgRank = (i + j + 2) / 2; // 1-based ranks
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
    i = j + 1;
  }
  let nPos = 0;
  let nNeg = 0;
  let rankSum = 0;
  for (let k = 0; k < n; k++) {
    if (y[k] === 1) {
      nPos++;
      rankSum += ranks[k];
    } else {
      nNeg++;
    }
  }
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

// ── ONNX serialization ─────────────────────────────────────────────────────
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

  const FLOAT = 1;
  const f32Bytes = (arr) => {
    const buf = new ArrayBuffer(arr.length * 4);
    new Float32Array(buf).set(arr);
    return new Uint8Array(buf);
  };

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
  const sig = Node.create({
    input: ['logits'],
    output: ['risk'],
    name: 'Sigmoid_0',
    opType: 'Sigmoid',
  });

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
    node: [matmul, add, sig],
    name: 'credit-score-logreg',
    initializer: [wTensor, bTensor],
    input: [inputInfo],
    output: [outputInfo],
  });

  const model = Model.create({
    irVersion: 7,
    producerName: 'nuqtaplus-train-credit-model',
    producerVersion: '2.0.0',
    domain: '',
    modelVersion: 2,
    docString:
      'Logistic-regression credit-default classifier trained on real ' +
      'credit_snapshots. Input float32[N, F]; output float32[N, 1] risk ' +
      'probability in [0, 1]. F = featureOrder.length.',
    graph,
    opsetImport: [OpsetId.create({ domain: '', version: 13 })],
  });

  return Model.encode(model).finish();
}

// ── Entry point ────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const valFrac = args.val ? Number(args.val) : DEFAULT_VAL_FRACTION;

  let rows;
  try {
    if (args.dataset) {
      console.log(`[train] loading dataset from ${args.dataset}`);
      rows = await loadFromFile(args.dataset);
    } else {
      console.log('[train] loading dataset from credit_snapshots');
      rows = await loadFromDb();
    }
  } finally {
    if (!args.dataset) {
      // Close DB once we have the rows
      try {
        const { closeDatabase } = await import('../backend/src/db.js');
        await closeDatabase();
      } catch {
        // best-effort
      }
    }
  }

  if (!rows.length) {
    console.error(
      '[train] no snapshots available. Run scripts/export-credit-dataset.mjs first ' +
        'to populate credit_snapshots, or pass --dataset=path.json.'
    );
    process.exit(1);
  }

  const positives = rows.filter((r) => r.labelDefaulted).length;
  console.log(
    `[train] ${rows.length} rows  positives=${positives} (${((100 * positives) / rows.length).toFixed(1)}%)`
  );

  if (positives === 0 || positives === rows.length) {
    console.error(
      '[train] dataset has only one class; cannot train a discriminative model. ' +
        'Collect more diverse data or fall back to rule-based scoring.'
    );
    process.exit(1);
  }

  const { train: trainRows, val: valRows } = timeBasedSplit(rows, valFrac);
  console.log(`[train] split: train=${trainRows.length}  val=${valRows.length} (time-based)`);

  const F = FEATURE_ORDER.length;
  const { X: Xtr, y: ytr } = buildXY(trainRows);
  const { X: Xval, y: yval } = buildXY(valRows);

  const trPos = trainRows.filter((r) => r.labelDefaulted).length;
  const trNeg = trainRows.length - trPos;
  const posWeight = trPos > 0 ? Math.min(10, trNeg / trPos) : 1;
  console.log(`[train] class weighting (positive): ${posWeight.toFixed(3)}`);

  console.log('[train] training logistic regression …');
  const { w, b } = train(Xtr, ytr, F, posWeight);

  // Evaluate
  const valProbs = predictProbs(Xval, yval, w, b, F);
  const trainProbs = predictProbs(Xtr, ytr, w, b, F);
  const trainMetrics = classificationMetrics(trainProbs, ytr);
  const valMetrics = classificationMetrics(valProbs, yval);
  const auc = valRows.length ? computeAuc(valProbs, yval) : 0.5;

  console.log(
    `[train] train acc=${trainMetrics.accuracy.toFixed(4)} ` +
      `prec=${trainMetrics.precision.toFixed(4)} recall=${trainMetrics.recall.toFixed(4)} ` +
      `f1=${trainMetrics.f1.toFixed(4)}`
  );
  console.log(
    `[train] val   acc=${valMetrics.accuracy.toFixed(4)} ` +
      `prec=${valMetrics.precision.toFixed(4)} recall=${valMetrics.recall.toFixed(4)} ` +
      `f1=${valMetrics.f1.toFixed(4)} auc=${auc.toFixed(4)}`
  );
  console.log(`[train] weights: [${Array.from(w).map((x) => x.toFixed(3)).join(', ')}]`);
  console.log(`[train] bias:    ${b.toFixed(3)}`);

  // Build & write ONNX
  console.log(`[train] loading ${PROTO_PATH}`);
  const root = await protobuf.load(PROTO_PATH);
  const bytes = buildOnnxModel(root, Array.from(w), b);

  await mkdir(dirname(MODEL_OUT), { recursive: true });

  const trainedAt = new Date().toISOString();
  const meta = {
    modelVersion: `2.0.0-${trainedAt.slice(0, 10).replaceAll('-', '')}`,
    trainedAt,
    feature_order: FEATURE_ORDER,
    featureNames: FEATURE_ORDER,
    outputLabels: ['non_default', 'default'],
    thresholdConfig: { low: 0.4, high: 0.7 },
    feature_ranges: RANGES,
    outputLabelsLegacy: ['LOW', 'MEDIUM', 'HIGH'],
    metrics: {
      train: trainMetrics,
      val: { ...valMetrics, auc },
    },
    trainingSummary: {
      epochs: EPOCHS,
      learningRate: LEARNING_RATE,
      l2: L2,
      positiveClassWeight: posWeight,
    },
    dataset: {
      n: rows.length,
      n_train: trainRows.length,
      n_val: valRows.length,
      positive_rate: positives / rows.length,
      val_fraction: valFrac,
      split_strategy: 'time-based',
    },
    weights: Array.from(w),
    bias: b,
  };
  meta.version = meta.modelVersion;
  meta.trained_at = meta.trainedAt;

  try {
    await atomicWriteFile(MODEL_OUT, bytes);
    await atomicWriteFile(META_OUT, JSON.stringify(meta, null, 2));
  } catch (err) {
    await rm(MODEL_OUT, { force: true });
    await rm(META_OUT, { force: true });
    throw new Error(`failed to write model artifacts atomically: ${err.message}`);
  }

  console.log(`[train] wrote ${MODEL_OUT} (${bytes.byteLength} bytes)`);
  console.log(`[train] wrote ${META_OUT}`);
}

main().catch((err) => {
  console.error('[train] failed:', err);
  process.exit(1);
});
