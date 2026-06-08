import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { getPool, closeDatabase } from '../src/db.js';
import accountingPeriodService from '../src/services/accountingPeriodService.js';
import cashSessionService from '../src/services/cashSessionService.js';
import expensesService from '../src/services/expensesService.js';
import reportService from '../src/services/reportService.js';
import { SaleService } from '../src/services/saleService.js';

const saleService = new SaleService();

/**
 * End-to-end lifecycle test for the accounting period (القيد المحاسبي) system.
 *
 * Runs with the feature flag ON and multi-branch OFF (single global period).
 * Real service wiring is exercised for opening, shift linking and expense
 * stamping; the close snapshot / P&L is verified against a controlled fixture
 * (currency 'ACP', year 2099 — isolated from real data).
 *
 * Fixture P&L:
 *   sale 5 × 30 = 150, cost 10/unit → COGS 50
 *   return 2 units = 60 returned, returned COGS 20
 *   expense 20
 *   netSalesAfterReturns 90, cogsNet 30, grossProfit 60, netProfit 40
 */

const CUR = 'ACP';
const DAY = '2099-06-15';
const ids = {};
let originalFlags = null;
let user;

async function setFlags(pool, obj) {
  await pool.query(
    `INSERT INTO settings (key, value, description) VALUES ('feature_flags', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(obj)]
  );
}

/**
 * Self-heal a shared/dev DB before the suite runs. A previously-INTERRUPTED run
 * (its `after` never executed) can leave an open accounting period that blocks
 * "open a global period" — and because the open period was reused by the next
 * run, that run's data piled onto it and its `after` (keyed on its own user id)
 * couldn't clear it. We scrub only THIS suite's signature — the reserved `ACP`
 * test currency and `acc-period-test%` users — plus fully-empty orphan open
 * periods (zero linked rows across every accounting_period_id table).
 *
 * TEST-ONLY: runs against the configured test/dev DB; never point it at
 * production. The "empty orphan" branch can match a non-test period, so it
 * relies on the empty-across-all-tables guard (incl. stock_movements) for safety.
 */
async function cleanupPriorTestData(pool) {
  const tryDel = async (text, params) => { try { await pool.query(text, params); } catch { /* ignore */ } };
  const { rows } = await pool.query(`
    SELECT ap.id FROM accounting_periods ap WHERE
      ap.opened_by_user_id IN (SELECT id FROM users WHERE username LIKE 'acc-period-test%')
      OR ap.id IN (SELECT accounting_period_id FROM expenses WHERE currency = $1 AND accounting_period_id IS NOT NULL)
      OR ap.id IN (SELECT accounting_period_id FROM sales WHERE currency = $1 AND accounting_period_id IS NOT NULL)
      -- Empty orphan OPEN periods left by interrupted runs: they carry no data
      -- yet (so the currency match above misses them) but still occupy the
      -- one-open-per-scope slot and block "open a period". An open period with
      -- ZERO linked rows across EVERY accounting_period_id table is unambiguously
      -- stale test residue. (Every table holding accounting_period_id is listed
      -- so a period with any real activity — incl. stock movements — is spared.)
      OR (
        ap.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM accounting_period_shifts s WHERE s.accounting_period_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.accounting_period_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.accounting_period_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.accounting_period_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.accounting_period_id = ap.id)
      )
  `, [CUR]);
  const pids = rows.map((r) => r.id);
  if (pids.length) {
    await tryDel('DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE accounting_period_id = ANY($1))', [pids]);
    await tryDel('DELETE FROM sale_returns WHERE accounting_period_id = ANY($1)', [pids]);
    await tryDel('DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE accounting_period_id = ANY($1))', [pids]);
    await tryDel('DELETE FROM payments WHERE cash_session_id IN (SELECT shift_id FROM accounting_period_shifts WHERE accounting_period_id = ANY($1))', [pids]);
    await tryDel('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE accounting_period_id = ANY($1))', [pids]);
    await tryDel('DELETE FROM sales WHERE accounting_period_id = ANY($1)', [pids]);
    await tryDel('DELETE FROM expenses WHERE accounting_period_id = ANY($1)', [pids]);
    await tryDel('DELETE FROM accounting_period_shifts WHERE accounting_period_id = ANY($1)', [pids]);
    await tryDel('DELETE FROM cash_sessions WHERE accounting_period_id = ANY($1)', [pids]);
    await tryDel('DELETE FROM accounting_periods WHERE id = ANY($1)', [pids]); // snapshots cascade
  }
  await tryDel("DELETE FROM cash_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'acc-period-test%')");
  await tryDel("DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'acc-period-test%')");
  await tryDel("DELETE FROM users WHERE username LIKE 'acc-period-test%'");
}

before(async () => {
  const pool = await getPool();
  await cleanupPriorTestData(pool);
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='feature_flags'");
  originalFlags = rows[0]?.value ?? null;
  await setFlags(pool, {
    inventory: true, pos: true, installments: true, creditScore: true, draftInvoices: true,
    multiBranch: false, multiWarehouse: false, warehouseTransfers: false,
    alerts: true, liveOperations: true, accountingPeriods: true,
  });

  const u = await pool.query(
    `INSERT INTO users (username, password, full_name, role, is_active)
     VALUES ($1, 'x', 'Acc Period Test', 'admin', true) RETURNING id`,
    [`acc-period-test-${Date.now()}`]
  );
  ids.userId = u.rows[0].id;
  user = { id: ids.userId, role: 'admin', username: 'acc-period-test' };
});

after(async () => {
  const pool = await getPool();
  // Restore the feature flags FIRST and unconditionally — leaving
  // accountingPeriods=true would make the running app (and other test files,
  // since the suite shares one DB) require open periods. We coerce
  // accountingPeriods back to its product default (false) on restore so an
  // interrupted prior run can never leave enforcement on for the next suite.
  try {
    if (originalFlags !== null) {
      const restored = { ...JSON.parse(originalFlags), accountingPeriods: false };
      await setFlags(pool, restored);
    } else {
      await pool.query("DELETE FROM settings WHERE key='feature_flags'");
    }
  } catch { /* best effort */ }

  // Each delete is independent so one FK hiccup can't skip the rest.
  const tryDel = async (text, params) => { try { await pool.query(text, params); } catch { /* ignore */ } };
  // User-scoped cleanup: covers every period this user opened (incl. the extra
  // periods the shift-enforcement tests create), so nothing leaks.
  let pid = [];
  if (ids.userId) {
    const r = await pool.query('SELECT id FROM accounting_periods WHERE opened_by_user_id=$1', [ids.userId]);
    pid = r.rows.map((x) => x.id);
  }
  if (ids.returnId) await tryDel('DELETE FROM sale_return_items WHERE return_id=$1', [ids.returnId]);
  if (ids.returnId) await tryDel('DELETE FROM sale_returns WHERE id=$1', [ids.returnId]);
  if (pid.length) await tryDel('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE accounting_period_id = ANY($1))', [pid]);
  if (pid.length) await tryDel('DELETE FROM sales WHERE accounting_period_id = ANY($1)', [pid]);
  for (const sid of [ids.saleId, ids.sale2Id].filter(Boolean)) {
    await tryDel('DELETE FROM sale_items WHERE sale_id=$1', [sid]);
    await tryDel('DELETE FROM sales WHERE id=$1', [sid]);
  }
  if (pid.length) await tryDel('DELETE FROM expenses WHERE accounting_period_id = ANY($1)', [pid]);
  if (pid.length) await tryDel('DELETE FROM accounting_period_shifts WHERE accounting_period_id = ANY($1)', [pid]);
  if (ids.userId) await tryDel('DELETE FROM cash_sessions WHERE user_id=$1', [ids.userId]);
  // Snapshot rows cascade when their period is deleted (FK ON DELETE cascade).
  if (pid.length) await tryDel('DELETE FROM accounting_periods WHERE id = ANY($1)', [pid]);
  // Throwaway branch used by the multi-branch / branch-report tests. Its sales
  // were stamped to user-owned periods and already removed above; drop the
  // branch last so no FK references remain.
  if (ids.branchBId) await tryDel('DELETE FROM sales WHERE branch_id=$1', [ids.branchBId]);
  if (ids.branchBId) await tryDel('DELETE FROM accounting_periods WHERE branch_id=$1', [ids.branchBId]);
  if (ids.branchBId) await tryDel('DELETE FROM branches WHERE id=$1', [ids.branchBId]);
  if (ids.userId) await tryDel('DELETE FROM audit_log WHERE user_id=$1', [ids.userId]);
  if (ids.userId) await tryDel('DELETE FROM users WHERE id=$1', [ids.userId]);

  await closeDatabase().catch(() => {});
});

test('open a global accounting period binds the default branch (multiBranch off)', async () => {
  const period = await accountingPeriodService.open({ type: 'monthly' }, user);
  ids.periodId = period.id;
  ids.periodBranchId = period.branchId;
  assert.equal(period.status, 'open');
  // scope_type stays 'global' when branches are off …
  assert.equal(period.scopeType, 'global');
  // … but branch_id is the internal default branch, never null, so a shift can
  // match it. (Old behavior stored null and broke shift↔period branch matching.)
  assert.notEqual(period.branchId, null, 'off-mode period carries the default branch, not null');
});

test('cannot open a second period for the same scope', async () => {
  await assert.rejects(
    () => accountingPeriodService.open({ type: 'monthly' }, user),
    /مفتوح بالفعل/
  );
});

test('opening a shift links to the open period AND shares its branch (multiBranch off)', async () => {
  const session = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);
  ids.sessionId = session.id;
  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT accounting_period_id, branch_id FROM cash_sessions WHERE id=$1', [session.id]
  );
  assert.equal(Number(rows[0].accounting_period_id), ids.periodId);
  // The whole point of the fix: shift.branch_id === accounting_period.branch_id.
  assert.equal(Number(rows[0].branch_id), Number(ids.periodBranchId), 'shift branch matches period branch');
  const { rows: link } = await pool.query(
    'SELECT 1 FROM accounting_period_shifts WHERE accounting_period_id=$1 AND shift_id=$2',
    [ids.periodId, session.id]
  );
  assert.equal(link.length, 1, 'shift linked to period');
});

test('an expense created while open is stamped with the period', async () => {
  const exp = await expensesService.create(
    { amount: 20, category: 'misc', currency: CUR, expenseDate: DAY }, user
  );
  ids.expenseId = exp.id;
  assert.equal(Number(exp.accountingPeriodId), ids.periodId);
});

test('closing computes a frozen P&L snapshot and auto-closes open shifts', async () => {
  // Controlled sale + return stamped to the period (currency ACP, 2099).
  const pool = await getPool();
  const sale = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, created_at, issued_at, accounting_period_id)
     VALUES ($1, 150, 150, $2, 'cash', 'completed', 90, 0, $3::timestamp, $3::timestamp, $4)
     RETURNING id`,
    [`ACP-${Date.now()}`, CUR, DAY, ids.periodId]
  );
  ids.saleId = sale.rows[0].id;
  const si = await pool.query(
    `INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, subtotal, unit_cost_price, base_quantity)
     VALUES ($1, 'ACP item', 5, 30, 150, 10, 5) RETURNING id`,
    [ids.saleId]
  );
  const ret = await pool.query(
    `INSERT INTO sale_returns (sale_id, returned_value, refund_amount, refund_method, currency,
                               accounting_period_id, created_at)
     VALUES ($1, 60, 60, 'cash', $2, $3, $4::timestamp) RETURNING id`,
    [ids.saleId, CUR, ids.periodId, DAY]
  );
  ids.returnId = ret.rows[0].id;
  await pool.query(
    `INSERT INTO sale_return_items (return_id, sale_item_id, product_name, quantity, unit_price, subtotal, base_quantity)
     VALUES ($1, $2, 'ACP item', 2, 30, 60, 2)`,
    [ids.returnId, si.rows[0].id]
  );

  const closed = await accountingPeriodService.close(ids.periodId, user);
  assert.equal(closed.status, 'closed');
  assert.ok(closed.closedAt, 'closed_at stamped');

  const cur = closed.totals.byCurrency[CUR];
  assert.ok(cur, 'snapshot has the ACP currency bucket');
  assert.equal(cur.netSales, 150);
  assert.equal(cur.returnedValue, 60);
  assert.equal(cur.netSalesAfterReturns, 90);
  assert.equal(cur.cogs, 50);
  assert.equal(cur.returnedCogs, 20);
  assert.equal(cur.cogsNet, 30);
  assert.equal(cur.grossProfit, 60);
  assert.equal(cur.expenses, 20);
  assert.equal(cur.netProfit, 40);
  assert.ok(closed.totals.shiftsClosed >= 1, 'open shift auto-closed');

  // The linked shift is now closed.
  const { rows } = await pool.query('SELECT status FROM cash_sessions WHERE id=$1', [ids.sessionId]);
  assert.equal(rows[0].status, 'closed');
});

