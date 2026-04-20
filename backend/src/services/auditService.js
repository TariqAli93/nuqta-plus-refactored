import { getDb } from '../db.js';
import { auditLog, users } from '../models/index.js';
import { eq, like, and, desc, sql, gte, lte } from 'drizzle-orm';

export class AuditService {
  /**
   * Log an action to the audit trail.
   * @param {object} entry
   * @param {number}  [entry.userId]    - Acting user ID (null for anonymous/system)
   * @param {string}  [entry.username]  - Acting username (denormalized for fast queries)
   * @param {string}   entry.action     - e.g. 'user:login', 'sale:create', 'backup:create'
   * @param {string}  [entry.resource]  - e.g. 'users', 'sales'
   * @param {number}  [entry.resourceId]- ID of the affected record
   * @param {object|string} [entry.details] - Extra context (stored as JSON string)
   * @param {string}  [entry.ipAddress] - Client IP
   */
  async log({ userId, username, action, resource, resourceId, details, ipAddress }) {
    const db = await getDb();
    await db.insert(auditLog).values({
      userId: userId || null,
      username: username || null,
      action,
      resource: resource || null,
      resourceId: resourceId || null,
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      ipAddress: ipAddress || null,
    });
  }

  /**
   * Query audit logs with pagination and filters.
   */
  async list({ page = 1, limit = 50, userId, action, resource, startDate, endDate, search }) {
    const db = await getDb();
    const conditions = [];

    if (userId) {
      conditions.push(eq(auditLog.userId, userId));
    }
    if (action) {
      conditions.push(eq(auditLog.action, action));
    }
    if (resource) {
      conditions.push(eq(auditLog.resource, resource));
    }
    if (startDate) {
      conditions.push(gte(auditLog.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(auditLog.createdAt, new Date(endDate)));
    }
    if (search) {
      conditions.push(like(auditLog.action, `%${search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * limit;

    const data = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        username: auditLog.username,
        action: auditLog.action,
        resource: auditLog.resource,
        resourceId: auditLog.resourceId,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    let countQuery = db.select({ count: sql`count(*)` }).from(auditLog);
    if (where) {
      countQuery = countQuery.where(where);
    }
    const [countResult] = await countQuery;
    const total = Number(countResult?.count || 0);

    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get distinct action types for filter dropdowns.
   */
  async getDistinctActions() {
    const db = await getDb();
    const results = await db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .orderBy(auditLog.action);

    return results.map((r) => r.action);
  }

  /**
   * Delete audit logs older than the given number of days.
   */
  async purgeOlderThan(days) {
    const db = await getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await db
      .delete(auditLog)
      .where(lte(auditLog.createdAt, cutoff))
      .returning({ id: auditLog.id });

    return { deleted: result.length };
  }
}

export default new AuditService();
