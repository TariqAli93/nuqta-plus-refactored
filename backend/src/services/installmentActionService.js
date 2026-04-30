import { getDb } from '../db.js';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  installments,
  installmentActions,
  sales,
  customers,
  users,
  branches,
} from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { branchFilterFor, enforceBranchScope } from './scopeService.js';
import { SaleService } from './saleService.js';
import auditService from './auditService.js';

const saleService = new SaleService();

function serializeAction(row) {
  return {
    id: row.id,
    installmentId: row.installmentId,
    customerId: row.customerId,
    saleId: row.saleId,
    userId: row.userId,
    username: row.username || null,
    actionType: row.actionType,
    note: row.note,
    promisedAmount: row.promisedAmount != null ? Number(row.promisedAmount) : null,
    promisedDate: row.promisedDate,
    oldDueDate: row.oldDueDate,
    newDueDate: row.newDueDate,
    paymentId: row.paymentId,
    createdAt: row.createdAt,
  };
}

/**
 * Lean collections workflow service. Records actions taken on installments
 * (calls, visits, promises, reschedules, notes, payments) and exposes
 * read endpoints for the frontend collections views.
 *
 * Money for `payment` actions still flows through SaleService.addPayment() —
 * we never duplicate payment math here.
 */
export class InstallmentActionService {
  /**
   * Load an installment + its parent sale, enforcing branch scope on the
   * acting user. Throws NotFoundError if missing or out of scope.
   */
  async getInstallmentInScope(installmentId, user) {
    const db = await getDb();
    const [row] = await db
      .select({
        id: installments.id,
        saleId: installments.saleId,
        customerId: installments.customerId,
        installmentNumber: installments.installmentNumber,
        dueAmount: installments.dueAmount,
        paidAmount: installments.paidAmount,
        remainingAmount: installments.remainingAmount,
        currency: installments.currency,
        dueDate: installments.dueDate,
        paidDate: installments.paidDate,
        status: installments.status,
        notes: installments.notes,
        saleBranchId: sales.branchId,
        invoiceNumber: sales.invoiceNumber,
      })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(eq(installments.id, Number(installmentId)))
      .limit(1);

    if (!row) throw new NotFoundError('Installment not found');
    enforceBranchScope(user, row.saleBranchId);
    return row;
  }

  /**
   * Record an action against an installment. Returns the inserted row.
   * For action_type='payment' delegates to SaleService.addPayment() and
   * stores the resulting payment id on the action.
   */
  async recordAction(installmentId, body, user) {
    const installment = await this.getInstallmentInScope(installmentId, user);

    if (installment.status === 'cancelled') {
      throw new ValidationError('Cannot act on a cancelled installment');
    }

    const db = await getDb();
    const action = body.actionType;
    const base = {
      installmentId: installment.id,
      customerId: installment.customerId || null,
      saleId: installment.saleId || null,
      userId: user?.id || null,
      actionType: action,
      note: body.note || null,
    };

    let inserted;

    if (action === 'payment') {
      // Reuse the canonical payment pipeline. The payment will be allocated
      // across the sale's installments in the natural order — recording the
      // action here marks the *intent* (this collection event is for this
      // installment) and links the resulting payment row.
      const updatedSale = await saleService.addPayment(
        installment.saleId,
        {
          amount: Number(body.amount),
          currency: body.currency || installment.currency,
          exchangeRate: body.exchangeRate || 1,
          paymentMethod: body.paymentMethod || 'cash',
          paymentReference: body.paymentReference || null,
          notes: body.note || null,
        },
        user?.id
      );
      const newest = (updatedSale.payments || [])
        .slice()
        .sort((a, b) => Number(b.id) - Number(a.id))[0];

      const [row] = await db
        .insert(installmentActions)
        .values({
          ...base,
          paymentId: newest?.id || null,
        })
        .returning();
      inserted = row;
    } else if (action === 'reschedule') {
      const oldDueDate = installment.dueDate;
      const newDueDate = body.newDueDate;
      if (oldDueDate === newDueDate) {
        throw new ValidationError('New due date must differ from the current due date');
      }
      // Update the installment's due date in the same step.
      await db
        .update(installments)
        .set({ dueDate: newDueDate, updatedAt: new Date() })
        .where(eq(installments.id, installment.id));

      const [row] = await db
        .insert(installmentActions)
        .values({
          ...base,
          oldDueDate,
          newDueDate,
        })
        .returning();
      inserted = row;
    } else if (action === 'promise_to_pay') {
      const [row] = await db
        .insert(installmentActions)
        .values({
          ...base,
          promisedAmount: body.promisedAmount != null ? String(body.promisedAmount) : null,
          promisedDate: body.promisedDate || null,
        })
        .returning();
      inserted = row;
    } else {
      // call | visit | note
      const [row] = await db
        .insert(installmentActions)
        .values({ ...base })
        .returning();
      inserted = row;
    }

    // Audit trail (best-effort — never fail the action)
    try {
      await auditService.log({
        userId: user?.id,
        username: user?.username,
        action: `installment:${action}`,
        resource: 'installments',
        resourceId: installment.id,
        details: {
          saleId: installment.saleId,
          customerId: installment.customerId,
          ...(action === 'reschedule'
            ? { oldDueDate: inserted.oldDueDate, newDueDate: inserted.newDueDate }
            : {}),
          ...(action === 'promise_to_pay'
            ? { promisedAmount: inserted.promisedAmount, promisedDate: inserted.promisedDate }
            : {}),
          ...(action === 'payment' ? { paymentId: inserted.paymentId, amount: body.amount } : {}),
        },
      });
    } catch {
      // non-fatal
    }

    return inserted;
  }

