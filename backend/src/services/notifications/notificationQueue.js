import * as svc from './notificationService.js';
import * as settingsService from './notificationSettingsService.js';
import { createAdapter } from './providers/index.js';

/**
 * In-process notification queue worker.
 *
 * Why in-process? The whole app already runs as a single Node service (the
 * existing scheduler / credit job lives in the same process), and the message
 * volume is small. A separate broker would be over-engineering and bring an
 * extra dependency to install on the operator's machine.
 *
 * The worker:
 *   1. Wakes up on an interval (default 10s).
 *   2. Skips immediately when notification settings are disabled.
 *   3. Claims up to BATCH_SIZE due rows (status pending OR processing-with-stale-lease).
 *   4. For each row:
 *        a. Re-checks per-channel feature flags.
 *        b. Tries the resolved channel (auto / sms / whatsapp).
 *        c. On failure with auto+fallback enabled, retries the other channel
 *           inside the same attempt.
 *        d. Logs every provider call to notification_logs.
 *        e. Marks the row sent / failed / scheduled-for-retry with backoff.
 *
 * The worker is idempotent + concurrency-safe: even if started twice, the DB
 * UPDATE that flips status from pending → processing claims the row.
 */

const BATCH_SIZE = 10;
const DEFAULT_INTERVAL_MS = 10_000;

let timer = null;
let running = false;
let inFlight = false;
let logger = console;

function buildAdapter(settings) {
  return createAdapter({
    provider: settings.provider,
    apiKey: settings.apiKey,
    senderId: settings.senderId,
  });
}

async function attemptChannel(adapter, channel, notification) {
  const fn = channel === 'whatsapp' ? adapter.sendWhatsapp : adapter.sendSms;
  return fn({ phone: notification.recipientPhone, message: notification.messageBody });
}

async function processOne(notification, settings, adapter) {
  // Re-resolve channel using live settings — operator might have toggled
  // SMS/WhatsApp between the row being queued and now.
  const initial = svc.resolveInitialChannel(notification.channel, settings);
  if (!initial) {
    await svc.markFailed(notification.id, {
      error: 'No channel available — both SMS and WhatsApp are disabled or system off',
      attempts: notification.attempts + 1,
      willRetry: false,
    });
    await svc.logProviderCall({
      notificationId: notification.id,
      provider: settings.provider,
      channel: notification.channel,
      requestPayload: { reason: 'channel_unavailable' },
      status: 'failed',
      error: 'channel_unavailable',
    });
    return;
  }

  const tried = [];
  let lastError = null;
  let lastChannel = initial;
  let result = null;

  let channel = initial;
  while (channel && !tried.includes(channel)) {
    tried.push(channel);
    lastChannel = channel;
    result = await attemptChannel(adapter, channel, notification);
    await svc.logProviderCall({
      notificationId: notification.id,
      provider: settings.provider,
      channel,
      requestPayload: {
        to: notification.recipientPhone,
        message: notification.messageBody,
      },
      responsePayload: result.response || null,
      status: result.ok ? 'ok' : 'error',
      error: result.error || null,
    });

    if (result.ok) {
      await svc.markSent(notification.id, { resolvedChannel: channel });
      return;
    }

    lastError = result.error || 'Provider returned failure';
    // Try fallback?
    const fallback = svc.nextFallbackChannel(channel, notification.channel, settings);
    if (!fallback) break;
    channel = fallback;
  }

  // All channels failed — decide whether to retry the whole notification later.
  const newAttempts = notification.attempts + 1;
  const willRetry = newAttempts < notification.maxAttempts;
  await svc.markFailed(notification.id, {
    error: `[${lastChannel}] ${lastError || 'unknown error'}`,
    attempts: newAttempts,
    willRetry,
  });
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const settings = await settingsService.getInternal();
    if (!settings.enabled) return;
    if (!settings.smsEnabled && !settings.whatsappEnabled) return;

    const adapter = buildAdapter(settings);
    if (!adapter) return; // No API key / unsupported provider — wait until configured.

    const claimed = await svc.claimDuePending(new Date(), BATCH_SIZE);
    if (claimed.length === 0) return;

    for (const n of claimed) {
      try {
        await processOne(n, settings, adapter);
      } catch (err) {
        const newAttempts = (n.attempts || 0) + 1;
        const willRetry = newAttempts < (n.maxAttempts || 5);
        await svc.markFailed(n.id, {
          error: err?.message || 'Worker exception',
          attempts: newAttempts,
          willRetry,
        });
        logger.error?.(`[notification-worker] processing failed for #${n.id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error?.(`[notification-worker] tick failed: ${err.message}`);
  } finally {
    inFlight = false;
  }
}

export function startWorker({ intervalMs = DEFAULT_INTERVAL_MS, log } = {}) {
  if (running) return;
  running = true;
  logger = log || console;
  timer = setInterval(() => {
    tick().catch((err) => logger.error?.(`[notification-worker] unhandled: ${err.message}`));
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info?.(`[notification-worker] started (intervalMs=${intervalMs})`);
}

export function stopWorker() {
  if (!running) return;
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

/** Run a single tick — useful for tests or admin "process now" button. */
export async function runOnce() {
  await tick();
}
