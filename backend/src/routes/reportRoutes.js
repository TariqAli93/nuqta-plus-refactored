import reportController from '../controllers/reportController.js';

export default async function reportRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/dashboard', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: reportController.dashboard.bind(reportController),
    schema: {
      description: 'Accounting dashboard report (branch-aware)',
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/export/excel', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: reportController.exportExcel.bind(reportController),
    schema: {
      description: 'Export accounting report as Excel-compatible workbook',
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/export/pdf', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: reportController.exportPdf.bind(reportController),
    schema: {
      description: 'Export accounting report as PDF',
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/aging', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: reportController.aging.bind(reportController),
    schema: {
      description:
        'Receivables aging buckets (0-7, 8-30, 31-60, 61+) — branch-scoped.',
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.get('/profit', {
    onRequest: [fastify.authenticate, fastify.authorize('manage:sales')],
    handler: reportController.profit.bind(reportController),
    schema: {
      description:
        'Profit report — revenue, COGS, expenses, gross/net profit by branch and period.',
      tags: ['reports'],
      security: [{ bearerAuth: [] }],
    },
  });
}
