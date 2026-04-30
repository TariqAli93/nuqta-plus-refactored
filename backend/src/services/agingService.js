import { getDb } from '../db.js';
import { installments, sales } from '../models/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { branchFilterFor } from './scopeService.js';

/**
 * Aging buckets for receivables intelligence.
 *
 * Buckets partition pending installments by how many days they are PAST DUE
 * relative to today. A pending installment with dueDate >= today is "current"
 * and not counted in any overdue bucket — the sum of buckets reflects only
 * actually-late money.
 */
export const AGING_BUCKETS = Object.freeze({
  '0_7':    { min: 0,  max: 7   },
  '8_30':   { min: 8,  max: 30  },
  '31_60':  { min: 31, max: 60  },
  '61_plus': { min: 61, max: null },
});

function emptyBuckets() {
  return { '0_7': 0, '8_30': 0, '31_60': 0, '61_plus': 0 };
}

function n(v) {
  if (v === null || v === undefined) return 0;
  return Number(v) || 0;
}

/**
 * Bucket an installment row by its overdue age (days past dueDate).
 * Pending installments only — paid/cancelled never appear in aging.
 */
function bucketKeyForDays(daysPastDue) {
  if (daysPastDue < 0) return null;     // not yet due
  if (daysPastDue <= 7) return '0_7';
  if (daysPastDue <= 30) return '8_30';
  if (daysPastDue <= 60) return '31_60';
  return '61_plus';
}

/**
 * Aggregated aging buckets across all customers.
 *
 * @param {object} filters
 * @param {number} [filters.branchId]  Filter by sale branch (only honoured for global admins)
 * @param {string} [filters.currency]  'USD' | 'IQD' | 'ALL' (default 'ALL')
 * @param {object} actingUser          For branch isolation
 * @returns {{ totalOutstanding: number, buckets: Record<string, number>, byCurrency: Record<string, {totalOutstanding:number,buckets:Record<string,number>}> }}
 */
export async function getAging(filters = {}, actingUser = null) {
  const db = await getDb();
  const allowed = branchFilterFor(actingUser);
  const branchId =
    allowed === null
      ? (filters.branchId ? Number(filters.branchId) : null)
      : (allowed.length === 0 ? -1 : Number(allowed[0]));

  const conds = [
    eq(installments.status, 'pending'),
    sql`${installments.dueDate} < CURRENT_DATE::text`,
  ];
  if (branchId !== null && branchId !== undefined) {
    if (branchId === -1) conds.push(sql`1=0`);
    else conds.push(eq(sales.branchId, branchId));
  }
  if (filters.currency && filters.currency !== 'ALL') {
    conds.push(eq(installments.currency, filters.currency));
  }

  const rows = await db
    .select({
      currency: installments.currency,
      bucket: sql`CASE
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 7  THEN '0_7'
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 30 THEN '8_30'
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 60 THEN '31_60'
        ELSE '61_plus' END`.as('bucket'),
      amount: sql`COALESCE(SUM(${installments.remainingAmount}::numeric), 0)`.as('amount'),
    })
    .from(installments)
    .leftJoin(sales, eq(installments.saleId, sales.id))
    .where(and(...conds))
    .groupBy(installments.currency, sql`bucket`);

  const byCurrency = {};
  let totalOutstanding = 0;
  const totalBuckets = emptyBuckets();

  for (const r of rows) {
    const cur = r.currency || 'USD';
    byCurrency[cur] ??= { totalOutstanding: 0, buckets: emptyBuckets() };
    const amt = n(r.amount);
    byCurrency[cur].buckets[r.bucket] = (byCurrency[cur].buckets[r.bucket] || 0) + amt;
    byCurrency[cur].totalOutstanding += amt;
    totalBuckets[r.bucket] = (totalBuckets[r.bucket] || 0) + amt;
    totalOutstanding += amt;
  }

  return {
    totalOutstanding,
    buckets: totalBuckets,
    byCurrency,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Aging breakdown for a single customer. Same bucket structure as the
 * aggregate but limited to one customer's pending installments.
 */
export async function getAgingForCustomer(customerId, actingUser = null) {
  const db = await getDb();
  if (!customerId) {
    return { totalOutstanding: 0, buckets: emptyBuckets(), byCurrency: {}, asOf: new Date().toISOString().slice(0, 10) };
  }

  const allowed = branchFilterFor(actingUser);
  const conds = [
    eq(installments.customerId, Number(customerId)),
    eq(installments.status, 'pending'),
    sql`${installments.dueDate} < CURRENT_DATE::text`,
  ];
  if (allowed !== null) {
    if (allowed.length === 0) conds.push(sql`1=0`);
    else conds.push(eq(sales.branchId, Number(allowed[0])));
  }

  const rows = await db
    .select({
      currency: installments.currency,
      bucket: sql`CASE
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 7  THEN '0_7'
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 30 THEN '8_30'
        WHEN (CURRENT_DATE - ${installments.dueDate}::date) <= 60 THEN '31_60'
        ELSE '61_plus' END`.as('bucket'),
      amount: sql`COALESCE(SUM(${installments.remainingAmount}::numeric), 0)`.as('amount'),
      count: sql`COUNT(*)`.as('count'),
    })
    .from(installments)
    .leftJoin(sales, eq(installments.saleId, sales.id))
    .where(and(...conds))
    .groupBy(installments.currency, sql`bucket`);

  const byCurrency = {};
  const totalBuckets = emptyBuckets();
  let totalOutstanding = 0;
  let overdueCount = 0;

  for (const r of rows) {
    const cur = r.currency || 'USD';
    byCurrency[cur] ??= { totalOutstanding: 0, buckets: emptyBuckets() };
    const amt = n(r.amount);
    const cnt = Number(r.count) || 0;
    byCurrency[cur].buckets[r.bucket] = (byCurrency[cur].buckets[r.bucket] || 0) + amt;
    byCurrency[cur].totalOutstanding += amt;
    totalBuckets[r.bucket] = (totalBuckets[r.bucket] || 0) + amt;
    totalOutstanding += amt;
    overdueCount += cnt;
  }

  // Lightweight summary used by the credit-decision engine. Returns the
  // worst bucket present (highest age) so callers can branch on severity
  // without re-walking the bucket map.
  let worstBucket = null;
  for (const key of ['61_plus', '31_60', '8_30', '0_7']) {
    if ((totalBuckets[key] || 0) > 0) {
      worstBucket = key;
      break;
    }
  }

  return {
    customerId: Number(customerId),
    totalOutstanding,
    overdueCount,
    worstBucket,
    buckets: totalBuckets,
    byCurrency,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Internal helper used by the credit-decision engine to fold aging into a
 * boolean "has any 31+ day overdue debt" flag without a second DB call.
 */
export function hasSevereDelinquency(aging) {
  if (!aging || !aging.buckets) return false;
  return (aging.buckets['31_60'] || 0) > 0 || (aging.buckets['61_plus'] || 0) > 0;
}

export { bucketKeyForDays };

export default {
  getAging,
  getAgingForCustomer,
  hasSevereDelinquency,
};
