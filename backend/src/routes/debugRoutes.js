/**
 * Debug Routes
 * مسارات التصحيح
 *
 * Provides endpoints for debugging and monitoring
 * يوفر نقاط نهاية للتصحيح والمراقبة
 *
 * ⚠️ Should be disabled in production or protected with authentication
 */

import { getQueryStats, resetQueryStats, printQueryStats } from '../utils/dbLogger.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DebugRoutes');

export default async function debugRoutes(fastify, _options) {
  const isDebugMode = process.env.DEBUG_MODE === 'true';
  const isDevEnv = process.env.NODE_ENV === 'development';

  if (!isDebugMode && !isDevEnv) {
    logger.warn('Debug routes disabled in production');
    return;
  }

  logger.info('🔧 Debug routes registered');

  /**
   * GET /debug/health
   * Health check endpoint with detailed information
   */
  fastify.get('/debug/health', async (_request, _reply) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      status: 'healthy',
      environment: process.env.NODE_ENV,
      uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
      },
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /debug/stats
   * Get application statistics
   */
  fastify.get('/debug/stats', async (_request, _reply) => {
    const queryStats = getQueryStats();
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      uptime: {
        seconds: uptime,
        formatted: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      },
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      database: {
        totalQueries: queryStats.total,
        queriesByType: queryStats.byType,
        queriesByTable: queryStats.byTable,
        slowQueriesCount: queryStats.slowQueries.length,
      },
      process: {
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /debug/queries
   * Get database query statistics
   */
  fastify.get('/debug/queries', async (_request, _reply) => {
    return getQueryStats();
  });

  /**
   * GET /debug/queries/print
   * Print query statistics to console
   */
  fastify.get('/debug/queries/print', async (_request, _reply) => {
    printQueryStats();
    return { message: 'Query statistics printed to console' };
  });

  /**
   * POST /debug/queries/reset
   * Reset query statistics
   */
  fastify.post('/debug/queries/reset', async (_request, _reply) => {
    resetQueryStats();
    return { message: 'Query statistics reset' };
  });

  /**
   * GET /debug/config
   * Get current configuration (sanitized)
   */
  fastify.get('/debug/config', async (_request, _reply) => {
    return {
      environment: process.env.NODE_ENV,
      debugMode: process.env.DEBUG_MODE === 'true',
      debugSQL: process.env.DEBUG_SQL === 'true',
      debugRequests: process.env.DEBUG_REQUESTS === 'true',
      debugBodies: process.env.DEBUG_BODIES === 'true',
      logLevel: process.env.LOG_LEVEL || 'info',
      port: process.env.PORT,
      host: process.env.HOST,
    };
  });

  /**
   * GET /debug/routes
   * List all registered routes
   */
  fastify.get('/debug/routes', async (_request, _reply) => {
    const routes = [];

    fastify.routes.forEach((route) => {
      routes.push({
        method: route.method,
        url: route.url,
        path: route.path,
      });
    });

    return {
      count: routes.length,
      routes: routes.sort((a, b) => a.url.localeCompare(b.url)),
    };
  });

  /**
   * POST /debug/log
   * Send custom log message (for testing)
   */
  fastify.post('/debug/log', async (request, reply) => {
    const { level = 'info', message, data } = request.body;

    if (!message) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    logger[level]?.(message, data || {});

    return {
      message: 'Log sent',
      level,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /debug/error
   * Trigger test error (for testing error handling)
   */
  fastify.get('/debug/error', async (_request, _reply) => {
    throw new Error('Test error from debug endpoint');
  });
}
