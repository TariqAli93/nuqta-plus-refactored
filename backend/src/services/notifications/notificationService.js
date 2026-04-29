import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb, saveDatabase } from '../../db.js';
import {
  customers,
  notificationLogs,
  notifications,
  settings as settingsTable,
} from '../../models/index.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import * as settingsService from './notificationSettingsService.js';
import { createAdapter } from './providers/index.js';
import { normalizeIraqPhone, isValidPhone } from './phone.js';
import { render, validatePayload, TEMPLATE_KEYS, listTemplates } from './templates.js';

/**
 * NotificationService — the only entry point that callers use to enqueue or
 * manage outbound messages. Everything below the surface area is private:
 *
 *   createNotification(...)             — enqueue a single message.
 *   createBulkCustomerNotifications(...) — enqueue one per customer.
 *   sendOverdueInstallmentReminder(...)  — feature-gated installment helper.
 *   sendPaymentConfirmation(...)         — feature-gated payment helper.
 *   listNotifications(filters)           — admin log/queue view.
 *   retryNotification(id)                — manual retry for failed sends.
 *   testConnection()                     — provider credential probe.
 *
 * This module never touches HTTP request/response objects — that's the
 * controller's job — and never sends a message synchronously. Sending is
 * always queued and processed by the worker (queue.js).
 */

const TYPES = Object.freeze({
  OVERDUE_REMINDER: 'overdue_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  CUSTOMER_MESSAGE: 'customer_message',
  BULK_MESSAGE: 'bulk_message',
});

const STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const ALLOWED_CHANNELS = new Set(['sms', 'whatsapp', 'auto']);
const DEFAULT_MAX_ATTEMPTS = 5;
const PROCESSING_LOCK_TIMEOUT_MS = 60_000;

function clampMessage(s) {
  if (!s) return '';
  // BulkSMSIraq accepts long Arabic SMS but we still cap to keep the DB tidy.
  return String(s).slice(0, 1600);
}

let businessNameCache = { value: null, at: 0 };
const BUSINESS_NAME_TTL_MS = 30_000;

async function getCachedBusinessName() {
  const now = Date.now();
  if (businessNameCache.value !== null && now - businessNameCache.at < BUSINESS_NAME_TTL_MS) {
    return businessNameCache.value;
  }
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, 'company.name'))
      .limit(1);
    businessNameCache = { value: row?.value || '', at: now };
  } catch {
    businessNameCache = { value: '', at: now };
  }
  return businessNameCache.value;
}

/**
 * Resolve the channel a notification should attempt first, given the
 * settings + the caller's preference. Returns null when no channel is
 * available (system OFF, or both SMS+WhatsApp disabled).
 */
export function resolveInitialChannel(channelPref, settings) {
  if (!settings.enabled) return null;
  const pref = ALLOWED_CHANNELS.has(channelPref) ? channelPref : settings.defaultChannel;
  if (pref === 'sms') return settings.smsEnabled ? 'sms' : null;
  if (pref === 'whatsapp') return settings.whatsappEnabled ? 'whatsapp' : null;
  // auto
  if (settings.whatsappEnabled) return 'whatsapp';
  if (settings.smsEnabled) return 'sms';
  return null;
}

export function nextFallbackChannel(currentChannel, originalPref, settings) {
  // Only attempt fallback if the original preference was 'auto' and fallback
  // is enabled. Manual SMS-only / WhatsApp-only requests are honored.
  if (!settings.autoFallbackEnabled) return null;
  if (originalPref !== 'auto') return null;
  if (currentChannel === 'whatsapp' && settings.smsEnabled) return 'sms';
  return null;
}

function backoffDelayMs(attempt) {
  // 1m, 5m, 15m, 1h, 6h
  const ladder = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  if (attempt <= 0) return ladder[0];
  if (attempt >= ladder.length) return ladder[ladder.length - 1];
  return ladder[attempt - 1];
}

async function insertNotificationRow(values) {
  const db = await getDb();
  const [row] = await db.insert(notifications).values(values).returning();
  saveDatabase();
  return row;
}

async function insertLog({
  notificationId,
  provider,
  channel,
  requestPayload,
  responsePayload,
  status,
  error,
}) {
  const db = await getDb();
  // Strip the api_key from any stored request payload — defence in depth so
  // the secret never leaks even if an admin downloads the audit table.
  let safeReq = requestPayload;
  if (safeReq && typeof safeReq === 'object' && !Array.isArray(safeReq)) {
    safeReq = { ...safeReq };
    if ('api_key' in safeReq) safeReq.api_key = '[redacted]';
    if ('apiKey' in safeReq) safeReq.apiKey = '[redacted]';
  }
  await db.insert(notificationLogs).values({
    notificationId: notificationId || null,
    provider: provider || 'unknown',
    channel: channel || 'unknown',
    requestPayload: safeReq || null,
    responsePayload: responsePayload || null,
    status,
    error: error ? String(error).slice(0, 1000) : null,
  });
}

