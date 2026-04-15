import { getDb, getSqlite, saveDatabase } from '../db.js';
import {
  sales,
  saleItems,
  products,
  customers,
  payments,
  installments,
  users,
} from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { generateInvoiceNumber, calculateSaleTotals } from '../utils/helpers.js';
import { eq, desc, and, or, gte, lte, sql, inArray, lt } from 'drizzle-orm';
import settingsService from './settingsService.js';

/**
 * Round amount based on currency
 * For IQD: round to nearest multiple of 250 (smallest denomination)
 * For USD: round to nearest integer
 * @param {number} amount - Amount to round
 * @param {string} currency - Currency code ('IQD' or 'USD')
 * @returns {number} Rounded amount
 */
function roundByCurrency(amount, currency) {
  if (currency === 'IQD') {
    // Round to nearest multiple of 250
    return Math.ceil(amount / 250) * 250;
  } else {
    // For USD and other currencies, round to nearest integer
    return Math.ceil(amount);
  }
}

export class SaleService {
  /**
   * Create a new sale with items, payments, and installments
   * @param {Object} saleData - Sale data including items and payment info
   * @param {number} userId - ID of user creating the sale
   * @returns {Promise<Object>} Created sale with all details
   */
  async create(saleData, userId) {
    const db = await getDb();
    // Get currency settings
    const currencySettings = await settingsService.getCurrencySettings();

    // Validate items exist
    if (!saleData.items || saleData.items.length === 0) {
      throw new ValidationError('Sale must have at least one item');
    }

    // Calculate totals
    const totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber();

    // Calculate interest for installment payments
    let interestAmount = 0;
    let finalTotal = totals.total;

    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      saleData.interestRate > 0
    ) {
      interestAmount = (totals.total * saleData.interestRate) / 100;
      finalTotal = totals.total + interestAmount;
    }

    // Use currency from settings if not provided
    const currency = saleData.currency || currencySettings.defaultCurrency;

    // Round finalTotal based on currency (IQD: nearest 250, USD: nearest integer)
    finalTotal = roundByCurrency(finalTotal, currency);

    // Calculate remaining amount
    const paidAmount = roundByCurrency(parseFloat(saleData.paidAmount) || 0, currency);
    let remainingAmount = Math.max(0, finalTotal - paidAmount);

    // Round remainingAmount based on currency
    // If remainingAmount is less than threshold, consider it as 0
    const threshold = currency === 'IQD' ? 250 : 0.01;
    remainingAmount = remainingAmount < threshold ? 0 : roundByCurrency(remainingAmount, currency);

    // Get exchange rate based on currency
    const exchangeRate =
      saleData.exchangeRate ||
      (currency === 'USD' ? currencySettings.usdRate : currencySettings.iqdRate);

    // Handle customer selection
    const customerId = saleData.customerId || null;

    // Validate customer if installment payment
    if (saleData.paymentType === 'installment' && !customerId) {
      throw new ValidationError('Customer is required for installment payments');
    }

    // Create sale record
    const [newSale] = await db
      .insert(sales)
      .values({
        invoiceNumber,
        customerId,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: finalTotal,
        currency,
        exchangeRate,
        paymentType: saleData.paymentType,
        paidAmount,
        remainingAmount,
        status: remainingAmount <= 0 ? 'completed' : 'pending',
        notes: saleData.notes || null,
        createdBy: userId,
        interestRate: parseFloat(saleData.interestRate) || 0,
        interestAmount: roundByCurrency(interestAmount, currency), // Round based on currency
      })
      .returning();

