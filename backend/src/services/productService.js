import { getDb, getPool, saveDatabase } from '../db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  products,
  categories,
  productStock,
  productStockEntries,
  productUnits,
  stockMovements,
  warehouseTransfers,
  sales,
  saleItems,
  saleReturns,
  saleReturnItems,
} from '../models/index.js';
import * as schema from '../models/index.js';
import {
  NotFoundError,
  ConflictError,
  AppError,
  translateDbConstraintError,
} from '../utils/errors.js';
import { eq, and, ne, gte, lte, desc, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { buildSearch, ncol, RANK } from '../utils/searchBuilder.js';

const log = createLogger('ProductService');
import alertBus from '../events/alertBus.js';
import inventoryService from './inventoryService.js';
import {
  replaceProductUnits,
  ensureBaseUnit,
  listProductUnits,
} from './productUnitService.js';

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

// Numeric equality predicate for price search. Returns null for non-numeric
// terms so the target contributes nothing to the OR.
function priceEq(column, raw) {
  if (!/\d/.test(String(raw ?? ''))) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return sql`${column} = ${n}`;
}

// Declarative product search targets (consumed by the centralized buildSearch).
// Order is irrelevant — ranking is driven by `rank`. Covers req #2 fields:
// name, SKU, barcode, category name, unit, notes(description), purchase + sale
// price. (Brand intentionally omitted — no brand entity exists.)
const PRODUCT_SEARCH_TARGETS = [
  { label: 'barcode', rank: RANK.BARCODE_EXACT, kind: 'codeExact', norm: ncol('products', 'search_barcode'), value: products.barcode },
  { label: 'sku', rank: RANK.SKU_EXACT, kind: 'codeExact', norm: ncol('products', 'search_sku'), value: products.sku },
  { label: 'name', rank: RANK.NAME_EXACT, kind: 'textExact', norm: ncol('products', 'search_name'), value: products.name },
  { label: 'sku', rank: RANK.CODE_PARTIAL, kind: 'codePartial', norm: ncol('products', 'search_sku'), value: products.sku },
  { label: 'name', rank: RANK.NAME_PARTIAL, kind: 'textPartial', norm: ncol('products', 'search_name'), value: products.name },
  { label: 'category', rank: RANK.FIELD_MATCH, kind: 'textPartial', norm: ncol('categories', 'search_name'), value: categories.name },
  { label: 'unit', rank: RANK.FIELD_MATCH, kind: 'textPartial', norm: ncol('products', 'search_unit'), value: products.unit },
  { label: 'supplier', rank: RANK.FIELD_MATCH, kind: 'textPartial', norm: ncol('products', 'search_supplier'), value: products.supplier },
  { label: 'salePrice', rank: RANK.FIELD_MATCH, kind: 'custom', value: products.sellingPrice, predicate: ({ raw }) => priceEq(products.sellingPrice, raw) },
  { label: 'purchasePrice', rank: RANK.FIELD_MATCH, kind: 'custom', value: products.costPrice, predicate: ({ raw }) => priceEq(products.costPrice, raw) },
  { label: 'notes', rank: RANK.DETAILS, kind: 'textPartial', norm: ncol('products', 'search_description'), value: products.description },
];

export class ProductService {
  async create(productData, userId) {
    const db = await getDb();
    // Check for duplicate SKU
    if (productData.sku) {
      const [existing] = await db
        .select()
        .from(products)
        .where(eq(products.sku, productData.sku))
        .limit(1);

      if (existing) {
        throw new ConflictError('Product with this SKU already exists');
      }
    }

    // Pull units off the payload — they get persisted in product_units, not
    // on the products row itself.
    const { units: unitsInput, ...productOnly } = productData || {};

    // Stock quantity is intentionally NOT written here — opening balance must
    // be entered via the inventory movement API (`/inventory/adjust`) so an
    // auditable movement record is created. The frontend redirects the user to
    // that flow after a successful product create.
    const newProduct = await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          ...productOnly,
          createdBy: userId,
        })
        .returning();

      if (Array.isArray(unitsInput) && unitsInput.length > 0) {
        await replaceProductUnits(tx, created.id, unitsInput);
      } else {
        // No units supplied — guarantee a base unit so downstream flows
        // (inventory, sale, return) can always resolve a conversionFactor.
        await ensureBaseUnit(tx, created.id, productOnly.unit && productOnly.unit !== 'piece' ? productOnly.unit : 'قطعة');
      }
      return created;
    });

    // Pre-create per-warehouse stock rows (quantity 0). Inventory movements
    // own all subsequent updates to those rows.
    await inventoryService.ensureProductStockRows(newProduct.id);

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.created');

    // Hydrate units onto the response so the frontend can show them right
    // after create.
    const units = await listProductUnits(newProduct.id);
    return { ...newProduct, units };
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, search, categoryId, warehouseId, status, unit, minPrice, maxPrice } =
      filters;

    // Centralized, ranked, Arabic/English-aware search. Empty term => inactive,
    // and we fall back to the default catalogue list (req #11).
    const searchClause = buildSearch(PRODUCT_SEARCH_TARGETS, search);

    // Per-warehouse stock sub-select — returns 0 when no row exists yet.
    const warehouseStockSelect = warehouseId
      ? sql`COALESCE((
          SELECT ps.quantity FROM product_stock ps
          WHERE ps.product_id = ${products.id} AND ps.warehouse_id = ${Number(warehouseId)}
        ), 0)`
      : sql`0`;

    // Total stock across all warehouses (ignored if warehouseId provided to save cost, still cheap).
    const totalStockSelect = sql`COALESCE((
      SELECT SUM(ps.quantity) FROM product_stock ps WHERE ps.product_id = ${products.id}
    ), 0)`;

    // Build base query.
    //
    // Note: `stock` here is the legacy aggregate column on `products`. It is
    // never written from product create/update — the canonical stock figures
    // are `warehouseStock` (current warehouse) and `totalStock` (sum across
    // warehouses), both derived from `product_stock` rows. The legacy field is
    // returned as a cached fallback for older clients only.
    let baseQuery = db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        description: products.description,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        currency: products.currency,
        stock: totalStockSelect.as('stock'),
        warehouseStock: warehouseStockSelect.as('warehouseStock'),
        totalStock: totalStockSelect.as('totalStock'),
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        unit: products.unit,
        supplier: products.supplier,
        tracksExpiry: products.tracksExpiry,
        isActive: products.isActive,
        createdAt: products.createdAt,
        categoryId: products.categoryId,
        category: categories.name,
        status: products.status,
        // Search match metadata (req #18) — null/0 when not searching.
        matchedField: searchClause.active ? searchClause.matchedField : sql`NULL`,
        matchedValue: searchClause.active ? searchClause.matchedValue : sql`NULL`,
        rankScore: searchClause.active ? searchClause.rankScore : sql`0`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id));

    // Build WHERE conditions
    const whereConditions = [];

    if (searchClause.where) {
      whereConditions.push(searchClause.where);
    }

    if (categoryId) {
      whereConditions.push(eq(products.categoryId, categoryId));
    }

    if (status) {
      whereConditions.push(eq(products.status, status));
    }

    if (unit) {
      whereConditions.push(eq(products.unit, unit));
    }

    // Sale-price range filter (req #14).
    if (minPrice !== undefined && minPrice !== null && minPrice !== '') {
      whereConditions.push(gte(products.sellingPrice, String(Number(minPrice))));
    }
    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
      whereConditions.push(lte(products.sellingPrice, String(Number(maxPrice))));
    }

    // Apply WHERE clause
    if (whereConditions.length > 0) {
      if (whereConditions.length === 1) {
        baseQuery = baseQuery.where(whereConditions[0]);
      } else {
        baseQuery = baseQuery.where(and(...whereConditions));
      }
    }

    // Get total count for pagination metadata. The category join is required
    // because the search predicate may reference categories.search_name.
    let countQuery = db
      .select({ count: sql`count(*)` })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id));
    if (whereConditions.length > 0) {
      if (whereConditions.length === 1) {
        countQuery = countQuery.where(whereConditions[0]);
      } else {
        countQuery = countQuery.where(and(...whereConditions));
      }
    }
    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // When searching, surface the strongest matches first (req #9); otherwise
    // keep the default newest-first ordering.
    const orderBy = searchClause.active
      ? [desc(searchClause.rankScore), desc(products.createdAt)]
      : [desc(products.createdAt)];

    // PostgreSQL handles LIMIT/OFFSET with JOINs correctly
    const results = await baseQuery
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    // Hydrate units in a single round-trip so the catalogue can render unit
    // pickers without per-row API calls.
    const productIds = results.map((r) => r.id);
    let unitsByProduct = new Map();
    if (productIds.length > 0) {
      const unitRows = await db
        .select()
        .from(productUnits)
        .where(sql`${productUnits.productId} IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`);
      for (const u of unitRows) {
        const list = unitsByProduct.get(u.productId) || [];
        list.push({
          id: u.id,
          productId: u.productId,
          name: u.name,
          conversionFactor: Number(u.conversionFactor) || 1,
          isBase: !!u.isBase,
          isDefaultSale: !!u.isDefaultSale,
          isDefaultPurchase: !!u.isDefaultPurchase,
          barcode: u.barcode || null,
          salePrice: u.salePrice == null ? null : Number(u.salePrice),
          costPrice: u.costPrice == null ? null : Number(u.costPrice),
          isActive: u.isActive !== false,
        });
        unitsByProduct.set(u.productId, list);
      }
      for (const list of unitsByProduct.values()) {
        list.sort((a, b) => {
          if (a.isBase && !b.isBase) return -1;
          if (!a.isBase && b.isBase) return 1;
          return (a.id || 0) - (b.id || 0);
        });
      }
    }

    return {
      data: results.map((r) => ({ ...r, units: unitsByProduct.get(r.id) || [] })),
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
    // Stock is intentionally a derived value, not a column on `products`.
    const totalStockSelect = sql`COALESCE((
      SELECT SUM(ps.quantity) FROM product_stock ps WHERE ps.product_id = ${products.id}
    ), 0)`;

    const [product] = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        categoryId: products.categoryId,
        description: products.description,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        currency: products.currency,
        stock: totalStockSelect.as('stock'),
        totalStock: totalStockSelect.as('totalStock'),
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        unit: products.unit,
        supplier: products.supplier,
        tracksExpiry: products.tracksExpiry,
        isActive: products.isActive,
        status: products.status,
        createdAt: products.createdAt,
        category: categories.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id))
      .limit(1);

    if (!product) {
      throw new NotFoundError('Product');
    }

    const units = await listProductUnits(id);

    return {
      ...product,
      costPrice: Number(product.costPrice) || 0,
      sellingPrice: Number(product.sellingPrice) || 0,
      stock: Number(product.stock) || 0,
      totalStock: Number(product.totalStock) || 0,
      units,
    };
  }

  async update(id, productData) {
    // Defensive scrub: even though the controller already rejects
    // quantity-like keys, never let them reach the products row from any
    // future caller path (internal jobs, scripts, etc.).
    const {
      stock: _stock,
      quantity: _quantity,
      qty: _qty,
      stockQuantity: _stockQuantity,
      currentStock: _currentStock,
      inStock: _inStock,
      openingStock: _openingStock,
      openingWarehouseId: _openingWarehouseId,
      units: unitsInput,
      ...safeUpdate
    } = productData || {};

    const updated = await withTransaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set({
          ...safeUpdate,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning();

      if (!row) {
        throw new NotFoundError('Product');
      }

      if (Array.isArray(unitsInput)) {
        await replaceProductUnits(tx, row.id, unitsInput);
      } else {
        await ensureBaseUnit(tx, row.id, safeUpdate.unit && safeUpdate.unit !== 'piece' ? safeUpdate.unit : 'قطعة');
      }
      return row;
    });

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.updated');

    const units = await listProductUnits(updated.id);
    return { ...updated, units };
  }

  /**
   * Permanently (hard) delete a product, but ONLY when it is not referenced by
   * any *active* data. Runs inside one transaction with automatic rollback.
   *
   * "Active" = a non-cancelled sale/return line, or a pending warehouse
   * transfer. A product that appears solely inside CANCELLED invoices is
   * deletable: those invoices are preserved for archival/audit, and their line
   * items keep a frozen product snapshot (product_name/sku/barcode/unit_name/
   * unit_price) so they render correctly after the product row is gone.
   *
   * Tables that reference `products.id` and what happens to them on delete:
   *   sale_items           → product_id set to NULL (row + snapshot preserved)
   *   sale_return_items    → product_id set to NULL (row + snapshot preserved)
   *   warehouse_transfers  → deleted (only resolved/historical ones remain)
   *   stock_movements      → deleted
   *   product_stock_entries→ deleted (cascades sale_item_stock_entries)
   *   product_stock        → deleted
   *   product_units        → deleted (kept sale lines' unit_id → SET NULL)
   */
  async delete(id) {
    const db = await getDb();
    const productId = Number(id);

    const [existing] = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.id, productId));

    if (!existing) {
      throw new NotFoundError('Product');
    }

    // ── Active-reference check ────────────────────────────────────────────
    // Sale lines on any non-cancelled invoice (pending/completed/returned/
    // partially_returned/draft) count as active. We count DISTINCT invoices so
    // the user-facing message can state exactly how many invoices block the
    // deletion.
    const [activeSaleRow] = await db
      .select({ invoices: sql`COUNT(DISTINCT ${saleItems.saleId})` })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(and(eq(saleItems.productId, productId), ne(sales.status, 'cancelled')));

    // Return lines tied to a non-cancelled sale.
    const [activeReturnRow] = await db
      .select({ count: sql`COUNT(*)` })
      .from(saleReturnItems)
      .innerJoin(saleReturns, eq(saleReturnItems.returnId, saleReturns.id))
      .innerJoin(sales, eq(saleReturns.saleId, sales.id))
      .where(and(eq(saleReturnItems.productId, productId), ne(sales.status, 'cancelled')));

    // Pending (not yet approved/rejected) stock transfers are live operations.
    const [pendingTransferRow] = await db
      .select({ count: sql`COUNT(*)` })
      .from(warehouseTransfers)
      .where(
        and(eq(warehouseTransfers.productId, productId), eq(warehouseTransfers.status, 'pending'))
      );

    const activeInvoices = Number(activeSaleRow?.invoices) || 0;
    const activeReturns = Number(activeReturnRow?.count) || 0;
    const pendingTransfers = Number(pendingTransferRow?.count) || 0;

    if (activeInvoices > 0 || activeReturns > 0 || pendingTransfers > 0) {
      // When the blocker is sales invoices, name the count; otherwise fall back
      // to the generic "registered invoices or operations" wording.
      const message =
        activeInvoices > 0
          ? `لا يمكن حذف هذا المنتج لأنه مرتبط بـ ${activeInvoices} فاتورة مسجلة داخل النظام.`
          : 'لا يمكن حذف هذا المنتج لأنه مستخدم في فواتير أو عمليات مسجلة داخل النظام.';
      const error = new ConflictError(message);
      error.code = 'PRODUCT_IN_ACTIVE_USE';
      error.details = {
        productId,
        activeInvoices,
        activeReturnItems: activeReturns,
        pendingTransfers,
      };
      throw error;
    }

    // ── Hard delete (atomic, rolls back on any error) ─────────────────────
    try {
      await withTransaction(async (tx) => {
        // Preserve cancelled-invoice archives: detach the product from the line
        // items but keep the rows and their snapshot intact.
        await tx
          .update(saleItems)
          .set({ productId: null })
          .where(eq(saleItems.productId, productId));
        await tx
          .update(saleReturnItems)
          .set({ productId: null })
          .where(eq(saleReturnItems.productId, productId));

        // Remove the product's owned operational data.
        await tx.delete(warehouseTransfers).where(eq(warehouseTransfers.productId, productId));
        await tx.delete(stockMovements).where(eq(stockMovements.productId, productId));
        await tx.delete(productStockEntries).where(eq(productStockEntries.productId, productId));
        await tx.delete(productStock).where(eq(productStock.productId, productId));
        await tx.delete(productUnits).where(eq(productUnits.productId, productId));

        // Finally the product row itself.
        const [deleted] = await tx
          .delete(products)
          .where(eq(products.id, productId))
          .returning();
        if (!deleted) {
          throw new NotFoundError('Product');
        }
      });
    } catch (err) {
      // Already user-facing (NotFound/Conflict/…) — surface as-is.
      if (err instanceof AppError) throw err;
      // Otherwise log the FULL technical error and return a clean Arabic
      // message. A lingering FK reference (e.g. a table added later without a
      // pre-check above) maps to the same "in use" wording instead of leaking
      // a database constraint error to the user.
      log.error('Hard delete of product failed', err);
      throw (
        translateDbConstraintError(err, {
          fkMessage: 'لا يمكن حذف هذا المنتج لأنه مستخدم في فواتير أو عمليات مسجلة داخل النظام.',
        }) || new AppError('تعذّر حذف المنتج بسبب خطأ غير متوقع. يرجى المحاولة مرة أخرى.', 500)
      );
    }

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.deleted');

    return { message: 'Product deleted successfully' };
  }

  async getLowStock(warehouseId) {
    // If a warehouseId is provided, delegate to inventoryService which joins
    // with product_stock and applies the per-warehouse threshold.
    if (warehouseId) {
      return await inventoryService.getLowStockProducts(Number(warehouseId));
    }

    // Without a warehouse, aggregate stock per product from `product_stock`
    // and compare against the product's threshold. We never read the legacy
    // `products.stock` column for this — that field is no longer authoritative.
    const db = await getDb();
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        unit: products.unit,
        sellingPrice: products.sellingPrice,
        currency: products.currency,
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        isActive: products.isActive,
        stock: sql`COALESCE(SUM(${productStock.quantity}), 0)`.as('stock'),
      })
      .from(products)
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.id);

    return rows
      .map((r) => ({ ...r, stock: Number(r.stock) || 0 }))
      .filter((r) => {
        const threshold =
          r.lowStockThreshold && r.lowStockThreshold > 0
            ? r.lowStockThreshold
            : r.minStock || 0;
        return r.stock <= threshold;
      });
  }
}