/**
 * Enqueue a single notification. Returns the row when accepted, or
 * `{ skipped: true, reason }` when the system is OFF, the feature is disabled,
 * the recipient phone is invalid, or a duplicate (dedupe_key) already exists.
 */
export async function createNotification({
  type,
  channel = 'auto',
  recipientPhone,
  customerId = null,
  saleId = null,
  installmentId = null,
  paymentId = null,
  template = null,
  payload = null,
  messageBody = null,
  dedupeKey = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  createdBy = null,
}) {
  if (!Object.values(TYPES).includes(type)) {
    throw new ValidationError(`Unknown notification type: ${type}`);
  }
  const settings = await settingsService.getInternal();
  if (!settings.enabled) return { skipped: true, reason: 'system_disabled' };

  // Feature gate
  if (type === TYPES.OVERDUE_REMINDER && !settings.overdueReminderEnabled) {
    return { skipped: true, reason: 'feature_disabled' };
  }
  if (type === TYPES.PAYMENT_CONFIRMATION && !settings.paymentConfirmationEnabled) {
    return { skipped: true, reason: 'feature_disabled' };
  }
  if (type === TYPES.CUSTOMER_MESSAGE && !settings.singleCustomerMessagingEnabled) {
    return { skipped: true, reason: 'feature_disabled' };
  }
  if (type === TYPES.BULK_MESSAGE && !settings.bulkMessagingEnabled) {
    return { skipped: true, reason: 'feature_disabled' };
  }

  // Channel availability — at least one of the requested channels must be enabled.
  const initial = resolveInitialChannel(channel, settings);
  if (!initial) return { skipped: true, reason: 'channel_unavailable' };

  // Phone validation
  const phone = normalizeIraqPhone(recipientPhone);
  if (!phone) return { skipped: true, reason: 'invalid_phone' };

  // Render body
  let body = messageBody;
  if (template) {
    const merged = {
      businessName: await getCachedBusinessName(),
      ...(payload || {}),
    };
    body = render(template, merged, settings.templates);
  }
  if (!body || !String(body).trim()) {
    throw new ValidationError('Notification message body is empty');
  }

  // Dedupe — skip if an identical un-failed notification already exists.
  if (dedupeKey) {
    const db = await getDb();
    const [existing] = await db
      .select({ id: notifications.id, status: notifications.status })
      .from(notifications)
      .where(eq(notifications.dedupeKey, dedupeKey))
      .limit(1);
    if (existing && existing.status !== STATUS.FAILED && existing.status !== STATUS.CANCELLED) {
      return { skipped: true, reason: 'duplicate', notificationId: existing.id };
    }
  }

  return insertNotificationRow({
    type,
    channel: ALLOWED_CHANNELS.has(channel) ? channel : 'auto',
    recipientPhone: phone,
    customerId,
    saleId,
    installmentId,
    paymentId,
    template,
    payload: payload || null,
    messageBody: clampMessage(body),
    status: STATUS.PENDING,
    attempts: 0,
    maxAttempts,
    nextAttemptAt: new Date(),
    dedupeKey,
    createdBy,
  });
}

/**
 * Enqueue a `payment_confirmation` notification for a recorded payment. Returns
 * silently when the system or feature is disabled — never throws on a settings
 * miss, since callers run inside controllers that should not fail just because
 * messaging is off.
 */
export async function sendPaymentConfirmation({ sale, payment, customer }) {
  if (!sale || !payment) return null;
  if (!customer || !customer.phone) return null;
  return createNotification({
    type: TYPES.PAYMENT_CONFIRMATION,
    channel: 'auto',
    recipientPhone: customer.phone,
    customerId: customer.id,
    saleId: sale.id,
    paymentId: payment.id,
    template: TEMPLATE_KEYS.PAYMENT_CONFIRMATION,
    payload: {
      customerName: customer.name,
      customerPhone: customer.phone,
      paidAmount: formatAmount(payment.amount, sale.currency),
      remainingAmount: formatAmount(sale.remainingAmount, sale.currency),
      invoiceNumber: sale.invoiceNumber,
    },
    dedupeKey: `payment:${payment.id}`,
  });
}

/**
 * Enqueue an `overdue_reminder` for a single installment. The dedupe key
 * includes the date so reminders can be sent at most once per installment per
 * day, and so a manual replay (e.g. tomorrow) still works.
 */
