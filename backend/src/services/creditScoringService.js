import { getDb } from '../db.js';
import { customers, sales, installments } from '../models/index.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Rule-based credit scoring.
 *
 * Score is 0–100. A recommendedLimit (currency of the customer's most recent
 * installment sale, falling back to IQD) is computed from score tier + history.
 *
 * Keep all tunable weights/thresholds in CREDIT_SCORING_CONFIG below — never
 * embed numbers in business logic.
 */
export const CREDIT_SCORING_CONFIG = {
  // Base score (every customer starts here)
  BASE_SCORE: 100,

  // Penalties
  LATE_PAYMENT_PENALTY: 5, // per late payment
  LATE_PAYMENT_CAP: 40, // max total penalty from late payments

  AVG_DELAY_PENALTY_PER_DAY: 0.5, // per average delay day
  AVG_DELAY_CAP: 20,

  HIGH_DEBT_RATIO_THRESHOLD: 0.5, // outstanding / total > 50%
  HIGH_DEBT_RATIO_PENALTY: 15,

  ACTIVE_INSTALLMENTS_THRESHOLD: 3, // more than N open installments
  ACTIVE_INSTALLMENTS_PENALTY: 10,

  // Bonuses
  ON_TIME_RATIO_BONUS_THRESHOLD: 0.9, // >= 90% on time
  ON_TIME_RATIO_BONUS: 5,

  LOYALTY_SALES_THRESHOLD: 10, // >= N installment sales
  LOYALTY_BONUS: 5,

  // Score tiers for recommended-limit computation
  TIERS: {
    excellent: { min: 85, multiplier: 1.5 }, // 150% of avg sale value
    good: { min: 70, multiplier: 1.0 },
    fair: { min: 50, multiplier: 0.5 },
    poor: { min: 0, multiplier: 0.0 },
  },

  // Minimum recommended limit for new/unknown customers (no history)
  NEW_CUSTOMER_DEFAULT_SCORE: 70,
  NEW_CUSTOMER_DEFAULT_LIMIT: 500000, // in base currency (IQD)

  // Thresholds for classifying a payment as late (days past due)
  LATE_PAYMENT_DAY_THRESHOLD: 0,
};

/**
 * Gather the raw inputs for a customer's credit score from the database.
 * Returns the 6 signals listed in the spec.
 */
async function gatherCustomerMetrics(customerId, db) {
  // 1. total_sales_on_installment — count of installment/mixed sales
  // 2. current_outstanding_debt — sum of remaining_amount across open sales
  // 3. active_installments_count — pending installments
  const [saleStats] = await db
    .select({
      totalSales: sql`COALESCE(COUNT(CASE WHEN ${sales.paymentType} IN ('installment','mixed') AND ${sales.status} != 'cancelled' THEN 1 END), 0)`,
      outstandingDebt: sql`COALESCE(SUM(CASE WHEN ${sales.status} = 'pending' THEN ${sales.remainingAmount}::numeric ELSE 0 END), 0)`,
      totalSalesValue: sql`COALESCE(SUM(CASE WHEN ${sales.paymentType} IN ('installment','mixed') AND ${sales.status} != 'cancelled' THEN ${sales.total}::numeric ELSE 0 END), 0)`,
    })
    .from(sales)
    .where(eq(sales.customerId, customerId));

  const [installmentStats] = await db
    .select({
      activeInstallments: sql`COALESCE(COUNT(CASE WHEN ${installments.status} = 'pending' THEN 1 END), 0)`,
      totalPaidInstallments: sql`COALESCE(COUNT(CASE WHEN ${installments.status} = 'paid' THEN 1 END), 0)`,
      // paid on time means paid_date <= due_date (when both present)
      onTimePaid: sql`COALESCE(COUNT(CASE WHEN ${installments.status} = 'paid' AND ${installments.paidDate} IS NOT NULL AND ${installments.paidDate} <= ${installments.dueDate} THEN 1 END), 0)`,
      // late payments: paid after due, or still pending but overdue
      latePaid: sql`COALESCE(COUNT(CASE WHEN (${installments.status} = 'paid' AND ${installments.paidDate} > ${installments.dueDate}) OR (${installments.status} = 'pending' AND ${installments.dueDate} < CURRENT_DATE) THEN 1 END), 0)`,
      // average delay (days) on paid-late installments
      avgDelayDays: sql`COALESCE(AVG(CASE WHEN ${installments.status} = 'paid' AND ${installments.paidDate} > ${installments.dueDate} THEN (${installments.paidDate}::date - ${installments.dueDate}::date) END), 0)`,
    })
    .from(installments)
    .where(eq(installments.customerId, customerId));

  return {
    totalSalesOnInstallment: Number(saleStats?.totalSales || 0),
    totalPaidOnTime: Number(installmentStats?.onTimePaid || 0),
    totalLatePayments: Number(installmentStats?.latePaid || 0),
    avgDelayDays: Number(installmentStats?.avgDelayDays || 0),
    currentOutstandingDebt: Number(saleStats?.outstandingDebt || 0),
    activeInstallmentsCount: Number(installmentStats?.activeInstallments || 0),
    totalSalesValue: Number(saleStats?.totalSalesValue || 0),
  };
}

/**
 * Apply scoring rules to the gathered metrics.
 * Pure function — no DB access — easy to unit test.
 */
