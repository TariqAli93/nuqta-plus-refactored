#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * POS performance benchmark — verifies the nightly credit-scoring job does
 * not materially affect POS response time.
 *
 * Flow:
 *   1. baseline       → hit POS endpoints without the job running
 *   2. job + load     → trigger job run (sync) in parallel with the same load
 *   3. compare        → average / p95 / error rate / throughput
 *
 * Uses only Node built-ins (no extra deps) so it runs anywhere the backend
 * does. Supply a JWT (obtained via /api/auth/login) for authenticated calls.
 *
 * Usage:
 *   node src/scripts/perf-benchmark.js \
 *     --url http://127.0.0.1:41732 \
 *     --token <jwt> \
 *     --duration 15 --concurrency 10
 *
 * Env alternatives: BENCH_URL, BENCH_TOKEN, BENCH_DURATION, BENCH_CONCURRENCY
 */

import { setTimeout as delay } from 'node:timers/promises';

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.url || process.env.BENCH_URL || 'http://127.0.0.1:41732';
const TOKEN = args.token || process.env.BENCH_TOKEN;
const DURATION_SEC = Number(args.duration || process.env.BENCH_DURATION || 15);
const CONCURRENCY = Number(args.concurrency || process.env.BENCH_CONCURRENCY || 10);
// Read-only path used as a POS-style hot endpoint. Same query shape a NewSale
// page would hit when populating the customer list and product picker.
const LOAD_PATH = args.path || process.env.BENCH_PATH || '/api/sales?limit=10&page=1';

if (!TOKEN) {
  console.error('Missing --token (or BENCH_TOKEN env) — login first and pass the JWT');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

/** Single request → returns { ms, ok } */
async function hit(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE_URL + path, { headers });
    // Drain body so keep-alive works
    await res.arrayBuffer();
    return { ms: performance.now() - t0, ok: res.ok, status: res.status };
  } catch (err) {
    return { ms: performance.now() - t0, ok: false, status: 0, err: err.message };
  }
}

/** Run a closed-loop load test for `durationMs`. */
async function loadTest({ durationMs, concurrency, path, label }) {
  const stopAt = Date.now() + durationMs;
  const samples = [];
  let errors = 0;

  async function worker() {
    while (Date.now() < stopAt) {
      const r = await hit(path);
      samples.push(r.ms);
      if (!r.ok) errors++;
    }
  }

  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - t0) / 1000;

  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];

  const report = {
    label,
    requests: samples.length,
    errors,
    errorRate: samples.length ? errors / samples.length : 0,
    rps: samples.length / elapsed,
    avgMs: +avg.toFixed(2),
    p50Ms: +p50.toFixed(2),
    p95Ms: +p95.toFixed(2),
    p99Ms: +p99.toFixed(2),
    durationSec: +elapsed.toFixed(2),
  };
  return report;
}

async function triggerJob({ sync = true } = {}) {
  const url = `${BASE_URL}/api/jobs/credit-scoring/run${sync ? '?sync=1' : ''}`;
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', headers });
  const body = await res.json().catch(() => ({}));
  const ms = performance.now() - t0;
  return { ok: res.ok, status: res.status, ms, body };
}

function printReport(report) {
  console.log('');
  console.log(`=== ${report.label} ===`);
  console.log(`  requests   : ${report.requests}`);
  console.log(`  rps        : ${report.rps.toFixed(2)}`);
  console.log(`  errors     : ${report.errors} (${(report.errorRate * 100).toFixed(2)}%)`);
  console.log(`  avg latency: ${report.avgMs} ms`);
  console.log(`  p50        : ${report.p50Ms} ms`);
  console.log(`  p95        : ${report.p95Ms} ms`);
  console.log(`  p99        : ${report.p99Ms} ms`);
}

function printDelta(base, job) {
  const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);
  console.log('');
  console.log('=== Delta (job-under-load vs baseline) ===');
  console.log(`  avg  : ${pct(job.avgMs, base.avgMs).toFixed(2)}%`);
  console.log(`  p95  : ${pct(job.p95Ms, base.p95Ms).toFixed(2)}%`);
  console.log(`  p99  : ${pct(job.p99Ms, base.p99Ms).toFixed(2)}%`);
  console.log(`  rps  : ${pct(job.rps, base.rps).toFixed(2)}%`);
  console.log(
    `  error-rate delta: ${((job.errorRate - base.errorRate) * 100).toFixed(2)} pp`
  );
}

(async () => {
  console.log(`Benchmark target : ${BASE_URL}`);
  console.log(`Path             : ${LOAD_PATH}`);
  console.log(`Duration         : ${DURATION_SEC}s (each phase)`);
  console.log(`Concurrency      : ${CONCURRENCY}`);

  console.log('\n[1/3] Warm up…');
  await loadTest({ durationMs: 2000, concurrency: 2, path: LOAD_PATH, label: 'warmup' });

  console.log('[2/3] Baseline (no job running)…');
  const baseline = await loadTest({
    durationMs: DURATION_SEC * 1000,
    concurrency: CONCURRENCY,
    path: LOAD_PATH,
    label: 'baseline',
  });

  console.log('[3/3] Job + load (scoring job running concurrently)…');
  // Fire the job and run load at the same time.
  // Using sync=1 makes the job request block until the full run completes,
  // so we definitely overlap the two workloads.
  const jobPromise = triggerJob({ sync: true });
  // tiny head-start so the job is definitely in flight when we start load
  await delay(50);
  const underLoad = await loadTest({
    durationMs: DURATION_SEC * 1000,
    concurrency: CONCURRENCY,
    path: LOAD_PATH,
    label: 'job-under-load',
  });
  const job = await jobPromise;

  printReport(baseline);
  printReport(underLoad);
  printDelta(baseline, underLoad);

  console.log('');
  console.log(
    `Scoring job finished in ${job.ms.toFixed(0)} ms → ${JSON.stringify(job.body?.data || job.body || {})}`
  );

  // Non-zero exit if p95 regressed by more than 25% or errors spiked.
  const p95Regress = (underLoad.p95Ms - baseline.p95Ms) / baseline.p95Ms;
  const errorRegress = underLoad.errorRate - baseline.errorRate;
  if (p95Regress > 0.25 || errorRegress > 0.01) {
    console.error(
      `\nRegression detected: p95 +${(p95Regress * 100).toFixed(1)}%, errorRate +${(errorRegress * 100).toFixed(2)}pp`
    );
    process.exit(2);
  }
  process.exit(0);
})().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
