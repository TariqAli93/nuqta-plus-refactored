import { getDb, getPool } from '../db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { expenses, branches, users } from '../models/index.js';
import * as schema from '../models/index.js';
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import { branchFilterFor, enforceBranchScope, isGlobalAdmin } from './scopeService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

function n(v) {
  if (v === null || v === undefined) return 0;
  return Number(v) || 0;
}

async function withTransaction(callback) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txDb = drizzle(client, { schema });
    const result = await callback(txDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Common expense categories. Free-form text is also accepted; this list is
 * surfaced by the UI as suggestions.
 */
export const COMMON_EXPENSE_CATEGORIES = Object.freeze([
  'rent',
  'salary',
  'utilities',
  'supplies',
  'maintenance',
  'transport',
  'marketing',
  'tax',
  'other',
]);

export class ExpensesService {
  /**
   * Create an expense row.
   *
   * Branch resolution:
   *  - Global admins may pass any branchId (or none for unscoped expense).
   *  - Other users always write to their assigned branch — payload branchId
   *    is ignored to prevent spoofing.
   */
  async create(input, user) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError('Expense amount must be greater than zero');
    }

    let branchId;
    if (isGlobalAdmin(user)) {
      branchId = input.branchId ? Number(input.branchId) : null;
    } else {
      branchId = user?.assignedBranchId || null;
      if (!branchId) {
        throw new ValidationError('User has no branch assigned');
      }
    }

    const expenseDate =
      input.expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)
        ? input.expenseDate
        : new Date().toISOString().slice(0, 10);

    return await withTransaction(async (tx) => {
      const [row] = await tx
        .insert(expenses)
        .values({
          branchId,
          category: String(input.category).trim(),
          amount: String(amount),
          currency: input.currency || 'USD',
          note: input.note || null,
          expenseDate,
          createdBy: user?.id || null,
        })
        .returning();
      return {
        ...row,
        amount: n(row.amount),
      };
    });
  }

  async getAll(filters = {}, actingUser = null) {
    const db = await getDb();
    const { page = 1, limit = 25, category, dateFrom, dateTo } = filters;

    const conds = [];
    if (category) conds.push(eq(expenses.category, String(category)));
    if (dateFrom) conds.push(gte(expenses.expenseDate, dateFrom));
    if (dateTo) conds.push(lte(expenses.expenseDate, dateTo));
    if (filters.currency && filters.currency !== 'ALL') {
      conds.push(eq(expenses.currency, filters.currency));
    }

    const allowed = branchFilterFor(actingUser);
    if (allowed === null) {
      if (filters.branchId) conds.push(eq(expenses.branchId, Number(filters.branchId)));
    } else if (allowed.length === 0) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    } else {
      conds.push(eq(expenses.branchId, Number(allowed[0])));
    }

    const where = conds.length ? and(...conds) : undefined;

    const [countRow] = await db
      .select({ count: sql`COUNT(*)` })
      .from(expenses)
      .where(where);
    const total = Number(countRow?.count || 0);
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: expenses.id,
        branchId: expenses.branchId,
        branchName: branches.name,
        category: expenses.category,
        amount: expenses.amount,
        currency: expenses.currency,
        note: expenses.note,
        expenseDate: expenses.expenseDate,
        createdAt: expenses.createdAt,
        createdBy: expenses.createdBy,
        createdByName: users.fullName,
      })
      .from(expenses)
      .leftJoin(branches, eq(expenses.branchId, branches.id))
      .leftJoin(users, eq(expenses.createdBy, users.id))
      .where(where)
      .orderBy(desc(expenses.expenseDate), desc(expenses.id))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map((r) => ({ ...r, amount: n(r.amount) })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id, actingUser = null) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, Number(id)))
      .limit(1);
    if (!row) throw new NotFoundError('Expense');
    enforceBranchScope(actingUser, row.branchId);
    return { ...row, amount: n(row.amount) };
  }

  async update(id, input, actingUser = null) {
    await this.getById(id, actingUser); // scope check + existence
    const db = await getDb();
    const patch = {};
    if (input.category !== undefined) patch.category = String(input.category).trim();
    if (input.amount !== undefined) {
      const a = Number(input.amount);
      if (!Number.isFinite(a) || a <= 0) {
        throw new ValidationError('Expense amount must be greater than zero');
      }
      patch.amount = String(a);
    }
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.note !== undefined) patch.note = input.note;
    if (input.expenseDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) {
      patch.expenseDate = input.expenseDate;
    }
    patch.updatedAt = new Date();

    const [row] = await db
      .update(expenses)
      .set(patch)
      .where(eq(expenses.id, Number(id)))
      .returning();
    return { ...row, amount: n(row.amount) };
  }

  async delete(id, actingUser = null) {
    await this.getById(id, actingUser); // scope check
    const db = await getDb();
    await db.delete(expenses).where(eq(expenses.id, Number(id)));
    return { success: true, message: 'Expense deleted' };
  }

  /**
   * Aggregated summary across the same filters as getAll.
   * Returns total + groupings by category, by branch, and by currency.
   */
  async getSummary(filters = {}, actingUser = null) {
    const db = await getDb();
    const { dateFrom, dateTo } = filters;
    const conds = [];
    if (dateFrom) conds.push(gte(expenses.expenseDate, dateFrom));
    if (dateTo) conds.push(lte(expenses.expenseDate, dateTo));
    if (filters.currency && filters.currency !== 'ALL') {
      conds.push(eq(expenses.currency, filters.currency));
    }

    const allowed = branchFilterFor(actingUser);
    if (allowed === null) {
      if (filters.branchId) conds.push(eq(expenses.branchId, Number(filters.branchId)));
    } else if (allowed.length === 0) {
      return {
        total: 0,
        byCategory: [],
        byBranch: [],
        byCurrency: [],
        filters: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      };
    } else {
      conds.push(eq(expenses.branchId, Number(allowed[0])));
    }

    const where = conds.length ? and(...conds) : undefined;

    const [totalRow] = await db
      .select({
        total: sql`COALESCE(SUM(${expenses.amount}::numeric), 0)`,
        count: sql`COUNT(*)`,
      })
      .from(expenses)
      .where(where);

    const byCategory = await db
      .select({
        category: expenses.category,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric), 0)`,
        count: sql`COUNT(*)`,
      })
      .from(expenses)
      .where(where)
      .groupBy(expenses.category, expenses.currency)
      .orderBy(desc(sql`COALESCE(SUM(${expenses.amount}::numeric), 0)`));

    const byBranch = await db
      .select({
        branchId: expenses.branchId,
        branchName: branches.name,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric), 0)`,
      })
      .from(expenses)
      .leftJoin(branches, eq(expenses.branchId, branches.id))
      .where(where)
      .groupBy(expenses.branchId, branches.name, expenses.currency);

    const byCurrency = await db
      .select({
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric), 0)`,
      })
      .from(expenses)
      .where(where)
      .groupBy(expenses.currency);

    return {
      total: n(totalRow?.total),
      count: Number(totalRow?.count || 0),
      byCategory: byCategory.map((r) => ({
        category: r.category,
        currency: r.currency,
        total: n(r.total),
        count: Number(r.count || 0),
      })),
      byBranch: byBranch.map((r) => ({
        branchId: r.branchId,
        branchName: r.branchName,
        currency: r.currency,
        total: n(r.total),
      })),
      byCurrency: byCurrency.map((r) => ({
        currency: r.currency,
        total: n(r.total),
      })),
      filters: {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        currency: filters.currency || 'ALL',
      },
    };
  }
}

export default new ExpensesService();
