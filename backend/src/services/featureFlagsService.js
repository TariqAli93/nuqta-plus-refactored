import { getDb } from '../db.js';
import { settings } from '../models/index.js';
import { eq } from 'drizzle-orm';
import { ValidationError } from '../utils/errors.js';

const SETTINGS_KEY = 'feature_flags';
const SETUP_MODE_KEY = 'setup_mode';

/**
 * Some flags are exposed to the API under more than one name so the
 * frontend payload can stay aligned with the product spec ("inventoryTransfers")
 * while the storage layer keeps the historical key ("warehouseTransfers").
 * The values are mirrored on read and on write — touching either name updates
 * the canonical key.
 */
const FLAG_ALIASES = Object.freeze({
  inventoryTransfers: 'warehouseTransfers',
});

/** Preset bundles for the first-run wizard. */
export const SETUP_PRESETS = Object.freeze({
  simple: {
    installments: false,
    creditScore: false,
    inventory: true,
    multiBranch: false,
    multiWarehouse: false,
    warehouseTransfers: false,
    pos: true,
    draftInvoices: true,
  },
  installments: {
    installments: true,
    creditScore: true,
    inventory: true,
    multiBranch: false,
    multiWarehouse: false,
    warehouseTransfers: false,
    pos: true,
    draftInvoices: true,
  },
  multi_branch: {
    installments: true,
    creditScore: true,
    inventory: true,
    multiBranch: true,
    multiWarehouse: true,
    warehouseTransfers: true,
    pos: true,
    draftInvoices: true,
  },
});

// Defaults chosen so a fresh install feels like a simple single-branch POS.
// The setup wizard turns on advanced flags when the user asks for them.
export const DEFAULT_FLAGS = Object.freeze({
  installments: true,
  creditScore: true,
  inventory: true,
  // Front-counter modules — on out of the box.
  pos: true,
  draftInvoices: true,
  // Advanced — off by default
  multiBranch: false,
  multiWarehouse: false,
  warehouseTransfers: false,
  // Keep operational features on so alerts keep working out of the box
  alerts: true,
  liveOperations: true,
});

const ALLOWED_KEYS = new Set([...Object.keys(DEFAULT_FLAGS), ...Object.keys(FLAG_ALIASES)]);

/**
 * Decorate the flag map with alias keys so callers (and the frontend) can
 * read either the canonical or spec-aligned name. The canonical key remains
 * the source of truth in storage.
 */
function withAliases(flags) {
  const next = { ...flags };
  for (const [alias, canonical] of Object.entries(FLAG_ALIASES)) {
    next[alias] = next[canonical] !== false;
  }
  return next;
}

/** Resolve any incoming alias keys to their canonical name. */
function normalizeFlagPayload(partial) {
  const next = {};
  for (const [key, value] of Object.entries(partial)) {
    const target = FLAG_ALIASES[key] || key;
    next[target] = value;
  }
  return next;
}

export async function getFeatureFlags() {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  if (!row) return withAliases({ ...DEFAULT_FLAGS });
  try {
    const parsed = JSON.parse(row.value);
    // Merge defaults so newly added flags are always present in the payload.
    const merged = { ...DEFAULT_FLAGS, ...normalizeFlagPayload(parsed) };
    return withAliases(merged);
  } catch {
    return withAliases({ ...DEFAULT_FLAGS });
  }
}

export async function isFeatureEnabled(flag) {
  const flags = await getFeatureFlags();
  // Normalize alias to canonical so callers can pass either name.
  const key = FLAG_ALIASES[flag] || flag;
  return flags[key] !== false;
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

  const normalized = normalizeFlagPayload(partial);

  const db = await getDb();
  const current = await getFeatureFlags();
  // Strip alias keys before persisting so storage stays canonical.
  const canonicalCurrent = Object.fromEntries(
    Object.entries(current).filter(([k]) => !FLAG_ALIASES[k])
  );
  const next = { ...canonicalCurrent, ...normalized };
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

  return withAliases(next);
}

/**
 * Throw when the named feature is disabled. The thrown error carries
 * `code = 'FEATURE_DISABLED'` and `statusCode = 403` so the global error
 * handler renders a recognizable JSON body and the frontend can refresh
 * its session/bootstrap.
 */
export async function requireFeature(flag) {
  const enabled = await isFeatureEnabled(flag);
  if (!enabled) {
    const err = new ValidationError(`Feature "${flag}" is disabled`);
    err.statusCode = 403;
    err.code = 'FEATURE_DISABLED';
    err.feature = flag;
    throw err;
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