test('closing writes an immutable snapshot row and links it via snapshot_id', async () => {
  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT snapshot_id FROM accounting_periods WHERE id=$1',
    [ids.periodId]
  );
  assert.ok(rows[0].snapshot_id, 'closed period points at its snapshot row');

  const { rows: snap } = await pool.query(
    'SELECT id, accounting_period_id, snapshot_json FROM accounting_period_report_snapshots WHERE accounting_period_id=$1',
    [ids.periodId]
  );
  assert.equal(snap.length, 1, 'exactly one frozen snapshot per period');
  assert.equal(snap[0].id, rows[0].snapshot_id, 'snapshot_id matches the snapshot row');
  const cur = snap[0].snapshot_json.byCurrency[CUR];
  assert.equal(cur.netSales, 150);
  assert.equal(cur.netProfit, 40);
  // Richer frozen summaries the spec requires.
  assert.ok(Array.isArray(snap[0].snapshot_json.productSalesSummary), 'has product sales summary');
  assert.ok(Array.isArray(snap[0].snapshot_json.shiftSummary), 'has shift summary');
  assert.ok(snap[0].snapshot_json.shiftSummary.length >= 1, 'shift summary lists the closed shift');
});

test('the snapshot table row is frozen — later row edits do not change it', async () => {
  const pool = await getPool();
  await pool.query('UPDATE sales SET total = 8888 WHERE id=$1', [ids.saleId]);
  const { rows } = await pool.query(
    'SELECT snapshot_json FROM accounting_period_report_snapshots WHERE accounting_period_id=$1',
    [ids.periodId]
  );
  assert.equal(rows[0].snapshot_json.byCurrency[CUR].netSales, 150, 'frozen snapshot row unchanged');
  await pool.query('UPDATE sales SET total = 150 WHERE id=$1', [ids.saleId]); // restore
});