    // Create sale items and update product stock
    for (const item of saleData.items) {
      // Get product details
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (!product) {
        throw new NotFoundError(`Product with ID ${item.productId} not found`);
      }

      // Validate stock availability
      if (product.stock < item.quantity) {
        throw new ValidationError(
          `Insufficient stock for product: ${product.name}. Available: ${product.stock}, Required: ${item.quantity}`
        );
      }

      // Calculate item subtotal
      // item.discount is per unit, so multiply by quantity
      const itemDiscountTotal = (item.discount || 0) * item.quantity;
      const itemSubtotal = item.quantity * item.unitPrice - itemDiscountTotal;

      // Create sale item
      await db.insert(saleItems).values({
        saleId: newSale.id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: itemDiscountTotal, // Store total discount (per unit * quantity)
        subtotal: parseFloat(itemSubtotal.toFixed(2)),
      });

      // Update product stock
      await db
        .update(products)
        .set({
          stock: product.stock - item.quantity,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(products.id, item.productId));
    }

    // Create initial payment if amount was paid
    if (paidAmount > 0) {
      await db.insert(payments).values({
        saleId: newSale.id,
        customerId,
        amount: parseFloat(paidAmount.toFixed(2)),
        currency,
        exchangeRate,
        paymentMethod: saleData.paymentMethod || 'cash',
        createdBy: userId,
        notes: saleData.paymentNotes || 'دفع نقدي عند البيع',
      });
    }

    // Create installment schedule if needed
    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      remainingAmount > 0
    ) {
      const installmentCount = parseInt(saleData.installmentCount) || 3;

      // Validate installment count
      if (installmentCount < 1) {
        throw new ValidationError('Installment count must be at least 1');
      }

      // Round remainingAmount based on currency before dividing
      const roundedRemainingAmount = roundByCurrency(remainingAmount, currency);

      // Calculate base installment amount (rounded up based on currency)
      const baseInstallmentAmount = roundByCurrency(
        roundedRemainingAmount / installmentCount,
        currency
      );

      // Calculate total if all installments use base amount
      const totalWithBaseAmount = baseInstallmentAmount * installmentCount;

      // Adjust last installment if there's a difference due to rounding
      const adjustment = totalWithBaseAmount - roundedRemainingAmount;

      const currentDate = new Date();

      for (let i = 0; i < installmentCount; i++) {
        const dueDate = new Date(currentDate);
        dueDate.setMonth(dueDate.getMonth() + i + 1);

        // Last installment gets adjusted amount to ensure total equals remainingAmount
        const isLastInstallment = i === installmentCount - 1;
        const installmentAmount = isLastInstallment
          ? baseInstallmentAmount - adjustment
          : baseInstallmentAmount;

        // Round based on currency to ensure proper denomination
        const roundedAmount = roundByCurrency(installmentAmount, currency);

        await db.insert(installments).values({
          saleId: newSale.id,
          customerId,
          installmentNumber: i + 1,
          dueAmount: roundedAmount,
          paidAmount: 0,
          remainingAmount: roundedAmount,
          currency,
          dueDate: dueDate.toISOString().split('T')[0],
          status: 'pending',
        });
      }

      // Update remainingAmount to match the rounded total
      remainingAmount = roundedRemainingAmount;
    }

    // Update customer totals if customer is specified
    if (customerId && remainingAmount > 0) {
      await db
        .update(customers)
        .set({
          totalDebt: customers.totalDebt + remainingAmount,
          totalPurchases: customers.totalPurchases + finalTotal,
        })
        .where(eq(customers.id, customerId));
    }

    saveDatabase();

