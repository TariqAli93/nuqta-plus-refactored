import { getDb } from '../db.js';
import { settings } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { ValidationError } from '../utils/errors.js';

const SETTINGS_KEY = 'feature_flags';

export const DEFAULT_FLAGS = Object.freeze({
  installments: true,
  creditScore: true,
  inventory: true,
  multiWarehouse: true,
  multiBranch: true,
  warehouseTransfers: true,
  alerts: true,
  liveOperations: true,
});

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_FLAGS));

export async function getFeatureFlags() {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  if (!row) return { ...DEFAULT_FLAGS };
  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_FLAGS, ...parsed };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export async function isFeatureEnabled(flag) {
  const flags = await getFeatureFlags();
  return flags[flag] !== false;
}

/**
 * Merge the provided partial flag map into the stored flags.
 * Rejects unknown keys so the stored JSON never drifts.
 */
export async function updateFeatureFlags(partial, userId) {
  if (!partial || typeof partial !== 'object') {
    throw new ValidationError('Invalid feature flags payload');
  }

  for (const key of Object.keys(partial)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ValidationError(`Unknown feature flag: ${key}`);
    }
    if (typeof partial[key] !== 'boolean') {
      throw new ValidationError(`Feature flag "${key}" must be a boolean`);
    }
  }

  const db = await getDb();
  const current = await getFeatureFlags();
  const next = { ...current, ...partial };
  const value = JSON.stringify(next);

  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  if (row) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date(), updatedBy: userId || null })
      .where(eq(settings.key, SETTINGS_KEY));
  } else {
    await db.insert(settings).values({
      key: SETTINGS_KEY,
      value,
      description: 'Feature toggles for optional product modules',
      updatedBy: userId || null,
    });
  }

  return next;
}

/** Fastify-style guard: reply 403 if the flag is off. */
export async function requireFeature(flag) {
  const enabled = await isFeatureEnabled(flag);
  if (!enabled) {
    throw new ValidationError(`Feature "${flag}" is disabled`);
  }
}

export default {
  DEFAULT_FLAGS,
  getFeatureFlags,
  isFeatureEnabled,
  updateFeatureFlags,
  requireFeature,
};