test('auto-closed shift gets frozen per-shift closing totals (totals_json)', async () => {
  const pool = await getPool();
  const { rows } = await pool.query('SELECT totals_json, expected_cash FROM cash_sessions WHERE id=$1', [ids.sessionId]);
  assert.ok(rows[0].totals_json, 'shift carries frozen closing totals');
  const t = rows[0].totals_json;
  assert.equal(typeof t.expectedCash, 'number');
  assert.equal(typeof t.salesTotal, 'number');
  assert.equal(typeof t.openingBalance, 'number');
  assert.equal(t.autoClosed, true);
});

test('snapshot is frozen — later row edits do not change the closed totals', async () => {
  const pool = await getPool();
  await pool.query('UPDATE sales SET total = 9999 WHERE id=$1', [ids.saleId]);
  const period = await accountingPeriodService.getById(ids.periodId, user);
  assert.equal(period.totals.byCurrency[CUR].netSales, 150, 'frozen snapshot unchanged');
  await pool.query('UPDATE sales SET total = 150 WHERE id=$1', [ids.saleId]); // restore
});

test('cannot close an already-closed period', async () => {
  await assert.rejects(
    () => accountingPeriodService.close(ids.periodId, user),
    /مغلق مسبقاً/
  );
});

test('writes inside a closed period are blocked; a new period can be opened', async () => {
  // No open period now → expense create is rejected (feature on, require).
  await assert.rejects(
    () => expensesService.create({ amount: 5, category: 'misc', currency: CUR }, user),
    /قيد محاسبي مفتوح/
  );

  // Closing freed the scope: a fresh period can be opened.
  const period2 = await accountingPeriodService.open({ type: 'daily' }, user);
  ids.period2Id = period2.id;
  assert.equal(period2.status, 'open');

  // assertWritable blocks the old (closed) period, allows the new one.
  await assert.rejects(
    () => accountingPeriodService.assertWritable(ids.periodId),
    /مغلق/
  );
  await accountingPeriodService.assertWritable(ids.period2Id); // resolves (open)
});

