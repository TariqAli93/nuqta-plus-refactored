import featureFlagsService, { SETUP_PRESETS } from '../services/featureFlagsService.js';
import auditService from '../services/auditService.js';
import { ValidationError } from '../utils/errors.js';

export class FeatureFlagsController {
  async get(request, reply) {
    const [flags, setupMode] = await Promise.all([
      featureFlagsService.getFeatureFlags(),
      featureFlagsService.getSetupMode(),
    ]);
    return reply.send({ success: true, data: { flags, setupMode } });
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

  async applySetupPreset(request, reply) {
    const preset = request.body?.preset;
    if (!preset || !SETUP_PRESETS[preset]) {
      throw new ValidationError(
        'preset is required — one of: simple | installments | multi_branch'
      );
    }

    const flags = await featureFlagsService.applySetupPreset(preset, request.user?.id);

    await auditService.log({
      userId: request.user?.id,
      username: request.user?.username,
      action: 'settings:setup_wizard_applied',
      resource: 'settings',
      details: { preset, flags },
    });

    return reply.send({ success: true, data: flags, message: 'Setup preset applied' });
  }
}
