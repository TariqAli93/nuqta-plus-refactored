#!/usr/bin/env node
/**
 * scripts/export-credit-dataset.mjs
 *
 * Build credit-risk training snapshots from the live database and (optionally)
 * dump the dataset to JSON or CSV on disk for offline inspection / training.
 *
 * Usage:
 *   node scripts/export-credit-dataset.mjs [options]
 *
 * Options:
 *   --start=YYYY-MM-DD     earliest snapshot date         (default: 365d ago)
 *   --end=YYYY-MM-DD       latest snapshot date           (default: now-window)
 *   --cadence=30           snapshot cadence in days       (default: 30)
 *   --window=90            forward labeling window (days) (default: 90)
 *   --out=./dataset.json   write dataset to file (json | csv inferred from ext)
 *   --no-build             skip rebuilding snapshots; just export what's in DB
 *
 * Two phases:
 *   1. Build snapshots into credit_snapshots (idempotent — uses ON CONFLICT).
 *   2. Re-read snapshots from DB and write them as JSON or CSV.
 *
 * Run only during build / dev — not in production. Inference uses the pre-
 * trained ONNX model, never this pipeline.
 */

import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, v = 'true'] = a.slice(2).split('=');
    out[k] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  // Lazy import — services need DB connection, which auto-runs migrations.
  const {
    buildDatasetForAllCustomers,
    loadSnapshotsForTraining,
    snapshotsToCsv,
  } = await import('../backend/src/services/creditDatasetService.js');
  const { closeDatabase } = await import('../backend/src/db.js');

  const opts = {
    start: args.start ? new Date(args.start) : undefined,
    end: args.end ? new Date(args.end) : undefined,
    cadenceDays: args.cadence ? Number(args.cadence) : 30,
    windowDays: args.window ? Number(args.window) : 90,
  };

  try {
    if (args.build !== 'false' && args['no-build'] !== 'true') {
      console.log('[export-dataset] building snapshots …');
      const result = await buildDatasetForAllCustomers({
        ...opts,
        onProgress: ({ processed, total, snapshots }) => {
          if (processed % 100 === 0 || processed === total) {
            console.log(
              `  customers ${processed}/${total}  snapshots=${snapshots}`
            );
          }
        },
      });
      console.log(
        `[export-dataset] built ${result.snapshots} snapshots across ${result.customers} customers ` +
          `(${result.dates.length} dates, window=${result.windowDays}d, cadence=${result.cadenceDays}d)`
      );
    } else {
      console.log('[export-dataset] skipping build phase (--no-build)');
    }

    const rows = await loadSnapshotsForTraining({
      minDate: opts.start,
      maxDate: opts.end,
    });

    const positives = rows.filter((r) => r.labelDefaulted).length;
    console.log(
      `[export-dataset] loaded ${rows.length} snapshots — positives=${positives} ` +
        `(${rows.length ? ((100 * positives) / rows.length).toFixed(1) : 0}%)`
    );

    if (args.out) {
      const ext = extname(args.out).toLowerCase();
      if (ext === '.csv') {
        writeFileSync(args.out, snapshotsToCsv(rows));
      } else {
        writeFileSync(args.out, JSON.stringify(rows, null, 2));
      }
      console.log(`[export-dataset] wrote ${args.out}`);
    }
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[export-dataset] failed:', err);
  process.exit(1);
});
