import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getPool, closeDatabase } from '../src/db.js';
import reportService from '../src/services/reportService.js';

/**
 * Regression test for the "collected amounts ignore refunds" reporting bug.
 *
 * Refunds are recorded on `sale_returns` (refund_amount + refund_method) — NO
 * payment row is created — so the dashboard's collected total used to stay at
 * the gross figure even when every invoice was refunded. The dashboard must now
 * expose: refundedAmount and netCollected = totalPaid − refundedAmount, plus the
 * per-method net (cashNet, …).
 *
 * Isolated fixture: currency 'PSR' + year 2099 (no real data) so the IQD bucket
 * reflects only this fixture. Cleaned up in `after`.
 *
 * Scenario: one cash invoice of 150 fully refunded in cash.
 */

const ADMIN = { id: null, role: 'admin' };
const DAY = '2099-06-15';
const RANGE = { dateFrom: '2099-01-01', dateTo: '2099-12-31', currency: 'PSR' };
const ids = {};

before(async () => {
  const pool = await getPool();

  const sale = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, created_at, issued_at)
     VALUES ($1, 150, 150, 'PSR', 'cash', 'returned', 0, 0, $2::timestamp, $2::timestamp)
     RETURNING id`,
    [`TEST-PAYSUM-${Date.now()}`, DAY]
  );
  ids.saleId = sale.rows[0].id;

  const pay = await pool.query(
    `INSERT INTO payments (sale_id, amount, currency, payment_method, payment_date, created_at)
     VALUES ($1, 150, 'PSR', 'cash', $2::timestamp, $2::timestamp) RETURNING id`,
    [ids.saleId, DAY]
  );
  ids.paymentId = pay.rows[0].id;

  const ret = await pool.query(
    `INSERT INTO sale_returns (sale_id, returned_value, refund_amount, refund_method, debt_reduction,
                               currency, created_at)
     VALUES ($1, 150, 150, 'cash', 0, 'PSR', $2::timestamp) RETURNING id`,
    [ids.saleId, DAY]
  );
  ids.returnId = ret.rows[0].id;
});

after(async () => {
  try {
    const pool = await getPool();
    if (ids.returnId) await pool.query('DELETE FROM sale_returns WHERE id = $1', [ids.returnId]);
    if (ids.paymentId) await pool.query('DELETE FROM payments WHERE id = $1', [ids.paymentId]);
    if (ids.saleId) await pool.query('DELETE FROM sales WHERE id = $1', [ids.saleId]);
  } finally {
    await closeDatabase().catch(() => {});
  }
});

test('fully refunded period: collected stays, refunded matches, net is zero', async () => {
  const report = await reportService.getDashboard(RANGE, ADMIN);
  const iqd = report.kpisByCurrency.PSR;
  assert.ok(iqd, 'expected an IQD KPI bucket');
  assert.equal(iqd.totalPaid, 150, 'collected should remain the gross 150 (not erased)');
  assert.equal(iqd.refundedAmount, 150, 'refunded should equal the refunded cash');
  assert.equal(iqd.netCollected, 0, 'net collected = 150 − 150 = 0');
});

test('per-method net is exposed (cash collected − cash refunded)', async () => {
  const report = await reportService.getDashboard(RANGE, ADMIN);
  const iqd = report.kpisByCurrency.PSR;
  assert.equal(iqd.cashPayments, 150, 'cash collected');
  assert.equal(iqd.cashRefunds, 150, 'cash refunded');
  assert.equal(iqd.cashNet, 0, 'cash net = 0');
});

test('partial refund reduces net by the refunded portion only', async () => {
  const pool = await getPool();
  await pool.query(`UPDATE sale_returns SET returned_value = 60, refund_amount = 60 WHERE id = $1`, [
    ids.returnId,
  ]);
  const report = await reportService.getDashboard(RANGE, ADMIN);
  const iqd = report.kpisByCurrency.PSR;
  assert.equal(iqd.totalPaid, 150, 'collected unchanged');
  assert.equal(iqd.refundedAmount, 60, 'refunded = partial 60');
  assert.equal(iqd.netCollected, 90, 'net = 150 − 60');
  assert.equal(iqd.cashNet, 90, 'cash net = 150 − 60');
});

test('credit-only return (debt forgiven, no cash back) does not count as refunded', async () => {
  const pool = await getPool();
  // refund_amount 0 + method credit → money was not handed back.
  await pool.query(
    `UPDATE sale_returns SET returned_value = 150, refund_amount = 0, refund_method = 'credit' WHERE id = $1`,
    [ids.returnId]
  );
  const report = await reportService.getDashboard(RANGE, ADMIN);
  const iqd = report.kpisByCurrency.PSR;
  assert.equal(iqd.refundedAmount, 0, 'a credit/debt-forgiveness return refunds no cash');
  assert.equal(iqd.netCollected, 150, 'net collected stays at collected when nothing was refunded');
});
