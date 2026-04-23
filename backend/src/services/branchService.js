import { getDb } from '../db.js';
import { branches, warehouses } from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { eq, desc, sql } from 'drizzle-orm';

export class BranchService {
  async getAll() {
    const db = await getDb();
    return await db
      .select({
        id: branches.id,
        name: branches.name,
        address: branches.address,
        isActive: branches.isActive,
        createdAt: branches.createdAt,
        warehouseCount: sql`(SELECT COUNT(*) FROM warehouses w WHERE w.branch_id = ${branches.id})`.as('warehouseCount'),
      })
      .from(branches)
      .orderBy(desc(branches.createdAt));
  }

  async getById(id) {
    const db = await getDb();
    const [branch] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
    if (!branch) throw new NotFoundError('Branch');
    return branch;
  }

  async create(data) {
    const db = await getDb();
    const [existing] = await db
      .select()
      .from(branches)
      .where(eq(branches.name, data.name))
      .limit(1);
    if (existing) throw new ConflictError('Branch name already exists');

    const [row] = await db
      .insert(branches)
      .values({
        name: data.name,
        address: data.address || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      })
      .returning();
    return row;
  }

  async update(id, data) {
    const db = await getDb();
    const [row] = await db
      .update(branches)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      })
      .where(eq(branches.id, id))
      .returning();
    if (!row) throw new NotFoundError('Branch');
    return row;
  }

  async delete(id) {
    const db = await getDb();
    // Soft-delete only if warehouses are linked. Otherwise allow hard delete.
    const [wh] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.branchId, id))
      .limit(1);
    if (wh) {
      await db.update(branches).set({ isActive: false }).where(eq(branches.id, id));
      return { message: 'Branch deactivated (has warehouses)' };
    }
    const [deleted] = await db.delete(branches).where(eq(branches.id, id)).returning();
    if (!deleted) throw new NotFoundError('Branch');
    return { message: 'Branch deleted' };
  }
}

export default new BranchService();
