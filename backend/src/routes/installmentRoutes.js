import { InstallmentController } from '../controllers/installmentController.js';

const installmentController = new InstallmentController();

/**
 * Installment routes. Mounted under /api/installments.
 *
 * The collections workflow (call/visit/promise/reschedule/note/payment) is
 * exposed as `actions` on a single installment. Reads are gated by
 * `sales:read`, writes by `sales:update` — the same pair used by sale-side
 * payment endpoints, so no new permission keys are introduced.
 */
export default async function installmentRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/:id/actions', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:read')],
    handler: installmentController.listActions,
    schema: {
      description: 'List collection actions for an installment',
      tags: ['installments'],
      security: [{ bearerAuth: [] }],
    },
  });

  fastify.post('/:id/actions', {
    onRequest: [fastify.authenticate, fastify.authorize('sales:update')],
    handler: installmentController.recordAction,
    schema: {
      description: 'Record a collection action against an installment',
      tags: ['installments'],
      security: [{ bearerAuth: [] }],
    },
  });
}
