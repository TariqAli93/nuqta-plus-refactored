import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getPool, closeDatabase } from '../src/db.js';
import { SaleController } from '../src/controllers/saleController.js';

/**
 * Authorization coverage for the DELETE sale endpoint (saleController.removeSale).
 *
 * Two independent guards must both hold:
 *   - branch scope (controller): a branch-restricted user may only delete sales
 *     from their own branch; global admins may delete any.
 *   - write-protection (service, saleService.assertSaleWritable): a sale tied to
 *     a CLOSED accounting period or a CLOSED shift can never be deleted.
 *
 * We drive the real controller method with a minimal request/reply so the full
 * path (getById → enforceBranchScope → saleService.removeSale) is exercised.
 * Fixtures use the reserved `RMSALE-` invoice prefix / `rmsale-` users so the
 * before-hook can self-heal a shared dev DB after an interrupted run.
 */

const controller = new SaleController();
const ids = {};
let originalFlags = null;
let adminUser;
let branchUser;
let seq = 0;

function makeReply() {
  return {
    statusCode: 200,
    body: null,
    code(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
  };
}

async function setFlags(pool, obj) {
  await pool.query(
    `INSERT INTO settings (key, value, description) VALUES ('feature_flags', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(obj)]
  );
}

async function insertSale(pool, { branchId = null, periodId = null, shiftId = null } = {}) {
  seq += 1;
  const inv = `RMSALE-${Date.now()}-${seq}`;
  const { rows } = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, branch_id, accounting_period_id, cash_session_id)
     VALUES ($1, 10, 10, 'USD', 'cash', 'completed', 10, 0, $2, $3, $4)
     RETURNING id`,
    [inv, branchId, periodId, shiftId]
  );
  return rows[0].id;
}

async function cleanupOwnFixtures(pool) {
  const tryDel = async (text, params) => { try { await pool.query(text, params); } catch { /* ignore */ } };
  // Sales first (they reference branch/period/shift), then the rows they point at.
  await tryDel("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE invoice_number LIKE 'RMSALE-%')");
  await tryDel("DELETE FROM sales WHERE invoice_number LIKE 'RMSALE-%'");
  await tryDel("DELETE FROM cash_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'rmsale-%')");
  await tryDel("DELETE FROM accounting_periods WHERE opened_by_user_id IN (SELECT id FROM users WHERE username LIKE 'rmsale-%')");
  await tryDel("DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'rmsale-%')");
  await tryDel("DELETE FROM users WHERE username LIKE 'rmsale-%'");
  await tryDel("DELETE FROM branches WHERE name LIKE 'RMSALE-BR-%'");
}

before(async () => {
  const pool = await getPool();
  await cleanupOwnFixtures(pool);

  const { rows } = await pool.query("SELECT value FROM settings WHERE key='feature_flags'");
  originalFlags = rows[0]?.value ?? null;
  // accountingPeriods ON so the closed-SHIFT guard (assertShiftWritable) fires.
  await setFlags(pool, {
    inventory: true, pos: true, installments: true, creditScore: true, draftInvoices: true,
    multiBranch: true, multiWarehouse: false, warehouseTransfers: false,
    alerts: true, liveOperations: true, accountingPeriods: true,
  });

  const ts = Date.now();
  const a = await pool.query(`INSERT INTO branches (name, is_active) VALUES ($1, true) RETURNING id`, [`RMSALE-BR-A-${ts}`]);
  const b = await pool.query(`INSERT INTO branches (name, is_active) VALUES ($1, true) RETURNING id`, [`RMSALE-BR-B-${ts}`]);
  ids.branchA = a.rows[0].id;
  ids.branchB = b.rows[0].id;

  const admin = await pool.query(
    `INSERT INTO users (username, password, full_name, role, is_active)
     VALUES ($1, 'x', 'RmSale Admin', 'admin', true) RETURNING id`,
    [`rmsale-admin-${ts}`]
  );
  ids.adminId = admin.rows[0].id;
  adminUser = { id: ids.adminId, role: 'admin', username: 'rmsale-admin' };

  const cashier = await pool.query(
    `INSERT INTO users (username, password, full_name, role, is_active, assigned_branch_id)
     VALUES ($1, 'x', 'RmSale Cashier A', 'cashier', true, $2) RETURNING id`,
    [`rmsale-cashier-${ts}`, ids.branchA]
  );
  ids.cashierId = cashier.rows[0].id;
  branchUser = { id: ids.cashierId, role: 'cashier', username: 'rmsale-cashier', assignedBranchId: ids.branchA };

  // A closed period and a closed shift to validate the write-protection guards.
  const closedPeriod = await pool.query(
    `INSERT INTO accounting_periods (type, scope_type, status, opened_by_user_id, closed_at, closed_by_user_id)
     VALUES ('daily', 'global', 'closed', $1, now(), $1) RETURNING id`,
    [ids.adminId]
  );
  ids.closedPeriodId = closedPeriod.rows[0].id;

  const closedShift = await pool.query(
    `INSERT INTO cash_sessions (user_id, branch_id, status, opening_cash, currency, closed_at)
     VALUES ($1, $2, 'closed', '0', 'USD', now()) RETURNING id`,
    [ids.adminId, ids.branchA]
  );
  ids.closedShiftId = closedShift.rows[0].id;
});

after(async () => {
  const pool = await getPool();
  try {
    if (originalFlags !== null) {
      await setFlags(pool, { ...JSON.parse(originalFlags), accountingPeriods: false });
    } else {
      await pool.query("DELETE FROM settings WHERE key='feature_flags'");
    }
  } catch { /* best effort */ }
  await cleanupOwnFixtures(pool);
  await closeDatabase().catch(() => {});
});

test('branch user CANNOT remove a sale from another branch (test 1)', async () => {
  const pool = await getPool();
  const saleId = await insertSale(pool, { branchId: ids.branchB });
  await assert.rejects(
    () => controller.removeSale({ user: branchUser, params: { id: saleId } }, makeReply()),
    /different branch/i
  );
  // Still present — the guard blocked the delete.
  const { rows } = await pool.query('SELECT 1 FROM sales WHERE id=$1', [saleId]);
  assert.equal(rows.length, 1, 'cross-branch sale must not be deleted');
});

test('branch user CAN remove a sale from their own branch (test 2)', async () => {
  const pool = await getPool();
  const saleId = await insertSale(pool, { branchId: ids.branchA });
  const reply = makeReply();
  await controller.removeSale({ user: branchUser, params: { id: saleId } }, reply);
  assert.equal(reply.body?.success, true);
  const { rows } = await pool.query('SELECT 1 FROM sales WHERE id=$1', [saleId]);
  assert.equal(rows.length, 0, 'own-branch sale should be deleted');
});

test('admin user CAN remove a sale from any branch (test 3)', async () => {
  const pool = await getPool();
  const saleId = await insertSale(pool, { branchId: ids.branchB });
  const reply = makeReply();
  await controller.removeSale({ user: adminUser, params: { id: saleId } }, reply);
  assert.equal(reply.body?.success, true);
  const { rows } = await pool.query('SELECT 1 FROM sales WHERE id=$1', [saleId]);
  assert.equal(rows.length, 0, 'global admin may delete any branch sale');
});

test('removing a sale in a CLOSED accounting period still fails (test 4)', async () => {
  const pool = await getPool();
  const saleId = await insertSale(pool, { branchId: ids.branchA, periodId: ids.closedPeriodId });
  // Admin passes branch scope; the service-level period guard must still block.
  await assert.rejects(
    () => controller.removeSale({ user: adminUser, params: { id: saleId } }, makeReply()),
    /مغلق/
  );
  const { rows } = await pool.query('SELECT 1 FROM sales WHERE id=$1', [saleId]);
  assert.equal(rows.length, 1, 'sale in a closed period must not be deleted');
});

test('removing a sale in a CLOSED shift still fails (test 5)', async () => {
  const pool = await getPool();
  const saleId = await insertSale(pool, { branchId: ids.branchA, shiftId: ids.closedShiftId });
  await assert.rejects(
    () => controller.removeSale({ user: adminUser, params: { id: saleId } }, makeReply()),
    /وردية مغلقة/
  );
  const { rows } = await pool.query('SELECT 1 FROM sales WHERE id=$1', [saleId]);
  assert.equal(rows.length, 1, 'sale in a closed shift must not be deleted');
});
