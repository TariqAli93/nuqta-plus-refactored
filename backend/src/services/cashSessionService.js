import { getDb } from '../db.js';
import {
  cashSessions,
  payments,
  sales,
  users,
  branches,
} from '../models/index.js';
import { eq, and, desc, gte, lte, sql, isNull } from 'drizzle-orm';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors.js';
import { isGlobalAdmin, branchFilterFor } from './scopeService.js';
import auditService from './auditService.js';

/** Parse PG numeric (string) → JS number. */
const n = (v) => (v === null || v === undefined ? 0 : Number(v));

const round4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;

/**
 * Cash session / shift closing business logic.
 *
 * A cashier opens a shift with the cash they're starting the drawer with.
 * Every cash POS sale during the shift is linked to the session via
 * `cash_session_id` (on sales + payments). When the shift is closed the
 * cashier counts the drawer; the service computes:
 *
 *   expected = opening + sum(cash_in) - sum(cash_out)
 *   variance = closing  - expected
 *
 * `cash_in`  = cash payments recorded against the session
 * `cash_out` = cash refunds (currently nothing in the system records cash
 *              refunds explicitly — sale cancellation does not refund cash —
 *              so cash_out is 0 for now and is wired up for future use).
 *
 * Closed sessions are immutable.
 */
export class CashSessionService {
  /**
   * Open a new cash session for the user/branch. Fails if one is already open.
   */
  async open({ openingCash = 0, currency = 'USD', notes = null, branchId = null }, user) {
    if (!user?.id) throw new AuthorizationError('Authentication required');

    const opening = round4(openingCash);
    if (opening < 0) {
      throw new ValidationError('Opening cash cannot be negative');
    }

    // Branch-bound users always operate on their assigned branch — they cannot
    // open a session in someone else's branch.
    const effectiveBranchId =
      isGlobalAdmin(user) ? branchId || user.assignedBranchId || null : user.assignedBranchId || null;

    const db = await getDb();
    const existing = await this.findOpenSession(user.id, effectiveBranchId);
    if (existing) {
      throw new ValidationError('User already has an open cash session for this branch');
    }

    const [row] = await db
      .insert(cashSessions)
      .values({
        userId: user.id,
        branchId: effectiveBranchId,
        openingCash: String(opening),
        currency,
        status: 'open',
        notes,
      })
      .returning();

    await auditService.log({
      userId: user.id,
      username: user.username,
      action: 'cash_session:open',
      resource: 'cash_sessions',
      resourceId: row.id,
      details: { openingCash: opening, currency, branchId: effectiveBranchId },
    });

    return await this.getById(row.id, user);
  }

  /**
   * Close the session: counts cash, computes variance, sets status=closed.
   */
  async close(id, { closingCash, notes }, user) {
    const session = await this.getById(id, user);
    if (session.status !== 'open') {
      throw new ValidationError('Cash session is already closed');
    }

    // Cashiers / managers can only close sessions they own. Global / branch
    // admins may close any session inside their scope.
    const ownsSession = Number(session.userId) === Number(user.id);
    if (!ownsSession && !isGlobalAdmin(user) && user.role !== 'branch_admin') {
      throw new AuthorizationError('You can only close your own cash session');
    }

    const closing = round4(closingCash);
    if (!Number.isFinite(closing) || closing < 0) {
      throw new ValidationError('Closing cash must be a non-negative number');
    }

    const totals = await this.computeSessionTotals(id);
    const expected = round4(n(session.openingCash) + totals.cashIn - totals.cashOut);
    const variance = round4(closing - expected);

    const db = await getDb();
    const [updated] = await db
      .update(cashSessions)
      .set({
        closingCash: String(closing),
        expectedCash: String(expected),
        variance: String(variance),
        status: 'closed',
        closedAt: new Date(),
        notes: notes ?? session.notes,
      })
      .where(and(eq(cashSessions.id, id), eq(cashSessions.status, 'open')))
      .returning();

    if (!updated) {
      // Lost the race — somebody else closed it between getById and update.
      throw new ValidationError('Cash session is already closed');
    }

    await auditService.log({
      userId: user.id,
      username: user.username,
      action: 'cash_session:close',
      resource: 'cash_sessions',
      resourceId: id,
      details: {
        openingCash: n(session.openingCash),
        closingCash: closing,
        expectedCash: expected,
        variance,
        cashIn: totals.cashIn,
        cashOut: totals.cashOut,
      },
    });

    return await this.getById(id, user);
  }

  /**
   * Find the user's open session for a branch, or null.
   * Used to enforce "open session required" before a cash POS sale.
   */
  async findOpenSession(userId, branchId) {
    if (!userId) return null;
    const db = await getDb();
    const conds = [eq(cashSessions.userId, userId), eq(cashSessions.status, 'open')];
    conds.push(branchId ? eq(cashSessions.branchId, branchId) : isNull(cashSessions.branchId));
    const [row] = await db
      .select()
      .from(cashSessions)
      .where(and(...conds))
      .orderBy(desc(cashSessions.openedAt))
      .limit(1);
    return row || null;
  }

  /**
   * Convenience: return current open session for the acting user, plus a
   * live summary of cash-in / cash-out / expected.
   */
  async getCurrent(user) {
    if (!user?.id) return null;
    const branchId = user.assignedBranchId || null;
    const session = await this.findOpenSession(user.id, branchId);
    if (!session) return null;
    const summary = await this.computeSessionTotals(session.id);
    const expected = round4(n(session.openingCash) + summary.cashIn - summary.cashOut);
    return {
      ...this.serialize(session),
      cashIn: summary.cashIn,
      cashOut: summary.cashOut,
      cashSalesCount: summary.cashSalesCount,
      expectedCash: expected,
    };
  }

