import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../../db.js';
import { customers, installments, sales } from '../../models/index.js';
import * as settingsService from './notificationSettingsService.js';
import { sendOverdueInstallmentReminder } from './notificationService.js';

/**
 * Scan for installments that became overdue and enqueue reminders.
 *
 * The notification service handles deduping (one reminder per installment per
 * day) so this job is safe to run multiple times a day.
 *
 * Skips entirely when:
 *   - global notification system is disabled
 *   - overdueReminderEnabled is false
 *   - no customer phone available
 */
export async function runOverdueReminderJob({ logger } = {}) {
  const log = logger || console;
  const settings = await settingsService.getInternal();
  if (!settings.enabled || !settings.overdueReminderEnabled) {
    log.debug?.('[overdueReminderJob] skipped — feature disabled');
    return { scanned: 0, queued: 0, skipped: 0, reason: 'feature_disabled' };
  }

  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      installmentId: installments.id,
      saleId: installments.saleId,
      customerId: installments.customerId,
      installmentNumber: installments.installmentNumber,
      dueAmount: installments.dueAmount,
      remainingAmount: installments.remainingAmount,
      currency: installments.currency,
      dueDate: installments.dueDate,
      invoiceNumber: sales.invoiceNumber,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(installments)
    .leftJoin(sales, eq(installments.saleId, sales.id))
    .leftJoin(customers, eq(installments.customerId, customers.id))
    .where(and(eq(installments.status, 'pending'), lt(installments.dueDate, today)));

  let queued = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.customerPhone) {
      skipped += 1;
      continue;
    }
    const result = await sendOverdueInstallmentReminder({
      installment: {
        id: r.installmentId,
        installmentNumber: r.installmentNumber,
        dueAmount: r.dueAmount,
        remainingAmount: r.remainingAmount,
        currency: r.currency,
        dueDate: r.dueDate,
      },
      sale: { id: r.saleId, invoiceNumber: r.invoiceNumber },
      customer: { id: r.customerId, name: r.customerName, phone: r.customerPhone },
    });
    if (result && result.skipped) skipped += 1;
    else if (result) queued += 1;
  }

  log.info?.(
    `[overdueReminderJob] scanned=${rows.length} queued=${queued} skipped=${skipped}`
  );
  return { scanned: rows.length, queued, skipped };
}