  /**
   * List actions for a single installment in chronological order (newest first).
   */
  async listActions(installmentId, user) {
    const installment = await this.getInstallmentInScope(installmentId, user);
    const db = await getDb();
    const rows = await db
      .select({
        id: installmentActions.id,
        installmentId: installmentActions.installmentId,
        customerId: installmentActions.customerId,
        saleId: installmentActions.saleId,
        userId: installmentActions.userId,
        username: users.username,
        actionType: installmentActions.actionType,
        note: installmentActions.note,
        promisedAmount: installmentActions.promisedAmount,
        promisedDate: installmentActions.promisedDate,
        oldDueDate: installmentActions.oldDueDate,
        newDueDate: installmentActions.newDueDate,
        paymentId: installmentActions.paymentId,
        createdAt: installmentActions.createdAt,
      })
      .from(installmentActions)
      .leftJoin(users, eq(installmentActions.userId, users.id))
      .where(eq(installmentActions.installmentId, installment.id))
      .orderBy(desc(installmentActions.createdAt));

    return rows.map(serializeAction);
  }

  /**
   * List collection actions across all installments belonging to a customer.
   * Used by the Collections tab on the customer profile.
   */
  async listForCustomer(customerId, user) {
    const db = await getDb();
    // Verify the customer is in scope first via any of their sales' branches.
    // Customers themselves don't currently carry a branchId, so we trust the
    // sale-level branch check applied in the join.
    const branchIds = branchFilterFor(user);

    const baseQuery = db
      .select({
        id: installmentActions.id,
        installmentId: installmentActions.installmentId,
        installmentNumber: installments.installmentNumber,
        installmentDueDate: installments.dueDate,
        installmentStatus: installments.status,
        installmentRemaining: installments.remainingAmount,
        installmentCurrency: installments.currency,
        saleId: installmentActions.saleId,
        invoiceNumber: sales.invoiceNumber,
        customerId: installmentActions.customerId,
        userId: installmentActions.userId,
        username: users.username,
        actionType: installmentActions.actionType,
        note: installmentActions.note,
        promisedAmount: installmentActions.promisedAmount,
        promisedDate: installmentActions.promisedDate,
        oldDueDate: installmentActions.oldDueDate,
        newDueDate: installmentActions.newDueDate,
        paymentId: installmentActions.paymentId,
        createdAt: installmentActions.createdAt,
      })
      .from(installmentActions)
      .leftJoin(installments, eq(installmentActions.installmentId, installments.id))
      .leftJoin(sales, eq(installmentActions.saleId, sales.id))
      .leftJoin(users, eq(installmentActions.userId, users.id));

    const conditions = [eq(installmentActions.customerId, Number(customerId))];
    if (branchIds && branchIds.length > 0) {
      conditions.push(inArray(sales.branchId, branchIds));
    } else if (branchIds && branchIds.length === 0) {
      // User has no branch assigned and isn't global — return nothing.
      return [];
    }

    const rows = await baseQuery
      .where(and(...conditions))
      .orderBy(desc(installmentActions.createdAt));

    return rows.map((r) => ({
      ...serializeAction(r),
      installmentNumber: r.installmentNumber,
      installmentDueDate: r.installmentDueDate,
      installmentStatus: r.installmentStatus,
      installmentRemaining: Number(r.installmentRemaining || 0),
      installmentCurrency: r.installmentCurrency,
      invoiceNumber: r.invoiceNumber,
    }));
  }