export async function sendOverdueInstallmentReminder({ installment, sale, customer }) {
  if (!installment || !customer || !customer.phone) return null;
  const today = new Date().toISOString().slice(0, 10);
  return createNotification({
    type: TYPES.OVERDUE_REMINDER,
    channel: 'auto',
    recipientPhone: customer.phone,
    customerId: customer.id,
    saleId: sale?.id || null,
    installmentId: installment.id,
    template: TEMPLATE_KEYS.OVERDUE_INSTALLMENT_REMINDER,
    payload: {
      customerName: customer.name,
      customerPhone: customer.phone,
      amount: formatAmount(
        installment.remainingAmount ?? installment.dueAmount,
        installment.currency
      ),
      dueDate: installment.dueDate,
      invoiceNumber: sale?.invoiceNumber || '',
      installmentNumber: String(installment.installmentNumber || ''),
    },
    dedupeKey: `installment:${installment.id}:overdue:${today}`,
  });
}

function formatAmount(amount, currency) {
  if (amount == null) return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const code = currency || '';
  return `${n.toLocaleString('en-US')}${code ? ' ' + code : ''}`;
}

/**
 * Enqueue a freeform message to a single customer. Sanitizes the body
 * (trims length, strips control chars) before persisting.
 */
export async function sendCustomerMessage({
  customerId,
  channel = 'auto',
  message,
  createdBy = null,
}) {
  if (!message || !String(message).trim()) {
    throw new ValidationError('Message body is required');
  }
  const db = await getDb();
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) throw new NotFoundError('Customer');
  if (!c.phone) throw new ValidationError('Customer has no phone on file');

  const safe = clampMessage(sanitizeFreeText(message));
  return createNotification({
    type: TYPES.CUSTOMER_MESSAGE,
    channel,
    recipientPhone: c.phone,
    customerId: c.id,
    template: TEMPLATE_KEYS.CUSTOM_CUSTOMER_MESSAGE,
    payload: {
      customerName: c.name,
      customerPhone: c.phone,
      messageBody: safe,
    },
    createdBy,
  });
}

/**
 * Enqueue a freeform message to many customers. When `customerIds` is
 * undefined or empty AND `all===true`, every active customer with a phone is
 * targeted. Returns aggregate stats — never throws on individual failures.
 */
export async function sendBulkCustomerMessage({
  customerIds = [],
  all = false,
  channel = 'auto',
  message,
  createdBy = null,
}) {
  if (!message || !String(message).trim()) {
    throw new ValidationError('Message body is required');
  }
  const safe = clampMessage(sanitizeFreeText(message));

  const db = await getDb();
  let rows;
  if (all) {
    rows = await db.select().from(customers).where(eq(customers.isActive, true));
  } else {
    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      throw new ValidationError('customerIds is required when not sending to all');
    }
    rows = await db.select().from(customers).where(inArray(customers.id, customerIds));
  }

  let queued = 0;
  let skippedNoPhone = 0;
  let skippedInvalidPhone = 0;
  let skippedFeatureDisabled = 0;
  let firstSkipReason = null;

  for (const c of rows) {
    if (!c.phone) {
      skippedNoPhone += 1;
      continue;
    }
    if (!isValidPhone(c.phone)) {
      skippedInvalidPhone += 1;
      continue;
    }
    const r = await createNotification({
      type: TYPES.BULK_MESSAGE,
      channel,
      recipientPhone: c.phone,
      customerId: c.id,
      template: TEMPLATE_KEYS.BULK_CUSTOMER_MESSAGE,
      payload: {
        customerName: c.name,
        customerPhone: c.phone,
        messageBody: safe,
      },
      createdBy,
    });
    if (r && r.skipped) {
      if (r.reason === 'feature_disabled' || r.reason === 'system_disabled') {
        skippedFeatureDisabled += 1;
        firstSkipReason = r.reason;
        // Bail out early — neither flag will change mid-loop, no point retrying.
        break;
      }
      if (r.reason === 'invalid_phone') skippedInvalidPhone += 1;
    } else if (r) {
      queued += 1;
    }
  }

  return {
    targeted: rows.length,
    queued,
    skippedNoPhone,
    skippedInvalidPhone,
    skippedFeatureDisabled,
    skippedReason: firstSkipReason,
  };
}

function sanitizeFreeText(s) {
  return String(s || '')
    .replace(/[ --]/g, '')
    .trim();
}

/**
 * Filtered listing of notifications for the admin UI. Returns rows + total.
 * Never includes the provider API key.
 */
