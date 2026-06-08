import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getPool, closeDatabase } from '../src/db.js';
import { SaleService } from '../src/services/saleService.js';
import reportService from '../src/services/reportService.js';

/**
 * Regression: item-return refund must use the ORIGINAL invoice sale price, and
 * reports must remove the returned item's profit using the ORIGINAL sale-time
 * cost (never the product's current cost / purchase price).
 *
 * Headline example: cost 3, sold 10 → refund 10, remaining profit 0.
 *
 * Isolated by unique currencies + year 2098 so report buckets reflect only this
 * fixture. Cleaned up in `after`.
 */

const saleService = new SaleService();
const ADMIN = { id: null, role: 'admin', username: 't' };
const DAY = '2098-06-15';
const RANGE = { dateFrom: '2098-01-01', dateTo: '2098-12-31' };
const ids = {};

async function makeSale(pool, { currency, qty, total }) {
  const p = await pool.query(
    `INSERT INTO products (name, cost_price, selling_price, currency, product_type, is_active)
     VALUES ($1, 3, 10, $2, 'inventory', true) RETURNING id`,
    [`RET-RFD-${currency}-${Date.now()}`, currency]
  );
  const pid = p.rows[0].id;
  const s = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, created_at, issued_at)
     VALUES ($1, $2, $2, $3, 'cash', 'completed', $2, 0, $4::timestamp, $4::timestamp) RETURNING id`,
    [`RET-RFD-${currency}-${Date.now()}`, total, currency, DAY]
  );
  const sid = s.rows[0].id;
  const si = await pool.query(
    `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal,
                            unit_cost_price, base_quantity, unit_conversion_factor)
     VALUES ($1, $2, 'cover', $3, 10, $4, 3, $3, 1) RETURNING id`,
    [sid, pid, qty, total]
  );
  return { pid, sid, siid: si.rows[0].id };
}

before(async () => {
  const pool = await getPool();
  ids.full = await makeSale(pool, { currency: 'RF1', qty: 1, total: 10 }); // full-return case
  ids.partial = await makeSale(pool, { currency: 'RF2', qty: 2, total: 20 }); // partial + cost-change case
});

after(async () => {
  const pool = await getPool();
  const del = async (t, p) => { try { await pool.query(t, p); } catch { /* ignore */ } };
  for (const k of ['full', 'partial']) {
    const f = ids[k];
    if (!f) continue;
    await del('DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE sale_id=$1)', [f.sid]);
    await del('DELETE FROM sale_returns WHERE sale_id=$1', [f.sid]);
    await del('DELETE FROM stock_movements WHERE reference_id=$1', [f.sid]);
    await del('DELETE FROM sale_items WHERE sale_id=$1', [f.sid]);
    await del('DELETE FROM sales WHERE id=$1', [f.sid]);
    await del('DELETE FROM products WHERE id=$1', [f.pid]);
  }
  await closeDatabase().catch(() => {});
});

test('full item return refunds the ORIGINAL sale price (10), not the cost (3)', async () => {
  const res = await saleService.createReturn(
    ids.full.sid,
    { items: [{ saleItemId: ids.full.siid, quantity: 1 }], refundAmount: 10, refundMethod: 'cash' },
    ADMIN
  );
  const r = res.returns[res.returns.length - 1];
  assert.equal(r.returnedValue, 10, 'returned value = sale price 10');
  assert.equal(r.refundAmount, 10, 'refund = sale price 10 (NOT cost 3)');

  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT subtotal, unit_price FROM sale_return_items WHERE return_id=$1', [r.id]
  );
  assert.equal(Number(rows[0].subtotal), 10, 'returned item recorded at sale price');
});

test('after full return: net sales, net cost and profit are all zero', async () => {
  const report = await reportService.getProfitReport({ ...RANGE, currency: 'RF1' }, ADMIN);
  const t = report.totals.byCurrency.RF1;
  assert.ok(t, 'RF1 bucket exists');
  assert.equal(t.revenue, 0, 'net sales 0');
  assert.equal(t.cogs, 0, 'net cost 0');
  assert.equal(t.grossProfit, 0, 'remaining profit 0');
  assert.equal(t.netProfit, 0);
});

test('partial return refunds sale price and keeps remaining profit at original cost — even after the product cost changes', async () => {
  const res = await saleService.createReturn(
    ids.partial.sid,
    { items: [{ saleItemId: ids.partial.siid, quantity: 1 }], refundAmount: 10, refundMethod: 'cash' },
    ADMIN
  );
  const r = res.returns[res.returns.length - 1];
  assert.equal(r.refundAmount, 10, 'partial refund = 1 × sale price 10');

  // Simulate the product cost changing AFTER the sale. Reports must ignore it
  // and use the sale-time snapshot cost (3), not the new cost (99).
  const pool = await getPool();
  await pool.query('UPDATE products SET cost_price = 99 WHERE id=$1', [ids.partial.pid]);

  const report = await reportService.getProfitReport({ ...RANGE, currency: 'RF2' }, ADMIN);
  const t = report.totals.byCurrency.RF2;
  assert.equal(t.revenue, 10, 'net sales = 20 sold − 10 returned');
  assert.equal(t.cogs, 3, 'net cost = original 6 − 3 returned (snapshot cost 3, NOT 99)');
  assert.equal(t.grossProfit, 7, 'remaining 1 unit profit = 10 − 3 = 7');
});
