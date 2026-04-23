import { getDb } from '../db.js';
import { warehouses, branches, productStock } from '../models/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import inventoryService from './inventoryService.js';

export class WarehouseService {
  async getAll({ branchId, activeOnly = false } = {}) {
    const db = await getDb();
    const conds = [];
    if (branchId) conds.push(eq(warehouses.branchId, Number(branchId)));
    if (activeOnly) conds.push(eq(warehouses.isActive, true));

    let q = db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        isActive: warehouses.isActive,
        createdAt: warehouses.createdAt,
      })
      .from(warehouses)
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .orderBy(desc(warehouses.createdAt));

    if (conds.length) q = q.where(and(...conds));
    return await q;
  }

  async getById(id) {
    const db = await getDb();
    const [row] = await db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        branchId: warehouses.branchId,
        branchName: branches.name,
        isActive: warehouses.isActive,
        createdAt: warehouses.createdAt,
      })
      .from(warehouses)
      .leftJoin(branches, eq(warehouses.branchId, branches.id))
      .where(eq(warehouses.id, id))
      .limit(1);
    if (!row) throw new NotFoundError('Warehouse');
    return row;
  }

  async create(data) {
    const db = await getDb();
    if (!data.branchId) throw new ValidationError('branchId is required');

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1);
    if (!branch) throw new NotFoundError('Branch');

    const [existing] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.branchId, data.branchId), eq(warehouses.name, data.name)))
      .limit(1);
    if (existing) throw new ConflictError('A warehouse with this name already exists in the branch');

    const [row] = await db
      .insert(warehouses)
      .values({
        name: data.name,
        branchId: data.branchId,
        isActive: data.isActive !== undefined ? data.isActive : true,
      })
      .returning();

    // Initialise product_stock rows for this warehouse (quantity 0 by default)
    await db.execute(sql`
      INSERT INTO product_stock (product_id, warehouse_id, quantity)
      SELECT p.id, ${row.id}, 0
      FROM products p
      WHERE p.is_active = true
      ON CONFLICT DO NOTHING
    `);

    return row;
  }

  async update(id, data) {
    const db = await getDb();
    const [row] = await db
      .update(warehouses)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.branchId !== undefined ? { branchId: data.branchId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      })
      .where(eq(warehouses.id, id))
      .returning();
    if (!row) throw new NotFoundError('Warehouse');
    return row;
  }

  async delete(id) {
    const db = await getDb();
    // Check if any stock exists; if so, soft-deactivate instead of deleting.
    const [hasStock] = await db
      .select({ total: sql`COALESCE(SUM(quantity), 0)` })
      .from(productStock)
      .where(eq(productStock.warehouseId, id));

    if (Number(hasStock?.total || 0) > 0) {
      await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, id));
      return { message: 'Warehouse deactivated (contains stock)' };
    }

    // No stock — safe to delete (cascade clears product_stock)
    const [deleted] = await db.delete(warehouses).where(eq(warehouses.id, id)).returning();
    if (!deleted) throw new NotFoundError('Warehouse');
    return { message: 'Warehouse deleted' };
  }
}

export default new WarehouseService();
