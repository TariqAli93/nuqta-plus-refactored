import { getDb, saveDatabase } from '../db.js';
import { products, categories, productStock } from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { eq, like, or, and, desc, sql } from 'drizzle-orm';
import alertBus from '../events/alertBus.js';
import inventoryService from './inventoryService.js';

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

    // Stock quantity is intentionally NOT written here — opening balance must
    // be entered via the inventory movement API (`/inventory/adjust`) so an
    // auditable movement record is created. The frontend redirects the user to
    // that flow after a successful product create.
    const [newProduct] = await db
      .insert(products)
      .values({
        ...productData,
        createdBy: userId,
      })
      .returning();

    // Pre-create per-warehouse stock rows (quantity 0). Inventory movements
    // own all subsequent updates to those rows.
    await inventoryService.ensureProductStockRows(newProduct.id);

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.created');

    return newProduct;
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, search, categoryId, warehouseId } = filters;

    // Normalize search - treat empty strings as undefined
    const normalizedSearch = search && search.trim() ? search.trim() : undefined;

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
        isActive: products.isActive,
        createdAt: products.createdAt,
        categoryId: products.categoryId,
        category: categories.name,
        status: products.status,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id));

    // Build WHERE conditions
    const whereConditions = [];

    if (normalizedSearch) {
      whereConditions.push(
        or(
          like(products.name, `%${normalizedSearch}%`),
          like(products.sku, `%${normalizedSearch}%`),
          like(products.barcode, `%${normalizedSearch}%`)
        )
      );
    }

    if (categoryId) {
      whereConditions.push(eq(products.categoryId, categoryId));
    }

    // Apply WHERE clause
    if (whereConditions.length > 0) {
      if (whereConditions.length === 1) {
        baseQuery = baseQuery.where(whereConditions[0]);
      } else {
        baseQuery = baseQuery.where(and(...whereConditions));
      }
    }

    // Get total count for pagination metadata
    let countQuery = db.select({ count: sql`count(*)` }).from(products);
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

    // PostgreSQL handles LIMIT/OFFSET with JOINs correctly
    const results = await baseQuery
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

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

    return {
      ...product,
      costPrice: Number(product.costPrice) || 0,
      sellingPrice: Number(product.sellingPrice) || 0,
      stock: Number(product.stock) || 0,
      totalStock: Number(product.totalStock) || 0,
    };
  }

  async update(id, productData) {
    const db = await getDb();
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
      ...safeUpdate
    } = productData || {};

    const [updated] = await db
      .update(products)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Product');
    }

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.updated');

    return updated;
  }

  async delete(id) {
    const db = await getDb();
    const [deleted] = await db.delete(products).where(eq(products.id, id)).returning();

    if (!deleted) {
      throw new NotFoundError('Product');
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
