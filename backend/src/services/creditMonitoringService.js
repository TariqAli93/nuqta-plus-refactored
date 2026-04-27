import { getPool } from '../db.js';
import { LABEL_CONFIG } from './creditDatasetService.js';

/**
 * Credit-risk monitoring.
 *
 * Reads from the credit_scores inference log and the live installments /
 * credit_events tables to answer two production questions:
 *
 *   1. Drift: is the distribution of risk assessments today materially
 *      different from the recent historical mean?
 *   2. Accuracy: of the predictions made N days ago, how many actually
 *      defaulted within the labeling window?
 *
 * Designed to be cheap — all queries are aggregate-only, no per-row joins.
 * Safe to run on the same DB as the live workload.
 */

const DEFAULT_WINDOW_DAYS = LABEL_CONFIG.WINDOW_DAYS;

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Distribution of risk_level over the requested period. Used to detect a
 * sudden shift (e.g. all customers suddenly scored HIGH after a model swap).
 *
 * @param {object} opts
 * @param {Date}   [opts.since]    inclusive lower bound (default: 30 days ago)
 * @param {Date}   [opts.until]    inclusive upper bound (default: now)
 * @param {string} [opts.modelVersion]  filter by model version
 */
export async function getRiskDistribution({ since, until, modelVersion } = {}) {
  const pool = await getPool();
  const params = [];
  const where = ['1=1'];
  if (since) {
    params.push(since.toISOString());
    where.push(`created_at >= $${params.length}::timestamp`);
  }
  if (until) {
    params.push(until.toISOString());
    where.push(`created_at <= $${params.length}::timestamp`);
  }
  if (modelVersion) {
    params.push(modelVersion);
    where.push(`model_version = $${params.length}`);
  }
  const sql = `
    SELECT
      risk_level,
      COUNT(*)::int                AS n,
      AVG(risk_probability)::float AS avg_prob,
      MIN(risk_probability)::float AS min_prob,
      MAX(risk_probability)::float AS max_prob
    FROM credit_scores
    WHERE ${where.join(' AND ')}
    GROUP BY risk_level
    ORDER BY risk_level
  `;
  const res = await pool.query(sql, params);
  const out = { LOW: null, MEDIUM: null, HIGH: null };
  let total = 0;
  for (const row of res.rows) {
    out[row.risk_level] = {
      count: row.n,
      avgProbability: row.avg_prob,
      minProbability: row.min_prob,
      maxProbability: row.max_prob,
    };
    total += row.n;
  }
  return { total, byLevel: out };
}

/**
 * Compare today's risk distribution against the trailing baseline. A simple
 * Population Stability Index (PSI) per level — easy to read, easy to alert on.
 *
 *   PSI < 0.1   → no drift
 *   PSI < 0.25  → moderate drift
 *   PSI ≥ 0.25  → significant drift
 *
 * @param {object} opts
 * @param {number} [opts.recentDays=1]    window for "current"
 * @param {number} [opts.baselineDays=30] window for "baseline" preceding the recent window
 */
export async function getDriftReport({ recentDays = 1, baselineDays = 30 } = {}) {
  const now = new Date();
  const recentStart = addDays(now, -recentDays);
  const baselineEnd = recentStart;
  const baselineStart = addDays(baselineEnd, -baselineDays);

  const [recent, baseline] = await Promise.all([
    getRiskDistribution({ since: recentStart, until: now }),
    getRiskDistribution({ since: baselineStart, until: baselineEnd }),
  ]);

  const safeRate = (cell, total) => {
    if (!cell || !total) return 0;
    const r = cell.count / total;
    return r === 0 ? 1e-6 : r;
  };

  const levels = ['LOW', 'MEDIUM', 'HIGH'];
  let psi = 0;
  for (const lvl of levels) {
    const a = safeRate(recent.byLevel[lvl], recent.total);
    const b = safeRate(baseline.byLevel[lvl], baseline.total);
    psi += (a - b) * Math.log(a / b);
  }

  let severity;
  if (recent.total === 0 || baseline.total === 0) severity = 'unknown';
  else if (psi < 0.1) severity = 'stable';
  else if (psi < 0.25) severity = 'moderate';
  else severity = 'significant';

  return {
    psi: +psi.toFixed(4),
    severity,
    recent,
    baseline,
    recentDays,
    baselineDays,
  };
}

/**
 * For each scoring call old enough that the labeling window has fully
 * elapsed, compare the predicted risk_level to the actual outcome and
 * report classification metrics.
 *
 * Actual outcome = "did the customer default within `windowDays` of the
 * prediction timestamp?" — using the same labeling rule as the dataset
 * builder (delay ≥ 60d, ≥ 2 missed, or DEFAULTED event).
 *
 * @param {object} opts
 * @param {number} [opts.windowDays=90]
 * @param {number} [opts.lookbackDays=180] how far back to consider predictions
 * @param {string} [opts.modelVersion]
 */
