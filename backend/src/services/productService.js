import { getDb, saveDatabase } from '../db.js';
import { products, categories } from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { eq, like, or, and, desc, lte, sql, inArray } from 'drizzle-orm';
import alertBus from '../events/alertBus.js';

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

    const [newProduct] = await db
      .insert(products)
      .values({
        ...productData,
        createdBy: userId,
      })
      .returning();

    saveDatabase();
    alertBus.emit('alerts.changed', 'product.created');

    return newProduct;
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, search, categoryId } = filters;
    
    // Normalize search - treat empty strings as undefined
    const normalizedSearch = search && search.trim() ? search.trim() : undefined;

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
        stock: products.stock,
        minStock: products.minStock,
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

  async getLowStock() {
    const db = await getDb();
    const lowStockProducts = await db
      .select()
      .from(products)
      .where((products) => lte(products.stock, products.minStock));

    return lowStockProducts;
  }
}
