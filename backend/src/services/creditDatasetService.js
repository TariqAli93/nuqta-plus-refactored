import { getDb, getPool } from '../db.js';
import { creditSnapshots, customers } from '../models/index.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Credit dataset builder.
 *
 * Produces (customer_id, snapshot_date) rows of behavior features + a
 * forward-looking default label, persisted into credit_snapshots and used to
 * train the ONNX model.
 *
 * ── Strict invariants ───────────────────────────────────────────────────
 *   1. Features at snapshot S only see data with created_at < S (or paid_date
 *      < S, or due_date < S — strictly before S). NO leakage.
 *   2. The label looks FORWARD: defaulted = true if any installment of that
 *      customer becomes overdue ≥ DEFAULT_DELAY_DAYS, has ≥ MISSED_THRESHOLD
 *      missed payments, or is manually defaulted within
 *      [snapshot_date, snapshot_date + label_window_days].
 *   3. Snapshots whose label window extends past `now()` are skipped — we
 *      cannot label them yet without peeking at the future.
 *   4. Idempotent: re-running over the same range upserts rather than
 *      duplicating. The unique index (customer_id, snapshot_date) is the
 *      conflict key.
 */

// ── Label thresholds ─────────────────────────────────────────────────────
export const LABEL_CONFIG = {
  DEFAULT_DELAY_DAYS: 60, // any single late payment ≥ N days → default
  MISSED_THRESHOLD: 2, // ≥ N pending-overdue installments → default
  WINDOW_DAYS: 90, // forward window
};

// Features the snapshot exposes (must match the order used for training and
// at inference time).
export const SNAPSHOT_FEATURE_ORDER = [
  'totalSalesOnInstallment',
  'totalPaidOnTime',
  'totalLatePayments',
  'avgDelayDays',
  'maxDelayDays',
  'currentOutstandingDebt',
  'activeInstallmentsCount',
  'completedInstallmentsCount',
];

// Format Date → 'YYYY-MM-DD' (UTC).
function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Compute features for a single customer as of `snapshotDate` (exclusive
 * boundary — only past data is used). Returns null if the customer has no
 * installment activity before the snapshot date (uninformative row).
 */