export async function getAccuracyReport({
  windowDays = DEFAULT_WINDOW_DAYS,
  lookbackDays = 180,
  modelVersion,
} = {}) {
  const pool = await getPool();
  const params = [windowDays, lookbackDays];
  let extra = '';
  if (modelVersion) {
    params.push(modelVersion);
    extra = ` AND cs.model_version = $${params.length}`;
  }

  // For every score row whose window fits in the past:
  //   actual = 1 IF any installment of that customer in (created_at, created_at + window]
  //              is paid late ≥ 60d, or pending overdue by ≥ 60d, or 2+ pending overdue,
  //              or there's a DEFAULTED credit_event in that window.
  const sql = `
    WITH eligible AS (
      SELECT cs.id,
             cs.customer_id,
             cs.model_version,
             cs.risk_level,
             cs.risk_probability::float AS risk_probability,
             cs.created_at,
             cs.created_at + ($1 || ' days')::interval AS window_end
      FROM credit_scores cs
      WHERE cs.created_at <= NOW() - ($1 || ' days')::interval
        AND cs.created_at >= NOW() - ($2 || ' days')::interval
        ${extra}
    ),
    actual AS (
      SELECT e.id,
             e.risk_level,
             e.risk_probability,
             e.model_version,
             COALESCE((
               SELECT 1 FROM installments i
               WHERE i.customer_id = e.customer_id
                 AND (
                   (i.status = 'paid' AND i.paid_date IS NOT NULL
                     AND i.paid_date::timestamp >= e.created_at
                     AND i.paid_date::timestamp <= e.window_end
                     AND (i.paid_date::date - i.due_date::date) >= 60)
                   OR
                   (i.status = 'pending'
                     AND i.due_date::timestamp >= e.created_at
                     AND i.due_date::timestamp <= e.window_end
                     AND (e.window_end::date - i.due_date::date) >= 60)
                 )
               LIMIT 1
             ), 0) AS hit_severe,
             COALESCE((
               SELECT COUNT(*) FROM installments i
               WHERE i.customer_id = e.customer_id
                 AND i.status = 'pending'
                 AND i.due_date::timestamp >= e.created_at
                 AND i.due_date::timestamp <= e.window_end
                 AND (e.window_end::date - i.due_date::date) > 0
             ), 0) AS missed_count,
             COALESCE((
               SELECT 1 FROM credit_events ev
               WHERE ev.customer_id = e.customer_id
                 AND ev.event_type = 'DEFAULTED'
                 AND ev.created_at >= e.created_at
                 AND ev.created_at <= e.window_end
               LIMIT 1
             ), 0) AS hit_defaulted
      FROM eligible e
    )
    SELECT
      a.model_version,
      a.risk_level,
      COUNT(*)::int AS n,
      SUM(CASE WHEN (a.hit_severe = 1 OR a.missed_count >= 2 OR a.hit_defaulted = 1) THEN 1 ELSE 0 END)::int AS actual_defaulted,
      AVG(a.risk_probability)::float AS avg_prob
    FROM actual a
    GROUP BY a.model_version, a.risk_level
    ORDER BY a.model_version, a.risk_level
  `;

  const res = await pool.query(sql, params);

  // Aggregate confusion-matrix style numbers per model_version.
  const byVersion = new Map();
  let total = 0;
  for (const row of res.rows) {
    const v = row.model_version;
    if (!byVersion.has(v)) {
      byVersion.set(v, {
        modelVersion: v,
        total: 0,
        tp: 0, // predicted HIGH, actually defaulted
        fp: 0, // predicted HIGH, did not default
        tn: 0, // predicted LOW, did not default
        fn: 0, // predicted LOW, actually defaulted
        mediumCorrect: 0,
        mediumIncorrect: 0,
        levels: {},
      });
    }
    const bucket = byVersion.get(v);
    bucket.total += row.n;
    bucket.levels[row.risk_level] = {
      n: row.n,
      actualDefaulted: row.actual_defaulted,
      avgProb: row.avg_prob,
    };

    if (row.risk_level === 'HIGH') {
      bucket.tp += row.actual_defaulted;
      bucket.fp += row.n - row.actual_defaulted;
    } else if (row.risk_level === 'LOW') {
      bucket.tn += row.n - row.actual_defaulted;
      bucket.fn += row.actual_defaulted;
    } else {
      bucket.mediumCorrect += 0; // MEDIUM excluded from binary metrics
      bucket.mediumIncorrect += row.actual_defaulted;
    }
    total += row.n;
  }

  const versions = Array.from(byVersion.values()).map((b) => {
    const tp = b.tp;
    const fp = b.fp;
    const tn = b.tn;
    const fn = b.fn;
    const accuracy = b.total ? (tp + tn) / Math.max(1, tp + tn + fp + fn) : 0;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      ...b,
      accuracy: +accuracy.toFixed(4),
      precision: +precision.toFixed(4),
      recall: +recall.toFixed(4),
      f1: +f1.toFixed(4),
    };
  });

  return {
    windowDays,
    lookbackDays,
    total,
    byVersion: versions,
  };
}

/**
 * One-shot health summary — composes drift + accuracy reports. Suitable for
 * a /admin or /metrics endpoint.
 */
export async function getMonitoringSummary(opts = {}) {
  const [drift, accuracy] = await Promise.all([
    getDriftReport(opts.drift ?? {}),
    getAccuracyReport(opts.accuracy ?? {}),
  ]);
  return { drift, accuracy };
}