export function scoreFromMetrics(metrics, cfg = CREDIT_SCORING_CONFIG) {
  // New customer with no history gets the default score & limit
  if (metrics.totalSalesOnInstallment === 0) {
    return {
      score: cfg.NEW_CUSTOMER_DEFAULT_SCORE,
      recommendedLimit: cfg.NEW_CUSTOMER_DEFAULT_LIMIT,
    };
  }

  let score = cfg.BASE_SCORE;

  // Late-payment penalty (capped)
  const latePenalty = Math.min(
    metrics.totalLatePayments * cfg.LATE_PAYMENT_PENALTY,
    cfg.LATE_PAYMENT_CAP
  );
  score -= latePenalty;

  // Average delay penalty (capped)
  const delayPenalty = Math.min(
    metrics.avgDelayDays * cfg.AVG_DELAY_PENALTY_PER_DAY,
    cfg.AVG_DELAY_CAP
  );
  score -= delayPenalty;

  // High debt ratio penalty
  const debtRatio =
    metrics.totalSalesValue > 0
      ? metrics.currentOutstandingDebt / metrics.totalSalesValue
      : 0;
  if (debtRatio > cfg.HIGH_DEBT_RATIO_THRESHOLD) {
    score -= cfg.HIGH_DEBT_RATIO_PENALTY;
  }

  // Too many active installments penalty
  if (metrics.activeInstallmentsCount > cfg.ACTIVE_INSTALLMENTS_THRESHOLD) {
    score -= cfg.ACTIVE_INSTALLMENTS_PENALTY;
  }

  // Good-history bonuses
  const totalFinishedPayments = metrics.totalPaidOnTime + metrics.totalLatePayments;
  if (totalFinishedPayments > 0) {
    const onTimeRatio = metrics.totalPaidOnTime / totalFinishedPayments;
    if (onTimeRatio >= cfg.ON_TIME_RATIO_BONUS_THRESHOLD) {
      score += cfg.ON_TIME_RATIO_BONUS;
    }
  }

  if (metrics.totalSalesOnInstallment >= cfg.LOYALTY_SALES_THRESHOLD) {
    score += cfg.LOYALTY_BONUS;
  }

  // Clamp 0..100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Recommended limit: tier multiplier * avg sale value, reduced by outstanding debt
  const avgSaleValue =
    metrics.totalSalesValue / Math.max(1, metrics.totalSalesOnInstallment);

  const tier = Object.values(cfg.TIERS)
    .sort((a, b) => b.min - a.min)
    .find((t) => score >= t.min);
  const multiplier = tier ? tier.multiplier : 0;

  let recommendedLimit = avgSaleValue * multiplier;
  // Subtract what they already owe — never offer more headroom than their actual risk allows
  recommendedLimit = Math.max(0, recommendedLimit - metrics.currentOutstandingDebt);
  recommendedLimit = Math.round(recommendedLimit);

  return { score, recommendedLimit };
}

/**
 * Calculate a single customer's credit score and recommended limit.
 * Does NOT persist — callers (job/controller) decide whether to write.
 */
export async function calculateCreditScore(customerId) {
  const db = await getDb();
  const metrics = await gatherCustomerMetrics(customerId, db);
  return scoreFromMetrics(metrics);
}

/**
 * Calculate + persist for a single customer. Returns the new values.
 * Kept separate so read-only callers (POS hot path) can call calculateCreditScore
 * without side effects.
 */
export async function calculateAndPersistCreditScore(customerId) {
  const db = await getDb();
  const { score, recommendedLimit } = await calculateCreditScore(customerId);

  await db
    .update(customers)
    .set({
      creditScore: score,
      creditScoreUpdatedAt: new Date(),
      recommendedLimit: String(recommendedLimit),
    })
    .where(eq(customers.id, customerId));

  return { score, recommendedLimit };
}

/**
 * Batch variant used by the nightly job. Processes customers in chunks to
 * avoid long-running queries and to keep transaction sizes small.
 *
 * @param {object} opts
 * @param {number} [opts.batchSize=100]  How many customers per chunk
 * @param {number} [opts.concurrency=4]  Parallel scores per chunk
 * @param {(progress:object)=>void} [opts.onProgress]
 */
export async function recalculateAllScores({
  batchSize = 100,
  concurrency = 4,
  onProgress,
} = {}) {
  const db = await getDb();
  const allIds = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isActive, true));

  const ids = allIds.map((r) => r.id);
  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);

    // Limited concurrency inside each chunk
    for (let j = 0; j < chunk.length; j += concurrency) {
      const slice = chunk.slice(j, j + concurrency);
      const results = await Promise.allSettled(
        slice.map((id) => calculateAndPersistCreditScore(id))
      );
      for (const r of results) {
        processed++;
        if (r.status === 'fulfilled') updated++;
        else failed++;
      }
      if (onProgress) onProgress({ processed, updated, failed, total: ids.length });
    }
  }

  return { processed, updated, failed, total: ids.length };
}

/**
 * Light helper used on the POS hot path. Reads the cached score/limit from
 * the customer row — no recalculation, no joins.
 */
export async function getCustomerCreditSnapshot(customerId) {
  if (!customerId) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      creditScore: customers.creditScore,
      creditScoreUpdatedAt: customers.creditScoreUpdatedAt,
      recommendedLimit: customers.recommendedLimit,
      totalDebt: customers.totalDebt,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    creditScore: row.creditScore == null ? null : Number(row.creditScore),
    recommendedLimit:
      row.recommendedLimit == null ? null : Number(row.recommendedLimit),
    totalDebt: row.totalDebt == null ? 0 : Number(row.totalDebt),
  };
}
