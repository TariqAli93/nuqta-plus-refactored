import { getDb, getPool, saveDatabase } from '../db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  SALE_TYPE_INSTALLMENT,
  SALE_SOURCE_POS,
  saleTypeToPaymentType,
} from '../constants/sales.js';
import {
  sales,
  saleItems,
  products,
  customers,
  payments,
  installments,
  users,
  warehouses,
  branches,
  productStock,
  saleReturns,
  saleReturnItems,
  saleItemStockEntries,
} from '../models/index.js';
import * as schema from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { generateDraftInvoicePlaceholder, calculateSaleTotals } from '../utils/helpers.js';
import { eq, desc, and, or, gte, lte, sql, inArray, lt, count as countFn } from 'drizzle-orm';
import settingsService from './settingsService.js';
import alertBus from '../events/alertBus.js';
import { hasPermission } from '../auth/permissionMatrix.js';
import { getCustomerCreditSnapshot, canCreateInstallmentSale } from './creditScoringService.js';
import auditService from './auditService.js';
import { InventoryService } from './inventoryService.js';
import { branchFilterFor, enforceBranchScope, enforceWarehouseScope } from './scopeService.js';
import featureFlagsService from './featureFlagsService.js';
import cashSessionService from './cashSessionService.js';
import { PAYMENT_METHOD_CASH } from '../constants/sales.js';

// Threshold below which a customer is considered "high risk" for an alert
const HIGH_RISK_SCORE_THRESHOLD = 50;

/**
 * Enforce the customer's recommended credit limit for installment/mixed sales.
 *
 * If the sale total exceeds recommendedLimit:
 *   - user with `sales.override_credit_limit` → allowed; logged to audit trail
 *   - otherwise → ValidationError (reject)
 *
 * Also logs an audit entry when a high-risk customer (score <= threshold) is
 * used in a new installment sale, and emits a real-time alert.
 *
 * @returns {{snapshot, exceeded, highRisk}}
 */
async function enforceCreditLimit({ customerId, total, user, paymentType, branchId }) {
  if (!customerId) return { snapshot: null, exceeded: false, highRisk: false, decision: null };
  if (paymentType !== 'installment' && paymentType !== 'mixed') {
    return { snapshot: null, exceeded: false, highRisk: false, decision: null };
  }

  // Smart decision engine — combines score + aging + active counts + limit.
  const decision = await canCreateInstallmentSale(customerId, Number(total), branchId);
  const snapshot = await getCustomerCreditSnapshot(customerId);
  if (!snapshot) {
    return { snapshot: null, exceeded: false, highRisk: false, decision };
  }

  const limit = snapshot.recommendedLimit;
  const score = snapshot.creditScore;
  const exceeded = limit != null && Number(total) > Number(limit);
  const highRisk =
    decision.riskLevel === 'high' ||
    (score != null && score <= HIGH_RISK_SCORE_THRESHOLD);

  // High-risk decision blocks the sale unless the caller has override permission.
  if (decision.riskLevel === 'high') {
    const canOverride = user && hasPermission('sales.override_credit_limit', user.role);
    if (!canOverride) {
      const err = new ValidationError(
        `Installment sale rejected: ${decision.reason}. Override permission required.`
      );
      err.code = 'CREDIT_DECISION_BLOCKED';
      err.decision = decision;
      throw err;
    }
    // Override taken — log every reason that contributed.
    await auditService.log({
      userId: user.id,
      username: user.username,
      action: 'sales:credit_decision_override',
      resource: 'customers',
      resourceId: customerId,
      details: {
        saleTotal: Number(total),
        recommendedLimit: limit != null ? Number(limit) : null,
        creditScore: score,
        riskLevel: decision.riskLevel,
        reasons: decision.reasons,
      },
    });
  }

  if (exceeded && decision.riskLevel !== 'high') {
    // Non-blocking exceed (e.g. limit slightly off but other signals are clean)
    // — still gated by override permission to avoid silent breaches.
    const canOverride = user && hasPermission('sales.override_credit_limit', user.role);
    if (!canOverride) {
      throw new ValidationError(
        `Sale total (${total}) exceeds customer's recommended credit limit (${limit}). An override permission is required.`
      );
    }
    await auditService.log({
      userId: user.id,
      username: user.username,
      action: 'sales:credit_limit_override',
      resource: 'customers',
      resourceId: customerId,
      details: {
        saleTotal: Number(total),
        recommendedLimit: Number(limit),
        creditScore: score,
      },
    });
  }

  if (highRisk) {
    await auditService.log({
      userId: user?.id || null,
      username: user?.username || null,
      action: 'sales:high_risk_approved',
      resource: 'customers',
      resourceId: customerId,
      details: {
        saleTotal: Number(total),
        recommendedLimit: limit != null ? Number(limit) : null,
        creditScore: score,
        threshold: HIGH_RISK_SCORE_THRESHOLD,
        decisionReasons: decision.reasons,
      },
    });
    alertBus.emit('alerts.changed', 'customer.high_risk_sale');
  }

  return { snapshot, exceeded, highRisk, decision };
}

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
 * Allocate the next invoice number for a branch within the current
 * transaction. Backed by the invoice_sequences counter row — the upsert
 * acquires a row-level lock, so concurrent callers serialize and the returned
 * sequence value is unique per (branchId, year).
 *
 * If the surrounding transaction rolls back, the increment rolls back too —
 * no number is burned on a failed sale.
 *
 * @param {object} tx Drizzle transaction handle (must run inside withTransaction)
 * @param {number} branchId
 * @returns {Promise<{invoiceNumber: string, issuedAt: Date}>}
 */
