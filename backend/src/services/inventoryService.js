import { getDb, getPool } from '../db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  productStock,
  stockMovements,
  products,
  productStockEntries,
  saleItemStockEntries,
  warehouses,
  branches,
  users,
} from '../models/index.js';
import * as schema from '../models/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import alertBus from '../events/alertBus.js';

/**
 * Simple multi-branch / multi-warehouse inventory service.
 * All stock mutations go through this module so movements are always recorded
 * and stock rows never diverge from the movement log.
 */

/** Run a callback inside a PostgreSQL transaction. */
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
 * Lock the product_stock row for (product, warehouse), creating it if missing.
 * Returns the current quantity. Must be called inside a transaction.
 */
async function lockOrCreateStockRow(tx, productId, warehouseId) {
  const [existing] = await tx
    .select()
    .from(productStock)
    .where(
      and(eq(productStock.productId, productId), eq(productStock.warehouseId, warehouseId))
    )
    .for('update')
    .limit(1);

  if (existing) return existing;

  // Insert; on conflict (another tx inserted first), select the row.
  await tx
    .insert(productStock)
    .values({ productId, warehouseId, quantity: 0 })
    .onConflictDoNothing({
      target: [productStock.productId, productStock.warehouseId],
    });

  const [row] = await tx
    .select()
    .from(productStock)
    .where(
      and(eq(productStock.productId, productId), eq(productStock.warehouseId, warehouseId))
    )
    .for('update')
    .limit(1);
  return row;
}

/**
 * Apply a stock change inside an active transaction.
 * Centralised so every caller records a movement and keeps product_stock in sync.
 */
async function applyStockChangeTx(
  tx,
  {
    productId,
    warehouseId,
    quantityChange, // positive = in, negative = out
    movementType,
    referenceType = null,
    referenceId = null,
    notes = null,
    userId = null,
    allowNegative = false,
  }
) {
  if (!productId || !warehouseId) {
    throw new ValidationError('productId and warehouseId are required');
  }
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    throw new ValidationError('quantityChange must be a non-zero integer');
  }

  const current = await lockOrCreateStockRow(tx, productId, warehouseId);
  const quantityBefore = current.quantity;
  const quantityAfter = quantityBefore + quantityChange;

  if (!allowNegative && quantityAfter < 0) {
    const [product] = await tx
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    throw new ValidationError(
      `Insufficient stock for ${product?.name || 'product'}. Available: ${quantityBefore}, required: ${-quantityChange}`
    );
  }

  await tx
    .update(productStock)
    .set({ quantity: quantityAfter, updatedAt: new Date() })
    .where(eq(productStock.id, current.id));

  await tx.insert(stockMovements).values({
    productId,
    warehouseId,
    movementType,
    quantityChange,
    quantityBefore,
    quantityAfter,
    referenceType,
    referenceId,
    notes: notes || null,
    createdBy: userId || null,
  });

  return { quantityBefore, quantityAfter };
}

export class InventoryService {
  /** Expose transaction helper for callers (e.g. saleService). */
  static withTransaction(cb) {
    return withTransaction(cb);
  }

  /** Expose the low-level apply helper so saleService can reuse it in its own tx. */
  static applyStockChangeTx(tx, payload) {
    return applyStockChangeTx(tx, payload);
  }

