import { FeatureFlagsController } from '../controllers/featureFlagsController.js';

const controller = new FeatureFlagsController();

export default async function featureFlagsRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  // Read is allowed to every authenticated user — the UI needs it to hide disabled modules.
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: controller.get,
    schema: { description: 'Read feature flags', tags: ['settings'], security: [{ bearerAuth: [] }] },
  });

  fastify.put('/', {
    onRequest: [fastify.authenticate, fastify.authorize('manage_feature_toggles')],
    handler: controller.update,
    schema: { description: 'Update feature flags', tags: ['settings'], security: [{ bearerAuth: [] }] },
  });
}
