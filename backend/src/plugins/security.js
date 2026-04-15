import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import config from '../config.js';

async function securityPlugin(fastify) {
  // Register Helmet for security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: config.server.env === 'production',
  });

  // Register CORS
  await fastify.register(cors, config.cors);

  // Register Rate Limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    errorResponseBuilder: function (request, context) {
      return {
        code: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds`,
      };
    },
  });
}

export default fp(securityPlugin);
