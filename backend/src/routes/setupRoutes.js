import { getSetupStatus, runFirstRun } from '../services/setupService.js';

export default async function setupRoutes(fastify) {
  // GET /api/setup/status — public, used by the SPA on every cold load.
  // Frontend treats `setupRequired === true` as the single signal to route
  // to FirstRun; backend is authoritative.
  fastify.get('/status', async () => {
    const status = await getSetupStatus();
    fastify.log.info(
      { reason: status.reason, setupRequired: status.setupRequired },
      `[bootstrap] /api/setup/status: ${status.reason}`
    );
    return status;
  });

  // POST /api/setup/first-run — public so it's reachable from a fresh,
  // user-less install. The service rejects the call when setup is already
  // complete, so a leaked endpoint cannot overwrite admin credentials.
  fastify.post(
    '/first-run',
    {
      config: {
        // Don't include the password body in the audit log payload.
        skipAuditBody: true,
        rateLimit: {
          max: 5,
          timeWindow: '5 minutes',
        },
      },
      schema: {
        description: 'Initialize the system with the first admin user and company defaults',
        tags: ['setup'],
        body: {
          type: 'object',
          required: ['username', 'password', 'fullName'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
            fullName: { type: 'string' },
            phone: { type: 'string' },
            company: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                city: { type: 'string' },
                area: { type: 'string' },
                street: { type: 'string' },
                phone: { type: 'string' },
                phone2: { type: 'string' },
                invoiceType: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await runFirstRun(request.body, { ipAddress: request.ip });
      return reply.code(201).send(result);
    }
  );
}
