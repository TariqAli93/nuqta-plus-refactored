import { getDb } from '../db.js';
import { branches, warehouses } from '../models/index.js';
import { asc, eq, sql } from 'drizzle-orm';

/**
 * System defaults — guarantees the inventory subsystem always has a usable
 * branch + warehouse to work with, even when the multi-branch feature is off
 * or the operator never created any.
 *
 * Why this exists
 * ───────────────
 * Every stock row (product_stock, product_stock_entries, stock_movements) is
 * keyed on a warehouseId, and invoice numbering + warehouse transfers need a
 * NOT-NULL branchId (invoice_sequences.branch_id / warehouse_transfers.branch_id
 * are NOT NULL with a FK to branches). A fresh install — or one running with
 * branch management disabled — could therefore have zero branches/warehouses,
 * which silently broke inventory and made sales fail at invoice allocation.
 *
 * These helpers create an *internal* default branch/warehouse on demand,
 * idempotently. When multi-branch is off the UI never shows the branch, so the
 * operator just gets a working "المخزن الرئيسي" without ever touching branches.
 * When multi-branch is on, real branches already exist and these helpers simply
 * return the first one — they never duplicate.
 */

export const DEFAULT_BRANCH_NAME = 'الفرع الرئيسي';
export const DEFAULT_WAREHOUSE_NAME = 'المخزن الرئيسي';

/**
 * Pure precedence helper (extracted for unit testing): pick the first
 * meaningful id from explicit → assigned, returning null when neither is set
 * so the caller can fall back to the system default.
 */
export function pickEffectiveId(explicit, assigned) {
  return explicit || assigned || null;
}

/**
 * Ensure at least one branch exists; return its id. Idempotent:
 *   - if any branch already exists, returns the oldest (lowest id);
 *   - otherwise creates the internal default branch.
 * `branches.name` is unique, so a concurrent create resolves via a re-select.
 */
export async function ensureDefaultBranch(executor = null) {
  const db = executor || (await getDb());

  const [existing] = await db
    .select({ id: branches.id })
    .from(branches)
    .orderBy(asc(branches.id))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(branches)
    .values({ name: DEFAULT_BRANCH_NAME, isActive: true })
    .onConflictDoNothing({ target: branches.name })
    .returning({ id: branches.id });
  if (created) return created.id;

  // Lost the race — another caller inserted it first.
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.name, DEFAULT_BRANCH_NAME))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Ensure at least one ACTIVE warehouse exists; return its id. Idempotent:
 *   - if any active warehouse already exists, returns the oldest (lowest id);
 *   - otherwise creates the internal default warehouse, attached to the
 *     default branch so invoice numbering / transfers keep a valid branchId,
 *     and seeds zero-quantity product_stock rows for existing products.
 */
export async function ensureDefaultWarehouse(executor = null) {
  const db = executor || (await getDb());

  const [existing] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(asc(warehouses.id))
    .limit(1);
  if (existing) return existing.id;

  const branchId = await ensureDefaultBranch(db);

  const [created] = await db
    .insert(warehouses)
    .values({ name: DEFAULT_WAREHOUSE_NAME, branchId, isActive: true })
    .returning({ id: warehouses.id });

  // Initialise product_stock rows (quantity 0) for every active product so the
  // inventory screen lists the catalogue immediately.
  await db.execute(sql`
    INSERT INTO product_stock (product_id, warehouse_id, quantity)
    SELECT p.id, ${created.id}, 0
    FROM products p
    WHERE p.is_active = true
    ON CONFLICT DO NOTHING
  `);

  return created.id;
}

/**
 * Resolve a usable branchId: explicit → user's assignment → system default.
 * Never returns null (creates the default branch when nothing else applies).
 */
export async function getEffectiveBranchId({ branchId = null, actingUser = null } = {}) {
  const chosen = pickEffectiveId(branchId, actingUser?.assignedBranchId);
  if (chosen) return chosen;
  return ensureDefaultBranch();
}

/**
 * Resolve a usable warehouseId: explicit → user's assignment → system default.
 * Never returns null (creates the default warehouse when nothing else applies).
 */
export async function getEffectiveWarehouseId({ warehouseId = null, actingUser = null } = {}) {
  const chosen = pickEffectiveId(warehouseId, actingUser?.assignedWarehouseId);
  if (chosen) return chosen;
  return ensureDefaultWarehouse();
}

export default {
  DEFAULT_BRANCH_NAME,
  DEFAULT_WAREHOUSE_NAME,
  pickEffectiveId,
  ensureDefaultBranch,
  ensureDefaultWarehouse,
  getEffectiveBranchId,
  getEffectiveWarehouseId,
};
