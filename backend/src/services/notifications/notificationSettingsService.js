import { eq } from 'drizzle-orm';
import { getDb, saveDatabase } from '../../db.js';
import { notificationSettings } from '../../models/index.js';
import { decrypt, encrypt, mask } from './crypto.js';

/**
 * Backing store for the singleton notification settings row.
 *
 * The whole feature is OFF by default. Reads return the row with the API key
 * decrypted (used internally only). Public/admin API responses must use
 * `toPublic()` to strip the secret.
 */

const SINGLETON_ID = 1;

const DEFAULTS = Object.freeze({
  id: SINGLETON_ID,
  enabled: false,
  provider: 'bulksmsiraq',
  apiKey: null,
  senderId: null,
  smsEnabled: true,
  whatsappEnabled: false,
  autoFallbackEnabled: true,
  defaultChannel: 'auto',
  overdueReminderEnabled: true,
  paymentConfirmationEnabled: true,
  bulkMessagingEnabled: false,
  singleCustomerMessagingEnabled: true,
  templates: null,
  lastTestAt: null,
  lastTestStatus: null,
  lastTestMessage: null,
});

const ALLOWED_CHANNELS = new Set(['sms', 'whatsapp', 'auto']);

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5_000;

function rowToInternal(row) {
  if (!row) return null;
  return {
    id: row.id,
    enabled: !!row.enabled,
    provider: row.provider || 'bulksmsiraq',
    apiKey: row.apiKeyEncrypted ? decrypt(row.apiKeyEncrypted) : null,
    senderId: row.senderId || null,
    smsEnabled: !!row.smsEnabled,
    whatsappEnabled: !!row.whatsappEnabled,
    autoFallbackEnabled: !!row.autoFallbackEnabled,
    defaultChannel: row.defaultChannel || 'auto',
    overdueReminderEnabled: !!row.overdueReminderEnabled,
    paymentConfirmationEnabled: !!row.paymentConfirmationEnabled,
    bulkMessagingEnabled: !!row.bulkMessagingEnabled,
    singleCustomerMessagingEnabled: !!row.singleCustomerMessagingEnabled,
    templates:
      row.templates && typeof row.templates === 'object' && !Array.isArray(row.templates)
        ? row.templates
        : null,
    lastTestAt: row.lastTestAt || null,
    lastTestStatus: row.lastTestStatus || null,
    lastTestMessage: row.lastTestMessage || null,
  };
}

async function ensureRow() {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.id, SINGLETON_ID))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(notificationSettings)
    .values({
      id: SINGLETON_ID,
      enabled: false,
      provider: 'bulksmsiraq',
      smsEnabled: true,
      whatsappEnabled: false,
      autoFallbackEnabled: true,
      defaultChannel: 'auto',
      overdueReminderEnabled: true,
      paymentConfirmationEnabled: true,
      bulkMessagingEnabled: false,
      singleCustomerMessagingEnabled: true,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  // Race: another caller inserted concurrently. Re-read.
  const [reread] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.id, SINGLETON_ID))
    .limit(1);
  return reread;
}

function invalidateCache() {
  cached = null;
  cachedAt = 0;
}

/** Internal getter — includes the decrypted API key. Use sparingly. */
export async function getInternal() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  const row = await ensureRow();
  cached = rowToInternal(row) || { ...DEFAULTS };
  cachedAt = now;
  return cached;
}

/** Public projection: mask the API key, never expose it. */
export function toPublic(internal) {
  const s = internal || DEFAULTS;
  return {
    enabled: s.enabled,
    provider: s.provider,
    apiKeyMasked: s.apiKey ? mask(s.apiKey) : '',
    apiKeyConfigured: !!s.apiKey,
    senderId: s.senderId,
    smsEnabled: s.smsEnabled,
    whatsappEnabled: s.whatsappEnabled,
    autoFallbackEnabled: s.autoFallbackEnabled,
    defaultChannel: s.defaultChannel,
    overdueReminderEnabled: s.overdueReminderEnabled,
    paymentConfirmationEnabled: s.paymentConfirmationEnabled,
    bulkMessagingEnabled: s.bulkMessagingEnabled,
    singleCustomerMessagingEnabled: s.singleCustomerMessagingEnabled,
    templates: s.templates,
    lastTestAt: s.lastTestAt,
    lastTestStatus: s.lastTestStatus,
    lastTestMessage: s.lastTestMessage,
  };
}

export async function getPublic() {
  return toPublic(await getInternal());
}

function pickBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return fallback;
  return Boolean(value);
}

/**
 * Partial update of the notification settings.
 * - apiKey: when undefined, kept as-is. When null/empty string, cleared.
 *   Otherwise encrypted and stored.
 * - templates: pass an object to override default bodies. Pass null to reset.
 */
export async function update(patch = {}) {
  const db = await getDb();
  const current = await ensureRow();

  const next = {
    enabled: pickBoolean(patch.enabled, current.enabled),
    provider: typeof patch.provider === 'string' ? patch.provider : current.provider,
    senderId:
      patch.senderId === undefined
        ? current.senderId
        : patch.senderId === null || patch.senderId === ''
          ? null
          : String(patch.senderId).trim(),
    smsEnabled: pickBoolean(patch.smsEnabled, current.smsEnabled),
    whatsappEnabled: pickBoolean(patch.whatsappEnabled, current.whatsappEnabled),
    autoFallbackEnabled: pickBoolean(patch.autoFallbackEnabled, current.autoFallbackEnabled),
    defaultChannel: ALLOWED_CHANNELS.has(patch.defaultChannel)
      ? patch.defaultChannel
      : current.defaultChannel,
    overdueReminderEnabled: pickBoolean(
      patch.overdueReminderEnabled,
      current.overdueReminderEnabled
    ),
    paymentConfirmationEnabled: pickBoolean(
      patch.paymentConfirmationEnabled,
      current.paymentConfirmationEnabled
    ),
    bulkMessagingEnabled: pickBoolean(patch.bulkMessagingEnabled, current.bulkMessagingEnabled),
    singleCustomerMessagingEnabled: pickBoolean(
      patch.singleCustomerMessagingEnabled,
      current.singleCustomerMessagingEnabled
    ),
    updatedAt: new Date(),
  };

  if (patch.templates === null) {
    next.templates = null;
  } else if (patch.templates && typeof patch.templates === 'object' && !Array.isArray(patch.templates)) {
    next.templates = patch.templates;
  }

  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null || patch.apiKey === '') {
      next.apiKeyEncrypted = null;
    } else {
      next.apiKeyEncrypted = encrypt(String(patch.apiKey).trim());
    }
  }

  await db.update(notificationSettings).set(next).where(eq(notificationSettings.id, SINGLETON_ID));
  saveDatabase();
  invalidateCache();
  return getInternal();
}

/** Persist the result of a connection test. */
export async function recordTestResult({ status, message }) {
  const db = await getDb();
  await db
    .update(notificationSettings)
    .set({
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestMessage: message ? String(message).slice(0, 500) : null,
    })
    .where(eq(notificationSettings.id, SINGLETON_ID));
  saveDatabase();
  invalidateCache();
}

export const __test__ = { invalidateCache };