async function allocateInvoiceNumber(tx, branchId) {
  if (!branchId || !Number.isInteger(branchId) || branchId <= 0) {
    throw new ValidationError('A branch is required to issue an invoice number');
  }
  const issuedAt = new Date();
  const year = issuedAt.getFullYear();

  const result = await tx.execute(sql`
    INSERT INTO invoice_sequences (branch_id, year, next_value)
    VALUES (${branchId}, ${year}, 2)
    ON CONFLICT (branch_id, year)
    DO UPDATE SET next_value = invoice_sequences.next_value + 1,
                  updated_at = now()
    RETURNING (next_value - 1) AS sequence
  `);

  const rows = result.rows ?? result;
  const seq = Number(rows?.[0]?.sequence);
  if (!Number.isFinite(seq) || seq <= 0) {
    throw new Error('Invoice sequence allocation failed');
  }

  const branchStr = String(branchId).padStart(3, '0');
  const seqStr = String(seq).padStart(6, '0');
  return {
    invoiceNumber: `BR${branchStr}-${year}-${seqStr}`,
    issuedAt,
  };
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

/**
 * Resolve the branch + warehouse pair for a sale.
 *
 * Preference order:
 *   1. An explicit warehouseId passed in (validated against branchId if given).
 *   2. The branch-bound user's assignedWarehouseId.
 *   3. The first active warehouse inside the user's assigned branch.
 *   4. The first active warehouse overall (legacy single-warehouse flow).
 *
 * Without step 3, a branch-bound user with no assigned warehouse would have
 * sales silently routed to the main warehouse of another branch — the bug
 * that kept non-main branches from selling.
 */
async function resolveBranchWarehouse({ branchId, warehouseId, actingUser }) {
  const db = await getDb();

  if (warehouseId) {
    const [wh] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);
    if (!wh) throw new ValidationError('Warehouse not found');
    if (!wh.isActive) throw new ValidationError('Warehouse is inactive');
    if (branchId && branchId !== wh.branchId) {
      throw new ValidationError('Warehouse does not belong to the specified branch');
    }
    return { branchId: wh.branchId, warehouseId: wh.id };
  }

  // Prefer a warehouse inside the user's assigned branch when the caller is
  // branch-bound. Picks an active warehouse there; if there's only one this
  // is deterministic.
  const preferredBranchId = branchId || actingUser?.assignedBranchId || null;
  if (preferredBranchId) {
    const [wh] = await db
      .select({ id: warehouses.id, branchId: warehouses.branchId })
      .from(warehouses)
      .where(
        and(eq(warehouses.branchId, preferredBranchId), eq(warehouses.isActive, true))
      )
      .orderBy(warehouses.id)
      .limit(1);
    if (wh) return { branchId: wh.branchId, warehouseId: wh.id };
    if (branchId || actingUser?.assignedBranchId) {
      throw new ValidationError(
        'No active warehouse found for the assigned branch — ask an admin to create one'
      );
    }
  }

  // Legacy fallback: first active warehouse anywhere
  const [fallback] = await db
    .select({ id: warehouses.id, branchId: warehouses.branchId })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.id)
    .limit(1);
  if (!fallback) {
    throw new ValidationError(
      'No active warehouse configured — create a branch/warehouse before recording sales'
    );
  }
  return { branchId: fallback.branchId, warehouseId: fallback.id };
}

export class SaleService {
  async create(saleData, user) {
    // Backward-compat: callers previously passed userId (number). Normalise.
    const actingUser = typeof user === 'object' && user !== null ? user : { id: user };
    const userId = actingUser.id;
    const currencySettings = await settingsService.getCurrencySettings();

    if (!saleData.items || saleData.items.length === 0) {
      throw new ValidationError('Sale must have at least one item');
    }

    const totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);

    // ── Normalise saleSource / saleType / paymentType ──────────────────────
    // New callers send `saleSource` + `saleType`; legacy callers only send
    // `paymentType`. We accept either and keep both in sync so the DB
    // column stays backward-compatible.
    const saleSource = saleData.saleSource || null;
    const saleType   = saleData.saleType   || null;
    const paymentType =
      saleData.paymentType ||
      (saleType ? saleTypeToPaymentType(saleType) : 'cash');

    // Feature gate: a POS sale requires the pos feature flag to be on.
    // Mirrors the frontend "hide POS button/route" UX.
    if (saleSource === SALE_SOURCE_POS) {
      const posEnabled = await featureFlagsService.isFeatureEnabled('pos');
      if (!posEnabled) {
        const err = new ValidationError('POS module is disabled');
        err.statusCode = 403;
        err.code = 'FEATURE_DISABLED';
        err.feature = 'pos';
        throw err;
      }
    }

    const isInstallmentSale =
      paymentType === 'installment' ||
      paymentType === 'mixed' ||
      saleType    === SALE_TYPE_INSTALLMENT;