export async function listNotifications({ status, type, customerId, limit = 50, page = 1 } = {}) {
  const db = await getDb();
  const conds = [];
  if (status) conds.push(eq(notifications.status, status));
  if (type) conds.push(eq(notifications.type, type));
  if (customerId) conds.push(eq(notifications.customerId, customerId));

  const where = conds.length ? and(...conds) : undefined;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  let countQuery = db.select({ count: sql`count(*)` }).from(notifications);
  if (where) countQuery = countQuery.where(where);
  const [{ count }] = await countQuery;

  let dataQuery = db.select().from(notifications);
  if (where) dataQuery = dataQuery.where(where);
  const data = await dataQuery
    .orderBy(desc(notifications.createdAt))
    .limit(safeLimit)
    .offset((safePage - 1) * safeLimit);

  return {
    data,
    meta: {
      total: Number(count) || 0,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil((Number(count) || 0) / safeLimit),
    },
  };
}

/** Recent log lines for a notification, newest first. */
export async function listLogs(notificationId, { limit = 20 } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(notificationLogs)
    .where(eq(notificationLogs.notificationId, notificationId))
    .orderBy(desc(notificationLogs.createdAt))
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 200));
}

/**
 * Reset a failed notification so the worker picks it up again. Returns the
 * updated row.
 */
export async function retryNotification(id) {
  const db = await getDb();
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  if (!row) throw new NotFoundError('Notification');
  if (row.status === STATUS.SENT) {
    throw new ValidationError('Notification was already sent');
  }
  const [updated] = await db
    .update(notifications)
    .set({
      status: STATUS.PENDING,
      attempts: 0,
      nextAttemptAt: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id))
    .returning();
  saveDatabase();
  return updated;
}

/** Run a credential probe against the configured provider, log the result. */
export async function testConnection({ apiKeyOverride } = {}) {
  const internal = await settingsService.getInternal();
  const apiKey = apiKeyOverride || internal.apiKey;
  if (!apiKey) {
    return { ok: false, error: 'No API key configured' };
  }
  const adapter = createAdapter({
    provider: internal.provider,
    apiKey,
    senderId: internal.senderId,
  });
  if (!adapter) {
    return { ok: false, error: `Unsupported provider: ${internal.provider}` };
  }
  const result = await adapter.testConnection();
  await settingsService.recordTestResult({
    status: result.ok ? 'ok' : 'error',
    message: result.ok ? 'Connection succeeded' : result.error || 'Connection failed',
  });
  await insertLog({
    notificationId: null,
    provider: internal.provider,
    channel: 'system',
    requestPayload: { action: 'test_connection' },
    responsePayload: result.response || null,
    status: result.ok ? 'ok' : 'error',
    error: result.ok ? null : result.error || 'Connection failed',
  });
  return { ok: result.ok, error: result.error || null };
}

// ── Worker-only API ───────────────────────────────────────────────────────
// The queue worker uses these to claim, complete, or fail notifications.
// Exported for the worker module — not called by controllers.

export async function claimDuePending(now = new Date(), limit = 10) {
  const db = await getDb();
  // Atomic claim: flip status to 'processing' so concurrent workers don't
  // pick the same row. We also bump `updatedAt` to act as a soft lease.
  const claimable = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        or(
          eq(notifications.status, STATUS.PENDING),
          and(
            eq(notifications.status, STATUS.PROCESSING),
            // Stale lease — pick up rows whose lock expired.
            lte(notifications.updatedAt, new Date(now.getTime() - PROCESSING_LOCK_TIMEOUT_MS))
          )
        ),
        or(isNull(notifications.nextAttemptAt), lte(notifications.nextAttemptAt, now))
      )
    )
    .limit(limit);

  if (claimable.length === 0) return [];
  const ids = claimable.map((r) => r.id);
  const claimed = await db
    .update(notifications)
    .set({ status: STATUS.PROCESSING, updatedAt: new Date() })
    .where(
      and(
        inArray(notifications.id, ids),
        or(eq(notifications.status, STATUS.PENDING), eq(notifications.status, STATUS.PROCESSING))
      )
    )
    .returning();
  return claimed;
}

export async function markSent(id, { resolvedChannel }) {
  const db = await getDb();
  await db
    .update(notifications)
    .set({
      status: STATUS.SENT,
      resolvedChannel: resolvedChannel || null,
      sentAt: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id));
  saveDatabase();
}

export async function markFailed(id, { error, attempts, willRetry }) {
  const db = await getDb();
  const next = willRetry ? new Date(Date.now() + backoffDelayMs(attempts)) : null;
  await db
    .update(notifications)
    .set({
      status: willRetry ? STATUS.PENDING : STATUS.FAILED,
      attempts,
      nextAttemptAt: next,
      error: error ? String(error).slice(0, 500) : null,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id));
  saveDatabase();
}

export async function logProviderCall(params) {
  return insertLog(params);
}

export const NotificationTypes = TYPES;
export const NotificationStatus = STATUS;

export function getTemplates(internal) {
  return listTemplates(internal?.templates || null);
}

export { validatePayload };
