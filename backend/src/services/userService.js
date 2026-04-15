import { getDb, saveDatabase } from '../db.js';
import { users } from '../models/index.js';
import { eq, like, and, sql } from 'drizzle-orm';
import { hashPassword } from '../utils/helpers.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';

export class UserService {
  async list({ page = 1, limit = 10, search, role, isActive }) {
    const db = await getDb();
    let where;
    if (search) {
      where = like(users.username, `%${search}%`);
    }
    if (typeof role !== 'undefined') {
      where = where ? and(where, eq(users.role, role)) : eq(users.role, role);
    }
    if (typeof isActive !== 'undefined') {
      where = where ? and(where, eq(users.isActive, !!isActive)) : eq(users.isActive, !!isActive);
    }

    // Use SQL LIMIT/OFFSET for efficient pagination
    const offset = (page - 1) * limit;
    const data = await db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        role: users.role,
      })
      .from(users)
      .where(where)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination metadata
    let countQuery = db.select({ count: sql`count(*)` }).from(users);
    if (where) {
      countQuery = countQuery.where(where);
    }
    const countResult = await countQuery.get();
    const total = Number(countResult?.count || 0);

    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async getById(id) {
    const db = await getDb();
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) throw new NotFoundError('User');
    return user;
  }

  async create(data, _actorId) {
    const db = await getDb();
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.username, data.username))
      .limit(1);
    if (existing) throw new ConflictError('Username already exists');

    const hashed = await hashPassword(data.password);
    const [user] = await db
      .insert(users)
      .values({
        username: data.username,
        password: hashed,
        fullName: data.fullName,
        phone: data.phone,
        role: data.role || 'cashier',
        isActive: true,
      })
      .returning();

    saveDatabase();

    return this.getById(user.id);
  }

  async update(id, data, _actorId) {
    const db = await getDb();
    await this.getById(id);

    // Build update object with only provided fields
    const updateData = {
      updatedAt: new Date().toISOString(),
    };

    if (data.fullName !== undefined) {
      updateData.fullName = data.fullName;
    }
    if (data.phone !== undefined) {
      updateData.phone = data.phone;
    }
    if (data.role !== undefined) {
      updateData.role = data.role;
    }
    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    await db.update(users).set(updateData).where(eq(users.id, id));

    saveDatabase();

    return this.getById(id);
  }

  async resetPassword(id, newPassword, _actorId) {
    const db = await getDb();
    await this.getById(id);
    const hashed = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ password: hashed, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    saveDatabase();
    return { success: true };
  }

  async remove(id, actorId) {
    const db = await getDb();

    // Prevent users from deleting themselves
    if (Number(id) === Number(actorId)) {
      throw new ConflictError('Cannot deactivate your own account');
    }

    const userToDelete = await this.getById(id);

    // Prevent deleting the last admin user
    if (userToDelete.role === 'admin' && userToDelete.isActive) {
      const adminCount = await db
        .select({ count: sql`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
        .get();

      const totalAdmins = Number(adminCount?.count || 0);
      if (totalAdmins <= 1) {
        throw new ConflictError('Cannot deactivate the last admin user');
      }
    }

    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));

    saveDatabase();
    return { success: true };
  }

  async checkFirstUser() {
    const db = await getDb();
    const count = await db.select().from(users).limit(1);
    return count.length > 0;
  }
}
