import { getDb } from '../db.js';
import {
  sales,
  payments,
  installments,
  customers,
  products,
  saleItems,
  productStock,
  warehouses,
  stockMovements,
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

    const summaryByCurrency = Object.fromEntries(salesSummaryRows.map((r) => [r.currency, {
      sales: toNum(r.totalSales), cashSales: toNum(r.cashSales), installmentSales: toNum(r.installmentSales),
      returnedCancelled: toNum(r.returnedCancelled), discounts: toNum(r.discounts), taxes: toNum(r.taxes),
      netSales: toNum(r.netSales), revenue: toNum(r.revenue), unpaidBalances: toNum(r.unpaidBalances),
    }]));

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

    const currencies = Object.keys(summaryByCurrency);
    for (const cur of currencies) {
      const s = summaryByCurrency[cur];
      const revenue = toNum(s.revenue);
      const cogs = s.cogs ?? null;
      const expenses = 0;
      s.grossProfit = cogs === null ? null : revenue - cogs;
      s.expenses = expenses;
      s.netProfit = cogs === null ? null : revenue - cogs - expenses;
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
          'Expenses module is not available in current schema; expenses shown as 0.',
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
        supported: false,
        totalExpenses: 0,
        byCategory: [],
        byBranch: [],
        byCurrency: [],
      },
      profitLoss: {
        byCurrency: Object.fromEntries(Object.entries(summaryByCurrency).map(([cur, s]) => [cur, {
          revenue: toNum(s.revenue), cogs: s.cogs ?? null, grossProfit: s.grossProfit ?? null, expenses: 0, netProfit: s.netProfit ?? null,
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
