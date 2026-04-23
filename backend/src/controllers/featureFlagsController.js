import featureFlagsService from '../services/featureFlagsService.js';
import auditService from '../services/auditService.js';

export class FeatureFlagsController {
  async get(request, reply) {
    const data = await featureFlagsService.getFeatureFlags();
    return reply.send({ success: true, data });
  }

  async update(request, reply) {
    const next = await featureFlagsService.updateFeatureFlags(
      request.body || {},
      request.user?.id
    );

    await auditService.log({
      userId: request.user?.id,
      username: request.user?.username,
      action: 'settings:feature_flags_updated',
      resource: 'settings',
      details: next,
    });

    return reply.send({ success: true, data: next, message: 'Feature flags updated' });
  }
}
