import { getDb, getPool } from '../db.js';
import {
  accountingPeriods,
  accountingPeriodShifts,
  cashSessions,
  branches,
  users,
} from '../models/index.js';
import { and, eq, desc, isNull, sql, inArray } from 'drizzle-orm';
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from '../utils/errors.js';
import featureFlagsService from './featureFlagsService.js';
import { isGlobalAdmin, branchFilterFor, resolveEffectiveBranchId } from './scopeService.js';
import { getDefaultBranchId } from './systemDefaultsService.js';
import auditService from './auditService.js';

/**
 * Accounting period (القيد المحاسبي) — a financial operating window opened once
 * and closed once. While open, shifts/sales/returns/expenses attach to it; on
 * close a frozen results snapshot is written to `totals_json` so reviewing a
 * closed period never changes even if underlying rows are later edited.
 *
 * Enforcement is gated by the `accountingPeriods` feature flag:
 *   - OFF (default): everything behaves as before. Writes still *stamp* the open
 *     period if one happens to exist, but never require one.
 *   - ON: opening a shift / recording a sale, return or expense REQUIRES an open
 *     period for that scope, and writes inside a closed period are blocked.
 */

export const PERIOD_TYPES = Object.freeze(['daily', 'weekly', 'monthly', 'yearly']);
const ACTIVE_SALE_STATUSES = "('completed','pending','partially_returned','returned')";

function toNum(v) {
  return v === null || v === undefined ? 0 : Number(v);
}

export class AccountingPeriodService {
  async isEnabled() {
    return featureFlagsService.isFeatureEnabled('accountingPeriods');
  }

  /** Is the operation scoped per-branch (multi-branch on) or global? */
  async isBranchScoped() {
    const flags = await featureFlagsService.getFeatureFlags();
    return flags.multiBranch !== false;
  }

  /**
   * Resolve the (scopeType, branchId) a NEW period would cover for this user.
   * Global admins may target any branch (multi-branch on) or the global scope
   * (off). Branch-bound users are pinned to their own branch.
   */
  async resolveOpenScope(user, requestedBranchId) {
    const branchScoped = await this.isBranchScoped();
    // Single source of truth for the branch. Even when branches are HIDDEN
    // (multiBranch off) we still bind the period to the internal default branch
    // — never branch_id = null — so the shift (which always carries a branch)
    // matches its period's branch. scope_type stays 'global' off / 'branch' on.
    const branchId = await resolveEffectiveBranchId({ user, requestedBranchId, ensure: true });
    return { scopeType: branchScoped ? 'branch' : 'global', branchId };
  }

  /**
   * The open period covering an operation in `branchId`. When branch-scoping is
   * off, the period bound to the system DEFAULT branch is used regardless of the
   * operation's input branch (only a zero-branch fresh install falls back to a
   * legacy branch_id IS NULL period). When on, the operation's branch period.
   */
  async getOpenPeriodForOperation(branchId) {
    const db = await getDb();
    const effective = await this.resolveLookupBranchId(branchId);
    // `effective` is the branch the period must belong to. When branches are
    // off it's the system default branch (matching where open()/shifts bind);
    // only a brand-new install with zero branches falls back to IS NULL so a
    // legacy null-branch period can still be found before migration repairs it.
    const where =
      effective != null
        ? and(eq(accountingPeriods.status, 'open'), eq(accountingPeriods.branchId, Number(effective)))
        : and(eq(accountingPeriods.status, 'open'), isNull(accountingPeriods.branchId));
    const [row] = await db.select().from(accountingPeriods).where(where).limit(1);
    return row || null;
  }

  /**
   * Resolve which branch a period LOOKUP should target. multiBranch on → the
   * passed branch (caller already validated it); off → the system default
   * branch (no create — null only when no branch exists yet).
   */
  async resolveLookupBranchId(branchId) {
    const branchScoped = await this.isBranchScoped();
    if (branchScoped) return branchId ? Number(branchId) : null;
    return await getDefaultBranchId();
  }

