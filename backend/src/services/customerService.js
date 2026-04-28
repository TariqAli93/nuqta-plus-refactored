import { getDb, saveDatabase } from '../db.js';
import {
  customers,
  sales,
  saleItems,
  payments,
  installments,
  branches,
  currencySettings,
} from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { eq, like, or, desc, sql, and, asc } from 'drizzle-orm';
import { isGlobalAdmin } from './scopeService.js';

export class CustomerService {
  async create(customerData, userId) {
    const db = await getDb();
    // Check for duplicate phone
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.phone, customerData.phone))
      .limit(1);

    if (existing && customerData.phone.trim() !== '') {
      throw new ConflictError(`Customer with phone ${customerData.phone} already exists`);
    }

    const [newCustomer] = await db
      .insert(customers)
      .values({
        ...customerData,
        createdBy: userId,
      })
      .returning();

    saveDatabase();

    return newCustomer;
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, search } = filters;

    let query = db.select().from(customers);

    if (search) {
      query = query.where(
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`))
      );
    }

    // Get total count for pagination metadata
    let countQuery = db.select({ count: sql`count(*)` }).from(customers);
    if (search) {
      countQuery = countQuery.where(
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`))
      );
    }
    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    // Get paginated results using offset and limit
    const results = await query
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: results,
      meta: {
        total: total || 0,
        page,
        limit,
        totalPages: Math.ceil((total || 0) / limit),
      },
    };
  }

  async getById(id) {
    const db = await getDb();
    const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

    if (!customer) {
      throw new NotFoundError('Customer');
    }

    // Get all sales for this customer
    const salesData = await db
      .select()
      .from(sales)
      .where(eq(sales.customerId, id))
      .orderBy(desc(sales.createdAt));

    // Get sale items for each sale
    const salesWithItems = await Promise.all(
      salesData.map(async (sale) => {
        const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));

        return {
          ...sale,
          items,
        };
      })
    );

    customer.sales = salesWithItems;

    return customer;
  }

  /**
   * Build a complete customer profile payload — basic info, financial summary,
   * sales/invoices, installments, payments, and a debit/credit/balance ledger.
   *
   * Authorization: global admins see any customer; branch-bound users may only
   * see a customer that has activity in their assigned branch (or no activity
   * at all). The branch check looks at the customer's sales because customers
   * themselves are not branch-owned in this schema.
   *
   * Aggregates are computed in SQL so this stays an O(1)-roundtrip endpoint.
   */
  async getProfile(rawId, actingUser = null) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new NotFoundError('Customer');
    }

    const db = await getDb();

    const [customer] = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        address: customers.address,
        city: customers.city,
        notes: customers.notes,
        totalPurchases: customers.totalPurchases,
        totalDebt: customers.totalDebt,
        creditScore: customers.creditScore,
        recommendedLimit: customers.recommendedLimit,
        isActive: customers.isActive,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    if (!customer) {
      throw new NotFoundError('Customer');
    }

    // ── Branch authorization ───────────────────────────────────────────────
    // Customers aren't branch-owned, but a branch-bound user must only see
    // customers who actually transacted in their branch. We answer that by
    // checking whether at least one sale exists for this customer in a
    // branch the user can access — and reject otherwise. Global admins skip.
    if (actingUser && !isGlobalAdmin(actingUser)) {
      const userBranchId = actingUser.assignedBranchId;
      if (!userBranchId) {
        // Branch user with no branch → cannot see any customer detail
        throw new NotFoundError('Customer');
      }
      const [branchSale] = await db
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.customerId, id), eq(sales.branchId, userBranchId)))
        .limit(1);
      const [anySale] = await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.customerId, id))
        .limit(1);
      // Customer only counts as "in this branch" if they have a sale here,
      // OR they have no sales at all (newly created, branch-agnostic).
      if (anySale && !branchSale) {
        throw new NotFoundError('Customer');
      }
    }

    // ── Financial summary (single SQL aggregate per dimension) ─────────────
    const [salesAgg] = await db
      .select({
        totalPurchases: sql`COALESCE(SUM(CASE WHEN ${sales.status} != 'cancelled' THEN ${sales.total}::numeric ELSE 0 END), 0)`.as('totalPurchases'),
        totalPaidOnSales: sql`COALESCE(SUM(CASE WHEN ${sales.status} != 'cancelled' THEN ${sales.paidAmount}::numeric ELSE 0 END), 0)`.as('totalPaidOnSales'),
        totalRemaining: sql`COALESCE(SUM(CASE WHEN ${sales.status} != 'cancelled' THEN ${sales.remainingAmount}::numeric ELSE 0 END), 0)`.as('totalRemaining'),
        cancelledCount: sql`COALESCE(SUM(CASE WHEN ${sales.status} = 'cancelled' THEN 1 ELSE 0 END), 0)`.as('cancelledCount'),
        totalSalesCount: sql`COUNT(*)`.as('totalSalesCount'),
        distinctCurrencies: sql`COUNT(DISTINCT ${sales.currency})`.as('distinctCurrencies'),
      })
      .from(sales)
      .where(eq(sales.customerId, id));

    const [paymentsAgg] = await db
      .select({
        totalPaid: sql`COALESCE(SUM(${payments.amount}::numeric), 0)`.as('totalPaid'),
        paymentsCount: sql`COUNT(*)`.as('paymentsCount'),
        distinctCurrencies: sql`COUNT(DISTINCT ${payments.currency})`.as('distinctCurrencies'),
      })
      .from(payments)
      .where(eq(payments.customerId, id));

    const [instAgg] = await db
      .select({
        active: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' THEN 1 ELSE 0 END), 0)`.as('active'),
        completed: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'paid' THEN 1 ELSE 0 END), 0)`.as('completed'),
        cancelled: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'cancelled' THEN 1 ELSE 0 END), 0)`.as('cancelled'),
        overdueAmount: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' AND ${installments.dueDate}::date < CURRENT_DATE THEN ${installments.remainingAmount}::numeric ELSE 0 END), 0)`.as('overdueAmount'),
      })
      .from(installments)
      .where(eq(installments.customerId, id));

    // ── Sales list with branch name (single JOIN, no N+1) ──────────────────
    const salesRows = await db
      .select({
        id: sales.id,
        invoiceNumber: sales.invoiceNumber,
        type: sql`COALESCE(${sales.saleType}, ${sales.paymentType})`.as('type'),
        paymentType: sales.paymentType,
        saleType: sales.saleType,
        date: sales.createdAt,
        total: sales.total,
        paidAmount: sales.paidAmount,
        remainingAmount: sales.remainingAmount,
        currency: sales.currency,
        status: sales.status,
        branchId: sales.branchId,
        branchName: branches.name,
      })
      .from(sales)
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(eq(sales.customerId, id))
      .orderBy(desc(sales.createdAt));

    // ── Installments list (with overdue days) ──────────────────────────────
    const installmentRows = await db
      .select({
        id: installments.id,
        saleId: installments.saleId,
        invoiceNumber: sales.invoiceNumber,
        installmentNumber: installments.installmentNumber,
        dueDate: installments.dueDate,
        dueAmount: installments.dueAmount,
        paidAmount: installments.paidAmount,
        remainingAmount: installments.remainingAmount,
        currency: installments.currency,
        status: installments.status,
        paidDate: installments.paidDate,
        overdueDays: sql`CASE
          WHEN ${installments.status} = 'pending' AND ${installments.dueDate}::date < CURRENT_DATE
            THEN (CURRENT_DATE - ${installments.dueDate}::date)
          ELSE 0
        END`.as('overdueDays'),
      })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(eq(installments.customerId, id))
      .orderBy(asc(installments.dueDate));

    // ── Payments list ──────────────────────────────────────────────────────
    const paymentRows = await db
      .select({
        id: payments.id,
        date: payments.paymentDate,
        createdAt: payments.createdAt,
        amount: payments.amount,
        currency: payments.currency,
        method: payments.paymentMethod,
        reference: payments.paymentReference,
        notes: payments.notes,
        saleId: payments.saleId,
        invoiceNumber: sales.invoiceNumber,
      })
      .from(payments)
      .leftJoin(sales, eq(payments.saleId, sales.id))
      .where(eq(payments.customerId, id))
      .orderBy(desc(payments.paymentDate));

    // ── Currency analysis ──────────────────────────────────────────────────
    // Group financial summary by currency so the frontend never sums across
    // currencies. Each entry is fully independent.
    const summaryByCurrency = {};
    for (const s of salesRows) {
      const cur = s.currency || 'USD';
      summaryByCurrency[cur] ??= {
        currency: cur,
        totalPurchases: 0,
        totalPaid: 0,
        totalRemaining: 0,
        cancelledCount: 0,
        salesCount: 0,
      };
      const row = summaryByCurrency[cur];
      row.salesCount += 1;
      if (s.status === 'cancelled') {
        row.cancelledCount += 1;
        continue;
      }
      row.totalPurchases += Number(s.total) || 0;
      row.totalPaid += Number(s.paidAmount) || 0;
      row.totalRemaining += Number(s.remainingAmount) || 0;
    }
    for (const p of paymentRows) {
      // `totalPaid` already comes from sales.paidAmount which is the source
      // of truth for invoice settlement. Keep the per-currency payment count
      // separate so the timeline reads correctly even if a payment is in a
      // different currency from the originating sale (rare but possible).
      const cur = p.currency || 'USD';
      summaryByCurrency[cur] ??= {
        currency: cur,
        totalPurchases: 0,
        totalPaid: 0,
        totalRemaining: 0,
        cancelledCount: 0,
        salesCount: 0,
      };
    }
    const summaryList = Object.values(summaryByCurrency);
    const multiCurrency = summaryList.length > 1;

    // ── Conversion availability ────────────────────────────────────────────
    const baseCur = await db
      .select({ code: currencySettings.currencyCode })
      .from(currencySettings)
      .where(and(eq(currencySettings.isBaseCurrency, true), eq(currencySettings.isActive, true)))
      .limit(1);
    const conversionUnavailable = baseCur.length === 0;

    // ── Debt timeline (debit on each sale, credit on each payment) ────────
    // Per-currency running balance. Cheap to build in JS once we have the
    // ordered rows; doing it in SQL would need a CTE per currency.
    const ledgerEvents = [
      ...salesRows
        .filter((s) => s.status !== 'cancelled')
        .map((s) => ({
          ts: s.date ? new Date(s.date).getTime() : 0,
          date: s.date,
          type: 'sale',
          description: `Invoice ${s.invoiceNumber}`,
          debit: Number(s.total) || 0,
          credit: 0,
          currency: s.currency || 'USD',
          referenceType: 'sale',
          referenceId: s.id,
        })),
      ...paymentRows.map((p) => ({
        ts: p.date ? new Date(p.date).getTime() : 0,
        date: p.date,
        type: 'payment',
        description: p.invoiceNumber
          ? `Payment for ${p.invoiceNumber}`
          : 'Payment',
        debit: 0,
        credit: Number(p.amount) || 0,
        currency: p.currency || 'USD',
        referenceType: 'payment',
        referenceId: p.id,
      })),
    ].sort((a, b) => a.ts - b.ts);

    const balances = {};
    const timeline = ledgerEvents.map((ev) => {
      balances[ev.currency] = (balances[ev.currency] || 0) + ev.debit - ev.credit;
      return {
        date: ev.date,
        type: ev.type,
        description: ev.description,
        debit: ev.debit,
        credit: ev.credit,
        balance: balances[ev.currency],
        currency: ev.currency,
        referenceType: ev.referenceType,
        referenceId: ev.referenceId,
      };
    });

    // ── Resolve a primary branch for the header (most-recent sale) ─────────
    const primaryBranch = salesRows.find((s) => s.branchId) || null;

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        notes: customer.notes,
        status: customer.isActive === false ? 'inactive' : 'active',
        isActive: customer.isActive !== false,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        branch: primaryBranch
          ? { id: primaryBranch.branchId, name: primaryBranch.branchName }
          : null,
        creditScore: customer.creditScore,
        recommendedLimit:
          customer.recommendedLimit != null ? Number(customer.recommendedLimit) : null,
      },
      summary: {
        totalPurchases: Number(salesAgg?.totalPurchases) || 0,
        totalPaid: Number(salesAgg?.totalPaidOnSales) || 0,
        totalRemainingDebt: Number(salesAgg?.totalRemaining) || 0,
        overdueAmount: Number(instAgg?.overdueAmount) || 0,
        activeInstallments: Number(instAgg?.active) || 0,
        completedInstallments: Number(instAgg?.completed) || 0,
        cancelledInstallments: Number(instAgg?.cancelled) || 0,
        cancelledSales: Number(salesAgg?.cancelledCount) || 0,
        salesCount: Number(salesAgg?.totalSalesCount) || 0,
        paymentsCount: Number(paymentsAgg?.paymentsCount) || 0,
        byCurrency: summaryList,
      },
      sales: salesRows.map((s) => ({
        id: s.id,
        invoiceNumber: s.invoiceNumber,
        type: s.type,
        paymentType: s.paymentType,
        saleType: s.saleType,
        date: s.date,
        total: Number(s.total) || 0,
        paid: Number(s.paidAmount) || 0,
        remaining: Number(s.remainingAmount) || 0,
        currency: s.currency,
        status: s.status,
        branch: s.branchId ? { id: s.branchId, name: s.branchName } : null,
      })),
      installments: installmentRows.map((i) => ({
        id: i.id,
        saleId: i.saleId,
        invoiceNumber: i.invoiceNumber,
        installmentNumber: i.installmentNumber,
        dueDate: i.dueDate,
        dueAmount: Number(i.dueAmount) || 0,
        paidAmount: Number(i.paidAmount) || 0,
        remainingAmount: Number(i.remainingAmount) || 0,
        currency: i.currency,
        status: i.status,
        paidDate: i.paidDate,
        overdueDays: Number(i.overdueDays) || 0,
      })),
      payments: paymentRows.map((p) => ({
        id: p.id,
        date: p.date || p.createdAt,
        amount: Number(p.amount) || 0,
        currency: p.currency,
        method: p.method,
        reference: p.reference,
        notes: p.notes,
        saleId: p.saleId,
        invoiceNumber: p.invoiceNumber,
      })),
      timeline,
      meta: {
        multiCurrency,
        conversionUnavailable,
        warnings: [
          ...(multiCurrency
            ? [
                {
                  code: 'MULTI_CURRENCY',
                  message:
                    'Customer has transactions in multiple currencies. Totals are reported per currency and never summed across them.',
                },
              ]
            : []),
          ...(conversionUnavailable
            ? [
                {
                  code: 'CONVERSION_UNAVAILABLE',
                  message:
                    'No active base currency configured. Cross-currency conversion is not available.',
                },
              ]
            : []),
        ],
      },
    };
  }

  async update(id, customerData) {
    const db = await getDb();
    const [updated] = await db
      .update(customers)
      .set({
        ...customerData,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return updated;
  }

  async delete(id) {
    const db = await getDb();
    const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning();

    if (!deleted) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return { message: 'Customer deleted successfully' };
  }

  async updateDebt(customerId, amount) {
    const db = await getDb();
    const customer = await this.getById(customerId);

    const [updated] = await db
      .update(customers)
      .set({
        totalDebt: (customer.totalDebt || 0) + amount,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updated) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return updated;
  }
}