export async function buildSnapshotFeatures(customerId, snapshotDate, pool) {
  const snapISO = isoDate(snapshotDate);

  // Sales aggregates (only sales created strictly before snapshot)
  const salesQ = `
    SELECT
      COUNT(CASE WHEN payment_type IN ('installment','mixed') AND status != 'cancelled' THEN 1 END) AS total_sales,
      COUNT(CASE WHEN payment_type IN ('installment','mixed') AND status = 'paid' THEN 1 END)      AS completed_sales,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN remaining_amount::numeric ELSE 0 END), 0)     AS outstanding_debt,
      COALESCE(SUM(CASE WHEN payment_type IN ('installment','mixed') AND status != 'cancelled' THEN total::numeric ELSE 0 END), 0) AS total_sales_value
    FROM sales
    WHERE customer_id = $1
      AND created_at < $2::timestamp
  `;

  // Installment aggregates with strict "as-of snapshot" interpretation:
  //   - on-time = paid && paid_date <= due_date && paid_date < snapshot
  //   - late paid = paid && paid_date > due_date && paid_date < snapshot
  //   - active = pending && created_at < snapshot
  //   - max delay observed up to snapshot (paid late or pending overdue)
  const instQ = `
    SELECT
      COUNT(CASE WHEN status = 'paid' AND paid_date IS NOT NULL
                  AND paid_date::date <= due_date::date
                  AND paid_date::date < $2::date
        THEN 1 END) AS on_time,
      COUNT(CASE WHEN status = 'paid' AND paid_date IS NOT NULL
                  AND paid_date::date > due_date::date
                  AND paid_date::date < $2::date
        THEN 1 END) AS late_paid,
      COUNT(CASE WHEN status = 'pending'
                  AND created_at < $2::timestamp
        THEN 1 END) AS active,
      COUNT(CASE WHEN status = 'paid'
                  AND paid_date IS NOT NULL
                  AND paid_date::date < $2::date
        THEN 1 END) AS completed,
      COALESCE(AVG(CASE WHEN status = 'paid' AND paid_date IS NOT NULL
                          AND paid_date::date > due_date::date
                          AND paid_date::date < $2::date
        THEN (paid_date::date - due_date::date) END), 0)::numeric AS avg_delay,
      COALESCE(MAX(CASE
        WHEN status = 'paid' AND paid_date IS NOT NULL
             AND paid_date::date > due_date::date
             AND paid_date::date < $2::date
          THEN (paid_date::date - due_date::date)
        WHEN status = 'pending' AND due_date::date < $2::date
          THEN ($2::date - due_date::date)
        ELSE 0
      END), 0) AS max_delay
    FROM installments
    WHERE customer_id = $1
  `;

  const [salesRes, instRes] = await Promise.all([
    pool.query(salesQ, [customerId, snapISO]),
    pool.query(instQ, [customerId, snapISO]),
  ]);

  const s = salesRes.rows[0] || {};
  const i = instRes.rows[0] || {};

  const totalSales = Number(s.total_sales || 0);
  const completedSales = Number(s.completed_sales || 0);
  const onTime = Number(i.on_time || 0);
  const latePaid = Number(i.late_paid || 0);
  const active = Number(i.active || 0);
  const completed = Number(i.completed || 0);
  const avgDelay = Number(i.avg_delay || 0);
  const maxDelay = Number(i.max_delay || 0);
  const outstandingDebt = Number(s.outstanding_debt || 0);
  const totalSalesValue = Number(s.total_sales_value || 0);

  // Reject totally empty rows — no signal to learn from.
  if (totalSales === 0 && active === 0 && completed === 0) {
    return null;
  }

  return {
    totalSalesOnInstallment: totalSales,
    completedSales,
    totalPaidOnTime: onTime,
    totalLatePayments: latePaid,
    avgDelayDays: avgDelay,
    maxDelayDays: maxDelay,
    currentOutstandingDebt: outstandingDebt,
    activeInstallmentsCount: active,
    completedInstallmentsCount: completed,
    totalSalesValue,
  };
}

/**
 * Compute the forward-looking default label for `customerId` over
 * (snapshotDate, snapshotDate + windowDays].
 *
 * Returns true if any of:
 *   - any installment due in the window is paid `delay_days` >= DEFAULT_DELAY_DAYS,
 *   - or pending past due by >= DEFAULT_DELAY_DAYS as of `now`,
 *   - or ≥ MISSED_THRESHOLD pending-overdue installments exist in the window,
 *   - or the customer has any DEFAULTED credit_event in the window.
 */
export async function computeDefaultLabel(customerId, snapshotDate, windowDays, pool) {
  const startISO = isoDate(snapshotDate);
  const endISO = isoDate(addDays(snapshotDate, windowDays));

  const q = `
    WITH inst AS (
      SELECT
        MAX(CASE
          WHEN status = 'paid' AND paid_date IS NOT NULL
               AND paid_date::date >= $2::date AND paid_date::date <= $3::date
            THEN GREATEST(0, paid_date::date - due_date::date)
          WHEN status = 'pending'
               AND due_date::date >= $2::date AND due_date::date <= $3::date
            THEN GREATEST(0, $3::date - due_date::date)
          ELSE 0
        END) AS max_delay,
        COUNT(CASE
          WHEN status = 'pending'
               AND due_date::date >= $2::date AND due_date::date <= $3::date
               AND ($3::date - due_date::date) > 0
            THEN 1
        END) AS missed_count
      FROM installments
      WHERE customer_id = $1
    ),
    ev AS (
      SELECT COUNT(*) AS defaulted_events
      FROM credit_events
      WHERE customer_id = $1
        AND event_type = 'DEFAULTED'
        AND created_at >= $2::timestamp
        AND created_at <= $3::timestamp
    )
    SELECT inst.max_delay, inst.missed_count, ev.defaulted_events
    FROM inst, ev
  `;

  const res = await pool.query(q, [customerId, startISO, endISO]);
  const row = res.rows[0] || {};
  const maxDelay = Number(row.max_delay || 0);
  const missed = Number(row.missed_count || 0);
  const events = Number(row.defaulted_events || 0);

  return (
    maxDelay >= LABEL_CONFIG.DEFAULT_DELAY_DAYS ||
    missed >= LABEL_CONFIG.MISSED_THRESHOLD ||
    events > 0
  );
}

