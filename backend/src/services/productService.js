import { getDb, saveDatabase } from '../db.js';
import { products, categories, productStock, warehouses } from '../models/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { eq, like, or, and, desc, lte, sql, inArray } from 'drizzle-orm';
import alertBus from '../events/alertBus.js';
import inventoryService, { InventoryService } from './inventoryService.js';

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

    // Extract opening stock (supports either a single warehouseId or the first
    // active warehouse) — the legacy `stock` field is written to products.stock
    // for backward-compat and as an opening_balance movement.
    const openingQty = Number(productData.stock || 0);
    const openingWarehouseId = productData.openingWarehouseId || null;

    const [newProduct] = await db
      .insert(products)
      .values({
        ...productData,
        createdBy: userId,
      })
      .returning();

    // Ensure per-warehouse stock rows exist for the new product
    await inventoryService.ensureProductStockRows(newProduct.id);

    if (openingQty > 0) {
      let targetWarehouseId = openingWarehouseId;
      if (!targetWarehouseId) {
        const [wh] = await db
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(eq(warehouses.isActive, true))
          .orderBy(warehouses.id)
          .limit(1);
        targetWarehouseId = wh?.id || null;
      }
      if (targetWarehouseId) {
        await InventoryService.withTransaction((tx) =>
          InventoryService.applyStockChangeTx(tx, {
            productId: newProduct.id,
            warehouseId: targetWarehouseId,
            quantityChange: openingQty,
            movementType: 'opening_balance',
            referenceType: 'product',
            referenceId: newProduct.id,
            notes: 'Opening balance on product creation',
            userId,
          })
        );
      }
    }

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

    // Build base query
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
        stock: products.stock, // legacy field — keep for backward compat
        warehouseStock: warehouseStockSelect.as('warehouseStock'),
        totalStock: totalStockSelect.as('totalStock'),
        minStock: products.minStock,
        lowStockThreshold: products.lowStockThreshold,
        unit: products.unit,
        supplier: products.supplier,
        isActive: products.isActive,
        createdAt: products.createdAt,
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
        stock: products.stock,
        minStock: products.minStock,
        unit: products.unit,
        supplier: products.supplier,
        isActive: products.isActive,
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
    };
  }

  async update(id, productData) {
    const db = await getDb();
    const [updated] = await db
      .update(products)
      .set({
        ...productData,
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

  async updateStock(productId, quantity) {
    const db = await getDb();
    const product = await this.getById(productId);

    const [updated] = await db
      .update(products)
      .set({
        stock: product.stock + quantity,
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId))
      .returning();

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.stock_updated');

    return updated;
  }

  async getLowStock(warehouseId) {
    // If a warehouseId is provided, delegate to inventoryService which joins
    // with product_stock and applies the per-warehouse threshold.
    if (warehouseId) {
      return await inventoryService.getLowStockProducts(Number(warehouseId));
    }

    // Legacy fallback: use products.stock vs minStock
    const db = await getDb();
    const lowStockProducts = await db
      .select()
      .from(products)
      .where((products) => lte(products.stock, products.minStock));

    return lowStockProducts;
  }
}