// ── Strict shift ↔ period ↔ sale/expense enforcement (uses the open period2) ──

test('open period but NO open shift → sale & expense are blocked (SHIFT_REQUIRED)', async () => {
  // period2 is open but the earlier shift was auto-closed at the first close.
  await assert.rejects(
    () => accountingPeriodService.requireOpenShift(user, ids.period2Id),
    /وردية مفتوحة/
  );
  await assert.rejects(
    () => expensesService.create({ amount: 5, category: 'misc', currency: CUR }, user),
    /وردية مفتوحة/
  );
});

test('with an open shift → expense records and is bound to period + shift', async () => {
  const session = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);
  ids.shift2Id = session.id;

  assert.equal(
    await accountingPeriodService.requireOpenShift(user, ids.period2Id),
    ids.shift2Id,
    'requireOpenShift resolves the open shift'
  );
  const exp = await expensesService.create(
    { amount: 5, category: 'misc', currency: CUR, expenseDate: DAY }, user
  );
  ids.expense2Id = exp.id;
  assert.equal(Number(exp.accountingPeriodId), ids.period2Id);
  assert.equal(Number(exp.cashSessionId), ids.shift2Id, 'expense bound to the shift');
});

test('after the shift is closed (period still open) → writes are locked', async () => {
  await cashSessionService.close(ids.shift2Id, { closingCash: 0 }, user);

  await assert.rejects(
    () => accountingPeriodService.assertShiftWritable(ids.shift2Id),
    /وردية مغلقة/
  );
  await assert.rejects(
    () => accountingPeriodService.requireOpenShift(user, ids.period2Id),
    /وردية مفتوحة/
  );
  await assert.rejects(
    () => expensesService.update(ids.expense2Id, { amount: 7 }, user),
    /وردية مغلقة/
  );
});