/**
 * Generate snapshots for a single customer at every date in `dates`.
 * Returns the number of snapshot rows actually inserted/upserted.
 */
async function buildCustomerSnapshots(customerId, dates, windowDays, pool) {
  const now = new Date();
  const cutoff = addDays(now, -windowDays); // labels needed; cannot include future
  const usableDates = dates.filter((d) => new Date(d) <= cutoff);

  let inserted = 0;
  for (const d of usableDates) {
    const features = await buildSnapshotFeatures(customerId, d, pool);
    if (!features) continue;
    const label = await computeDefaultLabel(customerId, d, windowDays, pool);

    const text = `
      INSERT INTO credit_snapshots (
        customer_id, snapshot_date,
        total_sales_on_installment, total_paid_on_time, total_late_payments,
        avg_delay_days, max_delay_days,
        current_outstanding_debt, active_installments_count,
        completed_installments_count,
        label_defaulted, label_window_days
      ) VALUES (
        $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (customer_id, snapshot_date) DO UPDATE SET
        total_sales_on_installment = EXCLUDED.total_sales_on_installment,
        total_paid_on_time         = EXCLUDED.total_paid_on_time,
        total_late_payments        = EXCLUDED.total_late_payments,
        avg_delay_days             = EXCLUDED.avg_delay_days,
        max_delay_days             = EXCLUDED.max_delay_days,
        current_outstanding_debt   = EXCLUDED.current_outstanding_debt,
        active_installments_count  = EXCLUDED.active_installments_count,
        completed_installments_count = EXCLUDED.completed_installments_count,
        label_defaulted            = EXCLUDED.label_defaulted,
        label_window_days          = EXCLUDED.label_window_days
    `;
    await pool.query(text, [
      customerId,
      isoDate(d),
      features.totalSalesOnInstallment,
      features.totalPaidOnTime,
      features.totalLatePayments,
      Number(features.avgDelayDays).toFixed(4),
      features.maxDelayDays,
      Number(features.currentOutstandingDebt).toFixed(4),
      features.activeInstallmentsCount,
      features.completedInstallmentsCount,
      label,
      windowDays,
    ]);
    inserted++;
  }
  return inserted;
}

/**
 * Generate a list of snapshot dates between [start, end] at fixed cadence.
 * Inclusive of `start`, exclusive of `end`. Cadence in days.
 */
export function generateSnapshotDates(start, end, cadenceDays = 30) {
  const out = [];
  const startD = new Date(start);
  const endD = new Date(end);
  for (let cur = new Date(startD); cur < endD; cur = addDays(cur, cadenceDays)) {
    out.push(new Date(cur));
  }
  return out;
}

/**
 * Build snapshots for all active customers across the requested date range.
 *
 * @param {object}  opts
 * @param {Date}    [opts.start]        — earliest snapshot date (default: 1y ago)
 * @param {Date}    [opts.end]          — latest snapshot date (default: now - window)
 * @param {number}  [opts.cadenceDays]  — days between snapshots per customer
 * @param {number}  [opts.windowDays]   — forward labeling window
 * @param {(p:object)=>void} [opts.onProgress]
 */