  async getStock(productId, warehouseId) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(productStock)
      .where(
        and(eq(productStock.productId, productId), eq(productStock.warehouseId, warehouseId))
      )
      .limit(1);
    return row ? row.quantity : 0;
  }

  /**
   * Return stock rows for a warehouse joined with product info.
   * `lowStockOnly` filters to rows where quantity <= low_stock_threshold (or minStock).
   */
  async getWarehouseStock(warehouseId, { search, lowStockOnly = false } = {}) {
    const db = await getDb();

    const rows = await db
      .select({
        productId: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        unit: products.unit,
        sellingPrice: products.sellingPrice,
        currency: products.currency,
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        tracksExpiry: products.tracksExpiry,
        quantity: sql`COALESCE(${productStock.quantity}, 0)`.as('quantity'),
        warehouseId: sql`${warehouseId}::int`.as('warehouseId'),
      })
      .from(products)
      .leftJoin(
        productStock,
        and(eq(productStock.productId, products.id), eq(productStock.warehouseId, warehouseId))
      )
      .where(eq(products.isActive, true));

    const threshold = (r) =>
      r.lowStockThreshold != null && r.lowStockThreshold > 0 ? r.lowStockThreshold : r.minStock || 0;

    let filtered = rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity) || 0,
      isLowStock: Number(r.quantity) <= threshold(r),
    }));

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.name || '').toLowerCase().includes(q) ||
          (r.sku || '').toLowerCase().includes(q) ||
          (r.barcode || '').toLowerCase().includes(q)
      );
    }

    if (lowStockOnly) filtered = filtered.filter((r) => r.isLowStock);

    return filtered;
  }

  /** Total stock for a product across all active warehouses. */
  async getProductTotals(productId) {
    const db = await getDb();
    const [row] = await db
      .select({ total: sql`COALESCE(SUM(${productStock.quantity}), 0)` })
      .from(productStock)
      .where(eq(productStock.productId, productId));

    const perWarehouse = await db
      .select({
        warehouseId: productStock.warehouseId,
        warehouseName: warehouses.name,
        branchName: branches.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        quantity: productStock.quantity,
      })
      .from(productStock)
      .leftJoin(warehouses, eq(productStock.warehouseId, warehouses.id))
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .where(eq(productStock.productId, productId));

    return {
      total: Number(row?.total || 0),
      perWarehouse,
    };
  }

  /**
   * Manual adjustment — increases or decreases stock for (productId, warehouseId).
   * @param {{productId, warehouseId, quantityChange, reason, allowNegative?, userId?}} input
   */
  async adjustStock(input) {
    const {
      productId,
      warehouseId,
      quantityChange,
      reason,
      costPrice,
      expiryDate,
      allowNegative = false,
      userId = null,
    } = input;

    if (!reason || !reason.trim()) {
      throw new ValidationError('Adjustment reason is required');
    }
    if (!Number.isInteger(quantityChange) || quantityChange === 0) {
      throw new ValidationError('Quantity change must be a non-zero integer');
    }

    const movementType =
      quantityChange > 0 ? 'manual_adjustment_in' : 'manual_adjustment_out';

    const result = await withTransaction((tx) =>
      applyStockChangeTx(tx, {
        productId,
        warehouseId,
        quantityChange,
        movementType,
        referenceType: 'adjustment',
        notes: reason.trim(),
        userId,
        allowNegative,
      }).then(async (movementResult) => {
        if (quantityChange > 0) {
          const [product] = await tx
            .select({ costPrice: products.costPrice })
            .from(products)
            .where(eq(products.id, productId))
            .limit(1);
          await tx.insert(productStockEntries).values({
            productId,
            warehouseId,
            quantity: quantityChange,
            remainingQuantity: quantityChange,
            costPrice: String(costPrice || product?.costPrice || 0),
            expiryDate: expiryDate || null,
            status: 'active',
            createdBy: userId || null,
          });
        }
        return movementResult;
      })
    );

    alertBus.emit('alerts.changed', 'inventory.adjusted');
    return result;
  }

  /**
   * Transfer between warehouses in the same transaction.
   * Emits transfer_out + transfer_in movements linked by the same referenceId.
   */
  async transferStock({ fromWarehouseId, toWarehouseId, productId, quantity, notes, userId }) {
    if (!fromWarehouseId || !toWarehouseId) {
      throw new ValidationError('Both source and destination warehouses are required');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new ValidationError('Source and destination warehouses must differ');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Transfer quantity must be a positive integer');
    }

    return withTransaction(async (tx) => {
      // Deterministic lock order by warehouse id to avoid deadlocks
      const [firstId, secondId] = [fromWarehouseId, toWarehouseId].sort((a, b) => a - b);
      await lockOrCreateStockRow(tx, productId, firstId);
      await lockOrCreateStockRow(tx, productId, secondId);

      // Use `createdAt` timestamp + source warehouse id as the shared reference
      // for now; good enough without introducing a dedicated transfers table.
      const referenceId = Date.now() % 2_147_483_647;

      const out = await applyStockChangeTx(tx, {
        productId,
        warehouseId: fromWarehouseId,
        quantityChange: -quantity,
        movementType: 'transfer_out',
        referenceType: 'transfer',
        referenceId,
        notes: notes || null,
        userId,
      });
      const incoming = await applyStockChangeTx(tx, {
        productId,
        warehouseId: toWarehouseId,
        quantityChange: quantity,
        movementType: 'transfer_in',
        referenceType: 'transfer',
        referenceId,
        notes: notes || null,
        userId,
      });
      await InventoryService.moveStockEntriesTx(tx, {
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity,
        userId,
      });

      alertBus.emit('alerts.changed', 'inventory.transferred');
      return { referenceId, out, in: incoming };
    });
  }

  /**
   * Apply the stock movements for a completed sale inside an existing transaction.
   * Called from saleService.create / completeDraft / restore.
   */
  static async applySaleStockMovement(tx, { saleId, warehouseId, items, userId }) {
    if (!warehouseId) throw new ValidationError('Sale must have a warehouseId for stock tracking');
    for (const item of items) {
      if (!item.productId) continue;
      let need = Number(item.quantity) || 0;
      const today = new Date().toISOString().slice(0, 10);
      let entries = await tx
        .select()
        .from(productStockEntries)
        .where(
          and(
            eq(productStockEntries.productId, item.productId),
            eq(productStockEntries.warehouseId, warehouseId),
            sql`${productStockEntries.remainingQuantity} > 0`
          )
        )
        .orderBy(sql`${productStockEntries.expiryDate} asc nulls last`)
        .for('update');
      if (entries.length === 0) {
        const [legacy] = await tx
          .select({ quantity: productStock.quantity, costPrice: products.costPrice })
          .from(productStock)
          .leftJoin(products, eq(productStock.productId, products.id))
          .where(and(eq(productStock.productId, item.productId), eq(productStock.warehouseId, warehouseId)))
          .limit(1)
          .for('update');
        if (legacy && Number(legacy.quantity) > 0) {
          await tx.insert(productStockEntries).values({
            productId: item.productId,
            warehouseId,
            quantity: Number(legacy.quantity),
            remainingQuantity: Number(legacy.quantity),
            costPrice: String(legacy.costPrice || 0),
            expiryDate: null,
            status: 'active',
            createdBy: userId || null,
          });
          entries = await tx
            .select()
            .from(productStockEntries)
            .where(and(eq(productStockEntries.productId, item.productId), eq(productStockEntries.warehouseId, warehouseId), sql`${productStockEntries.remainingQuantity} > 0`))
            .orderBy(sql`${productStockEntries.expiryDate} asc nulls last`)
            .for('update');
        }
      }
      for (const e of entries) {
        if (need <= 0) break;
        if (e.expiryDate && e.expiryDate < today) continue;
        const take = Math.min(need, Number(e.remainingQuantity || 0));
        if (take <= 0) continue;
        const updated = await tx.execute(sql`
          UPDATE product_stock_entries
          SET remaining_quantity = remaining_quantity - ${take},
              status = CASE WHEN (remaining_quantity - ${take}) <= 0 THEN 'depleted' ELSE 'active' END,
              updated_at = now()
          WHERE id = ${e.id}
            AND remaining_quantity >= ${take}
          RETURNING id, remaining_quantity
        `);
        const updatedRows = updated.rows ?? updated;
        if (!updatedRows || updatedRows.length === 0) {
          throw new ValidationError('الكمية الصالحة للبيع غير كافية');
        }
        if (item.saleItemId) {
          await tx.insert(saleItemStockEntries).values({
            saleItemId: item.saleItemId,
            productStockEntryId: e.id,
            quantity: take,
          });
        }
        need -= take;
      }
      if (need > 0) {
        throw new ValidationError('لا توجد كمية صالحة للبيع لهذا المنتج');
      }
      await applyStockChangeTx(tx, {
        productId: item.productId,
        warehouseId,
        quantityChange: -item.quantity,
        movementType: 'sale',
        referenceType: 'sale',
        referenceId: saleId,
        notes: null,
        userId,
      });
    }
  }

  async getExpiryAlerts({ warehouseId, productId, status } = {}) {
    const db = await getDb();
    const rows = await db
      .select({
        id: productStockEntries.id,
        productId: productStockEntries.productId,
        productName: products.name,
        warehouseId: productStockEntries.warehouseId,
        warehouseName: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        remainingQuantity: productStockEntries.remainingQuantity,
        expiryDate: productStockEntries.expiryDate,
        costPrice: productStockEntries.costPrice,
      })
      .from(productStockEntries)
      .leftJoin(products, eq(productStockEntries.productId, products.id))
      .leftJoin(warehouses, eq(productStockEntries.warehouseId, warehouses.id))
      .leftJoin(branches, eq(warehouses.branchId, branches.id));
    const today = new Date(); today.setHours(0,0,0,0);
    return rows
      .filter((r) => (!warehouseId || r.warehouseId === warehouseId) && (!productId || r.productId === productId))
      .map((r) => {
        const days = r.expiryDate ? Math.floor((new Date(r.expiryDate) - today) / 86400000) : null;
        const expiryStatus = r.expiryDate == null ? 'بدون تاريخ انتهاء' : days < 0 ? 'منتهي' : days <= 7 ? 'ينتهي خلال 7 أيام' : days <= 30 ? 'ينتهي خلال 30 يوم' : days <= 60 ? 'ينتهي خلال 60 يوم' : 'صالح';
        return { ...r, daysUntilExpiry: days, status: expiryStatus };
      })
      .filter((r) => !status || r.status === status);
  }

  /** Restore stock from a cancelled or returned sale. */
  static async restoreSaleStockMovement(
    tx,
    { saleId, warehouseId, items, userId, movementType = 'sale_cancel' }
  ) {
    if (!warehouseId) return; // Legacy sales without a warehouse — skip silently
    for (const item of items) {
      if (!item.productId) continue;
      await applyStockChangeTx(tx, {
        productId: item.productId,
        warehouseId,
        quantityChange: item.quantity,
        movementType,
        referenceType: 'sale',
        referenceId: saleId,
        notes: null,
        userId,
        allowNegative: true, // restoring never fails on availability
      });
    }
  }

  static async moveStockEntriesTx(tx, { productId, fromWarehouseId, toWarehouseId, quantity, userId }) {
    let need = Number(quantity) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const entries = await tx
      .select()
      .from(productStockEntries)
      .where(
        and(
          eq(productStockEntries.productId, productId),
          eq(productStockEntries.warehouseId, fromWarehouseId),
          sql`${productStockEntries.remainingQuantity} > 0`,
          sql`(${productStockEntries.expiryDate} IS NULL OR ${productStockEntries.expiryDate} >= ${today})`,
          sql`${productStockEntries.status} = 'active'`
        )
      )
      .orderBy(sql`${productStockEntries.expiryDate} asc nulls last`)
      .for('update');
    for (const e of entries) {
      if (need <= 0) break;
      const take = Math.min(need, Number(e.remainingQuantity) || 0);
      if (take <= 0) continue;
      const out = await tx.execute(sql`
        UPDATE product_stock_entries
        SET remaining_quantity = remaining_quantity - ${take},
            status = CASE WHEN (remaining_quantity - ${take}) <= 0 THEN 'depleted' ELSE 'active' END,
            updated_at = now()
        WHERE id = ${e.id} AND remaining_quantity >= ${take}
        RETURNING id
      `);
      const outRows = out.rows ?? out;
      if (!outRows || outRows.length === 0) throw new ValidationError('Transfer quantity is no longer available');
      await tx.insert(productStockEntries).values({
        productId,
        warehouseId: toWarehouseId,
        quantity: take,
        remainingQuantity: take,
        costPrice: e.costPrice,
        expiryDate: e.expiryDate || null,
        status: 'active',
        createdBy: userId || null,
      });
      need -= take;
    }
    if (need > 0) throw new ValidationError('Insufficient valid stock for transfer');
  }

  /** Return movements with optional filters and simple pagination. */
  async getStockMovements(filters = {}) {
    const db = await getDb();
    const {
      warehouseId,
      warehouseIds,
      productId,
      movementType,
      page = 1,
      limit = 20,
    } = filters;

    const conds = [];
    if (warehouseId) conds.push(eq(stockMovements.warehouseId, warehouseId));
    if (!warehouseId && Array.isArray(warehouseIds) && warehouseIds.length > 0) {
      conds.push(inArray(stockMovements.warehouseId, warehouseIds));
    }
    if (productId) conds.push(eq(stockMovements.productId, productId));
    if (movementType) conds.push(eq(stockMovements.movementType, movementType));

    let countQuery = db.select({ count: sql`count(*)` }).from(stockMovements);
    if (conds.length) countQuery = countQuery.where(and(...conds));
    const [countRow] = await countQuery;
    const total = Number(countRow?.count || 0);

    const offset = (page - 1) * limit;

    let q = db
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        productName: products.name,
        warehouseId: stockMovements.warehouseId,
        warehouseName: warehouses.name,
        movementType: stockMovements.movementType,
        quantityChange: stockMovements.quantityChange,
        quantityBefore: stockMovements.quantityBefore,
        quantityAfter: stockMovements.quantityAfter,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        notes: stockMovements.notes,
        createdAt: stockMovements.createdAt,
        createdByName: users.username,
      })
      .from(stockMovements)
      .leftJoin(products, eq(stockMovements.productId, products.id))
      .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
      .leftJoin(users, eq(stockMovements.createdBy, users.id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(limit)
      .offset(offset);

    if (conds.length) q = q.where(and(...conds));

    const data = await q;
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Return products at or below threshold in a given warehouse. */
  async getLowStockProducts(warehouseId) {
    if (!warehouseId) throw new ValidationError('warehouseId is required');
    const all = await this.getWarehouseStock(warehouseId);
    return all.filter((r) => r.isLowStock);
  }

  /** Ensure a product_stock row exists for every active warehouse. Used on product creation. */
  async ensureProductStockRows(productId) {
    const db = await getDb();
    const activeWarehouses = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.isActive, true));
    if (!activeWarehouses.length) return;

    await db
      .insert(productStock)
      .values(activeWarehouses.map((w) => ({ productId, warehouseId: w.id, quantity: 0 })))
      .onConflictDoNothing({
        target: [productStock.productId, productStock.warehouseId],
      });
  }
}

export default new InventoryService();
