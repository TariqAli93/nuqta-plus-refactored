import { getDb } from '../db.js';
import { settings } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { ValidationError } from '../utils/errors.js';

const SETTINGS_KEY = 'feature_flags';
const SETUP_MODE_KEY = 'setup_mode';

/** Preset bundles for the first-run wizard. */
export const SETUP_PRESETS = Object.freeze({
  simple: {
    installments: false,
    creditScore: false,
    inventory: true,
    multiBranch: false,
    multiWarehouse: false,
    warehouseTransfers: false,
  },
  installments: {
    installments: true,
    creditScore: true,
    inventory: true,
    multiBranch: false,
    multiWarehouse: false,
    warehouseTransfers: false,
  },
  multi_branch: {
    installments: true,
    creditScore: true,
    inventory: true,
    multiBranch: true,
    multiWarehouse: true,
    warehouseTransfers: true,
  },
});

// Defaults chosen so a fresh install feels like a simple single-branch POS.
// The setup wizard turns on advanced flags when the user asks for them.
export const DEFAULT_FLAGS = Object.freeze({
  installments: true,
  creditScore: true,
  inventory: true,
  // Advanced — off by default
  multiBranch: false,
  multiWarehouse: false,
  warehouseTransfers: false,
  // Keep operational features on so alerts keep working out of the box
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

/** Fastify-style guard: throws if the flag is off. */
export async function requireFeature(flag) {
  const enabled = await isFeatureEnabled(flag);
  if (!enabled) {
    throw new ValidationError(`Feature "${flag}" is disabled`);
  }
}

/** Read/write the setup wizard state (`"pending" | "done"`). */
export async function getSetupMode() {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETUP_MODE_KEY)).limit(1);
  return row?.value || 'pending';
}

export async function setSetupMode(value, userId) {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETUP_MODE_KEY)).limit(1);
  if (row) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date(), updatedBy: userId || null })
      .where(eq(settings.key, SETUP_MODE_KEY));
  } else {
    await db.insert(settings).values({
      key: SETUP_MODE_KEY,
      value,
      description: 'First-run setup wizard state',
      updatedBy: userId || null,
    });
  }
}

/**
 * Apply a preset bundle (`simple` | `installments` | `multi_branch`) and mark
 * setup as done. Returns the resulting flags.
 */
export async function applySetupPreset(preset, userId) {
  const bundle = SETUP_PRESETS[preset];
  if (!bundle) throw new ValidationError(`Unknown setup preset: ${preset}`);
  const next = await updateFeatureFlags(bundle, userId);
  await setSetupMode('done', userId);
  return next;
}

export default {
  DEFAULT_FLAGS,
  SETUP_PRESETS,
  getFeatureFlags,
  isFeatureEnabled,
  updateFeatureFlags,
  requireFeature,
  getSetupMode,
  setSetupMode,
  applySetupPreset,
};
