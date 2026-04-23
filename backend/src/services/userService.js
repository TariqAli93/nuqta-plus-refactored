import { getDb, saveDatabase } from '../db.js';
import { users, branches, warehouses } from '../models/index.js';
import { eq, like, and, sql } from 'drizzle-orm';
import { hashPassword } from '../utils/helpers.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';

const GLOBAL_ROLES = new Set(['admin', 'global_admin']);

/**
 * Ensure a non-global role has a valid assigned branch, and (optionally) a
 * warehouse inside that branch. Throws ValidationError on bad combinations.
 */
async function validateAssignment(db, { role, assignedBranchId, assignedWarehouseId }) {
  if (GLOBAL_ROLES.has(role)) return; // admins are allowed to roam

  if (!assignedBranchId) {
    throw new ValidationError('Non-admin users must be assigned to a branch');
  }

  const [branch] = await db.select().from(branches).where(eq(branches.id, assignedBranchId)).limit(1);
  if (!branch) throw new ValidationError('Assigned branch not found');

  if (assignedWarehouseId) {
    const [wh] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.id, assignedWarehouseId))
      .limit(1);
    if (!wh) throw new ValidationError('Assigned warehouse not found');
    if (wh.branchId !== assignedBranchId) {
      throw new ValidationError('Assigned warehouse does not belong to assigned branch');
    }
  }
}

export class UserService {
  async list({ page = 1, limit = 10, search, role, isActive, branchId }, actingUser = null) {
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

    // Branch admins can only list users inside their branch.
    const restrictedBranch =
      actingUser && !GLOBAL_ROLES.has(actingUser.role) ? actingUser.assignedBranchId : null;
    const branchCond = restrictedBranch || branchId;
    if (branchCond) {
      where = where
        ? and(where, eq(users.assignedBranchId, branchCond))
        : eq(users.assignedBranchId, branchCond);
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
        assignedBranchId: users.assignedBranchId,
        assignedWarehouseId: users.assignedWarehouseId,
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
    const [countResult] = await countQuery;
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
        assignedBranchId: users.assignedBranchId,
        assignedWarehouseId: users.assignedWarehouseId,
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

    const role = data.role || 'cashier';

    await validateAssignment(db, {
      role,
      assignedBranchId: data.assignedBranchId,
      assignedWarehouseId: data.assignedWarehouseId,
    });

    const hashed = await hashPassword(data.password);
    const [user] = await db
      .insert(users)
      .values({
        username: data.username,
        password: hashed,
        fullName: data.fullName,
        phone: data.phone,
        role,
        assignedBranchId: data.assignedBranchId || null,
        assignedWarehouseId: data.assignedWarehouseId || null,
        isActive: true,
      })
      .returning();

    saveDatabase();

    return this.getById(user.id);
  }

  async update(id, data, _actorId) {
    const db = await getDb();
    const existing = await this.getById(id);

    // Build update object with only provided fields
    const updateData = {
      updatedAt: new Date(),
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
    if (data.assignedBranchId !== undefined) {
      updateData.assignedBranchId = data.assignedBranchId || null;
    }
    if (data.assignedWarehouseId !== undefined) {
      updateData.assignedWarehouseId = data.assignedWarehouseId || null;
    }

    // Validate the resulting (role, branch, warehouse) combination.
    const nextRole = updateData.role || existing.role;
    const nextBranch =
      'assignedBranchId' in updateData ? updateData.assignedBranchId : existing.assignedBranchId;
    const nextWarehouse =
      'assignedWarehouseId' in updateData
        ? updateData.assignedWarehouseId
        : existing.assignedWarehouseId;
    await validateAssignment(db, {
      role: nextRole,
      assignedBranchId: nextBranch,
      assignedWarehouseId: nextWarehouse,
    });

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
      .set({ password: hashed, updatedAt: new Date() })
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
      const [adminCount] = await db
        .select({ count: sql`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));

      const totalAdmins = Number(adminCount?.count || 0);
      if (totalAdmins <= 1) {
        throw new ConflictError('Cannot deactivate the last admin user');
      }
    }

    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
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