  /**
   * Central helper (spec name): the single open period covering operations in
   * `branchId`. Branch-scoping rules are applied internally — pass the
   * operation's branch and you get the right period (branch period when
   * multi-branch is on, the global period otherwise). Returns null when none.
   */
  async getActiveAccountingPeriod({ branchId = null } = {}) {
    return this.getOpenPeriodForOperation(branchId);
  }

  /**
   * Resolve the period id to stamp on a write. Returns null when none applies.
   * When the feature is ON and `require` is set, throws if no open period.
   */
  async resolvePeriodIdForWrite(user, branchId, { require = false, message = null } = {}) {
    const enabled = await this.isEnabled();
    const period = await this.getOpenPeriodForOperation(branchId);
    if (enabled && require && !period) {
      const err = new ValidationError(
        message || 'لا يوجد قيد محاسبي مفتوح. يجب فتح قيد محاسبي قبل تنفيذ هذه العملية'
      );
      err.code = 'ACCOUNTING_PERIOD_REQUIRED';
      err.statusCode = 422;
      throw err;
    }
    return period ? period.id : null;
  }

  /** The most recent period for a scope (any status) — used to tell "closed" from "none". */
  async getLatestPeriodForScope(branchId) {
    const db = await getDb();
    const effective = await this.resolveLookupBranchId(branchId);
    const where =
      effective != null
        ? eq(accountingPeriods.branchId, Number(effective))
        : isNull(accountingPeriods.branchId);
    const [row] = await db
      .select({ id: accountingPeriods.id, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(where)
      .orderBy(desc(accountingPeriods.id))
      .limit(1);
    return row || null;
  }

  /**
   * Central, FLAG-INDEPENDENT guard for opening a shift. The financial system
   * depends on accounting periods, so a shift can NEVER open without an open
   * period — even when the feature is disabled. Returns the open period to bind
   * the shift to (its id becomes the shift's NOT-NULL accounting_period_id).
   *
   * Throws with the exact user-facing message for each failure:
   *   - feature disabled        → "...نظام القيد المحاسبي غير مفعل."
   *   - latest period is closed → "...لأن القيد المحاسبي مغلق."
   *   - no period at all        → "...لا يوجد قيد محاسبي مفتوح."
   */
  async resolvePeriodForNewShift(user, branchId) {
    if (!(await this.isEnabled())) {
      const err = new ValidationError('لا يمكن فتح وردية لأن نظام القيد المحاسبي غير مفعل.');
      err.code = 'ACCOUNTING_PERIOD_DISABLED';
      err.statusCode = 422;
      throw err;
    }
    const period = await this.getOpenPeriodForOperation(branchId);
    if (period) return period;

    const latest = await this.getLatestPeriodForScope(branchId);
    const closed = latest && latest.status === 'closed';
    const err = new ValidationError(
      closed
        ? 'لا يمكن فتح وردية لأن القيد المحاسبي مغلق.'
        : 'لا يمكن فتح وردية، لا يوجد قيد محاسبي مفتوح.'
    );
    // Distinct, spec-aligned codes the frontend maps to Arabic.
    err.code = closed ? 'ACCOUNTING_PERIOD_CLOSED' : 'NO_OPEN_ACCOUNTING_PERIOD';
    err.statusCode = 422;
    throw err;
  }

  /** Any OPEN shift for the user regardless of period — used to detect a legacy
   *  shift that predates the period system (accounting_period_id IS NULL). */
  async getAnyOpenShiftForUser(userId) {
    if (!userId) return null;
    const db = await getDb();
    const [row] = await db
      .select({ id: cashSessions.id, accountingPeriodId: cashSessions.accountingPeriodId })
      .from(cashSessions)
      .where(and(eq(cashSessions.userId, userId), eq(cashSessions.status, 'open')))
      .limit(1);
    return row || null;
  }

  /**
   * The user's OPEN shift (cash session) bound to the given open period, or
   * null. A shift can only exist inside an open period (open() requires it and
   * close() auto-closes shifts), so a matching open shift always belongs to the
   * current open period.
   */
  async getOpenShiftForUser(userId, periodId) {
    if (!userId || !periodId) return null;
    const db = await getDb();
    const [row] = await db
      .select({ id: cashSessions.id, accountingPeriodId: cashSessions.accountingPeriodId })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.userId, userId),
          eq(cashSessions.status, 'open'),
          eq(cashSessions.accountingPeriodId, periodId)
        )
      )
      .limit(1);
    return row || null;
  }

  /**
   * Enforce "an open shift inside the open period" for a financial write
   * (sale / expense). No-op when the feature is OFF. Returns the shift id.
   */
  async requireOpenShift(user, periodId, { message } = {}) {
    if (!(await this.isEnabled())) return null;
    const shift = await this.getOpenShiftForUser(user?.id, periodId);
    if (!shift) {
      // Distinguish "no open shift at all" from "a legacy shift exists but isn't
      // bound to an accounting period" (item 5 / older data).
      const stray = await this.getAnyOpenShiftForUser(user?.id);
      if (stray && !stray.accountingPeriodId) {
        const err = new ValidationError(
          'لا يمكن تنفيذ العملية لأن الوردية غير مرتبطة بقيد محاسبي.'
        );
        err.code = 'SHIFT_NOT_LINKED_TO_PERIOD';
        err.statusCode = 422;
        throw err;
      }
      const err = new ValidationError(
        message || 'لا توجد وردية مفتوحة ضمن قيد محاسبي مفتوح — افتح وردية أولاً'
      );
      err.code = 'SHIFT_REQUIRED';
      err.statusCode = 422;
      throw err;
    }
    return shift.id;
  }

  /**
   * Throw if the given shift is closed (locks edits on sales/expenses tied to a
   * manually-closed shift even while the period is still open). No-op off.
   */
  async assertShiftWritable(cashSessionId) {
    if (!cashSessionId) return;
    if (!(await this.isEnabled())) return;
    const db = await getDb();
    const [s] = await db
      .select({ status: cashSessions.status })
      .from(cashSessions)
      .where(eq(cashSessions.id, cashSessionId))
      .limit(1);
    if (s && s.status === 'closed') {
      const err = new ValidationError('لا يمكن تعديل هذه العملية لأنها تابعة لوردية مغلقة');
      err.code = 'SHIFT_CLOSED';
      err.statusCode = 422;
      throw err;
    }
  }

  /**
   * Central helper (spec name): assert a period accepts writes. Throws 422
   * `ACCOUNTING_PERIOD_CLOSED` when the period is closed. No-op when periodId
   * is null (legacy rows / feature off). Alias kept as `assertWritable`.
   */
  async assertAccountingPeriodWritable(accountingPeriodId) {
    return this.assertWritable(accountingPeriodId);
  }

  /** Throw if the given period is closed (locks edits inside a closed period). */
  async assertWritable(periodId) {
    if (!periodId) return; // not attached to a period (legacy / flag off) → allow
    const db = await getDb();
    const [p] = await db
      .select({ status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, periodId))
      .limit(1);
    if (p && p.status === 'closed') {
      const err = new ValidationError(
        'القيد المحاسبي مغلق — لا يمكن تعديل العمليات المالية بداخله'
      );
      err.code = 'ACCOUNTING_PERIOD_CLOSED';
      err.statusCode = 422;
      throw err;
    }
  }

  /** Open a new period. Race-safe via the partial unique index. */
  async open({ type = 'monthly', branchId = null, notes = null } = {}, user) {
    if (!PERIOD_TYPES.includes(type)) {
      throw new ValidationError(`نوع القيد غير صالح: ${type}`);
    }
    const { scopeType, branchId: scopeBranchId } = await this.resolveOpenScope(user, branchId);

    const existing = await this.getOpenPeriodForOperation(scopeBranchId);
    if (existing) {
      throw new ValidationError('يوجد قيد محاسبي مفتوح بالفعل لهذا النطاق');
    }

    const db = await getDb();
    let row;
    try {
      [row] = await db
        .insert(accountingPeriods)
        .values({
          type,
          scopeType,
          branchId: scopeBranchId,
          status: 'open',
          openedByUserId: user?.id || null,
          notes: notes || null,
        })
        .returning();
    } catch (err) {
      // Partial unique index violation → someone opened one concurrently.
      if (err?.code === '23505') {
        throw new ValidationError('يوجد قيد محاسبي مفتوح بالفعل لهذا النطاق');
      }
      throw err;
    }

    await auditService.log({
      userId: user?.id,
      username: user?.username,
      action: 'accounting_period:open',
      resource: 'accounting_periods',
      resourceId: row.id,
      details: { type, scopeType, branchId: scopeBranchId },
    });

    return this.getById(row.id, user);
  }

  /**
   * Compute the results snapshot for a period from its attached rows. Used both
   * for the frozen close snapshot and for a live preview while open.
   *
   * COGS uses the sale-time per-unit cost snapshot (`sale_items.unit_cost_price`,
   * itself derived from the FIFO stock entries at sale time) with a fallback to
   * the product base cost — never the *current* product price. Freezing the
   * result in totals_json makes it immutable after close.
   *
   * `client` is a pg client (inside the close transaction) or the pool.
   */
  async computeSnapshot(client, periodId, { generatedByUserId = null } = {}) {
    const q = (text, params) => client.query(text, params).then((r) => r.rows);

    const salesRows = await q(
      `SELECT currency,
         COALESCE(SUM(subtotal::numeric),0)        AS gross_sales,
         COALESCE(SUM(discount::numeric),0)        AS discounts,
         COALESCE(SUM(total::numeric),0)           AS net_sales,
         COALESCE(SUM(paid_amount::numeric),0)     AS paid,
         COALESCE(SUM(remaining_amount::numeric),0) AS debt,
         COUNT(*)                                  AS sales_count
       FROM sales
       WHERE accounting_period_id = $1 AND status IN ${ACTIVE_SALE_STATUSES}
       GROUP BY currency`,
      [periodId]
    );

    const payMethodRows = await q(
      `SELECT s.currency, p.payment_method AS method, COALESCE(SUM(p.amount::numeric),0) AS amt
       FROM payments p JOIN sales s ON p.sale_id = s.id
       WHERE s.accounting_period_id = $1 AND s.status IN ${ACTIVE_SALE_STATUSES}
       GROUP BY s.currency, p.payment_method`,
      [periodId]
    );

    const returnsRows = await q(
      `SELECT currency,
         COALESCE(SUM(returned_value::numeric),0) AS returned_value,
         COALESCE(SUM(refund_amount::numeric),0)  AS refunded,
         COUNT(*)                                 AS returns_count
       FROM sale_returns WHERE accounting_period_id = $1 GROUP BY currency`,
      [periodId]
    );

    const cogsRows = await q(
      `SELECT s.currency,
         COALESCE(SUM(
           CASE WHEN si.unit_cost_price IS NOT NULL
                THEN si.unit_cost_price::numeric * si.quantity
                ELSE COALESCE(p.cost_price::numeric,0) * COALESCE(NULLIF(si.base_quantity,0), si.quantity)
           END),0) AS cogs
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       LEFT JOIN products p ON si.product_id = p.id
       WHERE s.accounting_period_id = $1 AND s.status IN ${ACTIVE_SALE_STATUSES}
       GROUP BY s.currency`,
      [periodId]
    );

    const returnedCogsRows = await q(
      `SELECT s.currency,
         COALESCE(SUM(
           CASE WHEN si.unit_cost_price IS NOT NULL
                THEN si.unit_cost_price::numeric * sri.quantity
                ELSE COALESCE(p.cost_price::numeric,0) * COALESCE(NULLIF(sri.base_quantity,0), sri.quantity)
           END),0) AS returned_cogs
       FROM sale_return_items sri
       JOIN sale_returns sr ON sri.return_id = sr.id
       JOIN sales s ON sr.sale_id = s.id
       LEFT JOIN sale_items si ON sri.sale_item_id = si.id
       LEFT JOIN products p ON sri.product_id = p.id
       WHERE sr.accounting_period_id = $1
       GROUP BY s.currency`,
      [periodId]
    );

    const expenseRows = await q(
      `SELECT currency, COALESCE(SUM(amount::numeric),0) AS total
       FROM expenses WHERE accounting_period_id = $1 GROUP BY currency`,
      [periodId]
    );
    const expenseCatRows = await q(
      `SELECT category, currency, COALESCE(SUM(amount::numeric),0) AS total
       FROM expenses WHERE accounting_period_id = $1 GROUP BY category, currency`,
      [periodId]
    );

    // Product sales summary — per product (net of returns), valued + COGS, so a
    // closed period keeps a frozen "what sold" breakdown.
    const productSalesRows = await q(
      `SELECT si.product_id AS product_id, si.product_name AS product_name, s.currency,
         COALESCE(SUM(si.quantity),0)                          AS quantity,
         COALESCE(SUM(si.subtotal::numeric),0)                 AS gross_sales,
         COALESCE(SUM(
           CASE WHEN si.unit_cost_price IS NOT NULL
                THEN si.unit_cost_price::numeric * si.quantity
                ELSE COALESCE(p.cost_price::numeric,0) * COALESCE(NULLIF(si.base_quantity,0), si.quantity)
           END),0) AS cogs
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       LEFT JOIN products p ON si.product_id = p.id
       WHERE s.accounting_period_id = $1 AND s.status IN ${ACTIVE_SALE_STATUSES}
       GROUP BY si.product_id, si.product_name, s.currency
       ORDER BY gross_sales DESC`,
      [periodId]
    );

    // Inventory movement summary — stock movements for the period's sales
    // (sale / sale_cancel / sale_return), counted and summed by type. Robust
    // even though sale movements don't stamp accounting_period_id directly.
    const inventoryMovementRows = await q(
      `SELECT sm.movement_type AS movement_type, COUNT(*) AS count,
              COALESCE(SUM(ABS(sm.quantity_change)),0) AS qty
       FROM stock_movements sm
       WHERE sm.reference_type = 'sale'
         AND sm.reference_id IN (SELECT id FROM sales WHERE accounting_period_id = $1)
       GROUP BY sm.movement_type`,
      [periodId]
    );

    // Shift summary — every cash session linked to the period.
    const shiftRows = await q(
      `SELECT cs.id, cs.user_id, u.full_name AS cashier_name, cs.status, cs.currency,
              cs.opening_cash, cs.closing_cash, cs.expected_cash, cs.variance,
              cs.opened_at, cs.closed_at
       FROM accounting_period_shifts aps
       JOIN cash_sessions cs ON aps.shift_id = cs.id
       LEFT JOIN users u ON cs.user_id = u.id
       WHERE aps.accounting_period_id = $1
       ORDER BY cs.id`,
      [periodId]
    );

    // ── Assemble per currency ────────────────────────────────────────────────
    const byCur = {};
    const ensure = (cur) => (byCur[cur] ??= {
      grossSales: 0, discounts: 0, netSales: 0, paid: 0, debt: 0, salesCount: 0,
      paidCash: 0, paidCard: 0, paidTransfer: 0, paidOther: 0,
      returnedValue: 0, refunded: 0, returnsCount: 0,
      cogs: 0, returnedCogs: 0,
      expenses: 0,
    });

    for (const r of salesRows) {
      const s = ensure(r.currency || 'USD');
      s.grossSales = toNum(r.gross_sales); s.discounts = toNum(r.discounts);
      s.netSales = toNum(r.net_sales); s.paid = toNum(r.paid); s.debt = toNum(r.debt);
      s.salesCount = Number(r.sales_count || 0);
    }
    for (const r of payMethodRows) {
      const s = ensure(r.currency || 'USD');
      const amt = toNum(r.amt);
      const m = (r.method || '').toLowerCase();
      if (m === 'cash') s.paidCash += amt;
      else if (m === 'card') s.paidCard += amt;
      else if (m === 'transfer') s.paidTransfer += amt;
      else s.paidOther += amt;
    }
    for (const r of returnsRows) {
      const s = ensure(r.currency || 'USD');
      s.returnedValue = toNum(r.returned_value); s.refunded = toNum(r.refunded);
      s.returnsCount = Number(r.returns_count || 0);
    }
    for (const r of cogsRows) ensure(r.currency || 'USD').cogs = toNum(r.cogs);
    for (const r of returnedCogsRows) ensure(r.currency || 'USD').returnedCogs = toNum(r.returned_cogs);
    for (const r of expenseRows) ensure(r.currency || 'USD').expenses = toNum(r.total);

    for (const cur of Object.keys(byCur)) {
      const s = byCur[cur];
      s.netSalesAfterReturns = s.netSales - s.returnedValue;
      s.cogsNet = Math.max(0, s.cogs - s.returnedCogs);
      // Spec alias — COGS used for profit is the net (after-returns) cost.
      s.costOfGoodsSold = s.cogsNet;
      s.grossProfit = s.netSalesAfterReturns - s.cogsNet;
      s.netProfit = s.grossProfit - s.expenses;
      // Loss surfaced as a positive magnitude when the period is in the red.
      s.loss = s.netProfit < 0 ? -s.netProfit : 0;
      s.netCollected = s.paid - s.refunded;
      // Spec-aligned field names alongside the existing ones.
      s.totalCard = s.paidCard;
      s.totalCash = s.paidCash;
      s.totalDebt = s.debt;
    }

    return {
      generatedAt: new Date().toISOString(),
      generatedByUserId: generatedByUserId || null,
      basis: 'sale-time unit cost snapshot (frozen at close)',
      byCurrency: byCur,
      expensesByCategory: expenseCatRows.map((r) => ({
        category: r.category, currency: r.currency, total: toNum(r.total),
      })),
      // Frozen breakdown summaries (spec §"Snapshot reports").
      productSalesSummary: productSalesRows.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        currency: r.currency || 'USD',
        quantity: Number(r.quantity || 0),
        grossSales: toNum(r.gross_sales),
        cogs: toNum(r.cogs),
      })),
      paymentMethodSummary: payMethodRows.map((r) => ({
        currency: r.currency || 'USD',
        method: (r.method || 'other').toLowerCase(),
        amount: toNum(r.amt),
      })),
      inventoryMovementSummary: inventoryMovementRows.map((r) => ({
        movementType: r.movement_type,
        count: Number(r.count || 0),
        quantity: toNum(r.qty),
      })),
      shiftSummary: shiftRows.map((r) => ({
        shiftId: r.id,
        userId: r.user_id,
        cashierName: r.cashier_name || null,
        status: r.status,
        currency: r.currency || 'USD',
        openingBalance: toNum(r.opening_cash),
        closingBalance: r.closing_cash === null ? null : toNum(r.closing_cash),
        expectedCash: r.expected_cash === null ? null : toNum(r.expected_cash),
        variance: r.variance === null ? null : toNum(r.variance),
        openedAt: r.opened_at,
        closedAt: r.closed_at,
      })),
    };
  }

  /**
   * Per-shift closing totals frozen onto the cash session when its period (or
   * the shift itself) closes: sales / returns / expenses / payments and the
   * expected cash in the drawer. `client` is a pg client or the pool.
   */
  async computeShiftClosingTotals(client, shiftId) {
    const q = (text, params) => client.query(text, params).then((r) => r.rows);

    const [salesAgg] = await q(
      `SELECT COALESCE(SUM(total::numeric),0) AS sales_total, COUNT(*) AS sales_count
       FROM sales WHERE cash_session_id = $1 AND status IN ${ACTIVE_SALE_STATUSES}`,
      [shiftId]
    );
    const [returnsAgg] = await q(
      `SELECT COALESCE(SUM(returned_value::numeric),0) AS returns_total,
              COALESCE(SUM(refund_amount::numeric),0)  AS refunds_total,
              COUNT(*) AS returns_count
       FROM sale_returns WHERE cash_session_id = $1`,
      [shiftId]
    );
    const [expensesAgg] = await q(
      `SELECT COALESCE(SUM(amount::numeric),0) AS expenses_total, COUNT(*) AS expenses_count
       FROM expenses WHERE cash_session_id = $1`,
      [shiftId]
    );
    const [paymentsAgg] = await q(
      `SELECT COALESCE(SUM(amount::numeric),0) AS payments_total,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount::numeric ELSE 0 END),0) AS cash_in
       FROM payments WHERE cash_session_id = $1`,
      [shiftId]
    );
    const [shiftRow] = await q(
      `SELECT opening_cash, closing_cash FROM cash_sessions WHERE id = $1`,
      [shiftId]
    );

    const openingBalance = toNum(shiftRow?.opening_cash);
    const cashIn = toNum(paymentsAgg?.cash_in);
    // Cash refunds reduce the drawer; debt/credit refunds do not.
    const [cashRefundAgg] = await q(
      `SELECT COALESCE(SUM(refund_amount::numeric),0) AS cash_out
       FROM sale_returns WHERE cash_session_id = $1 AND refund_method = 'cash'`,
      [shiftId]
    );
    const cashOut = toNum(cashRefundAgg?.cash_out);
    const expectedCash = openingBalance + cashIn - cashOut;

    return {
      generatedAt: new Date().toISOString(),
      salesTotal: toNum(salesAgg?.sales_total),
      salesCount: Number(salesAgg?.sales_count || 0),
      returnsTotal: toNum(returnsAgg?.returns_total),
      refundsTotal: toNum(returnsAgg?.refunds_total),
      returnsCount: Number(returnsAgg?.returns_count || 0),
      expensesTotal: toNum(expensesAgg?.expenses_total),
      expensesCount: Number(expensesAgg?.expenses_count || 0),
      paymentsTotal: toNum(paymentsAgg?.payments_total),
      cashIn,
      cashOut,
      openingBalance,
      closingBalance: shiftRow?.closing_cash === null || shiftRow?.closing_cash === undefined
        ? null
        : toNum(shiftRow.closing_cash),
      expectedCash,
    };
  }

  /**
   * Close a period: auto-close its open shifts, compute + freeze the snapshot,
   * and flip status to closed — all inside one transaction with a row lock so
   * two concurrent closes can't both win.
   */
  async close(id, user, { notes } = {}) {
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [period] } = await client.query(
        'SELECT * FROM accounting_periods WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!period) throw new NotFoundError('Accounting period');
      this.assertCanManage(user, period);
      if (period.status === 'closed') {
        throw new ValidationError('القيد المحاسبي مغلق مسبقاً');
      }

      // Auto-close attached open shifts (cash sessions).
      const { rows: openShifts } = await client.query(
        `SELECT cs.id, cs.opening_cash
         FROM accounting_period_shifts aps
         JOIN cash_sessions cs ON aps.shift_id = cs.id
         WHERE aps.accounting_period_id = $1 AND cs.status = 'open'`,
        [id]
      );
      let shiftsClosed = 0;
      for (const shift of openShifts) {
        // Freeze the full per-shift closing totals (sales/returns/expenses/
        // payments + expected cash). The cashier never counted the drawer on an
        // auto-close, so closing balance == expected and variance is zero.
        const shiftTotals = await this.computeShiftClosingTotals(client, shift.id);
        const expected = shiftTotals.expectedCash;
        shiftTotals.closingBalance = expected;
        shiftTotals.variance = 0;
        shiftTotals.autoClosed = true;
        await client.query(
          `UPDATE cash_sessions
           SET status='closed', closed_at=now(), expected_cash=$2, closing_cash=$2,
               variance='0', totals_json=$3::jsonb
           WHERE id=$1 AND status='open'`,
          [shift.id, String(expected), JSON.stringify(shiftTotals)]
        );
        shiftsClosed += 1;
      }

      const snapshot = await this.computeSnapshot(client, id, { generatedByUserId: user?.id || null });
      snapshot.shiftsClosed = shiftsClosed;

      // Freeze the snapshot into its own immutable row, then point the period at
      // it and mirror the payload into totals_json for the period-detail UI.
      const { rows: [snapRow] } = await client.query(
        `INSERT INTO accounting_period_report_snapshots
           (accounting_period_id, branch_id, snapshot_json, created_by_user_id)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (accounting_period_id)
           DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json
         RETURNING id`,
        [id, period.branch_id || null, JSON.stringify(snapshot), user?.id || null]
      );
      const snapshotId = snapRow?.id || null;

      const { rowCount } = await client.query(
        `UPDATE accounting_periods
         SET status='closed', closed_at=now(), closed_by_user_id=$2,
             totals_json=$3::jsonb, snapshot_id=$5, notes=COALESCE($4, notes), updated_at=now()
         WHERE id=$1 AND status='open'`,
        [id, user?.id || null, JSON.stringify(snapshot), notes || null, snapshotId]
      );
      if (!rowCount) {
        // Lost the race between the lock and update (defensive).
        throw new ValidationError('القيد المحاسبي مغلق مسبقاً');
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await auditService.log({
      userId: user?.id,
      username: user?.username,
      action: 'accounting_period:close',
      resource: 'accounting_periods',
      resourceId: id,
    });

    return this.getById(id, user);
  }

  /** Authorization: global admin → any; branch admin/manager → own branch. */
  assertCanManage(user, period) {
    if (isGlobalAdmin(user)) return;
    const allowed = branchFilterFor(user);
    if (allowed === null) return; // treated as global
    if (allowed.length === 0 || (period.branchId && Number(period.branchId) !== Number(allowed[0]))) {
      throw new AuthorizationError('لا تملك صلاحية إدارة قيود هذا الفرع');
    }
  }

  async list(user, { status, type, branchId } = {}) {
    const db = await getDb();
    const conds = [];
    if (status) conds.push(eq(accountingPeriods.status, status));
    if (type) conds.push(eq(accountingPeriods.type, type));

    if (!isGlobalAdmin(user)) {
      const allowed = branchFilterFor(user);
      if (allowed && allowed.length > 0) conds.push(eq(accountingPeriods.branchId, allowed[0]));
    } else if (branchId) {
      conds.push(eq(accountingPeriods.branchId, Number(branchId)));
    }

    const opener = users;
    const rows = await db
      .select({
        id: accountingPeriods.id,
        type: accountingPeriods.type,
        scopeType: accountingPeriods.scopeType,
        branchId: accountingPeriods.branchId,
        branchName: branches.name,
        status: accountingPeriods.status,
        openedAt: accountingPeriods.openedAt,
        closedAt: accountingPeriods.closedAt,
        openedByUserId: accountingPeriods.openedByUserId,
        openedByName: opener.fullName,
        closedByUserId: accountingPeriods.closedByUserId,
        totalsJson: accountingPeriods.totalsJson,
        notes: accountingPeriods.notes,
      })
      .from(accountingPeriods)
      .leftJoin(branches, eq(accountingPeriods.branchId, branches.id))
      .leftJoin(opener, eq(accountingPeriods.openedByUserId, opener.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(accountingPeriods.openedAt));

    return rows;
  }

  async getById(id, user = null) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, Number(id)))
      .limit(1);
    if (!row) throw new NotFoundError('Accounting period');
    if (user) this.assertCanManage(user, row);

    const [branch] = row.branchId
      ? await db.select({ name: branches.name }).from(branches).where(eq(branches.id, row.branchId)).limit(1)
      : [{ name: null }];

    const shifts = await db
      .select({
        id: cashSessions.id,
        userId: cashSessions.userId,
        cashierName: users.fullName,
        status: cashSessions.status,
        openingCash: cashSessions.openingCash,
        closingCash: cashSessions.closingCash,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
      })
      .from(accountingPeriodShifts)
      .innerJoin(cashSessions, eq(accountingPeriodShifts.shiftId, cashSessions.id))
      .leftJoin(users, eq(cashSessions.userId, users.id))
      .where(eq(accountingPeriodShifts.accountingPeriodId, row.id));

    // Closed → frozen snapshot. Open → live preview computed on the fly.
    let totals = row.totalsJson;
    if (row.status === 'open') {
      const pool = await getPool();
      totals = await this.computeSnapshot(pool, row.id);
    }

    return {
      ...row,
      branchName: branch?.name || null,
      shifts,
      shiftCount: shifts.length,
      openShiftCount: shifts.filter((s) => s.status === 'open').length,
      totals,
    };
  }

  /** Link a shift (cash session) to a period. Idempotent via unique(shift_id). */
  async linkShift(periodId, shiftId, executor = null) {
    if (!periodId || !shiftId) return;
    const db = executor || (await getDb());
    await db
      .insert(accountingPeriodShifts)
      .values({ accountingPeriodId: periodId, shiftId })
      .onConflictDoNothing({ target: accountingPeriodShifts.shiftId });
  }
}

export default new AccountingPeriodService();