    // Feature gate: reject installment sales when the installments module is
    // disabled. Mirrors the frontend "hide installment button" UX so a
    // direct API call still gets blocked.
    if (isInstallmentSale) {
      const installmentsEnabled = await featureFlagsService.isFeatureEnabled('installments');
      if (!installmentsEnabled) {
        const err = new ValidationError('Installments are disabled');
        err.statusCode = 403;
        err.code = 'FEATURE_DISABLED';
        err.feature = 'installments';
        throw err;
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    let interestAmount = 0;
    let finalTotal = totals.total;

    if (isInstallmentSale && saleData.interestRate > 0) {
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

    if (isInstallmentSale && !customerId) {
      throw new ValidationError('Customer is required for installment payments');
    }

    // Enforce credit-limit policy before any DB writes.
    // Throws ValidationError when the smart decision rejects the sale and the
    // caller lacks the override permission.
    await enforceCreditLimit({
      customerId,
      total: finalTotal,
      user: actingUser,
      paymentType,
      branchId: actingUser?.assignedBranchId || saleData.branchId || null,
    });

    // Resolve branch + warehouse. Keeps existing callers working without changes.
    // If the caller is branch-bound, force their assigned branch so a client
    // that tries to spoof branchId/warehouseId in the payload cannot escape.
    const { branchId, warehouseId } = await resolveBranchWarehouse({
      branchId: actingUser?.assignedBranchId || saleData.branchId,
      warehouseId: actingUser?.assignedWarehouseId || saleData.warehouseId,
      actingUser,
    });

    // Final scope check — throws if the resolved warehouse is outside the
    // acting user's branch/warehouse scope (defensive).
    await enforceWarehouseScope(actingUser, warehouseId);

    // ── Cash session enforcement ────────────────────────────────────────────
    // POS cash sales must run inside an open cash session for the acting user
    // and branch. Installment sales (and POS card sales) do not need one — a
    // POS card sale takes no physical cash so the drawer is unaffected, and
    // installment sales come from the NewSale flow which has no shift drawer.
    let cashSessionId = null;
    const incomingPaymentMethod = saleData.paymentMethod || PAYMENT_METHOD_CASH;
    const isPosCashSale =
      saleSource === SALE_SOURCE_POS &&
      !isInstallmentSale &&
      incomingPaymentMethod === PAYMENT_METHOD_CASH &&
      Number(paidAmount) > 0;

    if (isPosCashSale) {
      const session = await cashSessionService.findOpenSession(userId, branchId);
      if (!session) {
        throw new ValidationError(
          'No open cash session — open a shift before recording cash sales',
          'CASH_SESSION_REQUIRED'
        );
      }
      cashSessionId = session.id;
    }

    const newSaleId = await withTransaction(async (tx) => {
      // Allocate inside the transaction so a rollback releases the number
      // back (the counter increment rolls back too) and concurrent inserts
      // serialize on the row-level lock.
      const { invoiceNumber, issuedAt } = await allocateInvoiceNumber(tx, branchId);

      const [newSale] = await tx
        .insert(sales)
        .values({
          invoiceNumber,
          issuedAt,
          customerId,
          branchId,
          warehouseId,
          cashSessionId,
          subtotal: String(totals.subtotal),
          discount: String(totals.discount),
          tax: String(totals.tax),
          total: String(finalTotal),
          currency,
          exchangeRate: String(exchangeRate),
          paymentType,
          saleSource,
          saleType,
          paidAmount: String(paidAmount),
          remainingAmount: String(remainingAmount),
          status: remainingAmount <= 0 ? 'completed' : 'pending',
          notes: saleData.notes || null,
          createdBy: userId,
          interestRate: String(parseFloat(saleData.interestRate) || 0),
          interestAmount: String(roundByCurrency(interestAmount, currency)),
        })
        .returning();

      const stockItems = [];
      for (const item of saleData.items) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (!product) {
          throw new NotFoundError(`Product with ID ${item.productId} not found`);
        }

        const itemDiscountTotal = (item.discount || 0) * item.quantity;
        const itemSubtotal = item.quantity * item.unitPrice - itemDiscountTotal;

        const [insertedSaleItem] = await tx.insert(saleItems).values({
          saleId: newSale.id,
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          discount: String(itemDiscountTotal),
          subtotal: String(parseFloat(itemSubtotal.toFixed(2))),
        }).returning({ id: saleItems.id });

        stockItems.push({ productId: item.productId, quantity: item.quantity, saleItemId: insertedSaleItem.id });
      }

      // Per-warehouse stock deduction via inventoryService.
      // Throws ValidationError on insufficient stock and rolls back the tx.
      await InventoryService.applySaleStockMovement(tx, {
        saleId: newSale.id,
        warehouseId,
        items: stockItems,
        userId,
      });

      if (paidAmount > 0) {
        const method = saleData.paymentMethod || 'cash';
        await tx.insert(payments).values({
          saleId: newSale.id,
          customerId,
          amount: String(parseFloat(paidAmount.toFixed(2))),
          currency,
          exchangeRate: String(exchangeRate),
          paymentMethod: method,
          paymentReference: saleData.paymentReference || null,
          // Tie cash payments to the open shift so close-of-shift can compute
          // expected cash. Card payments stay unlinked — they don't touch the drawer.
          cashSessionId: method === PAYMENT_METHOD_CASH ? cashSessionId : null,
          createdBy: userId,
          notes: saleData.paymentNotes || null,
        });
      }

      if (isInstallmentSale && remainingAmount > 0) {
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

    alertBus.emit('alerts.changed', 'sale.created');
    return await this.getById(newSaleId);
  }

  async getAll(filters = {}, actingUser = null) {
    const db = await getDb();
    const { page = 1, limit = 10, status, startDate, endDate, paymentType } = filters;

    const conditions = [];

    if (status) {
      conditions.push(eq(sales.status, status));
    }

    // PosScreen passes paymentType='cash' to exclude installment drafts.
    if (paymentType) {
      conditions.push(eq(sales.paymentType, paymentType));
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

    // Branch scope — non-global-admins only see their branch. Global admins
    // may pass `branchId` explicitly to filter.
    const allowedBranches = branchFilterFor(actingUser);
    if (allowedBranches === null && filters.branchId) {
      conditions.push(eq(sales.branchId, Number(filters.branchId)));
    } else if (allowedBranches !== null) {
      if (allowedBranches.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      conditions.push(eq(sales.branchId, allowedBranches[0]));
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
        customerId: sales.customerId,
        createdBy: users.username,
        itemCount: sql`(SELECT COUNT(*) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`,
        returnedTotal: sql`COALESCE((SELECT SUM(${saleReturns.returnedValue}::numeric) FROM ${saleReturns} WHERE ${saleReturns.saleId} = ${sales.id}), 0)`,
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
        itemCount: Number(row.itemCount) || 0,
        returnedTotal: n(row.returnedTotal),
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
        branchId: sales.branchId,
        branchName: branches.name,
        warehouseId: sales.warehouseId,
        warehouseName: warehouses.name,
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
        issuedAt: sales.issuedAt,
        createdAt: sales.createdAt,
        createdBy: users.username,
      })
      .from(sales)
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .leftJoin(users, eq(sales.createdBy, users.id))
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
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
        // Profit visibility — uses the product's current cost_price. Returns
        // null when the product was deleted so the UI can render "n/a".
        costPrice: products.costPrice,
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

    const returns = await this.getReturnsForSale(id);

    // Compute per-item + sale-level profit. profit=null on any item with a
    // missing cost (deleted product) so the UI can show "n/a" instead of
    // a misleading number. The sale-level total is null in that case too.
    const enrichedItems = items.map((item) => {
      const cost = item.costPrice == null ? null : Number(item.costPrice);
      const qty = Number(item.quantity) || 0;
      const profit =
        cost == null ? null : Number(item.unitPrice) * qty - n(item.discount) - cost * qty;
      return {
        ...item,
        unitPrice: n(item.unitPrice),
        discount: n(item.discount),
        subtotal: n(item.subtotal),
        costPrice: cost,
        profit,
      };
    });
    const profitAccurate = enrichedItems.every((it) => it.profit !== null);
    const totalProfit = profitAccurate
      ? enrichedItems.reduce((acc, it) => acc + (it.profit || 0), 0)
      : null;

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
      totalProfit,
      profitAccurate,
      customer,
      items: enrichedItems,
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
      returns,
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

    let insertedPaymentId = null;

    await withTransaction(async (tx) => {
      const [insertedPayment] = await tx
        .insert(payments)
        .values({
          saleId,
          customerId: sale.customerId,
          amount: String(paymentAmount),
          currency: paymentData.currency || sale.currency,
          exchangeRate: String(paymentData.exchangeRate || sale.exchangeRate),
          paymentMethod: paymentData.paymentMethod || 'cash',
          paymentReference: paymentData.paymentReference || null,
          notes: paymentData.notes,
          createdBy: userId,
        })
        .returning({ id: payments.id });
      insertedPaymentId = insertedPayment?.id || null;

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

    alertBus.emit('alerts.changed', 'payment.added');

    // Reload the sale + customer so we have the post-payment state for the
    // confirmation message. Errors here MUST NOT roll back the payment — the
    // notification system is optional, so we log and move on.
    try {
      const updatedSale = await this.getById(saleId);
      if (updatedSale.customerId && insertedPaymentId) {
        const db = await getDb();
        const [c] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, updatedSale.customerId))
          .limit(1);
        if (c && c.phone) {
          const notifications = await import('./notifications/notificationService.js');
          await notifications.sendPaymentConfirmation({
            sale: updatedSale,
            payment: { id: insertedPaymentId, amount: paymentAmount },
            customer: c,
          });
        }
      }
    } catch (err) {
      // Non-fatal — payment is already committed.
      // eslint-disable-next-line no-console
      console.warn('[notifications] payment confirmation skipped:', err.message);
    }

    return await this.getById(saleId);
  }

  async cancel(id, userId) {
    const sale = await this.getById(id);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Sale is already cancelled');
    }

    const result = await withTransaction(async (tx) => {
      // Per-warehouse stock restore via inventoryService (records sale_cancel
      // movement). Legacy sales with no warehouseId are skipped safely.
      await InventoryService.restoreSaleStockMovement(tx, {
        saleId: sale.id,
        warehouseId: sale.warehouseId,
        items: sale.items.filter((i) => i.productId),
        userId,
        movementType: 'sale_cancel',
      });

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

    alertBus.emit('alerts.changed', 'sale.cancelled');
    return result;
  }

  async getSalesReport(filters = {}, actingUser = null) {
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

    const allowedBranches = branchFilterFor(actingUser);
    if (allowedBranches !== null) {
      if (allowedBranches.length === 0) {
        // Nothing to report for a user with no assigned branch
        return { salesUSD: 0, paidUSD: 0, profitUSD: 0, salesIQD: 0, paidIQD: 0, profitIQD: 0, count: 0 };
      }
      conds.push(eq(sales.branchId, allowedBranches[0]));
    } else if (filters.branchId) {
      conds.push(eq(sales.branchId, Number(filters.branchId)));
    }

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

    alertBus.emit('alerts.changed', 'payment.removed');
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

    alertBus.emit('alerts.changed', 'sale.removed');
    return sale;
  }

  async restoreSale(saleId, userId) {
    const sale = await this.getById(saleId);

    if (!sale) {
      throw new NotFoundError('Sale');
    }

    if (sale.status !== 'cancelled') {
      throw new ValidationError('Only cancelled sales can be restored');
    }

    const result = await withTransaction(async (tx) => {
      if (sale.warehouseId) {
        await InventoryService.applySaleStockMovement(tx, {
          saleId: sale.id,
          warehouseId: sale.warehouseId,
          items: sale.items
            .filter((i) => i.productId)
            .map((i) => ({ productId: i.productId, quantity: i.quantity })),
          userId,
        });
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

    alertBus.emit('alerts.changed', 'sale.restored');
    return result;
  }

  /**
   * Fetch all returns recorded against a sale, with their items. Used by
   * getById() to surface return history alongside payments and installments.
   */
  async getReturnsForSale(saleId) {
    const db = await getDb();
    const returns = await db
      .select()
      .from(saleReturns)
      .where(eq(saleReturns.saleId, saleId))
      .orderBy(desc(saleReturns.createdAt));

    if (returns.length === 0) return [];

    const ids = returns.map((r) => r.id);
    const items = await db
      .select()
      .from(saleReturnItems)
      .where(inArray(saleReturnItems.returnId, ids));

    const itemsByReturn = new Map();
    for (const it of items) {
      if (!itemsByReturn.has(it.returnId)) itemsByReturn.set(it.returnId, []);
      itemsByReturn.get(it.returnId).push({
        ...it,
        unitPrice: n(it.unitPrice),
        subtotal: n(it.subtotal),
      });
    }

    return returns.map((r) => ({
      ...r,
      returnedValue: n(r.returnedValue),
      refundAmount: n(r.refundAmount),
      debtReduction: n(r.debtReduction),
      items: itemsByReturn.get(r.id) || [],
    }));
  }

  /**
   * Record a return / refund against an existing sale.
   *
   * Effects (single transaction):
   *   - Validates returnable quantity per item (sold qty - prior returns).
   *   - Inserts sale_returns + sale_return_items rows.
   *   - Restores stock via stock_movements (movement_type='sale_return').
   *   - Reduces sales.paidAmount by refundAmount and sales.remainingAmount by
   *     debtReduction. Status becomes 'completed' if no debt remains.
   *   - Reduces customer.totalPurchases by returnedValue and totalDebt by debtReduction.
   *   - For installment sales, walks pending installments from latest to
   *     earliest, reducing dueAmount/remainingAmount and cancelling rows
   *     that drop to zero, until debtReduction is fully absorbed.
   *   - Logs an audit entry for the operation.
   *
   * @param {number} saleId
   * @param {{items, refundAmount, refundMethod, refundReference, reason, notes}} returnData
   * @param {{id, username, assignedBranchId, assignedWarehouseId, role}} actingUser
   */
  async createReturn(saleId, returnData, actingUser) {
    const userId = actingUser?.id || null;
    const sale = await this.getById(saleId);

    if (sale.status === 'cancelled') {
      throw new ValidationError('Cannot return items from a cancelled sale');
    }
    if (sale.status === 'draft') {
      throw new ValidationError('Cannot return items from a draft sale');
    }
    // Installment invoices are excluded — refunds against an open installment
    // schedule are handled by adjusting/cancelling the installment plan,
    // not through this return flow.
    if (
      sale.paymentType === 'installment' ||
      sale.paymentType === 'mixed' ||
      sale.saleType === 'INSTALLMENT'
    ) {
      throw new ValidationError(
        'Returns are not supported on installment invoices. Cancel or adjust the installment plan instead.'
      );
    }
    if (!Array.isArray(returnData.items) || returnData.items.length === 0) {
      throw new ValidationError('Return must include at least one item');
    }

    // Branch/warehouse scope — same defensive check used elsewhere.
    enforceBranchScope(actingUser, sale.branchId);
    if (sale.warehouseId) {
      await enforceWarehouseScope(actingUser, sale.warehouseId);
    }

    const currency = sale.currency || 'USD';

    // Sum prior-returned quantity per saleItemId so we can enforce
    // (returnedQty + priorReturns) <= soldQty.
    const priorReturns = await this.getReturnsForSale(saleId);
    const priorByItemId = new Map();
    for (const r of priorReturns) {
      for (const it of r.items) {
        if (!it.saleItemId) continue;
        priorByItemId.set(it.saleItemId, (priorByItemId.get(it.saleItemId) || 0) + it.quantity);
      }
    }

    // Resolve every requested return item against the original sale's items.
    // We accept either saleItemId (preferred) or productId for callers that
    // only know the product. When productId is given, pick the first matching
    // sale item with capacity left.
    const saleItemsById = new Map(sale.items.map((it) => [it.id, it]));
    const saleItemsByProduct = new Map();
    for (const it of sale.items) {
      if (!it.productId) continue;
      if (!saleItemsByProduct.has(it.productId)) saleItemsByProduct.set(it.productId, []);
      saleItemsByProduct.get(it.productId).push(it);
    }

    const resolvedItems = [];
    for (const req of returnData.items) {
      const qty = Number(req.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new ValidationError('Returned quantity must be a positive integer');
      }

      let target = null;
      if (req.saleItemId) {
        target = saleItemsById.get(req.saleItemId);
        if (!target) {
          throw new ValidationError(
            `Sale item ${req.saleItemId} does not belong to sale ${saleId}`
          );
        }
      } else if (req.productId) {
        const candidates = saleItemsByProduct.get(req.productId) || [];
        target = candidates.find((c) => {
          const prior = priorByItemId.get(c.id) || 0;
          return c.quantity - prior > 0;
        });
        if (!target) {
          throw new ValidationError(
            `Product ${req.productId} was not sold on this sale or is fully returned`
          );
        }
      } else {
        throw new ValidationError('Each return item needs saleItemId or productId');
      }

      const prior = priorByItemId.get(target.id) || 0;
      const remainingQty = target.quantity - prior;
      if (qty > remainingQty) {
        throw new ValidationError(
          `Cannot return ${qty} of "${target.productName}" — only ${remainingQty} remain returnable`
        );
      }

      // Net unit price after distributing the per-item discount on the
      // original sale_items row. saleItem.subtotal already nets the
      // discount, so subtotal/quantity is the post-discount unit price.
      // Keep raw (unrounded) — per-line ceil rounding amplifies float noise
      // past the actual paid amount on IQD (250-bucket) sales.
      const netUnit = target.quantity > 0 ? target.subtotal / target.quantity : Number(target.unitPrice);
      const lineSubtotal = netUnit * qty;

      // Reserve capacity so two requests in the same payload that target the
      // same sale_item don't both pass validation.
      priorByItemId.set(target.id, prior + qty);

      resolvedItems.push({
        saleItem: target,
        quantity: qty,
        unitPrice: netUnit,
        subtotal: lineSubtotal,
      });
    }

    // Cap returnedValue at what the sale actually has left to give back
    // (sale.total minus everything previously returned). This absorbs the
    // float / rounding gap that would otherwise push the value past the
    // paidAmount + remainingAmount budget on currencies like IQD.
    const priorReturnedTotal = priorReturns.reduce((acc, r) => acc + r.returnedValue, 0);
    const maxReturnable = Math.max(0, sale.total - priorReturnedTotal);

    // Round to the nearest currency bucket (not ceil) so the figure stays
    // within the cap; ceil would re-introduce the same overshoot we just
    // fixed by capping above.
    const roundReturnNearest = (amount) => {
      if (currency === 'IQD') return Math.round(amount / 250) * 250;
      return Math.round(amount * 100) / 100;
    };

    // Goods value of the returned items (no interest).
    const returnedGoodsValue = resolvedItems.reduce((acc, it) => acc + it.subtotal, 0);

    // Interest pro-ration: installment sales pre-bake interest into the sale
    // total. When the customer returns goods we cancel the proportional
    // slice of interest with them — otherwise returning everything would
    // still leave the interest portion as a phantom debt across future
    // installments. Cash sales have interestAmount = 0 so this is a no-op.
    const saleGoodsTotal = sale.items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
    const interestAmount = Number(sale.interestAmount || 0);
    const returnedInterest =
      interestAmount > 0 && saleGoodsTotal > 0
        ? (returnedGoodsValue / saleGoodsTotal) * interestAmount
        : 0;

    const rawReturnedValue = returnedGoodsValue + returnedInterest;
    const returnedValue = roundReturnNearest(Math.min(rawReturnedValue, maxReturnable));
    if (returnedValue <= 0) {
      throw new ValidationError('Returned value must be greater than zero');
    }

    // Refund + debt allocation. The customer must always be made whole:
    // refundAmount is cash handed back, debtReduction is debt forgiven.
    // Together they equal returnedValue. Each side is bounded by what the
    // sale actually has available.
    const tolerance = currency === 'IQD' ? 250 : 0.01;
    const requestedRefund = roundReturnNearest(
      Math.max(0, Number(returnData.refundAmount) || 0)
    );
    if (requestedRefund > returnedValue + tolerance) {
      throw new ValidationError('Refund amount cannot exceed the returned value');
    }
    if (requestedRefund > sale.paidAmount + tolerance) {
      throw new ValidationError(
        `Refund amount (${requestedRefund}) cannot exceed amount already paid (${sale.paidAmount})`
      );
    }

    // Refund is capped at both the returned value and what was actually paid;
    // whatever is left becomes a debt write-off, capped at the outstanding
    // remaining amount. Any tiny float / bucket residual collapses into the
    // refund side (so we never throw on rounding noise — the cap above
    // already kept us within the sale's budget).
    let refundAmount = Math.min(requestedRefund, returnedValue, sale.paidAmount);
    let debtReduction = roundReturnNearest(returnedValue - refundAmount);
    if (debtReduction > sale.remainingAmount) {
      const overflow = debtReduction - sale.remainingAmount;
      if (overflow > tolerance) {
        throw new ValidationError(
          `Returned value (${returnedValue}) exceeds remaining debt (${sale.remainingAmount}) plus refund (${refundAmount}) by ${overflow}. Increase the refund amount.`
        );
      }
      // Within tolerance — push the residual onto the refund side so the
      // numbers add up without surfacing a bucket-rounding error to the user.
      debtReduction = sale.remainingAmount;
      refundAmount = roundReturnNearest(returnedValue - debtReduction);
    }

    const refundMethod =
      returnData.refundMethod ||
      (refundAmount > 0 ? 'cash' : 'credit');
    if (refundMethod === 'card' && !returnData.refundReference) {
      throw new ValidationError('Card refund requires a reference number');
    }

    const result = await withTransaction(async (tx) => {
      // 1. Insert the return header.
      const [newReturn] = await tx
        .insert(saleReturns)
        .values({
          saleId: sale.id,
          customerId: sale.customerId || null,
          branchId: sale.branchId || null,
          warehouseId: sale.warehouseId || null,
          returnedValue: String(returnedValue),
          refundAmount: String(refundAmount),
          debtReduction: String(debtReduction),
          refundMethod,
          refundReference: returnData.refundReference || null,
          currency,
          reason: returnData.reason || null,
          notes: returnData.notes || null,
          createdBy: userId,
        })
        .returning();

      // 2. Insert the line items.
      for (const it of resolvedItems) {
        await tx.insert(saleReturnItems).values({
          returnId: newReturn.id,
          saleItemId: it.saleItem.id,
          productId: it.saleItem.productId || null,
          productName: it.saleItem.productName,
          quantity: it.quantity,
          unitPrice: String(it.unitPrice),
          subtotal: String(it.subtotal),
        });
      }

      // 3. Restore stock for items that have a productId. Legacy sales with
      //    no warehouseId are skipped (movements need a warehouse).
      if (sale.warehouseId) {
        // Prefer restoring to the original consumed stock entries when trace
        // rows exist. Fallback to legacy aggregate restore when no trace is
        // present (older sales).
        const fallbackStockItems = [];
        for (const it of resolvedItems) {
          if (!it.saleItem?.id || !it.saleItem?.productId) continue;
          let remaining = Number(it.quantity) || 0;
          const traces = await tx
            .select({
              id: saleItemStockEntries.id,
              stockEntryId: saleItemStockEntries.productStockEntryId,
              quantity: saleItemStockEntries.quantity,
            })
            .from(saleItemStockEntries)
            .where(eq(saleItemStockEntries.saleItemId, it.saleItem.id))
            .orderBy(desc(saleItemStockEntries.id))
            .for('update');
          for (const tr of traces) {
            if (remaining <= 0) break;
            const giveBack = Math.min(remaining, Number(tr.quantity) || 0);
            if (giveBack <= 0) continue;
            await tx.execute(sql`
              UPDATE product_stock_entries
              SET remaining_quantity = remaining_quantity + ${giveBack},
                  status = CASE WHEN status = 'blocked' THEN 'blocked' ELSE 'active' END,
                  updated_at = now()
              WHERE id = ${tr.stockEntryId}
                AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
            `);
            await tx
              .update(saleItemStockEntries)
              .set({ quantity: Number(tr.quantity) - giveBack })
              .where(eq(saleItemStockEntries.id, tr.id));
            remaining -= giveBack;
          }
          if (remaining > 0) {
            fallbackStockItems.push({ productId: it.saleItem.productId, quantity: remaining });
          }
        }
        if (fallbackStockItems.length > 0) {
          await InventoryService.restoreSaleStockMovement(tx, {
            saleId: sale.id,
            warehouseId: sale.warehouseId,
            items: fallbackStockItems,
            userId,
            movementType: 'sale_return',
          });
        }
      }

      // 4. Update the sale: paidAmount drops by refundAmount, remainingAmount
      //    drops by debtReduction. Status becomes 'completed' when no debt
      //    remains (mirrors addPayment's behaviour).
      const newPaidAmount = roundByCurrency(
        Math.max(0, sale.paidAmount - refundAmount),
        currency
      );
      const newRemainingAmount = roundByCurrency(
        Math.max(0, sale.remainingAmount - debtReduction),
        currency
      );
      const newStatus = newRemainingAmount <= 0 ? 'completed' : sale.status;
      await tx
        .update(sales)
        .set({
          paidAmount: String(newPaidAmount),
          remainingAmount: String(newRemainingAmount),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(sales.id, sale.id));

      // 5. Customer balance: lifetime purchases drops by the returned value;
      //    outstanding debt drops by the forgiven portion.
      if (sale.customerId) {
        const setExpr = {
          totalPurchases: sql`GREATEST(${customers.totalPurchases}::numeric - ${returnedValue}, 0)`,
          updatedAt: new Date(),
        };
        if (debtReduction > 0) {
          setExpr.totalDebt = sql`GREATEST(${customers.totalDebt}::numeric - ${debtReduction}, 0)`;
        }
        await tx.update(customers).set(setExpr).where(eq(customers.id, sale.customerId));
      }

      // 6. Installment adjustment: walk pending installments from highest
      //    number down, shrinking dueAmount/remainingAmount until the debt
      //    reduction is consumed. An installment whose remainingAmount drops
      //    to zero is marked 'cancelled' to stay consistent with cancel().
      if (debtReduction > 0 && sale.installments && sale.installments.length > 0) {
        let toAbsorb = debtReduction;
        const sortedPending = [...sale.installments]
          .filter((i) => i.status === 'pending' && i.remainingAmount > 0)
          .sort((a, b) => b.installmentNumber - a.installmentNumber);

        for (const inst of sortedPending) {
          if (toAbsorb <= 0) break;
          const reduceBy = Math.min(toAbsorb, inst.remainingAmount);
          const newRemaining = roundByCurrency(
            Math.max(0, inst.remainingAmount - reduceBy),
            currency
          );
          const newDue = roundByCurrency(
            Math.max(inst.paidAmount || 0, inst.dueAmount - reduceBy),
            currency
          );
          const newInstStatus = newRemaining <= 0 ? 'cancelled' : 'pending';
          await tx
            .update(installments)
            .set({
              dueAmount: String(newDue),
              remainingAmount: String(newRemaining),
              status: newInstStatus,
              updatedAt: new Date(),
            })
            .where(eq(installments.id, inst.id));
          toAbsorb -= reduceBy;
        }
      }

      return newReturn;
    });

    // 7. Audit trail — non-fatal if the audit service throws.
    try {
      await auditService.log({
        userId: actingUser?.id || null,
        username: actingUser?.username || null,
        action: 'sale:return_created',
        resource: 'sales',
        resourceId: sale.id,
        details: {
          returnId: result.id,
          returnedValue,
          refundAmount,
          debtReduction,
          refundMethod,
          itemCount: resolvedItems.length,
          reason: returnData.reason || null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[audit] sale:return_created skipped:', err.message);
    }

    alertBus.emit('alerts.changed', 'sale.returned');
    return await this.getById(saleId);
  }

  async createDraft(saleData, userId) {
    const db = await getDb();
    const currencySettings = await settingsService.getCurrencySettings();

    let totals = { subtotal: 0, discount: 0, tax: 0, total: 0 };
    if (saleData.items && saleData.items.length > 0) {
      totals = calculateSaleTotals(saleData.items, saleData.discount || 0, saleData.tax || 0);
    }

    // Drafts use a non-conflicting placeholder. A real invoice number is only
    // allocated from invoice_sequences when the draft is completed — so a
    // draft that never ships does not burn a number, and per-branch sequences
    // stay densely packed.
    const invoiceNumber = generateDraftInvoicePlaceholder();
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

    if (saleData.branchId) draftValues.branchId = saleData.branchId;
    if (saleData.warehouseId) draftValues.warehouseId = saleData.warehouseId;

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

  async completeDraft(draftId, saleData, user) {
    const actingUser = typeof user === 'object' && user !== null ? user : { id: user };
    const userId = actingUser.id;
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

    const draftCustomerId = saleData.customerId || draft.customerId || null;
    await enforceCreditLimit({
      customerId: draftCustomerId,
      total: finalTotal,
      user: actingUser,
      paymentType: saleData.paymentType || draft.paymentType,
    });

    const { branchId, warehouseId } = await resolveBranchWarehouse({
      branchId: actingUser?.assignedBranchId || saleData.branchId || draft.branchId,
      warehouseId: actingUser?.assignedWarehouseId || saleData.warehouseId || draft.warehouseId,
      actingUser,
    });

    // Mirror the cash-session enforcement from create() so completing a POS
    // cash draft requires an open shift.
    let cashSessionId = null;
    const draftPaymentMethod = saleData.paymentMethod || 'cash';
    const draftSaleSource = saleData.saleSource || draft.saleSource || null;
    const draftPaymentType = saleData.paymentType || draft.paymentType;
    const draftIsCashSale =
      draftSaleSource === SALE_SOURCE_POS &&
      draftPaymentType === 'cash' &&
      draftPaymentMethod === PAYMENT_METHOD_CASH &&
      Number(paidAmount) > 0;
    if (draftIsCashSale) {
      const session = await cashSessionService.findOpenSession(userId, branchId);
      if (!session) {
        throw new ValidationError(
          'No open cash session — open a shift before completing a cash sale',
          'CASH_SESSION_REQUIRED'
        );
      }
      cashSessionId = session.id;
    }

    const updatedSaleId = await withTransaction(async (tx) => {
      await tx.delete(saleItems).where(eq(saleItems.saleId, draftId));

      // Drafts arrive with a DRAFT- placeholder; promotion to a real invoice
      // happens here, inside the same transaction that flips status off
      // 'draft'. allocateInvoiceNumber holds a row lock on the sequence row
      // so two cashiers completing drafts at the same instant get distinct
      // numbers, and a rollback gives the number back.
      const { invoiceNumber, issuedAt } = await allocateInvoiceNumber(tx, branchId);

      const [updatedSale] = await tx
        .update(sales)
        .set({
          invoiceNumber,
          issuedAt,
          customerId: saleData.customerId || draft.customerId,
          branchId,
          warehouseId,
          cashSessionId,
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

      const stockItems = [];
      for (const item of saleData.items) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (!product) {
          throw new ValidationError(`Product with ID ${item.productId} not found`);
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

        stockItems.push({ productId: item.productId, quantity: item.quantity });
      }

      await InventoryService.applySaleStockMovement(tx, {
        saleId: updatedSale.id,
        warehouseId,
        items: stockItems,
        userId,
      });

      if (paidAmount > 0) {
        const customerId = saleData.customerId || draft.customerId || null;
        const method = saleData.paymentMethod || 'cash';
        await tx.insert(payments).values({
          saleId: updatedSale.id,
          customerId,
          amount: String(paidAmount),
          currency,
          exchangeRate: String(exchangeRate),
          paymentMethod: method,
          paymentReference: saleData.paymentReference || null,
          cashSessionId: method === PAYMENT_METHOD_CASH ? cashSessionId : null,
          createdBy: userId,
        });
      }

      const draftIsInstallment =
        saleData.paymentType === 'installment' ||
        saleData.paymentType === 'mixed' ||
        saleData.saleType === SALE_TYPE_INSTALLMENT;

      if (draftIsInstallment && saleData.installments && saleData.installments.length > 0) {
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

    alertBus.emit('alerts.changed', 'draft.completed');
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