  async getById(id, user = null) {
    const db = await getDb();
    const [row] = await db
      .select({
        id: cashSessions.id,
        userId: cashSessions.userId,
        branchId: cashSessions.branchId,
        openingCash: cashSessions.openingCash,
        closingCash: cashSessions.closingCash,
        expectedCash: cashSessions.expectedCash,
        variance: cashSessions.variance,
        currency: cashSessions.currency,
        status: cashSessions.status,
        notes: cashSessions.notes,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
        cashierName: users.fullName,
        cashierUsername: users.username,
        branchName: branches.name,
      })
      .from(cashSessions)
      .leftJoin(users, eq(cashSessions.userId, users.id))
      .leftJoin(branches, eq(cashSessions.branchId, branches.id))
      .where(eq(cashSessions.id, id))
      .limit(1);

    if (!row) throw new NotFoundError('Cash session');

    if (user && !isGlobalAdmin(user)) {
      // Branch scope: non-global users can only see sessions inside their branch.
      const allowedBranches = branchFilterFor(user);
      if (allowedBranches !== null) {
        const userBranchId = allowedBranches[0];
        // null branch sessions are visible to anyone in the same workspace.
        if (row.branchId && Number(row.branchId) !== Number(userBranchId)) {
          throw new AuthorizationError('Cash session belongs to a different branch');
        }
      }
    }

    const totals = await this.computeSessionTotals(row.id);
    const expected =
      row.status === 'closed'
        ? n(row.expectedCash)
        : round4(n(row.openingCash) + totals.cashIn - totals.cashOut);

    return {
      ...this.serialize(row),
      cashierName: row.cashierName,
      cashierUsername: row.cashierUsername,
      branchName: row.branchName,
      cashIn: totals.cashIn,
      cashOut: totals.cashOut,
      cashSalesCount: totals.cashSalesCount,
      expectedCash: expected,
    };
  }

  /**
   * List sessions with simple filters. Branch-scoped for non-global users.
   */
  async list({ page = 1, limit = 20, status, userId, branchId, startDate, endDate } = {}, user) {
    const db = await getDb();
    const conds = [];
    if (status) conds.push(eq(cashSessions.status, status));
    if (userId) conds.push(eq(cashSessions.userId, Number(userId)));

    if (isGlobalAdmin(user)) {
      if (branchId) conds.push(eq(cashSessions.branchId, Number(branchId)));
    } else {
      const allowed = branchFilterFor(user);
      if (allowed === null) {
        // not global but branchFilterFor returned null — defensive
      } else if (allowed.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      } else {
        conds.push(eq(cashSessions.branchId, allowed[0]));
      }
    }

    if (startDate) conds.push(gte(cashSessions.openedAt, new Date(startDate)));
    if (endDate) conds.push(lte(cashSessions.openedAt, new Date(endDate)));

    const where = conds.length ? and(...conds) : undefined;

    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(cashSessions)
      .where(where || sql`true`);
    const total = Number(count || 0);
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: cashSessions.id,
        userId: cashSessions.userId,
        branchId: cashSessions.branchId,
        openingCash: cashSessions.openingCash,
        closingCash: cashSessions.closingCash,
        expectedCash: cashSessions.expectedCash,
        variance: cashSessions.variance,
        currency: cashSessions.currency,
        status: cashSessions.status,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
        cashierName: users.fullName,
        cashierUsername: users.username,
        branchName: branches.name,
      })
      .from(cashSessions)
      .leftJoin(users, eq(cashSessions.userId, users.id))
      .leftJoin(branches, eq(cashSessions.branchId, branches.id))
      .where(where || sql`true`)
      .orderBy(desc(cashSessions.openedAt))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => this.serialize(r)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Sum the cash flowing through this session.
   *
   * cashIn  = SUM(payments.amount) where session_id = id AND method = 'cash'
   * cashOut = 0 (placeholder for explicit cash refunds — sale cancellation
   *           does not refund cash in this system; reserve hook for future).
   * cashSalesCount = number of distinct sales tied to this session.
   */
  async computeSessionTotals(sessionId) {
    const db = await getDb();

    const [paymentSum] = await db
      .select({
        sum: sql`COALESCE(SUM(${payments.amount}::numeric), 0)`,
      })
      .from(payments)
      .where(
        and(eq(payments.cashSessionId, sessionId), eq(payments.paymentMethod, 'cash'))
      );

    const [salesCount] = await db
      .select({ count: sql`count(*)` })
      .from(sales)
      .where(eq(sales.cashSessionId, sessionId));

    return {
      cashIn: round4(Number(paymentSum?.sum || 0)),
      cashOut: 0,
      cashSalesCount: Number(salesCount?.count || 0),
    };
  }

  /** Map a raw row to the API shape (numeric strings → numbers). */
  serialize(row) {
    return {
      id: row.id,
      userId: row.userId,
      branchId: row.branchId,
      openingCash: n(row.openingCash),
      closingCash: row.closingCash === null || row.closingCash === undefined
        ? null
        : n(row.closingCash),
      expectedCash: row.expectedCash === null || row.expectedCash === undefined
        ? null
        : n(row.expectedCash),
      variance: row.variance === null || row.variance === undefined ? null : n(row.variance),
      currency: row.currency,
      status: row.status,
      notes: row.notes ?? null,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
    };
  }
}

export default new CashSessionService();
