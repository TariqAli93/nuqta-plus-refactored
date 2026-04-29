import { z } from 'zod';
import * as svc from '../services/notifications/notificationService.js';
import * as settingsService from '../services/notifications/notificationSettingsService.js';
import { listProviders } from '../services/notifications/providers/index.js';
import { TEMPLATE_KEYS, listTemplates } from '../services/notifications/templates.js';
import { runOverdueReminderJob } from '../services/notifications/overdueReminderJob.js';
import { runOnce } from '../services/notifications/notificationQueue.js';
import { ValidationError } from '../utils/errors.js';

const channelEnum = z.enum(['sms', 'whatsapp', 'auto']);
const phoneFormatEnum = z.enum(['e164', 'international', 'local']);

const settingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.string().min(1).optional(),
    apiKey: z.union([z.string(), z.null()]).optional(),
    senderId: z.union([z.string(), z.null()]).optional(),
    smsEnabled: z.boolean().optional(),
    whatsappEnabled: z.boolean().optional(),
    autoFallbackEnabled: z.boolean().optional(),
    defaultChannel: channelEnum.optional(),
    phoneFormat: z.union([phoneFormatEnum, z.null()]).optional(),
    overdueReminderEnabled: z.boolean().optional(),
    paymentConfirmationEnabled: z.boolean().optional(),
    bulkMessagingEnabled: z.boolean().optional(),
    singleCustomerMessagingEnabled: z.boolean().optional(),
    templates: z
      .union([
        z.null(),
        z.record(
          z.string(),
          z.object({
            body: z.string().min(1),
          })
        ),
      ])
      .optional(),
  })
  .strict();

const customerMessageSchema = z.object({
  customerId: z.number().int().positive(),
  channel: channelEnum.optional().default('auto'),
  message: z.string().min(1, 'Message body is required').max(1600),
});

const bulkMessageSchema = z
  .object({
    customerIds: z.array(z.number().int().positive()).optional(),
    all: z.boolean().optional().default(false),
    channel: channelEnum.optional().default('auto'),
    message: z.string().min(1, 'Message body is required').max(1600),
  })
  .superRefine((d, ctx) => {
    if (!d.all && (!d.customerIds || d.customerIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerIds'],
        message: 'Either provide customerIds or set all=true',
      });
    }
  });

const testConnectionSchema = z
  .object({ apiKey: z.string().optional() })
  .optional();

export class NotificationController {
  async getSettings(_request, reply) {
    const data = await settingsService.getPublic();
    return reply.send({
      success: true,
      data: {
        ...data,
        availableProviders: listProviders(),
        templates: listTemplates(data.templates || null),
        templateKeys: TEMPLATE_KEYS,
      },
    });
  }

  async updateSettings(request, reply) {
    const patch = settingsPatchSchema.parse(request.body || {});
    const updated = await settingsService.update(patch);
    return reply.send({
      success: true,
      data: settingsService.toPublic(updated),
      message: 'Notification settings updated',
    });
  }

  async testConnection(request, reply) {
    const body = testConnectionSchema.parse(request.body || {}) || {};
    const result = await svc.testConnection({ apiKeyOverride: body.apiKey });
    if (result.ok) {
      return reply.send({ success: true, data: { ok: true }, message: 'Connection succeeded' });
    }
    return reply.code(400).send({
      success: false,
      data: { ok: false },
      message: result.error || 'Connection failed',
    });
  }

  async sendCustomerMessage(request, reply) {
    const data = customerMessageSchema.parse(request.body);
    const result = await svc.sendCustomerMessage({
      customerId: data.customerId,
      channel: data.channel,
      message: data.message,
      createdBy: request.user?.id || null,
    });
    if (result?.skipped) {
      return reply.code(409).send({
        success: false,
        data: result,
        message: skipReasonMessage(result.reason),
      });
    }
    return reply.code(201).send({
      success: true,
      data: result,
      message: 'Message queued',
    });
  }

  async sendBulkMessage(request, reply) {
    const data = bulkMessageSchema.parse(request.body);
    const result = await svc.sendBulkCustomerMessage({
      customerIds: data.customerIds || [],
      all: data.all,
      channel: data.channel,
      message: data.message,
      createdBy: request.user?.id || null,
    });
    if (result.queued === 0 && result.skippedReason) {
      return reply.code(409).send({
        success: false,
        data: result,
        message: skipReasonMessage(result.skippedReason),
      });
    }
    return reply.code(201).send({
      success: true,
      data: result,
      message: `${result.queued} message(s) queued`,
    });
  }

  async listNotifications(request, reply) {
    const result = await svc.listNotifications({
      status: request.query.status,
      type: request.query.type,
      customerId: request.query.customerId ? Number(request.query.customerId) : undefined,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      page: request.query.page ? Number(request.query.page) : undefined,
    });
    return reply.send({ success: true, data: result.data, meta: result.meta });
  }

  async listLogs(request, reply) {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ValidationError('Invalid notification id');
    }
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    const data = await svc.listLogs(id, { limit });
    return reply.send({ success: true, data });
  }

  async retry(request, reply) {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ValidationError('Invalid notification id');
    }
    const updated = await svc.retryNotification(id);
    return reply.send({
      success: true,
      data: updated,
      message: 'Notification scheduled for retry',
    });
  }

  /** Manual "process now" — handy for admins after a config change. */
  async processNow(_request, reply) {
    await runOnce();
    return reply.send({ success: true, message: 'Worker tick complete' });
  }

  /** Manual "scan overdue" — outside of the scheduler tick. */
  async scanOverdue(_request, reply) {
    const result = await runOverdueReminderJob();
    return reply.send({ success: true, data: result });
  }
}

function skipReasonMessage(reason) {
  switch (reason) {
    case 'system_disabled':
      return 'Messaging system is disabled';
    case 'feature_disabled':
      return 'This messaging feature is disabled';
    case 'channel_unavailable':
      return 'No channel available — enable SMS or WhatsApp first';
    case 'invalid_phone':
      return 'Recipient phone number is invalid';
    case 'duplicate':
      return 'A notification for this event was already queued';
    default:
      return 'Notification was skipped';
  }
}

export default new NotificationController();