test('cancel / return of a sale in a closed shift is blocked (period still open)', async () => {
  const pool = await getPool();
  const s = await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
                        paid_amount, remaining_amount, created_at, issued_at,
                        accounting_period_id, cash_session_id)
     VALUES ($1, 10, 10, $2, 'cash', 'completed', 10, 0, $3::timestamp, $3::timestamp, $4, $5)
     RETURNING id`,
    [`ACP-SHIFT-${Date.now()}`, CUR, DAY, ids.period2Id, ids.shift2Id]
  );
  ids.sale2Id = s.rows[0].id;
  await pool.query(
    `INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, subtotal, base_quantity, unit_conversion_factor)
     VALUES ($1, 'x', 1, 10, 10, 1, 1)`,
    [ids.sale2Id]
  );

  await assert.rejects(() => saleService.cancel(ids.sale2Id, user.id), /وردية مغلقة/);
  await assert.rejects(
    () => saleService.createReturn(ids.sale2Id, { items: [], refundMethod: 'cash' }, user),
    /وردية مغلقة/
  );
});

// ── Strict "no shift without an open period" rule (FLAG-INDEPENDENT) ──────────
// These exercise cashSessionService.open directly. Note period2 is CLOSED only
// after test 13 closes it; sequencing matters.

test('with the accounting-period feature OFF, a shift opens WITHOUT a period (legacy POS)', async () => {
  // The requirement is feature-gated: when OFF, POS behaves as before — a shift
  // opens with accounting_period_id = null and no period is required.
  const pool = await getPool();
  await setFlags(pool, { multiBranch: false, accountingPeriods: false });
  const session = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);
  const { rows } = await pool.query('SELECT accounting_period_id FROM cash_sessions WHERE id=$1', [session.id]);
  assert.equal(rows[0].accounting_period_id, null, 'no period required or linked when the feature is off');
  // Close it so the next test starts from a no-open-shift state.
  await cashSessionService.close(session.id, { closingCash: 0 }, user);
  // restore feature ON for the remaining tests
  await setFlags(pool, { multiBranch: false, accountingPeriods: true });
});

test('opening a shift is blocked when the only period is closed', async () => {
  // Close the still-open period2 so the scope has a period, but it is closed.
  await accountingPeriodService.close(ids.period2Id, user);
  await assert.rejects(
    () => cashSessionService.open({ openingCash: 0, currency: CUR }, user),
    /القيد المحاسبي مغلق/
  );
});

test('opening a shift succeeds with an open period and is bound to it (non-null)', async () => {
  const period3 = await accountingPeriodService.open({ type: 'daily' }, user);
  ids.period3Id = period3.id;
  const session = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);

  const pool = await getPool();
  const { rows } = await pool.query('SELECT accounting_period_id FROM cash_sessions WHERE id=$1', [session.id]);
  assert.equal(Number(rows[0].accounting_period_id), ids.period3Id, 'shift bound to the open period');
  assert.notEqual(rows[0].accounting_period_id, null, 'accounting_period_id is never null');
  // close it so the next test starts from a no-open-shift state
  await cashSessionService.close(session.id, { closingCash: 0 }, user);
  await accountingPeriodService.close(ids.period3Id, user);
});

test('multi-branch: a shift only opens under the same branch open period; reports filter by branch + period', async () => {
  const pool = await getPool();
  await setFlags(pool, { multiBranch: true, accountingPeriods: true });
  try {
    // A dedicated throwaway branch so the test never collides with seed/dev data.
    const b = await pool.query(
      `INSERT INTO branches (name, is_active) VALUES ($1, true) RETURNING id`,
      [`ACP-Branch-${Date.now()}`]
    );
    ids.branchBId = b.rows[0].id;

    const bp = await accountingPeriodService.open({ type: 'daily', branchId: ids.branchBId }, user);
    ids.branchPeriodId = bp.id;

    // Same branch resolves to its open period…
    const ok = await accountingPeriodService.resolvePeriodForNewShift(user, ids.branchBId);
    assert.equal(ok.id, ids.branchPeriodId);
    // …a branch with no open period is rejected (test 14).
    await assert.rejects(
      () => accountingPeriodService.resolvePeriodForNewShift(user, 999999),
      /لا يوجد قيد محاسبي مفتوح/
    );

    // A shift opens only under the SAME branch period, and shares its branch.
    const branchShift = await cashSessionService.open(
      { openingCash: 0, currency: CUR, branchId: ids.branchBId }, user
    );
    const { rows: bs } = await pool.query(
      'SELECT accounting_period_id, branch_id FROM cash_sessions WHERE id=$1', [branchShift.id]
    );
    assert.equal(Number(bs[0].accounting_period_id), ids.branchPeriodId);
    assert.equal(Number(bs[0].branch_id), Number(ids.branchBId), 'branch-mode shift branch matches its period branch');
    await cashSessionService.close(branchShift.id, { closingCash: 0 }, user);

    // ── Report filtering by BOTH accounting_period_id AND branch_id (test 15) ──
    // 70 → this branch, this period (should count).
    await pool.query(
      `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
         paid_amount, remaining_amount, created_at, issued_at, accounting_period_id, branch_id)
       VALUES ($1, 70, 70, $2, 'cash', 'completed', 70, 0, $3::timestamp, $3::timestamp, $4, $5)`,
      [`ACP-BR-IN-${Date.now()}`, CUR, DAY, ids.branchPeriodId, ids.branchBId]
    );
    // 50 → this period but ANOTHER branch (excluded by branch filter).
    await pool.query(
      `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
         paid_amount, remaining_amount, created_at, issued_at, accounting_period_id, branch_id)
       VALUES ($1, 50, 50, $2, 'cash', 'completed', 50, 0, $3::timestamp, $3::timestamp, $4, 1)`,
      [`ACP-BR-OTHER-${Date.now()}`, CUR, DAY, ids.branchPeriodId]
    );
    // 30 → this branch but a DIFFERENT (closed) period (excluded by period filter).
    await pool.query(
      `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
         paid_amount, remaining_amount, created_at, issued_at, accounting_period_id, branch_id)
       VALUES ($1, 30, 30, $2, 'cash', 'completed', 30, 0, $3::timestamp, $3::timestamp, $4, $5)`,
      [`ACP-BR-OLD-${Date.now()}`, CUR, DAY, ids.periodId, ids.branchBId]
    );

    // A branch-bound cashier scoped to branch B sees only its own open period.
    const branchUser = { id: ids.userId, role: 'cashier', username: 'acp-branch', assignedBranchId: ids.branchBId };
    const rep = await reportService.getProfitReport({ currency: CUR }, branchUser);
    assert.equal(rep.meta.accountingPeriodId, ids.branchPeriodId, 'scoped to the branch open period');
    assert.equal(rep.meta.noOpenPeriod, false);
    assert.equal(rep.totals.byCurrency[CUR]?.revenue, 70, 'only same-branch same-period sales count');

    if (ids.branchPeriodId) await accountingPeriodService.close(ids.branchPeriodId, user);
  } finally {
    await setFlags(pool, { multiBranch: false, accountingPeriods: true });
  }
});

// ── Live report active-period scoping (القيد المحاسبي) — global scope ─────────
// Runs with multiBranch OFF (restored by the multi-branch test's finally).

test('live report starts from zero when a fresh accounting period is opened (test 8)', async () => {
  const period = await accountingPeriodService.open({ type: 'daily' }, user);
  ids.reportPeriodId = period.id;
  const rep = await reportService.getProfitReport({ currency: CUR }, user);
  assert.equal(rep.meta.noOpenPeriod, false);
  assert.equal(rep.meta.accountingPeriodId, ids.reportPeriodId, 'scoped to the new open period');
  const cur = rep.totals.byCurrency[CUR];
  assert.ok(!cur || cur.revenue === 0, 'a fresh period reports zero revenue');
});

test('live report includes only data from the active open period (test 9)', async () => {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
       paid_amount, remaining_amount, created_at, issued_at, accounting_period_id)
     VALUES ($1, 100, 100, $2, 'cash', 'completed', 100, 0, $3::timestamp, $3::timestamp, $4)`,
    [`ACP-RPT-${Date.now()}`, CUR, DAY, ids.reportPeriodId]
  );
  const rep = await reportService.getProfitReport({ currency: CUR }, user);
  // The old closed period's ACP sale (150) is excluded — only the 100 here counts.
  assert.equal(rep.totals.byCurrency[CUR]?.revenue, 100);
});

