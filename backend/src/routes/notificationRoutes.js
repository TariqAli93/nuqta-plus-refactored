import notificationController from '../controllers/notificationController.js';

/**
 * Notification (messaging) routes. Mounted under /api/notifications.
 *
 * All routes require authentication. Settings + bulk messaging require the
 * 'settings:manage' permission (admin/global_admin); other endpoints map to
 * the existing customer/sale permission set.
 */
export default async function notificationRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/settings', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.getSettings.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Get notification settings (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.put('/settings', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.updateSettings.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Update notification settings (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/settings/test', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.testConnection.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Test provider API key (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/send/customer', {
    onRequest: [fastify.authenticate, fastify.authorize('customers:read')],
    handler: notificationController.sendCustomerMessage.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Send a single customer message',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/send/bulk', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.sendBulkMessage.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Send a message to many or all customers (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.listNotifications.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'List notifications with optional filters',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          type: { type: 'string' },
          customerId: { type: 'number' },
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  });

  fastify.get('/:id/logs', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.listLogs.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Provider call logs for a notification',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/retry', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.retry.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Retry a failed notification',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/process-now', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.processNow.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Run a single worker tick (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/scan-overdue', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: notificationController.scanOverdue.bind(notificationController),
    schema: {
      tags: ['Notifications'],
      summary: 'Scan for overdue installments and queue reminders (admin only)',
      security: [{ bearerAuth: [] }],
    },
  });
}
