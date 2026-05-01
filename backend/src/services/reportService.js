import { getDb } from '../db.js';
import {
  sales,
  payments,
  installments,
  customers,
  products,
  saleItems,
  saleReturns,
  saleReturnItems,
  productStock,
  warehouses,
  stockMovements,
  expenses,
  branches,
} from '../models/index.js';
import { and, eq, gte, lte, sql, inArray, desc } from 'drizzle-orm';
import { branchFilterFor } from './scopeService.js';


function toNum(v) {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

function ymd(date) {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
}

function makeRange({ dateFrom, dateTo }) {
  const from = ymd(dateFrom);
  const to = ymd(dateTo);
  return { from, to };
}

function applyBranchScope(filters, actingUser) {
  const allowed = branchFilterFor(actingUser);
  if (allowed === null) {
    return filters.branchId ? Number(filters.branchId) : null;
  }
  if (allowed.length === 0) return -1;
  return Number(allowed[0]);
}

function withConditions(base = [], { branchId, currency, from, to }, dateColumn) {
  const out = [...base];
  if (branchId !== null && branchId !== undefined) {
    if (branchId === -1) out.push(sql`1=0`);
    else out.push(eq(sales.branchId, branchId));
  }
  if (currency && currency !== 'ALL') out.push(eq(sales.currency, currency));
  if (from) out.push(gte(dateColumn, from));
  if (to) out.push(lte(dateColumn, to));
  return out;
}

export class ReportService {
  async getDashboard(filters = {}, actingUser = null) {
    const db = await getDb();
    const { from, to } = makeRange(filters);
    const branchId = applyBranchScope(filters, actingUser);
    const currency = filters.currency || 'ALL';

    const salesDate = sql`${sales.createdAt}::date::text`;
    const saleConds = withConditions([
      sql`${sales.status} <> 'draft'`,
    ], { branchId, currency, from, to }, salesDate);

    const salesSummaryRows = await db
      .select({
        currency: sales.currency,
        totalSales: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.total}::numeric ELSE 0 END),0)`,
        cashSales: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' AND ${sales.paymentType} = 'cash' THEN ${sales.total}::numeric ELSE 0 END),0)`,
        installmentSales: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' AND ${sales.paymentType} IN ('installment','mixed') THEN ${sales.total}::numeric ELSE 0 END),0)`,
        returnedCancelled: sql`COALESCE(SUM(CASE WHEN ${sales.status} = 'cancelled' THEN ${sales.total}::numeric ELSE 0 END),0)`,
        discounts: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.discount}::numeric ELSE 0 END),0)`,
        taxes: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.tax}::numeric ELSE 0 END),0)`,
        netSales: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.total}::numeric - ${sales.discount}::numeric ELSE 0 END),0)`,
        revenue: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.total}::numeric ELSE 0 END),0)`,
        unpaidBalances: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${sales.remainingAmount}::numeric ELSE 0 END),0)`,
      })
      .from(sales)
      .where(and(...saleConds))
      .groupBy(sales.currency);

    const returnRows = await db
      .select({
        currency: sales.currency,
        returnedValue: sql`COALESCE(SUM(${saleReturns.returnedValue}::numeric),0)`,
      })
      .from(saleReturns)
      .leftJoin(sales, eq(saleReturns.saleId, sales.id))
      .where(and(...saleConds))
      .groupBy(sales.currency);

    const paymentDate = sql`${payments.paymentDate}::date::text`;
    const paymentConds = [
      ...(from ? [gte(paymentDate, from)] : []),
      ...(to ? [lte(paymentDate, to)] : []),
      ...(currency && currency !== 'ALL' ? [eq(payments.currency, currency)] : []),
    ];
    if (branchId !== null && branchId !== undefined) {
      if (branchId === -1) paymentConds.push(sql`1=0`);
      else paymentConds.push(eq(sales.branchId, branchId));
    }

    const paymentRows = await db
      .select({
        currency: payments.currency,
        totalPaid: sql`COALESCE(SUM(${payments.amount}::numeric),0)`,
        cashPayments: sql`COALESCE(SUM(CASE WHEN ${payments.paymentMethod} = 'cash' THEN ${payments.amount}::numeric ELSE 0 END),0)`,
        cardPayments: sql`COALESCE(SUM(CASE WHEN ${payments.paymentMethod} = 'card' THEN ${payments.amount}::numeric ELSE 0 END),0)`,
        transferPayments: sql`COALESCE(SUM(CASE WHEN ${payments.paymentMethod} = 'transfer' THEN ${payments.amount}::numeric ELSE 0 END),0)`,
        installmentCollections: sql`COALESCE(SUM(CASE WHEN ${sales.paymentType} IN ('installment','mixed') THEN ${payments.amount}::numeric ELSE 0 END),0)`,
      })
      .from(payments)
      .leftJoin(sales, eq(payments.saleId, sales.id))
      .where(and(...paymentConds))
      .groupBy(payments.currency);

    const installmentConds = [
      ...(from ? [gte(installments.dueDate, from)] : []),
      ...(to ? [lte(installments.dueDate, to)] : []),
      ...(currency && currency !== 'ALL' ? [eq(installments.currency, currency)] : []),
    ];
    if (branchId !== null && branchId !== undefined) {
      if (branchId === -1) installmentConds.push(sql`1=0`);
      else installmentConds.push(eq(sales.branchId, branchId));
    }
    const today = new Date().toISOString().slice(0, 10);
    const installmentRows = await db
      .select({
        currency: installments.currency,
        dueInstallments: sql`COUNT(CASE WHEN ${installments.status} = 'pending' THEN 1 END)`,
        overdueInstallments: sql`COUNT(CASE WHEN ${installments.status} = 'pending' AND ${installments.dueDate} < ${today} THEN 1 END)`,
        paidInstallments: sql`COUNT(CASE WHEN ${installments.status} = 'paid' THEN 1 END)`,
        partialInstallments: sql`COUNT(CASE WHEN ${installments.status} = 'pending' AND ${installments.paidAmount}::numeric > 0 THEN 1 END)`,
        expectedCollections: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' THEN ${installments.remainingAmount}::numeric ELSE 0 END),0)`,
        lateAmounts: sql`COALESCE(SUM(CASE WHEN ${installments.status} = 'pending' AND ${installments.dueDate} < ${today} THEN ${installments.remainingAmount}::numeric ELSE 0 END),0)`,
      })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(and(...installmentConds))
      .groupBy(installments.currency);

    const delayRows = await db
      .select({
        customerId: installments.customerId,
        customerName: customers.name,
        avgDelayDays: sql`COALESCE(AVG(CASE WHEN ${installments.status}='paid' AND ${installments.paidDate} > ${installments.dueDate} THEN (${installments.paidDate}::date - ${installments.dueDate}::date) END),0)`,
        lateCount: sql`COUNT(CASE WHEN (${installments.status}='paid' AND ${installments.paidDate} > ${installments.dueDate}) OR (${installments.status}='pending' AND ${installments.dueDate} < ${today}) THEN 1 END)`,
      })
      .from(installments)
      .leftJoin(customers, eq(installments.customerId, customers.id))
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(and(...installmentConds))
      .groupBy(installments.customerId, customers.name)
      .orderBy(desc(sql`COUNT(CASE WHEN (${installments.status}='paid' AND ${installments.paidDate} > ${installments.dueDate}) OR (${installments.status}='pending' AND ${installments.dueDate} < ${today}) THEN 1 END)`))
      .limit(10);

    const idsForBranch = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId, name: warehouses.name })
      .from(warehouses)
      .where(branchId && branchId !== -1 ? eq(warehouses.branchId, branchId) : sql`1=1`);

    const warehouseIds = idsForBranch.map((w) => w.id);
    const stockRows = warehouseIds.length
      ? await db
          .select({
            warehouseId: productStock.warehouseId,
            warehouseName: warehouses.name,
            branchId: warehouses.branchId,
            productId: products.id,
            productName: products.name,
            quantity: productStock.quantity,
            minStock: products.minStock,
            costPrice: products.costPrice,
            currency: products.currency,
          })
          .from(productStock)
          .leftJoin(products, eq(productStock.productId, products.id))
          .leftJoin(warehouses, eq(productStock.warehouseId, warehouses.id))
          .where(inArray(productStock.warehouseId, warehouseIds))
      : [];

    const movementRows = warehouseIds.length
      ? await db
          .select({
            movementType: stockMovements.movementType,
            count: sql`COUNT(*)`,
            qty: sql`COALESCE(SUM(ABS(${stockMovements.quantityChange})),0)`,
          })
          .from(stockMovements)
          .where(and(inArray(stockMovements.warehouseId, warehouseIds), ...(from ? [gte(sql`${stockMovements.createdAt}::date::text`, from)] : []), ...(to ? [lte(sql`${stockMovements.createdAt}::date::text`, to)] : [])))
          .groupBy(stockMovements.movementType)
      : [];

    const debtRows = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        totalDebt: customers.totalDebt,
        totalPurchases: customers.totalPurchases,
      })
      .from(customers)
      .where(sql`${customers.totalDebt}::numeric > 0`)
      .orderBy(desc(sql`${customers.totalDebt}::numeric`))
      .limit(10);

    const topPaying = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        paid: sql`COALESCE(SUM(${payments.amount}::numeric),0)`,
        currency: payments.currency,
      })
      .from(payments)
      .leftJoin(customers, eq(payments.customerId, customers.id))
      .leftJoin(sales, eq(payments.saleId, sales.id))
      .where(and(...paymentConds))
      .groupBy(customers.id, customers.name, payments.currency)
      .orderBy(desc(sql`COALESCE(SUM(${payments.amount}::numeric),0)`))
      .limit(10);

    const cogsRows = await db
      .select({
        currency: sales.currency,
        cogs: sql`COALESCE(SUM(CASE WHEN ${sales.status} <> 'cancelled' THEN ${saleItems.quantity} * ${products.costPrice}::numeric ELSE 0 END),0)`,
      })
      .from(saleItems)
      .leftJoin(sales, eq(saleItems.saleId, sales.id))
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(and(...saleConds))
      .groupBy(sales.currency);

    const returnedCogsRows = await db
      .select({
        currency: sales.currency,
        returnedCogs: sql`COALESCE(SUM(${saleReturnItems.quantity} * ${products.costPrice}::numeric),0)`,
      })
      .from(saleReturnItems)
      .leftJoin(saleReturns, eq(saleReturnItems.returnId, saleReturns.id))
      .leftJoin(sales, eq(saleReturns.saleId, sales.id))
      .leftJoin(products, eq(saleReturnItems.productId, products.id))
      .where(and(...saleConds))
      .groupBy(sales.currency);

    // ── Expenses summary (used by netProfit + dedicated expense panels) ─────
    const expenseConds = [];
    if (from) expenseConds.push(gte(expenses.expenseDate, from));
    if (to) expenseConds.push(lte(expenses.expenseDate, to));
    if (currency && currency !== 'ALL') expenseConds.push(eq(expenses.currency, currency));
    if (branchId !== null && branchId !== undefined) {
      if (branchId === -1) expenseConds.push(sql`1=0`);
      else expenseConds.push(eq(expenses.branchId, branchId));
    }
    const expenseWhere = expenseConds.length ? and(...expenseConds) : undefined;

    const expenseByCurrency = await db
      .select({
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.currency);

    const expenseByCategoryRows = await db
      .select({
        category: expenses.category,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.category, expenses.currency)
      .orderBy(desc(sql`COALESCE(SUM(${expenses.amount}::numeric),0)`));

    const expenseByBranchRows = await db
      .select({
        branchId: expenses.branchId,
        branchName: branches.name,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .leftJoin(branches, eq(expenses.branchId, branches.id))
      .where(expenseWhere)
      .groupBy(expenses.branchId, branches.name, expenses.currency);

    const expensesByCurrencyMap = Object.fromEntries(
      expenseByCurrency.map((r) => [r.currency, toNum(r.total)])
    );
    const totalExpenses = expenseByCurrency.reduce((acc, r) => acc + toNum(r.total), 0);

    const summaryByCurrency = Object.fromEntries(salesSummaryRows.map((r) => [r.currency, {
      sales: toNum(r.totalSales), cashSales: toNum(r.cashSales), installmentSales: toNum(r.installmentSales),
      returnedCancelled: toNum(r.returnedCancelled), discounts: toNum(r.discounts), taxes: toNum(r.taxes),
      netSales: toNum(r.netSales), revenue: toNum(r.revenue), unpaidBalances: toNum(r.unpaidBalances),
    }]));

    for (const r of returnRows) {
      const key = r.currency;
      summaryByCurrency[key] ??= {};
      const returned = toNum(r.returnedValue);
      summaryByCurrency[key].returnedValue = returned;
      summaryByCurrency[key].sales = Math.max(0, toNum(summaryByCurrency[key].sales) - returned);
      summaryByCurrency[key].netSales = Math.max(0, toNum(summaryByCurrency[key].netSales) - returned);
      summaryByCurrency[key].revenue = Math.max(0, toNum(summaryByCurrency[key].revenue) - returned);
    }

    for (const r of paymentRows) {
      const key = r.currency;
      summaryByCurrency[key] ??= {};
      Object.assign(summaryByCurrency[key], {
        totalPaid: toNum(r.totalPaid), cashPayments: toNum(r.cashPayments), cardPayments: toNum(r.cardPayments),
        transferPayments: toNum(r.transferPayments), installmentCollections: toNum(r.installmentCollections),
      });
    }
    for (const r of installmentRows) {
      const key = r.currency;
      summaryByCurrency[key] ??= {};
      Object.assign(summaryByCurrency[key], {
        dueInstallments: Number(r.dueInstallments || 0), overdueInstallments: Number(r.overdueInstallments || 0),
        paidInstallments: Number(r.paidInstallments || 0), partialInstallments: Number(r.partialInstallments || 0),
        expectedCollections: toNum(r.expectedCollections), lateAmounts: toNum(r.lateAmounts),
      });
    }
    for (const r of cogsRows) {
      const key = r.currency;
      summaryByCurrency[key] ??= {};
      summaryByCurrency[key].cogs = toNum(r.cogs);
    }
    for (const r of returnedCogsRows) {
      const key = r.currency;
      summaryByCurrency[key] ??= {};
      summaryByCurrency[key].cogs = Math.max(
        0,
        toNum(summaryByCurrency[key].cogs) - toNum(r.returnedCogs)
      );
    }

    const currencies = Object.keys(summaryByCurrency);
    for (const cur of currencies) {
      const s = summaryByCurrency[cur];
      const revenue = toNum(s.revenue);
      const cogs = s.cogs ?? null;
      const expenseTotal = expensesByCurrencyMap[cur] || 0;
      s.grossProfit = cogs === null ? null : revenue - cogs;
      s.expenses = expenseTotal;
      s.netProfit = cogs === null ? null : revenue - cogs - expenseTotal;
    }
    // Cover currencies that have expenses but no sales in the same period.
    for (const [cur, total] of Object.entries(expensesByCurrencyMap)) {
      summaryByCurrency[cur] ??= { revenue: 0 };
      if (summaryByCurrency[cur].expenses === undefined) {
        summaryByCurrency[cur].expenses = total;
      }
    }

    const lowStock = stockRows.filter((r) => Number(r.quantity) > 0 && Number(r.quantity) <= Number(r.minStock || 0));
    const outOfStock = stockRows.filter((r) => Number(r.quantity) <= 0);

    const debtByCurrency = {};
    for (const d of debtRows) {
      const cur = 'UNKNOWN';
      debtByCurrency[cur] = (debtByCurrency[cur] || 0) + toNum(d.totalDebt);
    }

    return {
      meta: {
        filters: { dateFrom: from, dateTo: to, currency, requestedBranchId: filters.branchId || null, effectiveBranchId: branchId },
        generatedAt: new Date().toISOString(),
        conversionAvailable: false,
        notes: [
          'Currency conversion unavailable: totals are grouped by currency only.',
        ],
      },
      kpisByCurrency: summaryByCurrency,
      salesSummary: summaryByCurrency,
      paymentsSummary: summaryByCurrency,
      installmentsSummary: {
        byCurrency: summaryByCurrency,
        customerDelayStats: delayRows.map((r) => ({ customerId: r.customerId, customerName: r.customerName, avgDelayDays: toNum(r.avgDelayDays), lateCount: Number(r.lateCount || 0) })),
      },
      expensesSummary: {
        supported: true,
        totalExpenses,
        byCategory: expenseByCategoryRows.map((r) => ({
          category: r.category,
          currency: r.currency,
          total: toNum(r.total),
        })),
        byBranch: expenseByBranchRows.map((r) => ({
          branchId: r.branchId,
          branchName: r.branchName,
          currency: r.currency,
          total: toNum(r.total),
        })),
        byCurrency: expenseByCurrency.map((r) => ({
          currency: r.currency,
          total: toNum(r.total),
        })),
      },
      profitLoss: {
        byCurrency: Object.fromEntries(Object.entries(summaryByCurrency).map(([cur, s]) => [cur, {
          revenue: toNum(s.revenue), cogs: s.cogs ?? null, grossProfit: s.grossProfit ?? null, expenses: toNum(s.expenses || 0), netProfit: s.netProfit ?? null,
          cogsAccurate: s.cogs !== null,
          warning: s.cogs === null ? 'COGS cannot be calculated accurately from current data.' : null,
        }]))
      },
      inventory: {
        stockValueByCurrency: stockRows.reduce((acc, r) => {
          const cur = r.currency || 'USD';
          acc[cur] = (acc[cur] || 0) + toNum(r.costPrice) * Number(r.quantity || 0);
          return acc;
        }, {}),
        lowStockProducts: lowStock,
        outOfStockProducts: outOfStock,
        stockByBranchWarehouse: stockRows,
        movementSummary: movementRows,
      },
      customersDebt: {
        totalCustomersWithDebt: debtRows.length,
        totalOutstandingDebt: debtByCurrency,
        overdueDebt: Object.fromEntries(installmentRows.map((r) => [r.currency, toNum(r.lateAmounts)])),
        topDebtCustomers: debtRows,
        topPayingCustomers: topPaying,
      },
      trends: await this.getTrends({ from, to, branchId, currency }),
    };
  }

  /**
   * Profit report — combines revenue, COGS, expenses for the requested
   * window. Output shape:
   *   {
   *     totals:       { byCurrency: { CUR: { revenue, cogs, grossProfit, expenses, netProfit } } },
   *     byBranch:     [{ branchId, branchName, currency, revenue, cogs, expenses, netProfit }],
   *     byPeriod:     [{ day, currency, revenue, cogs, expenses, netProfit }],
   *     meta:         { filters, generatedAt }
   *   }
   *
   * Period granularity is daily — the existing dashboard already groups by
   * day; consumers can re-bucket on the client.
   */
  async getProfitReport(filters = {}, actingUser = null) {
    const db = await getDb();
    const { from, to } = makeRange(filters);
    const branchId = applyBranchScope(filters, actingUser);
    const currency = filters.currency || 'ALL';

    const salesDate = sql`${sales.createdAt}::date::text`;
    const saleConds = withConditions(
      [sql`${sales.status} <> 'cancelled'`, sql`${sales.status} <> 'draft'`],
      { branchId, currency, from, to },
      salesDate
    );
    const saleWhere = saleConds.length ? and(...saleConds) : undefined;

    // Revenue aggregations from `sales`
    const revenueByCurrency = await db
      .select({
        currency: sales.currency,
        revenue: sql`COALESCE(SUM(${sales.total}::numeric),0)`,
      })
      .from(sales)
      .where(saleWhere)
      .groupBy(sales.currency);

    const revenueByBranch = await db
      .select({
        branchId: sales.branchId,
        branchName: branches.name,
        currency: sales.currency,
        revenue: sql`COALESCE(SUM(${sales.total}::numeric),0)`,
      })
      .from(sales)
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(saleWhere)
      .groupBy(sales.branchId, branches.name, sales.currency);

    const revenueByDay = await db
      .select({
        day: salesDate,
        currency: sales.currency,
        revenue: sql`COALESCE(SUM(${sales.total}::numeric),0)`,
      })
      .from(sales)
      .where(saleWhere)
      .groupBy(salesDate, sales.currency)
      .orderBy(salesDate);

    // COGS aggregations from `sale_items` joined back to `sales`
    const cogsByCurrencyRows = await db
      .select({
        currency: sales.currency,
        cogs: sql`COALESCE(SUM(${saleItems.quantity} * ${products.costPrice}::numeric),0)`,
      })
      .from(saleItems)
      .leftJoin(sales, eq(saleItems.saleId, sales.id))
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(saleWhere)
      .groupBy(sales.currency);

    const cogsByBranchRows = await db
      .select({
        branchId: sales.branchId,
        currency: sales.currency,
        cogs: sql`COALESCE(SUM(${saleItems.quantity} * ${products.costPrice}::numeric),0)`,
      })
      .from(saleItems)
      .leftJoin(sales, eq(saleItems.saleId, sales.id))
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(saleWhere)
      .groupBy(sales.branchId, sales.currency);

    const cogsByDayRows = await db
      .select({
        day: salesDate,
        currency: sales.currency,
        cogs: sql`COALESCE(SUM(${saleItems.quantity} * ${products.costPrice}::numeric),0)`,
      })
      .from(saleItems)
      .leftJoin(sales, eq(saleItems.saleId, sales.id))
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(saleWhere)
      .groupBy(salesDate, sales.currency)
      .orderBy(salesDate);

    const cogsByCurrencyMap = Object.fromEntries(
      cogsByCurrencyRows.map((r) => [r.currency || 'USD', toNum(r.cogs)])
    );
    const cogsByBranchMap = new Map(
      cogsByBranchRows.map((r) => [`${r.branchId || 'null'}|${r.currency}`, toNum(r.cogs)])
    );
    const cogsByDayMap = new Map(
      cogsByDayRows.map((r) => [`${r.day}|${r.currency}`, toNum(r.cogs)])
    );

    const totalsRows = revenueByCurrency.map((r) => ({
      currency: r.currency,
      revenue: toNum(r.revenue),
      cogs: cogsByCurrencyMap[r.currency] || 0,
    }));
    const branchRows = revenueByBranch.map((r) => ({
      branchId: r.branchId,
      branchName: r.branchName,
      currency: r.currency,
      revenue: toNum(r.revenue),
      cogs: cogsByBranchMap.get(`${r.branchId || 'null'}|${r.currency}`) || 0,
    }));
    const periodRows = revenueByDay.map((r) => ({
      day: r.day,
      currency: r.currency,
      revenue: toNum(r.revenue),
      cogs: cogsByDayMap.get(`${r.day}|${r.currency}`) || 0,
    }));

    // ── Expenses for the same window ────────────────────────────────────────
    const expenseConds = [];
    if (from) expenseConds.push(gte(expenses.expenseDate, from));
    if (to) expenseConds.push(lte(expenses.expenseDate, to));
    if (currency && currency !== 'ALL') expenseConds.push(eq(expenses.currency, currency));
    if (branchId !== null && branchId !== undefined) {
      if (branchId === -1) expenseConds.push(sql`1=0`);
      else expenseConds.push(eq(expenses.branchId, branchId));
    }
    const expenseWhere = expenseConds.length ? and(...expenseConds) : undefined;

    const expByCurrency = await db
      .select({
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.currency);

    const expByBranch = await db
      .select({
        branchId: expenses.branchId,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.branchId, expenses.currency);

    const expByDay = await db
      .select({
        day: expenses.expenseDate,
        currency: expenses.currency,
        total: sql`COALESCE(SUM(${expenses.amount}::numeric),0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.expenseDate, expenses.currency)
      .orderBy(expenses.expenseDate);

    const expByCurrencyMap = Object.fromEntries(
      expByCurrency.map((r) => [r.currency, toNum(r.total)])
    );
    const expByBranchMap = new Map(
      expByBranch.map((r) => [`${r.branchId || 'null'}|${r.currency}`, toNum(r.total)])
    );
    const expByDayMap = new Map(
      expByDay.map((r) => [`${r.day}|${r.currency}`, toNum(r.total)])
    );

    const totalsByCurrency = {};
    for (const r of totalsRows) {
      const cur = r.currency || 'USD';
      const exp = expByCurrencyMap[cur] || 0;
      totalsByCurrency[cur] = {
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.revenue - r.cogs,
        expenses: exp,
        netProfit: r.revenue - r.cogs - exp,
      };
    }
    // Cover expense-only currencies
    for (const [cur, total] of Object.entries(expByCurrencyMap)) {
      totalsByCurrency[cur] ??= {
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        expenses: total,
        netProfit: -total,
      };
    }

    const byBranch = branchRows.map((r) => {
      const exp = expByBranchMap.get(`${r.branchId || 'null'}|${r.currency}`) || 0;
      return {
        branchId: r.branchId,
        branchName: r.branchName,
        currency: r.currency,
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.revenue - r.cogs,
        expenses: exp,
        netProfit: r.revenue - r.cogs - exp,
      };
    });

    const byPeriod = periodRows.map((r) => {
      const exp = expByDayMap.get(`${r.day}|${r.currency}`) || 0;
      return {
        day: r.day,
        currency: r.currency,
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.revenue - r.cogs,
        expenses: exp,
        netProfit: r.revenue - r.cogs - exp,
      };
    });

    return {
      totals: { byCurrency: totalsByCurrency },
      byBranch,
      byPeriod,
      meta: {
        filters: {
          dateFrom: from,
          dateTo: to,
          currency,
          requestedBranchId: filters.branchId || null,
          effectiveBranchId: branchId,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async getTrends({ from, to, branchId, currency }) {
    const db = await getDb();
    const conds = [sql`${sales.status} <> 'cancelled'`];
    if (from) conds.push(gte(sql`${sales.createdAt}::date::text`, from));
    if (to) conds.push(lte(sql`${sales.createdAt}::date::text`, to));
    if (branchId !== null && branchId !== undefined) {
      if (branchId === -1) conds.push(sql`1=0`);
      else conds.push(eq(sales.branchId, branchId));
    }
    if (currency && currency !== 'ALL') conds.push(eq(sales.currency, currency));

    const salesOverTime = await db
      .select({ day: sql`${sales.createdAt}::date::text`, currency: sales.currency, total: sql`COALESCE(SUM(${sales.total}::numeric),0)` })
      .from(sales)
      .where(and(...conds))
      .groupBy(sql`${sales.createdAt}::date::text`, sales.currency)
      .orderBy(sql`${sales.createdAt}::date::text`);

    const paymentMethods = await db
      .select({ method: payments.paymentMethod, currency: payments.currency, total: sql`COALESCE(SUM(${payments.amount}::numeric),0)` })
      .from(payments)
      .leftJoin(sales, eq(payments.saleId, sales.id))
      .where(and(...conds))
      .groupBy(payments.paymentMethod, payments.currency);

    const overdueTrend = await db
      .select({ day: installments.dueDate, currency: installments.currency, overdueCount: sql`COUNT(*)` })
      .from(installments)
      .leftJoin(sales, eq(installments.saleId, sales.id))
      .where(and(
        eq(installments.status, 'pending'),
        ...(from ? [gte(installments.dueDate, from)] : []),
        ...(to ? [lte(installments.dueDate, to)] : []),
        ...(currency && currency !== 'ALL' ? [eq(installments.currency, currency)] : []),
        ...(branchId !== null && branchId !== undefined ? [branchId === -1 ? sql`1=0` : eq(sales.branchId, branchId)] : [])
      ))
      .groupBy(installments.dueDate, installments.currency)
      .orderBy(installments.dueDate);

    return { salesOverTime, paymentsByMethod: paymentMethods, overdueInstallmentsTrend: overdueTrend };
  }
}

export default new ReportService();
