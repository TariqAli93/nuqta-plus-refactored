import { runCreditScoringJob } from '../jobs/creditScoringJob.js';

/**
 * Admin-only endpoints for triggering background jobs manually.
 * Used by ops tooling and the performance benchmark.
 */
export default async function jobRoutes(fastify) {
  fastify.post('/credit-scoring/run', {
    onRequest: [fastify.authenticate, fastify.authorize('settings:manage')],
    handler: async (request, reply) => {
      // Run asynchronously so the HTTP request returns immediately (fire-and-forget).
      // The ?sync=1 flag is used by the benchmark script to measure the full run.
      const sync = request.query?.sync === '1' || request.query?.sync === 'true';
      if (sync) {
        const result = await runCreditScoringJob({ logger: request.log });
        return reply.send({ success: true, data: result });
      }
      runCreditScoringJob({ logger: request.log }).catch((err) =>
        request.log.error({ err }, 'creditScoringJob failed')
      );
      return reply.send({ success: true, message: 'Credit scoring job started' });
    },
    schema: {
      description: 'Manually trigger the daily credit scoring job',
      tags: ['jobs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sync: { type: 'string' },
        },
      },
    },
  });
}
