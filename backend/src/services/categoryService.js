import { getDb, saveDatabase } from '../db.js';
import { categories, products } from '../models/index.js';
import {
  NotFoundError,
  ConflictError,
  AppError,
  translateDbConstraintError,
} from '../utils/errors.js';
import { eq, like, desc, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CategoryService');

export class CategoryService {
  async create(categoryData) {
    const db = await getDb();
    // Check for duplicate name
    const [existing] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, categoryData.name))
      .limit(1);

    if (existing) {
      throw new ConflictError('Category with this name already exists');
    }

    const [newCategory] = await db.insert(categories).values(categoryData).returning();

    saveDatabase();

    return newCategory;
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 50, search } = filters;

    let query = db.select().from(categories);

    if (search) {
      query = query.where(like(categories.name, `%${search}%`));
    }

    // Get total count for pagination metadata
    let countQuery = db.select({ count: sql`count(*)` }).from(categories);
    if (search) {
      countQuery = countQuery.where(like(categories.name, `%${search}%`));
    }
    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    // Get paginated results using offset and limit
    const results = await query
      .orderBy(desc(categories.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: results,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id) {
    const db = await getDb();
    const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);

    if (!category) {
      throw new NotFoundError('Category');
    }

    return category;
  }

  async update(id, categoryData) {
    const db = await getDb();
    const [updated] = await db
      .update(categories)
      .set(categoryData)
      .where(eq(categories.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Category');
    }

    saveDatabase();

    return updated;
  }

  async delete(id) {
    const db = await getDb();

    // Pre-check: a category still used by products cannot be deleted. Report
    // the exact count so the message is actionable.
    const [usage] = await db
      .select({ count: sql`COUNT(*)` })
      .from(products)
      .where(eq(products.categoryId, Number(id)));
    const productCount = Number(usage?.count) || 0;
    if (productCount > 0) {
      throw new ConflictError(
        `لا يمكن حذف هذه الفئة لأنها مرتبطة بـ ${productCount} منتج مسجل داخل النظام.`
      );
    }

    try {
      const [deleted] = await db.delete(categories).where(eq(categories.id, id)).returning();
      if (!deleted) {
        throw new NotFoundError('Category');
      }
      saveDatabase();
      return { message: 'Category deleted successfully' };
    } catch (err) {
      if (err instanceof AppError) throw err;
      log.error('Delete of category failed', err);
      throw (
        translateDbConstraintError(err, {
          fkMessage: 'لا يمكن حذف هذه الفئة لأنها مستخدمة في بيانات أخرى مسجلة داخل النظام.',
        }) || new AppError('تعذّر حذف الفئة بسبب خطأ غير متوقع. يرجى المحاولة مرة أخرى.', 500)
      );
    }
  }
}