test('live report returns zero when there is no open accounting period (test 7)', async () => {
  await accountingPeriodService.close(ids.reportPeriodId, user);
  const rep = await reportService.getProfitReport({ currency: CUR }, user);
  assert.equal(rep.meta.noOpenPeriod, true, 'flagged so the UI shows "no open accounting period"');
  const cur = rep.totals.byCurrency[CUR];
  assert.ok(!cur || cur.revenue === 0, 'no open period → zero revenue');
});

test('off-mode report ignores a non-admin branch and counts default-branch data', async () => {
  // Regression: branchFilterFor is flag-unaware and returns a non-admin user's
  // assignedBranchId; in OFF mode all data is under the default branch, so the
  // report must NOT branch-filter or it would wrongly zero out.
  const period = await accountingPeriodService.open({ type: 'daily' }, user);
  const defBranch = Number(period.branchId);
  const pool = await getPool();
  await pool.query(
    `INSERT INTO sales (invoice_number, subtotal, total, currency, payment_type, status,
       paid_amount, remaining_amount, created_at, issued_at, accounting_period_id, branch_id)
     VALUES ($1, 40, 40, $2, 'cash', 'completed', 40, 0, $3::timestamp, $3::timestamp, $4, $5)`,
    [`ACP-OFFBR-${Date.now()}`, CUR, DAY, period.id, defBranch]
  );
  const mismatchedUser = { id: ids.userId, role: 'cashier', username: 'acp-off', assignedBranchId: defBranch + 9999 };
  const rep = await reportService.getProfitReport({ currency: CUR }, mismatchedUser);
  assert.equal(rep.totals.byCurrency[CUR]?.revenue, 40, 'counts default-branch sales regardless of the user branch');
  await accountingPeriodService.close(period.id, user);
});