    return await this.getById(newSale.id);
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, status, startDate, endDate } = filters;

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
      .leftJoin(users, eq(sales.createdBy, users.id));

    const conditions = [];

    if (status) {
      conditions.push(eq(sales.status, status));
    }

    if (startDate) {
      conditions.push(gte(sales.createdAt, startDate));
    }

    if (endDate) {
      conditions.push(lte(sales.createdAt, endDate));
    }

    if (filters.customer) {
      conditions.push(eq(sales.customerId, filters.customer));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Get total count for pagination metadata
    // Note: We count from sales table only (no joins needed) since all filter conditions
    // reference only the sales table, and joins would cause incorrect counts if there are
    // multiple related rows (e.g., multiple saleItems per sale)
    let countQuery = db.select({ count: sql`count(*)` }).from(sales);

    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions));
    }

    const countResult = await countQuery.get();
    const total = Number(countResult?.count || 0);

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Workaround for Drizzle ORM offset issue with joins:
    // Use raw SQL to get paginated IDs, then use Drizzle for the join query
    const sqlite = await getSqlite();
    
    // Build WHERE clause and parameters
    let whereClause = '';
    const params = [];
    
    if (status) {
      whereClause += (whereClause ? ' AND ' : '') + 'status = ?';
      params.push(status);
    }
    
    if (startDate) {
      whereClause += (whereClause ? ' AND ' : '') + 'created_at >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      whereClause += (whereClause ? ' AND ' : '') + 'created_at <= ?';
      params.push(endDate);
    }
    
    if (filters.customer) {
      whereClause += (whereClause ? ' AND ' : '') + 'customer_id = ?';
      params.push(filters.customer);
    }
    
    // Get paginated IDs using raw SQL (avoids Drizzle offset bug)
    const idsQuery = sqlite.prepare(`
      SELECT id FROM sales 
      ${whereClause ? 'WHERE ' + whereClause : ''}
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `);
    
    const paginatedIds = idsQuery.all(...params, limit, offset);
    const saleIds = paginatedIds.map((row) => row.id);
    
    // If no sales found, return empty array
    if (saleIds.length === 0) {
      return {
        data: [],
        meta: {
          total: total || 0,
          page,
          limit,
          totalPages: Math.ceil((total || 0) / limit),
        },
      };
    }
    
    // Now get full sale data with joins for the paginated IDs
    let finalQuery = db
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
      .where(inArray(sales.id, saleIds))
      .orderBy(desc(sales.createdAt));
    
    const results = await finalQuery;

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

    // Get full customer object if customerId exists
    let customer = null;
    if (sale.customerId) {
      const [customerData] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, sale.customerId))
        .limit(1);
      customer = customerData || null;
    }

    // Get sale items with product description
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

    // Get payments
    const salePayments = await db
      .select({
        ...payments,
        createdBy: users.username,
      })
      .from(payments)
      .leftJoin(users, eq(payments.createdBy, users.id))
      .where(eq(payments.saleId, id));

    // Get installments
    const saleInstallments = await db
      .select({
        ...installments,
        customerName: customers.name,
        customerPhone: customers.phone,
        createdBy: users.username,
      })
      .from(installments)
      .leftJoin(customers, eq(installments.customerId, customers.id))
      .leftJoin(users, eq(installments.createdBy, users.id))
      .where(eq(installments.saleId, id));

    return {
      ...sale,
      customer, // Include full customer object
      items,
      payments: salePayments,
      installments: saleInstallments,
    };
  }

  async addPayment(saleId, paymentData, userId) {
    const db = await getDb();
    const sale = await this.getById(saleId);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Cannot add payment to cancelled sale');
    }

    if (sale.remainingAmount <= 0) {
      throw new ValidationError('Sale is already fully paid');
    }

    // Validate payment amount
    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new ValidationError('Payment amount must be greater than zero');
    }

    // Round payment amount based on currency to avoid decimal fractions
    const currency = sale.currency || 'USD';
    const roundedPaymentDataAmount = roundByCurrency(paymentData.amount, currency);
    const roundedRemainingAmount = roundByCurrency(sale.remainingAmount, currency);
    const paymentAmount = Math.min(roundedPaymentDataAmount, roundedRemainingAmount);

    // Create payment record
    await db.insert(payments).values({
      saleId,
      customerId: sale.customerId,
      amount: paymentAmount,
      currency: paymentData.currency || sale.currency,
      exchangeRate: paymentData.exchangeRate || sale.exchangeRate,
      paymentMethod: paymentData.paymentMethod || 'cash',
      notes: paymentData.notes,
      createdBy: userId,
    });

    // Update sale amounts
    // Round amounts based on currency to avoid decimal fractions
    const roundedPaymentAmount = roundByCurrency(paymentAmount, currency);
    const newPaidAmount = roundByCurrency(sale.paidAmount + roundedPaymentAmount, currency);
    const newRemainingAmount = Math.max(
      0,
      roundByCurrency(sale.remainingAmount - roundedPaymentAmount, currency)
    );
    const newStatus = newRemainingAmount <= 0 ? 'completed' : 'pending';

    await db
      .update(sales)
      .set({
        paidAmount: newPaidAmount,
        remainingAmount: newRemainingAmount,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sales.id, saleId));

    // Update customer debt
    if (sale.customerId) {
      await db
        .update(customers)
        .set({
          totalDebt: customers.totalDebt - paymentAmount,
        })
        .where(eq(customers.id, sale.customerId));
    }

    // Update installments if applicable
    if (sale.installments && sale.installments.length > 0) {
      let remainingPayment = paymentAmount;

      for (const installment of sale.installments) {
        if (remainingPayment <= 0) break;
        if (installment.status === 'paid') continue;

        const installmentPayment = Math.min(remainingPayment, installment.remainingAmount);
        const newInstallmentPaid = installment.paidAmount + installmentPayment;
        const newInstallmentRemaining = installment.remainingAmount - installmentPayment;
        const installmentStatus = newInstallmentRemaining <= 0 ? 'paid' : 'pending';

        await db
          .update(installments)
          .set({
            paidAmount: newInstallmentPaid,
            remainingAmount: newInstallmentRemaining,
            status: installmentStatus,
            paidDate: installmentStatus === 'paid' ? new Date().toISOString().split('T')[0] : null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(installments.id, installment.id));

        remainingPayment -= installmentPayment;
      }
    }

    saveDatabase();

    return await this.getById(saleId);
  }

  async cancel(id, _userId) {
    const db = await getDb();
    const sale = await this.getById(id);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Sale is already cancelled');
    }

    // Restore product stock correctly
    for (const item of sale.items) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (product) {
        await db
          .update(products)
          .set({
            stock: product.stock + item.quantity,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(products.id, item.productId));
      }
    }

    // Update customer debt
    if (sale.customerId && sale.remainingAmount > 0) {
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, sale.customerId))
        .limit(1);

      if (customer) {
        await db
          .update(customers)
          .set({
            totalDebt: Math.max(0, customer.totalDebt - sale.remainingAmount),
            totalPurchases: Math.max(0, customer.totalPurchases - sale.total),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(customers.id, sale.customerId));
      }
    }

    // Cancel all pending installments
    await db
      .update(installments)
      .set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(installments.saleId, id), eq(installments.status, 'pending')));

    // Update sale status
    const [updated] = await db
      .update(sales)
      .set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sales.id, id))
      .returning();

    saveDatabase();

    return updated;
  }

  async getSalesReport(filters = {}) {
    const db = await getDb();
    const { startDate, endDate, currency } = filters;

    const toYmd = (d) => (d ? new Date(d).toISOString().split('T')[0] : null);
    const start = toYmd(startDate);
    const end = toYmd(endDate);

    const createdDate = sql`substr(${sales.createdAt}, 1, 10)`;
    const conds = [
      or(eq(sales.status, 'completed'), eq(sales.status, 'pending')),
      ...(start ? [gte(createdDate, start)] : []),
      ...(end ? [lte(createdDate, end)] : []),
    ];
    if (currency) conds.push(eq(sales.currency, currency));

    // 1️⃣ نجلب المبيعات ضمن الفترة
    const salesData = await db
      .select()
      .from(sales)
      .where(and(...conds))
      .all();
    const saleIds = salesData.map((s) => s.id);

    // 2️⃣ نجلب كل العناصر المرتبطة لتحديد الربح الحقيقي
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
        .where(inArray(saleItems.saleId, saleIds))
        .all();
    }

    // 3️⃣ نحسب القيم حسب العملة
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

      o.totalSales += s.total ?? 0;
      o.totalPaid += s.paidAmount ?? 0;
      o.totalRemaining += s.remainingAmount ?? 0;
      o.totalDiscount += s.discount ?? 0;
      o.totalInterest += s.interestAmount ?? 0;
      o.totalRevenue += (s.total ?? 0) - (s.interestAmount ?? 0);

      o.count += 1;
      if (s.paymentType) o[`${s.paymentType}Sales`] += 1;
      o[`${s.status}Sales`] += 1;
    }

    // 4️⃣ نحسب الربح من العناصر بشكل محاسبي دقيق
    for (const item of items) {
      const c = item.currency || 'USD';
      const itemDiscount = item.discount ?? 0;
      // Prevent division by zero - skip items with zero or invalid quantity
      if (!item.quantity || item.quantity <= 0) {
        continue;
      }
      const netUnitPrice = item.unitPrice - itemDiscount / item.quantity;
      const costPrice = item.productCost ?? 0;
      const profit = (netUnitPrice - costPrice) * item.quantity;
      byCur[c].totalProfit += profit;
    }

    // 5️⃣ نطرح الخصم الإضافي ونضيف الفائدة
    for (const c in byCur) {
      const o = byCur[c];
      o.totalProfit = o.totalProfit - o.totalDiscount + o.totalInterest;
    }

    // 6️⃣ نحسب المتوسطات والتقرير النهائي
    const usd = byCur['USD'] ?? {};
    const iqd = byCur['IQD'] ?? {};
    const allCount = Object.values(byCur).reduce((a, d) => a + (d.count || 0), 0);

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
      overdueInstallments: (
        await db
          .select()
          .from(installments)
          .where(
            and(
              eq(installments.status, 'pending'),
              lte(installments.dueDate, new Date().toISOString().split('T')[0])
            )
          )
          .all()
      ).length,
    };
  }

  async removePayment(saleId, paymentId, userId) {
    const db = await getDb();
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Check if the user is authorized to remove the payment
    if (payment.userId !== userId) {
      throw new Error('Unauthorized');
    }

    await db.delete(payments).where(eq(payments.id, paymentId));

    // Update sale amounts
    const sale = await this.getById(saleId);
    const newPaidAmount = sale.paidAmount - payment.amount;
    const newRemainingAmount = sale.remainingAmount + payment.amount;
    const newStatus = 'pending';

    await db
      .update(sales)
      .set({
        paidAmount: newPaidAmount,
        remainingAmount: newRemainingAmount,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sales.id, saleId));

    // Update customer debt
    if (sale.customerId) {
      await db
        .update(customers)
        .set({
          totalDebt: customers.totalDebt + payment.amount,
        })
        .where(eq(customers.id, sale.customerId));
    }

    saveDatabase();

    return payment;
  }

  // db.delete(...).from is not a function
  async removeSale(saleId) {
    const db = await getDb();
    const sale = await this.getById(saleId);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    // Delete related payments
    await db.delete(payments).where(eq(payments.saleId, saleId));

    // Delete related installments
    await db.delete(installments).where(eq(installments.saleId, saleId));

    // Delete related sale items
    await db.delete(saleItems).where(eq(saleItems.saleId, saleId));

    // Delete the sale itself
    await db.delete(sales).where(eq(sales.id, saleId));

    saveDatabase();

    return sale;
  }

  async restoreSale(saleId) {
    const db = await getDb();
    // restore sale by setting its status back to 'completed' and adjusting stock and customer debt accordingly
    const sale = await this.getById(saleId);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    if (sale.status !== 'cancelled') {
      throw new ValidationError('Only cancelled sales can be restored');
    }

    // Adjust stock for each sale item
    for (const item of sale.items) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (product) {
        await db
          .update(products)
          .set({
            stock: product.stock - item.quantity,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(products.id, item.productId));
      }
    }

    // Update customer debt
    if (sale.customerId && sale.remainingAmount > 0) {
      await db
        .update(customers)
        .set({
          totalDebt: customers.totalDebt + sale.remainingAmount,
          totalPurchases: customers.totalPurchases + sale.total,
        })
        .where(eq(customers.id, sale.customerId));
    }

    // Restore sale status
    // Round remainingAmount based on currency to avoid decimal fractions
    const currency = sale.currency || 'USD';
    const roundedRemainingAmount = roundByCurrency(sale.remainingAmount, currency);
    const [updated] = await db
      .update(sales)
      .set({
        status: roundedRemainingAmount <= 0 ? 'completed' : 'pending',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sales.id, saleId))
      .returning();

    // Restore pending installments
    await db
      .update(installments)
      .set({
        status: 'pending',
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(installments.saleId, saleId), eq(installments.status, 'cancelled')));

    saveDatabase();

    return updated;
  }

  /**
   * Create a draft sale (saved temporarily)
   * @param {Object} saleData - Sale data including items
   * @param {number} userId - ID of user creating the draft
   * @returns {Promise<Object>} Created draft sale
   */
  async createDraft(saleData, userId) {
    const db = await getDb();
    const currencySettings = await settingsService.getCurrencySettings();

    // Calculate totals if items exist
    let totals = { subtotal: 0, discount: 0, tax: 0, total: 0 };
    if (saleData.items && saleData.items.length > 0) {
      totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);
    }

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber();

    // Use currency from settings if not provided
    const currency = saleData.currency || currencySettings.defaultCurrency;

    // Get exchange rate based on currency
    const exchangeRate =
      saleData.exchangeRate ||
      (currency === 'USD' ? currencySettings.usdRate : currencySettings.iqdRate);

    // Create draft sale record (status = 'draft')
    // Prepare values object
    const draftValues = {
      invoiceNumber,
      subtotal: totals.subtotal,
      discount: totals.discount || 0,
      tax: totals.tax || 0,
      total: totals.total,
      currency,
      exchangeRate,
      paymentType: saleData.paymentType || 'cash',
      paidAmount: 0,
      remainingAmount: totals.total,
      status: 'draft', // Draft status
      notes: saleData.notes || null,
      createdBy: userId,
      interestRate: parseFloat(saleData.interestRate) || 0,
      interestAmount: 0,
    };

    // إضافة customerId فقط إذا كان موجوداً
    if (saleData.customerId !== undefined && saleData.customerId !== null) {
      draftValues.customerId = saleData.customerId;
    }

    const [newDraft] = await db.insert(sales).values(draftValues).returning();

    // Create sale items if they exist (without updating stock)
    if (saleData.items && saleData.items.length > 0) {
      const itemsToInsert = [];
      for (const item of saleData.items) {
        let productName = item.productName || 'Unknown Product';

        // Try to get product name from database if productId exists
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

        // Calculate item subtotal and discount (consistent with create method)
        // item.discount is per unit, so multiply by quantity to get total discount
        const itemDiscountTotal = (item.discount || 0) * (item.quantity || 1);
        const itemSubtotal = (item.unitPrice || 0) * (item.quantity || 1) - itemDiscountTotal;

        itemsToInsert.push({
          saleId: newDraft.id,
          productId: item.productId || null,
          productName,
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          discount: itemDiscountTotal, // Store total discount (per unit * quantity)
          subtotal: parseFloat(itemSubtotal.toFixed(2)),
        });
      }

      await db.insert(saleItems).values(itemsToInsert);
    }

    saveDatabase();
    return await this.getById(newDraft.id);
  }

  /**
   * Delete old draft sales (older than 1 day)
   * @returns {Promise<number>} Number of deleted drafts
   */
  async deleteOldDrafts() {
    const db = await getDb();
    // Calculate one day ago in local time (matching database datetime format)
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Format as local time string (YYYY-MM-DD HH:MM:SS) to match SQLite datetime('now','localtime')
    // SQLite stores timestamps in local time format: YYYY-MM-DD HH:MM:SS
    const year = oneDayAgo.getFullYear();
    const month = String(oneDayAgo.getMonth() + 1).padStart(2, '0');
    const day = String(oneDayAgo.getDate()).padStart(2, '0');
    const hours = String(oneDayAgo.getHours()).padStart(2, '0');
    const minutes = String(oneDayAgo.getMinutes()).padStart(2, '0');
    const seconds = String(oneDayAgo.getSeconds()).padStart(2, '0');
    const oneDayAgoLocal = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    // Delete draft sales older than 1 day
    const deleted = await db
      .delete(sales)
      .where(and(eq(sales.status, 'draft'), lt(sales.createdAt, oneDayAgoLocal)))
      .returning();

    saveDatabase();
    return deleted.length;
  }

  /**
   * Complete a draft sale (convert to regular sale)
   * @param {number} draftId - ID of draft sale
   * @param {Object} saleData - Complete sale data
   * @param {number} userId - ID of user completing the sale
   * @returns {Promise<Object>} Completed sale
   */
  async completeDraft(draftId, saleData, userId) {
    const db = await getDb();

    // Get the draft sale
    const draft = await this.getById(draftId);
    if (draft.status !== 'draft') {
      throw new ValidationError('Sale is not a draft');
    }

    // Delete old draft items
    await db.delete(saleItems).where(eq(saleItems.saleId, draftId));

    // Validate items exist
    if (!saleData.items || saleData.items.length === 0) {
      throw new ValidationError('Sale must have at least one item');
    }

    // Calculate totals
    const totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);

    // Calculate interest for installment payments
    let interestAmount = 0;
    let finalTotal = totals.total;

    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      saleData.interestRate > 0
    ) {
      interestAmount = (totals.total * saleData.interestRate) / 100;
      finalTotal = totals.total + interestAmount;
    }

    // Get currency settings
    const currencySettings = await settingsService.getCurrencySettings();

    // Use currency from saleData or draft
    const currency = saleData.currency || draft.currency || currencySettings.defaultCurrency;

    // Round finalTotal based on currency (IQD: nearest 250, USD: nearest integer)
    finalTotal = roundByCurrency(finalTotal, currency);

    // Calculate remaining amount
    const paidAmount = roundByCurrency(parseFloat(saleData.paidAmount) || 0, currency);
    let remainingAmount = Math.max(0, finalTotal - paidAmount);

    // Round remainingAmount based on currency
    // If remainingAmount is less than threshold, consider it as 0
    const threshold = currency === 'IQD' ? 250 : 0.01;
    remainingAmount = remainingAmount < threshold ? 0 : roundByCurrency(remainingAmount, currency);

    // Update draft to completed sale
    // Use exchangeRate from saleData if provided, otherwise use draft values
    const exchangeRate =
      saleData.exchangeRate !== undefined ? saleData.exchangeRate : draft.exchangeRate;

    const [updatedSale] = await db
      .update(sales)
      .set({
        customerId: saleData.customerId || draft.customerId,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: finalTotal,
        currency: currency,
        exchangeRate: exchangeRate,
        paymentType: saleData.paymentType || draft.paymentType,
        paidAmount,
        remainingAmount,
        status: remainingAmount <= 0 ? 'completed' : 'pending',
        notes: saleData.notes || draft.notes,
        interestRate: parseFloat(saleData.interestRate) || 0,
        interestAmount: roundByCurrency(interestAmount, currency), // Round based on currency
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sales.id, draftId))
      .returning();

    // Create sale items and update product stock
    for (const item of saleData.items) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (!product) {
        throw new ValidationError(`Product with ID ${item.productId} not found`);
      }

      // Check stock availability
      if (product.stock < item.quantity) {
        throw new ValidationError(
          `Insufficient stock for product ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`
        );
      }

      // Calculate item subtotal and discount (consistent with create method)
      // item.discount is per unit, so multiply by quantity to get total discount
      const itemDiscountTotal = (item.discount || 0) * item.quantity;
      const itemSubtotal = item.quantity * item.unitPrice - itemDiscountTotal;

      // Create sale item
      await db.insert(saleItems).values({
        saleId: updatedSale.id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: itemDiscountTotal, // Store total discount (per unit * quantity)
        subtotal: parseFloat(itemSubtotal.toFixed(2)),
      });

      // Update product stock
      await db
        .update(products)
        .set({ stock: product.stock - item.quantity })
        .where(eq(products.id, item.productId));
    }

    // Handle payments if any
    // If paidAmount > 0, create a payment record even if paymentMethod is not specified
    // Use default payment method 'cash' if not provided to maintain payment audit trail
    if (paidAmount > 0) {
      const customerId = saleData.customerId || draft.customerId || null;
      await db.insert(payments).values({
        saleId: updatedSale.id,
        customerId: customerId,
        amount: paidAmount, // Already rounded by currency
        currency: currency,
        exchangeRate: exchangeRate,
        paymentMethod: saleData.paymentMethod || 'cash', // Default to 'cash' if not specified
        createdBy: userId,
      });
    }

    // Handle installments if payment type is installment or mixed
    if (
      (saleData.paymentType === 'installment' || saleData.paymentType === 'mixed') &&
      saleData.installments &&
      saleData.installments.length > 0
    ) {
      // Validate that customerId is provided for installment sales
      const customerId = saleData.customerId || draft.customerId;
      if (!customerId) {
        throw new ValidationError('Customer ID is required for installment sales');
      }

      for (const installment of saleData.installments) {
        // Round installment amount based on currency to avoid decimal fractions
        const roundedAmount = roundByCurrency(installment.amount, currency);

        await db.insert(installments).values({
          saleId: updatedSale.id,
          customerId: customerId,
          installmentNumber: installment.number,
          dueAmount: roundedAmount,
          paidAmount: 0,
          remainingAmount: roundedAmount,
          currency: currency,
          dueDate: installment.dueDate,
          status: 'pending',
          createdBy: userId,
        });
      }

      // Update customer debt
      if (customerId) {
        const { CustomerService } = await import('./customerService.js');
        const customerService = new CustomerService();
        await customerService.updateDebt(customerId, remainingAmount);
      }
    }

    saveDatabase();
    return await this.getById(updatedSale.id);
  }

  /**
   * Get top selling products
   * @param {Object} filters - Filters like limit, startDate, endDate
   * @returns {Promise<Array>} Array of top products with sales data
   */
  async getTopProducts(filters = {}) {
    const db = await getDb();
    const { limit = 5, startDate, endDate } = filters;

    // Build WHERE conditions for sales
    const saleConditions = [eq(sales.status, 'completed')];
    
    if (startDate) {
      saleConditions.push(gte(sales.createdAt, startDate));
    }
    
    if (endDate) {
      saleConditions.push(lte(sales.createdAt, endDate));
    }

    // Query to aggregate product sales
    // Use raw SQL for better compatibility with SQLite aggregations
    const sqlite = await getSqlite();
    
    // Build WHERE clause
    let whereClause = 'sales.status = ?';
    const params = ['completed'];
    
    if (startDate) {
      whereClause += ' AND sales.created_at >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      whereClause += ' AND sales.created_at <= ?';
      params.push(endDate);
    }
    
    // Build SQL query
    const query = `
      SELECT 
        sale_items.product_id as productId,
        products.name as productName,
        CAST(SUM(sale_items.quantity) AS INTEGER) as totalQuantity,
        CAST(SUM(sale_items.quantity * sale_items.unit_price) AS REAL) as totalRevenue
      FROM sale_items
      INNER JOIN sales ON sale_items.sale_id = sales.id
      INNER JOIN products ON sale_items.product_id = products.id
      WHERE ${whereClause}
      GROUP BY sale_items.product_id, products.name
      ORDER BY SUM(sale_items.quantity) DESC
      LIMIT ?
    `;
    
    params.push(limit);
    
    const result = sqlite.prepare(query).all(...params);
    
    const topProducts = result.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      totalQuantity: Number(row.totalQuantity) || 0,
      totalRevenue: Number(row.totalRevenue) || 0,
    }));

    return topProducts.map((product) => ({
      productId: product.productId,
      productName: product.productName,
      totalQuantity: Number(product.totalQuantity) || 0,
      totalRevenue: Number(product.totalRevenue) || 0,
    }));
  }
}