  /**
   * Overdue installments across the user's branch scope. Optional filters:
   *   branchId    — global admins can pin to a specific branch
   *   startDate   — earliest dueDate (YYYY-MM-DD)
   *   endDate     — latest dueDate (YYYY-MM-DD)
   *   agingBucket — '1-7' | '8-30' | '31-60' | '60+' (days overdue)
   *   collectorId — (future) action.userId — kept for forward compat
   *   page, limit
   */
  async listOverdue(query, user) {
    const db = await getDb();
    const branchIds = branchFilterFor(user);

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions = [
      eq(installments.status, 'pending'),
      sql`${installments.dueDate}::date < CURRENT_DATE`,
    ];

    if (branchIds && branchIds.length > 0) {
      conditions.push(inArray(sales.branchId, branchIds));
    } else if (branchIds && branchIds.length === 0) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    if (query?.branchId) {
      conditions.push(eq(sales.branchId, Number(query.branchId)));
    }
    if (query?.startDate) {
      conditions.push(gte(installments.dueDate, query.startDate));
    }
    if (query?.endDate) {
      conditions.push(lte(installments.dueDate, query.endDate));
    }
    if (query?.agingBucket) {
      const bucket = String(query.agingBucket);
      const daysOverdue = sql`(CURRENT_DATE - ${installments.dueDate}::date)`;
      if (bucket === '1-7') {
        conditions.push(sql`${daysOverdue} BETWEEN 1 AND 7`);
      } else if (bucket === '8-30') {
        conditions.push(sql`${daysOverdue} BETWEEN 8 AND 30`);
      } else if (bucket === '31-60') {
        conditions.push(sql`${daysOverdue} BETWEEN 31 AND 60`);
      } else if (bucket === '60+') {
        conditions.push(sql`${daysOverdue} > 60`);
      }
    }

    const where = and(...conditions);

    const data = await db
      .select({
        id: installments.id,
        saleId: installments.saleId,
        customerId: installments.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        invoiceNumber: sales.invoiceNumber,
        branchId: sales.branchId,
        branchName: branches.name,
        installmentNumber: installments.installmentNumber,
        dueDate: installments.dueDate,
        dueAmount: installments.dueAmount,
        paidAmount: installments.paidAmount,
        remainingAmount: installments.remainingAmount,
        currency: installments.currency,
        overdueDays: sql`(CURRENT_DATE - ${installments.dueDate}::date)`.as('overdueDays'),
      })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .leftJoin(customers, eq(installments.customerId, customers.id))
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(where)
      .orderBy(asc(installments.dueDate))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql`COUNT(*)::int` })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(where);

    const total = Number(count || 0);

    return {
      data: data.map((r) => ({
        ...r,
        dueAmount: Number(r.dueAmount || 0),
        paidAmount: Number(r.paidAmount || 0),
        remainingAmount: Number(r.remainingAmount || 0),
        overdueDays: Number(r.overdueDays || 0),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export default new InstallmentActionService();