export async function buildDatasetForAllCustomers({
  start,
  end,
  cadenceDays = 30,
  windowDays = LABEL_CONFIG.WINDOW_DAYS,
  onProgress,
} = {}) {
  const db = await getDb();
  const pool = await getPool();

  const now = new Date();
  const defaultEnd = addDays(now, -windowDays);
  const defaultStart = addDays(defaultEnd, -365);
  const startD = start ? new Date(start) : defaultStart;
  const endD = end ? new Date(end) : defaultEnd;

  if (startD >= endD) {
    return { customers: 0, snapshots: 0, dates: [] };
  }

  const dates = generateSnapshotDates(startD, endD, cadenceDays);
  const active = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isActive, true));

  let totalInserted = 0;
  for (let k = 0; k < active.length; k++) {
    const id = active[k].id;
    try {
      const n = await buildCustomerSnapshots(id, dates, windowDays, pool);
      totalInserted += n;
    } catch (err) {
      // Don't let one bad customer kill the run.
      console.error(`[creditDataset] customer ${id} failed: ${err.message}`);
    }
    if (onProgress) {
      onProgress({ processed: k + 1, total: active.length, snapshots: totalInserted });
    }
  }

  return {
    customers: active.length,
    snapshots: totalInserted,
    dates: dates.map(isoDate),
    windowDays,
    cadenceDays,
  };
}

/**
 * Read-only loader: stream all snapshots ordered by snapshot_date for use by
 * the training script. Returns an array of plain objects (no Drizzle helpers
 * leaking out).
 */
export async function loadSnapshotsForTraining({ minDate, maxDate } = {}) {
  const db = await getDb();
  const conditions = [];
  if (minDate) {
    conditions.push(sql`${creditSnapshots.snapshotDate} >= ${isoDate(minDate)}`);
  }
  if (maxDate) {
    conditions.push(sql`${creditSnapshots.snapshotDate} <= ${isoDate(maxDate)}`);
  }
  let q = db.select().from(creditSnapshots);
  if (conditions.length) {
    q = q.where(sql.join(conditions, sql` AND `));
  }
  q = q.orderBy(creditSnapshots.snapshotDate, creditSnapshots.id);
  const rows = await q;

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    snapshotDate: r.snapshotDate,
    totalSalesOnInstallment: Number(r.totalSalesOnInstallment || 0),
    totalPaidOnTime: Number(r.totalPaidOnTime || 0),
    totalLatePayments: Number(r.totalLatePayments || 0),
    avgDelayDays: Number(r.avgDelayDays || 0),
    maxDelayDays: Number(r.maxDelayDays || 0),
    currentOutstandingDebt: Number(r.currentOutstandingDebt || 0),
    activeInstallmentsCount: Number(r.activeInstallmentsCount || 0),
    completedInstallmentsCount: Number(r.completedInstallmentsCount || 0),
    labelDefaulted: !!r.labelDefaulted,
    labelWindowDays: Number(r.labelWindowDays || LABEL_CONFIG.WINDOW_DAYS),
  }));
}

/**
 * Serialize snapshots as CSV. Order of columns is fixed for downstream tools.
 */
export function snapshotsToCsv(rows) {
  const header = [
    'id',
    'customer_id',
    'snapshot_date',
    ...SNAPSHOT_FEATURE_ORDER.map((k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())),
    'label_defaulted',
    'label_window_days',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.customerId,
        r.snapshotDate,
        r.totalSalesOnInstallment,
        r.totalPaidOnTime,
        r.totalLatePayments,
        Number(r.avgDelayDays).toFixed(4),
        r.maxDelayDays,
        Number(r.currentOutstandingDebt).toFixed(4),
        r.activeInstallmentsCount,
        r.completedInstallmentsCount,
        r.labelDefaulted ? 1 : 0,
        r.labelWindowDays,
      ].join(',')
    );
  }
  return lines.join('\n');
}
