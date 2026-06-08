import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getPool, closeDatabase } from '../src/db.js';
import reportService from '../src/services/reportService.js';
import { SaleService } from '../src/services/saleService.js';

const saleService = new SaleService();

/**
 * Integration regression test for the invoice-return reporting bug.
 *
 * A returned / partially-returned sale keeps its original total + line items;
 * the refunded portion lives in sale_returns / sale_return_items. The reports
 * must subtract that returned portion from revenue, COGS and profit.
 *
 * The fixture is fully isolated: currency 'IQD' + dates in the year 2099 (no
 * real data lives there) so absolute assertions on the IQD bucket / 2099 window
 * reflect ONLY this fixture. Everything is deleted again in `after`.
 *
 * Scenario: 5 units @ 30 (cost 10) = 150 sale; 2 units returned = 60 refunded.
 *   gross revenue 150, gross COGS 50, gross profit 100
 *   net   revenue  90, net   COGS 30, net   profit  60
 */

const ADMIN = { id: null, role: 'admin' }; // global admin → no branch filtering
const DAY = '2099-06-15';
const RANGE = { dateFrom: '2099-01-01', dateTo: '2099-12-31' };
const INVOICE = `TEST-RET-RPT-${Date.now()}`;

const ids = {};

before(async () => {
  const pool = await getPool();

  const product = await pool.query(
    `INSERT INTO products (name, cost_price, selling_price, currency, product_type, is_active)
     VALUES ('TEST-RET-RPT product', 10, 30, 'IQD', 'inventory', true) RETURNING id`
  );
  ids.productId = product.rows[0].id;

  const sale = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, created_at, issued_at)
     VALUES ($1, 150, 150, 'IQD', 'cash', 'partially_returned', 90, 0, $2::timestamp, $2::timestamp)
     RETURNING id`,
    [INVOICE, DAY]
  );
  ids.saleId = sale.rows[0].id;

  const saleItem = await pool.query(
    `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal,
                             unit_conversion_factor, base_quantity)
     VALUES ($1, $2, 'TEST-RET-RPT product', 5, 30, 150, 1, 5) RETURNING id`,
    [ids.saleId, ids.productId]
  );
  ids.saleItemId = saleItem.rows[0].id;

  const ret = await pool.query(
    `INSERT INTO sale_returns (sale_id, returned_value, refund_amount, debt_reduction, currency, created_at)
     VALUES ($1, 60, 60, 0, 'IQD', $2::timestamp) RETURNING id`,
    [ids.saleId, DAY]
  );
  ids.returnId = ret.rows[0].id;

  await pool.query(
    `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, product_name, quantity,
                                    unit_price, subtotal, unit_conversion_factor, base_quantity)
     VALUES ($1, $2, $3, 'TEST-RET-RPT product', 2, 30, 60, 1, 2)`,
    [ids.returnId, ids.saleItemId, ids.productId]
  );
});

after(async () => {
  try {
    const pool = await getPool();
    if (ids.returnId) await pool.query('DELETE FROM sale_return_items WHERE return_id = $1', [ids.returnId]);
    if (ids.returnId) await pool.query('DELETE FROM sale_returns WHERE id = $1', [ids.returnId]);
    if (ids.saleId) await pool.query('DELETE FROM sale_items WHERE sale_id = $1', [ids.saleId]);
    if (ids.saleId) await pool.query('DELETE FROM sales WHERE id = $1', [ids.saleId]);
    if (ids.productId) await pool.query('DELETE FROM products WHERE id = $1', [ids.productId]);
  } finally {
    await closeDatabase().catch(() => {});
  }
});

test('profit report nets returned revenue, COGS and profit out of the totals', async () => {
  const report = await reportService.getProfitReport({ ...RANGE, currency: 'IQD' }, ADMIN);
  const iqd = report.totals.byCurrency.IQD;
  assert.ok(iqd, 'expected an IQD totals bucket');
  assert.equal(iqd.revenue, 90, 'revenue should be 150 − 60 returned');
  assert.equal(iqd.cogs, 30, 'COGS should be 50 − 20 returned');
  assert.equal(iqd.grossProfit, 60, 'gross profit should be 100 − 40 returned margin');
  assert.equal(iqd.netProfit, 60, 'net profit (no expenses) should equal gross profit');
});

test('sales report nets returned value out of sales, revenue and profit', async () => {
  const report = await saleService.getSalesReport(
    { startDate: RANGE.dateFrom, endDate: RANGE.dateTo, currency: 'IQD' },
    ADMIN
  );
  assert.equal(report.salesIQD, 90, 'sales should be 150 − 60 returned');
  assert.equal(report.revenueIQD, 90, 'revenue should be 150 − 60 returned');
  assert.equal(report.profitIQD, 60, 'profit should be 100 − 40 returned margin');
});

test('top products reports NET sold quantity (returned units excluded)', async () => {
  const top = await saleService.getTopProducts({
    startDate: RANGE.dateFrom,
    endDate: RANGE.dateTo,
    limit: 50,
  });
  const row = top.find((r) => r.productId === ids.productId);
  assert.ok(row, 'expected the fixture product in top products');
  assert.equal(row.totalQuantity, 3, 'net quantity should be 5 sold − 2 returned');
  assert.equal(row.totalRevenue, 90, 'net revenue should be 150 − 60 returned');
});

test('regression: a fully returned invoice contributes zero to reports', async () => {
  const pool = await getPool();
  // Push the remaining 3 units back so the invoice is fully returned.
  await pool.query(
    `UPDATE sale_returns SET returned_value = 150, refund_amount = 150 WHERE id = $1`,
    [ids.returnId]
  );
  await pool.query(
    `UPDATE sale_return_items SET quantity = 5, base_quantity = 5, subtotal = 150 WHERE return_id = $1`,
    [ids.returnId]
  );
  await pool.query(`UPDATE sales SET status = 'returned', paid_amount = 0 WHERE id = $1`, [ids.saleId]);

  const report = await reportService.getProfitReport({ ...RANGE, currency: 'IQD' }, ADMIN);
  const iqd = report.totals.byCurrency.IQD || { revenue: 0, cogs: 0, grossProfit: 0, netProfit: 0 };
  assert.equal(iqd.revenue, 0, 'fully returned invoice → zero revenue');
  assert.equal(iqd.cogs, 0, 'fully returned invoice → zero COGS');
  assert.equal(iqd.grossProfit, 0, 'fully returned invoice → zero gross profit');

  const sales = await saleService.getSalesReport(
    { startDate: RANGE.dateFrom, endDate: RANGE.dateTo, currency: 'IQD' },
    ADMIN
  );
  assert.equal(sales.salesIQD, 0, 'fully returned invoice → zero sales');
  assert.equal(sales.profitIQD, 0, 'fully returned invoice → zero profit');

  const top = await saleService.getTopProducts({
    startDate: RANGE.dateFrom,
    endDate: RANGE.dateTo,
    limit: 50,
  });
  assert.equal(
    top.find((r) => r.productId === ids.productId),
    undefined,
    'fully returned product should drop out of top products (net qty 0)'
  );
});