// ── Cannot create a SALE in a closed shift / closed period (tests 10 & 11) ────
// saleService.create rejects at the period/shift guards (before any stock work),
// so a minimal dummy item is enough to drive the guard.
const dummySaleInput = () => ({
  items: [{ productId: 1, quantity: 1, unitPrice: 10 }],
  paymentMethod: 'cash',
  paidAmount: 10,
  currency: CUR,
});

test('cannot create a sale when the shift is closed (period still open) (test 10)', async () => {
  const p = await accountingPeriodService.open({ type: 'daily' }, user);
  const shift = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);
  await cashSessionService.close(shift.id, { closingCash: 0 }, user);
  // Period is open, but its only shift is closed → no open shift → sale blocked.
  await assert.rejects(() => saleService.create(dummySaleInput(), user), /وردية/);
  await accountingPeriodService.close(p.id, user);
});

test('cannot create a sale when the accounting period is closed (test 11)', async () => {
  // After the previous test there is no open period for the scope.
  await assert.rejects(
    () => saleService.create(dummySaleInput(), user),
    /قيد محاسبي مفتوح/
  );
});

// ── Cannot create an EXPENSE in a closed shift / closed period (tests 12 & 13) ─

test('cannot create an expense when the shift is closed (period still open) (test 12)', async () => {
  const p = await accountingPeriodService.open({ type: 'daily' }, user);
  const shift = await cashSessionService.open({ openingCash: 0, currency: CUR }, user);
  await cashSessionService.close(shift.id, { closingCash: 0 }, user);
  await assert.rejects(
    () => expensesService.create({ amount: 5, category: 'misc', currency: CUR, expenseDate: DAY }, user),
    /وردية/
  );
  await accountingPeriodService.close(p.id, user);
});

