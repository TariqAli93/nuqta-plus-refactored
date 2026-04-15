import { getDb, saveDatabase } from '../db.js';
import { customers, sales, saleItems } from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { eq, like, or, desc, sql } from 'drizzle-orm';

export class CustomerService {
  async create(customerData, userId) {
    const db = await getDb();
    // Check for duplicate phone
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.phone, customerData.phone))
      .limit(1);

    if (existing && customerData.phone.trim() !== '') {
      throw new ConflictError(`Customer with phone ${customerData.phone} already exists`);
    }

    const [newCustomer] = await db
      .insert(customers)
      .values({
        ...customerData,
        createdBy: userId,
      })
      .returning();

    saveDatabase();

    return newCustomer;
  }

  async getAll(filters = {}) {
    const db = await getDb();
    const { page = 1, limit = 10, search } = filters;

    let query = db.select().from(customers);

    if (search) {
      query = query.where(
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`))
      );
    }

    // Get total count for pagination metadata
    let countQuery = db.select({ count: sql`count(*)` }).from(customers);
    if (search) {
      countQuery = countQuery.where(
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`))
      );
    }
    const countResult = await countQuery.get();
    const total = Number(countResult?.count || 0);

    // Get paginated results using offset and limit (better-sqlite3 supports this)
    const results = await query
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

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
    const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

    if (!customer) {
      throw new NotFoundError('Customer');
    }

    // Get all sales for this customer
    const salesData = await db
      .select()
      .from(sales)
      .where(eq(sales.customerId, id))
      .orderBy(desc(sales.createdAt));

    // Get sale items for each sale
    const salesWithItems = await Promise.all(
      salesData.map(async (sale) => {
        const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));

        return {
          ...sale,
          items,
        };
      })
    );

    customer.sales = salesWithItems;

    return customer;
  }

  async update(id, customerData) {
    const db = await getDb();
    const [updated] = await db
      .update(customers)
      .set({
        ...customerData,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(customers.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return updated;
  }

  async delete(id) {
    const db = await getDb();
    const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning();

    if (!deleted) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return { message: 'Customer deleted successfully' };
  }

  async updateDebt(customerId, amount) {
    const db = await getDb();
    const customer = await this.getById(customerId);

    const [updated] = await db
      .update(customers)
      .set({
        totalDebt: (customer.totalDebt || 0) + amount,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    if (!updated) {
      throw new NotFoundError('Customer');
    }

    saveDatabase();

    return updated;
  }
}
