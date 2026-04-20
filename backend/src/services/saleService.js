import { getDb, getPool, saveDatabase } from '../db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  sales,
  saleItems,
  products,
  customers,
  payments,
  installments,
  users,
} from '../models/index.js';
import * as schema from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { generateInvoiceNumber, calculateSaleTotals } from '../utils/helpers.js';
import { eq, desc, and, or, gte, lte, sql, inArray, lt, count as countFn } from 'drizzle-orm';
import settingsService from './settingsService.js';

/**
 * Run a callback inside a PostgreSQL transaction.
 * Creates a dedicated client from the pool, wraps in BEGIN/COMMIT/ROLLBACK,
 * and provides a transaction-scoped Drizzle instance.
 */
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
 * Round amount based on currency
 * For IQD: round to nearest multiple of 250 (smallest denomination)
 * For USD: round to nearest integer
 */
function roundByCurrency(amount, currency) {
  if (currency === 'IQD') {
    return Math.ceil(amount / 250) * 250;
  } else {
    return Math.ceil(amount);
  }
}

/** Parse numeric string from PG to JS number. PG numeric columns return strings. */
function n(val) {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

export class SaleService {
  async create(saleData, userId) {
    const currencySettings = await settingsService.getCurrencySettings();

    if (!saleData.items || saleData.items.length === 0) {
      throw new ValidationError('Sale must have at least one item');
    }

    const totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);
    const invoiceNumber = generateInvoiceNumber();

    let interestAmount = 0;
    let finalTotal = totals.total;

    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      saleData.interestRate > 0
    ) {
      interestAmount = (totals.total * saleData.interestRate) / 100;
      finalTotal = totals.total + interestAmount;
    }

    const currency = saleData.currency || currencySettings.defaultCurrency;
    finalTotal = roundByCurrency(finalTotal, currency);

    const paidAmount = roundByCurrency(parseFloat(saleData.paidAmount) || 0, currency);
    let remainingAmount = Math.max(0, finalTotal - paidAmount);

    const threshold = currency === 'IQD' ? 250 : 0.01;
    remainingAmount = remainingAmount < threshold ? 0 : roundByCurrency(remainingAmount, currency);

    const exchangeRate =
      saleData.exchangeRate ||
      (currency === 'USD' ? currencySettings.usdRate : currencySettings.iqdRate);

    const customerId = saleData.customerId || null;

    if (saleData.paymentType === 'installment' && !customerId) {
      throw new ValidationError('Customer is required for installment payments');
    }

    const newSaleId = await withTransaction(async (tx) => {
      const [newSale] = await tx
        .insert(sales)
        .values({
          invoiceNumber,
          customerId,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          tax: String(totals.tax),
          total: String(finalTotal),
          currency,
          exchangeRate: String(exchangeRate),
          paymentType: saleData.paymentType,
          paidAmount: String(paidAmount),
          remainingAmount: String(remainingAmount),
          status: remainingAmount <= 0 ? 'completed' : 'pending',
          notes: saleData.notes || null,
          createdBy: userId,
          interestRate: String(parseFloat(saleData.interestRate) || 0),
          interestAmount: String(roundByCurrency(interestAmount, currency)),
        })
        .returning();

      for (const item of saleData.items) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (!product) {
          throw new NotFoundError(`Product with ID ${item.productId} not found`);
        }

        if (product.stock < item.quantity) {
          throw new ValidationError(
            `Insufficient stock for product: ${product.name}. Available: ${product.stock}, Required: ${item.quantity}`
          );
        }

        const itemDiscountTotal = (item.discount || 0) * item.quantity;
        const itemSubtotal = item.quantity * item.unitPrice - itemDiscountTotal;

        await tx.insert(saleItems).values({
          saleId: newSale.id,
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          discount: String(itemDiscountTotal),
          subtotal: String(parseFloat(itemSubtotal.toFixed(2))),
        });

        // Atomic stock decrement — safe under concurrent access
        await tx
          .update(products)
          .set({
            stock: sql`${products.stock} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(products.id, item.productId));
      }

      if (paidAmount > 0) {
        await tx.insert(payments).values({
          saleId: newSale.id,
          customerId,
          amount: String(parseFloat(paidAmount.toFixed(2))),
          currency,
          exchangeRate: String(exchangeRate),
          paymentMethod: saleData.paymentMethod || 'cash',
          createdBy: userId,
          notes: saleData.paymentNotes || 'دفع نقدي عند البيع',
        });
      }

      if (
        (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
        remainingAmount > 0
      ) {
        const installmentCount = parseInt(saleData.installmentCount) || 3;

        if (installmentCount < 1) {
          throw new ValidationError('Installment count must be at least 1');
        }

        const roundedRemainingAmount = roundByCurrency(remainingAmount, currency);
        const baseInstallmentAmount = roundByCurrency(
          roundedRemainingAmount / installmentCount,
          currency
        );
        const totalWithBaseAmount = baseInstallmentAmount * installmentCount;
        const adjustment = totalWithBaseAmount - roundedRemainingAmount;
        const currentDate = new Date();

        for (let i = 0; i < installmentCount; i++) {
          const dueDate = new Date(currentDate);
          dueDate.setMonth(dueDate.getMonth() + i + 1);

          const isLastInstallment = i === installmentCount - 1;
          const installmentAmount = isLastInstallment
            ? baseInstallmentAmount - adjustment
            : baseInstallmentAmount;

          const roundedAmount = roundByCurrency(installmentAmount, currency);

          await tx.insert(installments).values({
            saleId: newSale.id,
            customerId,
            installmentNumber: i + 1,
            dueAmount: String(roundedAmount),
            paidAmount: '0',
            remainingAmount: String(roundedAmount),
            currency,
            dueDate: dueDate.toISOString().split('T')[0],
            status: 'pending',
          });
        }
      }

      if (customerId && remainingAmount > 0) {
        await tx
          .update(customers)
          .set({
            totalDebt: sql`${customers.totalDebt}::numeric + ${remainingAmount}`,
            totalPurchases: sql`${customers.totalPurchases}::numeric + ${finalTotal}`,
          })
          .where(eq(customers.id, customerId));
      }

      return newSale.id;
    });

    return await this.getById(newSaleId);
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, status, startDate, endDate } = filters;

    const conditions = [];

    if (status) {
      conditions.push(eq(sales.status, status));
    }

    if (startDate) {
      conditions.push(gte(sales.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(sales.createdAt, new Date(endDate)));
    }

    if (filters.customer) {
      conditions.push(eq(sales.customerId, filters.customer));
    }

    // Get total count
    let countQuery = db.select({ count: sql`count(*)` }).from(sales);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions));
    }
    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    const offset = (page - 1) * limit;

    // Main query with joins + pagination
    let query = db
      .select({
        id: sales.id,
        invoiceNumber: sales.invoiceNumber,
        total: sales.total,
        currency: sales.currency,
        paymentType: sales.paymentType,
        paidAmount: sales.paidAmount,
        remainingAmount: sales.remainingAmount,
        status: sales.status,
        createdAt: sales.createdAt,
        customer: customers.name,
        customerPhone: customers.phone,
        createdBy: users.username,
      })
      .from(sales)
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .leftJoin(users, eq(sales.createdBy, users.id))
      .orderBy(desc(sales.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query;

    return {
      data: results.map((row) => ({
        ...row,
        total: n(row.total),
        paidAmount: n(row.paidAmount),
        remainingAmount: n(row.remainingAmount),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id) {
    const db = await getDb();
    const [sale] = await db
      .select({
        id: sales.id,
        invoiceNumber: sales.invoiceNumber,
        customerId: sales.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        subtotal: sales.subtotal,
        discount: sales.discount,
        tax: sales.tax,
        total: sales.total,
        currency: sales.currency,
        exchangeRate: sales.exchangeRate,
        interestRate: sales.interestRate,
        interestAmount: sales.interestAmount,
        paymentType: sales.paymentType,
        paidAmount: sales.paidAmount,
        remainingAmount: sales.remainingAmount,
        status: sales.status,
        notes: sales.notes,
        createdAt: sales.createdAt,
        createdBy: users.username,
      })
      .from(sales)
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .leftJoin(users, eq(sales.createdBy, users.id))
      .where(eq(sales.id, id))
      .limit(1);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    let customer = null;
    if (sale.customerId) {
      const [customerData] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, sale.customerId))
        .limit(1);
      customer = customerData || null;
    }

    const items = await db
      .select({
        id: saleItems.id,
        saleId: saleItems.saleId,
        productId: saleItems.productId,
        productName: saleItems.productName,
        productDescription: products.description,
        quantity: saleItems.quantity,
        unitPrice: saleItems.unitPrice,
        discount: saleItems.discount,
        subtotal: saleItems.subtotal,
        createdAt: saleItems.createdAt,
      })
      .from(saleItems)
      .leftJoin(products, eq(saleItems.productId, products.id))
      .where(eq(saleItems.saleId, id));

    const salePayments = await db
      .select()
      .from(payments)
      .where(eq(payments.saleId, id));

    const saleInstallments = await db
      .select()
      .from(installments)
      .where(eq(installments.saleId, id));

    // Convert numeric strings to numbers for the response
    return {
      ...sale,
      subtotal: n(sale.subtotal),
      discount: n(sale.discount),
      tax: n(sale.tax),
      total: n(sale.total),
      exchangeRate: n(sale.exchangeRate),
      interestRate: n(sale.interestRate),
      interestAmount: n(sale.interestAmount),
      paidAmount: n(sale.paidAmount),
      remainingAmount: n(sale.remainingAmount),
      customer,
      items: items.map((item) => ({
        ...item,
        unitPrice: n(item.unitPrice),
        discount: n(item.discount),
        subtotal: n(item.subtotal),
      })),
      payments: salePayments.map((p) => ({
        ...p,
        amount: n(p.amount),
        exchangeRate: n(p.exchangeRate),
      })),
      installments: saleInstallments.map((inst) => ({
        ...inst,
        dueAmount: n(inst.dueAmount),
        paidAmount: n(inst.paidAmount),
        remainingAmount: n(inst.remainingAmount),
      })),
    };
  }

  async addPayment(saleId, paymentData, userId) {
    const sale = await this.getById(saleId);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Cannot add payment to cancelled sale');
    }

    if (sale.remainingAmount <= 0) {
      throw new ValidationError('Sale is already fully paid');
    }

    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new ValidationError('Payment amount must be greater than zero');
    }

    const currency = sale.currency || 'USD';
    const roundedPaymentDataAmount = roundByCurrency(paymentData.amount, currency);
    const roundedRemainingAmount = roundByCurrency(sale.remainingAmount, currency);
    const paymentAmount = Math.min(roundedPaymentDataAmount, roundedRemainingAmount);

    await withTransaction(async (tx) => {
      await tx.insert(payments).values({
        saleId,
        customerId: sale.customerId,
        amount: String(paymentAmount),
        currency: paymentData.currency || sale.currency,
        exchangeRate: String(paymentData.exchangeRate || sale.exchangeRate),
        paymentMethod: paymentData.paymentMethod || 'cash',
        notes: paymentData.notes,
        createdBy: userId,
      });

      const roundedPaymentAmount = roundByCurrency(paymentAmount, currency);
      const newPaidAmount = roundByCurrency(sale.paidAmount + roundedPaymentAmount, currency);
      const newRemainingAmount = Math.max(
        0,
        roundByCurrency(sale.remainingAmount - roundedPaymentAmount, currency)
      );
      const newStatus = newRemainingAmount <= 0 ? 'completed' : 'pending';

      await tx
        .update(sales)
        .set({
          paidAmount: String(newPaidAmount),
          remainingAmount: String(newRemainingAmount),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(sales.id, saleId));

      if (sale.customerId) {
        await tx
          .update(customers)
          .set({
            totalDebt: sql`${customers.totalDebt}::numeric - ${paymentAmount}`,
          })
          .where(eq(customers.id, sale.customerId));
      }

      if (sale.installments && sale.installments.length > 0) {
        let remainingPayment = paymentAmount;

        for (const installment of sale.installments) {
          if (remainingPayment <= 0) break;
          if (installment.status === 'paid') continue;

          const installmentPayment = Math.min(remainingPayment, installment.remainingAmount);
          const newInstallmentPaid = installment.paidAmount + installmentPayment;
          const newInstallmentRemaining = installment.remainingAmount - installmentPayment;
          const installmentStatus = newInstallmentRemaining <= 0 ? 'paid' : 'pending';

          await tx
            .update(installments)
            .set({
              paidAmount: String(newInstallmentPaid),
              remainingAmount: String(newInstallmentRemaining),
              status: installmentStatus,
              paidDate: installmentStatus === 'paid' ? new Date().toISOString().split('T')[0] : null,
              updatedAt: new Date(),
            })
            .where(eq(installments.id, installment.id));

          remainingPayment -= installmentPayment;
        }
      }
    });

    return await this.getById(saleId);
  }

  async cancel(id, _userId) {
    const sale = await this.getById(id);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Sale is already cancelled');
    }

    return await withTransaction(async (tx) => {
      // Atomic stock restore
      for (const item of sale.items) {
        if (item.productId) {
          await tx
            .update(products)
            .set({
              stock: sql`${products.stock} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(products.id, item.productId));
        }
      }

      if (sale.customerId && sale.remainingAmount > 0) {
        await tx
          .update(customers)
          .set({
            totalDebt: sql`GREATEST(${customers.totalDebt}::numeric - ${sale.remainingAmount}, 0)`,
            totalPurchases: sql`GREATEST(${customers.totalPurchases}::numeric - ${sale.total}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, sale.customerId));
      }

      await tx
        .update(installments)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(and(eq(installments.saleId, id), eq(installments.status, 'pending')));

      const [updated] = await tx
        .update(sales)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(sales.id, id))
        .returning();

      return updated;
    });
  }

  async getSalesReport(filters = {}) {
    const db = await getDb();
    const { startDate, endDate, currency } = filters;

    const toYmd = (d) => (d ? new Date(d).toISOString().split('T')[0] : null);
    const start = toYmd(startDate);
    const end = toYmd(endDate);

    // Use sql cast for date comparison with timestamps
    const createdDate = sql`${sales.createdAt}::date::text`;
    const conds = [
      or(eq(sales.status, 'completed'), eq(sales.status, 'pending')),
      ...(start ? [gte(createdDate, start)] : []),
      ...(end ? [lte(createdDate, end)] : []),
    ];
    if (currency) conds.push(eq(sales.currency, currency));

    const salesData = await db
      .select()
      .from(sales)
      .where(and(...conds));

    const saleIds = salesData.map((s) => s.id);

    let items = [];
    if (saleIds.length) {
      items = await db
        .select({
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          discount: saleItems.discount,
          subtotal: saleItems.subtotal,
          productId: saleItems.productId,
          productCost: products.costPrice,
          currency: sales.currency,
        })
        .from(saleItems)
        .leftJoin(products, eq(saleItems.productId, products.id))
        .leftJoin(sales, eq(saleItems.saleId, sales.id))
        .where(inArray(saleItems.saleId, saleIds));
    }

    const byCur = {};
    for (const s of salesData) {
      const c = s.currency || 'USD';
      byCur[c] ??= {
        totalSales: 0,
        totalPaid: 0,
        totalRemaining: 0,
        totalProfit: 0,
        totalRevenue: 0,
        totalDiscount: 0,
        totalInterest: 0,
        count: 0,
        cashSales: 0,
        installmentSales: 0,
        mixedSales: 0,
        completedSales: 0,
        pendingSales: 0,
      };
      const o = byCur[c];

      o.totalSales += n(s.total);
      o.totalPaid += n(s.paidAmount);
      o.totalRemaining += n(s.remainingAmount);
      o.totalDiscount += n(s.discount);
      o.totalInterest += n(s.interestAmount);
      o.totalRevenue += n(s.total) - n(s.interestAmount);

      o.count += 1;
      if (s.paymentType) o[`${s.paymentType}Sales`] = (o[`${s.paymentType}Sales`] || 0) + 1;
      o[`${s.status}Sales`] = (o[`${s.status}Sales`] || 0) + 1;
    }

    for (const item of items) {
      const c = item.currency || 'USD';
      if (!item.quantity || item.quantity <= 0) continue;
      const itemDiscount = n(item.discount);
      const netUnitPrice = n(item.unitPrice) - itemDiscount / item.quantity;
      const costPrice = n(item.productCost);
      const profit = (netUnitPrice - costPrice) * item.quantity;
      if (byCur[c]) byCur[c].totalProfit += profit;
    }

    for (const c in byCur) {
      const o = byCur[c];
      o.totalProfit = o.totalProfit - o.totalDiscount + o.totalInterest;
    }

    const usd = byCur['USD'] ?? {};
    const iqd = byCur['IQD'] ?? {};
    const allCount = Object.values(byCur).reduce((a, d) => a + (d.count || 0), 0);

    // Overdue installments count
    const overdueResult = await db
      .select({ count: sql`count(*)` })
      .from(installments)
      .where(
        and(
          eq(installments.status, 'pending'),
          lte(installments.dueDate, new Date().toISOString().split('T')[0])
        )
      );

    return {
      salesUSD: usd.totalSales || 0,
      paidUSD: usd.totalPaid || 0,
      profitUSD: parseFloat((usd.totalProfit || 0).toFixed(2)),
      revenueUSD: parseFloat((usd.totalRevenue || 0).toFixed(2)),
      discountUSD: parseFloat((usd.totalDiscount || 0).toFixed(2)),
      interestUSD: parseFloat((usd.totalInterest || 0).toFixed(2)),
      avgSaleUSD: usd.count ? parseFloat((usd.totalSales / usd.count).toFixed(2)) : 0,
      avgProfitUSD: usd.count ? parseFloat((usd.totalProfit / usd.count).toFixed(2)) : 0,
      profitMarginUSD: usd.totalRevenue
        ? parseFloat(((usd.totalProfit / usd.totalRevenue) * 100).toFixed(2))
        : 0,

      salesIQD: iqd.totalSales || 0,
      paidIQD: iqd.totalPaid || 0,
      profitIQD: parseFloat((iqd.totalProfit || 0).toFixed(2)),
      revenueIQD: parseFloat((iqd.totalRevenue || 0).toFixed(2)),
      discountIQD: parseFloat((iqd.totalDiscount || 0).toFixed(2)),
      interestIQD: parseFloat((iqd.totalInterest || 0).toFixed(2)),
      avgSaleIQD: iqd.count ? parseFloat((iqd.totalSales / iqd.count).toFixed(2)) : 0,
      avgProfitIQD: iqd.count ? parseFloat((iqd.totalProfit / iqd.count).toFixed(2)) : 0,
      profitMarginIQD: iqd.totalRevenue
        ? parseFloat(((iqd.totalProfit / iqd.totalRevenue) * 100).toFixed(2))
        : 0,

      count: allCount,
      completedSales: (usd.completedSales || 0) + (iqd.completedSales || 0),
      pendingSales: (usd.pendingSales || 0) + (iqd.pendingSales || 0),
      overdueInstallments: Number(overdueResult[0]?.count || 0),
    };
  }

  async removePayment(saleId, paymentId, userId) {
    const db = await getDb();
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);

    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.userId !== userId) {
      throw new Error('Unauthorized');
    }

    const sale = await this.getById(saleId);
    const paymentAmount = n(payment.amount);

    await withTransaction(async (tx) => {
      await tx.delete(payments).where(eq(payments.id, paymentId));

      const newPaidAmount = sale.paidAmount - paymentAmount;
      const newRemainingAmount = sale.remainingAmount + paymentAmount;

      await tx
        .update(sales)
        .set({
          paidAmount: String(newPaidAmount),
          remainingAmount: String(newRemainingAmount),
          status: 'pending',
          updatedAt: new Date(),
        })
        .where(eq(sales.id, saleId));

      if (sale.customerId) {
        await tx
          .update(customers)
          .set({
            totalDebt: sql`${customers.totalDebt}::numeric + ${paymentAmount}`,
          })
          .where(eq(customers.id, sale.customerId));
      }
    });

    return payment;
  }

  async removeSale(saleId) {
    const sale = await this.getById(saleId);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    await withTransaction(async (tx) => {
      await tx.delete(payments).where(eq(payments.saleId, saleId));
      await tx.delete(installments).where(eq(installments.saleId, saleId));
      await tx.delete(saleItems).where(eq(saleItems.saleId, saleId));
      await tx.delete(sales).where(eq(sales.id, saleId));
    });

    return sale;
  }

  async restoreSale(saleId) {
    const sale = await this.getById(saleId);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    if (sale.status !== 'cancelled') {
      throw new ValidationError('Only cancelled sales can be restored');
    }

    return await withTransaction(async (tx) => {
      // Atomic stock decrement
      for (const item of sale.items) {
        if (item.productId) {
          await tx
            .update(products)
            .set({
              stock: sql`${products.stock} - ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(eq(products.id, item.productId));
        }
      }

      if (sale.customerId && sale.remainingAmount > 0) {
        await tx
          .update(customers)
          .set({
            totalDebt: sql`${customers.totalDebt}::numeric + ${sale.remainingAmount}`,
            totalPurchases: sql`${customers.totalPurchases}::numeric + ${sale.total}`,
          })
          .where(eq(customers.id, sale.customerId));
      }

      const currency = sale.currency || 'USD';
      const roundedRemainingAmount = roundByCurrency(sale.remainingAmount, currency);
      const [updated] = await tx
        .update(sales)
        .set({
          status: roundedRemainingAmount <= 0 ? 'completed' : 'pending',
          updatedAt: new Date(),
        })
        .where(eq(sales.id, saleId))
        .returning();

      await tx
        .update(installments)
        .set({
          status: 'pending',
          updatedAt: new Date(),
        })
        .where(and(eq(installments.saleId, saleId), eq(installments.status, 'cancelled')));

      return updated;
    });
  }

  async createDraft(saleData, userId) {
    const db = await getDb();
    const currencySettings = await settingsService.getCurrencySettings();

    let totals = { subtotal: 0, discount: 0, tax: 0, total: 0 };
    if (saleData.items && saleData.items.length > 0) {
      totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);
    }

    const invoiceNumber = generateInvoiceNumber();
    const currency = saleData.currency || currencySettings.defaultCurrency;
    const exchangeRate =
      saleData.exchangeRate ||
      (currency === 'USD' ? currencySettings.usdRate : currencySettings.iqdRate);

    const draftValues = {
      invoiceNumber,
      subtotal: String(totals.subtotal),
      discount: String(totals.discount || 0),
      tax: String(totals.tax || 0),
      total: String(totals.total),
      currency,
      exchangeRate: String(exchangeRate),
      paymentType: saleData.paymentType || 'cash',
      paidAmount: '0',
      remainingAmount: String(totals.total),
      status: 'draft',
      notes: saleData.notes || null,
      createdBy: userId,
      interestRate: String(parseFloat(saleData.interestRate) || 0),
      interestAmount: '0',
    };

    if (saleData.customerId !== undefined && saleData.customerId !== null) {
      draftValues.customerId = saleData.customerId;
    }

    const [newDraft] = await db.insert(sales).values(draftValues).returning();

    if (saleData.items && saleData.items.length > 0) {
      const itemsToInsert = [];
      for (const item of saleData.items) {
        let productName = item.productName || 'Unknown Product';

        if (item.productId) {
          const [product] = await db
            .select({ name: products.name })
            .from(products)
            .where(eq(products.id, item.productId))
            .limit(1);
          if (product) {
            productName = product.name;
          }
        }

        const itemDiscountTotal = (item.discount || 0) * (item.quantity || 1);
        const itemSubtotal = (item.unitPrice || 0) * (item.quantity || 1) - itemDiscountTotal;

        itemsToInsert.push({
          saleId: newDraft.id,
          productId: item.productId || null,
          productName,
          quantity: item.quantity || 1,
          unitPrice: String(item.unitPrice || 0),
          discount: String(itemDiscountTotal),
          subtotal: String(parseFloat(itemSubtotal.toFixed(2))),
        });
      }

      await db.insert(saleItems).values(itemsToInsert);
    }

    saveDatabase();
    return await this.getById(newDraft.id);
  }

  async deleteOldDrafts() {
    const db = await getDb();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const deleted = await db
      .delete(sales)
      .where(and(eq(sales.status, 'draft'), lt(sales.createdAt, oneDayAgo)))
      .returning();

    saveDatabase();
    return deleted.length;
  }

  async completeDraft(draftId, saleData, userId) {
    const draft = await this.getById(draftId);
    if (draft.status !== 'draft') {
      throw new ValidationError('Sale is not a draft');
    }

    if (!saleData.items || saleData.items.length === 0) {
      throw new ValidationError('Sale must have at least one item');
    }

    const totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);

    let interestAmount = 0;
    let finalTotal = totals.total;

    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      saleData.interestRate > 0
    ) {
      interestAmount = (totals.total * saleData.interestRate) / 100;
      finalTotal = totals.total + interestAmount;
    }

    const currencySettings = await settingsService.getCurrencySettings();
    const currency = saleData.currency || draft.currency || currencySettings.defaultCurrency;

    finalTotal = roundByCurrency(finalTotal, currency);

    const paidAmount = roundByCurrency(parseFloat(saleData.paidAmount) || 0, currency);
    let remainingAmount = Math.max(0, finalTotal - paidAmount);

    const threshold = currency === 'IQD' ? 250 : 0.01;
    remainingAmount = remainingAmount < threshold ? 0 : roundByCurrency(remainingAmount, currency);

    const exchangeRate =
      saleData.exchangeRate !== undefined ? saleData.exchangeRate : draft.exchangeRate;

    const updatedSaleId = await withTransaction(async (tx) => {
      await tx.delete(saleItems).where(eq(saleItems.saleId, draftId));

      const [updatedSale] = await tx
        .update(sales)
        .set({
          customerId: saleData.customerId || draft.customerId,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          tax: String(totals.tax),
          total: String(finalTotal),
          currency,
          exchangeRate: String(exchangeRate),
          paymentType: saleData.paymentType || draft.paymentType,
          paidAmount: String(paidAmount),
          remainingAmount: String(remainingAmount),
          status: remainingAmount <= 0 ? 'completed' : 'pending',
          notes: saleData.notes || draft.notes,
          interestRate: String(parseFloat(saleData.interestRate) || 0),
          interestAmount: String(roundByCurrency(interestAmount, currency)),
          updatedAt: new Date(),
        })
        .where(eq(sales.id, draftId))
        .returning();

      for (const item of saleData.items) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (!product) {
          throw new ValidationError(`Product with ID ${item.productId} not found`);
        }

        if (product.stock < item.quantity) {
          throw new ValidationError(
            `Insufficient stock for product ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`
          );
        }

        const itemDiscountTotal = (item.discount || 0) * item.quantity;
        const itemSubtotal = item.quantity * item.unitPrice - itemDiscountTotal;

        await tx.insert(saleItems).values({
          saleId: updatedSale.id,
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          discount: String(itemDiscountTotal),
          subtotal: String(parseFloat(itemSubtotal.toFixed(2))),
        });

        // Atomic stock decrement
        await tx
          .update(products)
          .set({
            stock: sql`${products.stock} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(products.id, item.productId));
      }

      if (paidAmount > 0) {
        const customerId = saleData.customerId || draft.customerId || null;
        await tx.insert(payments).values({
          saleId: updatedSale.id,
          customerId,
          amount: String(paidAmount),
          currency,
          exchangeRate: String(exchangeRate),
          paymentMethod: saleData.paymentMethod || 'cash',
          createdBy: userId,
        });
      }

      if (
        (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
        saleData.installments &&
        saleData.installments.length > 0
      ) {
        const customerId = saleData.customerId || draft.customerId;
        if (!customerId) {
          throw new ValidationError('Customer ID is required for installment sales');
        }

        for (const installment of saleData.installments) {
          const roundedAmount = roundByCurrency(installment.amount, currency);

          await tx.insert(installments).values({
            saleId: updatedSale.id,
            customerId,
            installmentNumber: installment.number,
            dueAmount: String(roundedAmount),
            paidAmount: '0',
            remainingAmount: String(roundedAmount),
            currency,
            dueDate: installment.dueDate,
            status: 'pending',
            createdBy: userId,
          });
        }

        if (customerId && remainingAmount > 0) {
          await tx
            .update(customers)
            .set({
              totalDebt: sql`${customers.totalDebt}::numeric + ${remainingAmount}`,
              totalPurchases: sql`${customers.totalPurchases}::numeric + ${finalTotal}`,
            })
            .where(eq(customers.id, customerId));
        }
      }

      return updatedSale.id;
    });

    return await this.getById(updatedSaleId);
  }

  async getTopProducts(filters = {}) {
    const db = await getDb();
    const { limit = 5, startDate, endDate } = filters;

    const conditions = [eq(sales.status, 'completed')];
    if (startDate) conditions.push(gte(sales.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(sales.createdAt, new Date(endDate)));

    const result = await db
      .select({
        productId: saleItems.productId,
        productName: sql`min(${products.name})`.as('productName'),
        totalQuantity: sql`CAST(sum(${saleItems.quantity}) AS integer)`.as('totalQuantity'),
        totalRevenue: sql`CAST(sum(${saleItems.quantity} * ${saleItems.unitPrice}::numeric) AS numeric)`.as('totalRevenue'),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .innerJoin(products, eq(saleItems.productId, products.id))
      .where(and(...conditions))
      .groupBy(saleItems.productId)
      .orderBy(sql`sum(${saleItems.quantity}) DESC`)
      .limit(limit);

    return result.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      totalQuantity: Number(row.totalQuantity) || 0,
      totalRevenue: Number(row.totalRevenue) || 0,
    }));
  }
}
