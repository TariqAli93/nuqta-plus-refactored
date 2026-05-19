import remoteAccessController from '../controllers/remoteAccessController.js';

const statusSchema = {
  tags: ['RemoteAccess'],
  summary: 'Get remote-access (Cloudflare Tunnel) status',
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            running: { type: 'boolean' },
            subdomain: { type: 'string' },
            publicUrl: { type: 'string' },
            tunnelId: { type: 'string' },
            machineId: { type: 'string' },
            configExists: { type: 'boolean' },
            cloudflaredAvailable: { type: 'boolean' },
          },
        },
      },
    },
  },
};

const enableDisableSchema = (summary) => ({
  tags: ['RemoteAccess'],
  summary,
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object', additionalProperties: true },
      },
    },
  },
});

export default async function remoteAccessRoutes(fastify) {
  fastify.get('/status', {
    schema: statusSchema,
    onRequest: [fastify.authenticate, fastify.authorize('settings:read')],
    handler: remoteAccessController.getStatus.bind(remoteAccessController),
  });

  fastify.post('/enable', {
    schema: enableDisableSchema('Enable remote access (Cloudflare Tunnel)'),
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: remoteAccessController.enable.bind(remoteAccessController),
  });

  fastify.post('/disable', {
    schema: enableDisableSchema('Disable remote access (Cloudflare Tunnel)'),
    onRequest: [fastify.authenticate, fastify.authorize('settings:update')],
    handler: remoteAccessController.disable.bind(remoteAccessController),
  });
}