test('cannot create an expense when the accounting period is closed (test 13)', async () => {
  // After the previous test there is no open period for the scope.
  await assert.rejects(
    () => expensesService.create({ amount: 5, category: 'misc', currency: CUR }, user),
    /قيد محاسبي مفتوح/
  );
});

test('addPayment is blocked when the sale accounting period is closed', async () => {
  // sale2Id was stamped to period2 (closed) and shift2 (closed) earlier.
  await assert.rejects(
    () => saleService.addPayment(ids.sale2Id, { amount: 5, paymentMethod: 'cash' }, user.id),
    /مغلق/
  );
});

test('migration 0005 repair binds an open null-branch period to the default branch (test 9b)', async () => {
  const pool = await getPool();
  // Simulate a legacy period created before the fix: open, branch_id = NULL.
  const ins = await pool.query(
    `INSERT INTO accounting_periods (type, scope_type, branch_id, status, opened_by_user_id)
     VALUES ('daily', 'global', NULL, 'open', $1) RETURNING id`,
    [ids.userId]
  );
  const legacyId = ins.rows[0].id;
  try {
    // Apply migration 0005's repair statement verbatim.
    await pool.query(`
      UPDATE accounting_periods
      SET branch_id = (SELECT MIN(id) FROM branches), updated_at = now()
      WHERE status = 'open' AND branch_id IS NULL AND EXISTS (SELECT 1 FROM branches)
    `);
    const def = (await pool.query('SELECT MIN(id) AS id FROM branches')).rows[0];
    const row = (await pool.query('SELECT branch_id FROM accounting_periods WHERE id=$1', [legacyId])).rows[0];
    assert.notEqual(row.branch_id, null, 'legacy null-branch period is repaired');
    assert.equal(Number(row.branch_id), Number(def.id), 'repaired to the system default branch');
  } finally {
    // Don't leave an open period behind to block the next run.
    await pool.query('DELETE FROM accounting_periods WHERE id=$1', [legacyId]);
  }
});
