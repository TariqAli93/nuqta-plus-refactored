/**
 * Debug Plugin for Fastify
 * إضافة تصحيح شاملة لـ Fastify
 *
 * Logs all requests, responses, errors, and performance metrics
 * يسجل جميع الطلبات والاستجابات والأخطاء ومقاييس الأداء
 *
 * Features:
 * - Request/Response logging
 * - Query parameter logging
 * - Body payload logging (sanitized)
 * - Error tracking
 * - Performance monitoring
 * - User context tracking
 *
 * Enable: Set DEBUG_MODE=true in .env
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('Debugger');

/**
 * Sanitize sensitive data from objects
 * حذف البيانات الحساسة من الكائنات
 */
const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = { ...obj };
  const sensitiveKeys = ['password', 'token', 'secret', 'jwt', 'authorization'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = '***REDACTED***';
    }
  }

  return sanitized;
};

/**
 * Debug Plugin
 */
async function debuggerPlugin(fastify, _options) {
  const isDebugMode = process.env.DEBUG_MODE === 'true';
  const isDevEnv = process.env.NODE_ENV === 'development';
  const debugRequests = process.env.DEBUG_REQUESTS === 'true' || isDebugMode;
  const debugBodies = process.env.DEBUG_BODIES === 'true' || isDebugMode;
  const debugHeaders = process.env.DEBUG_HEADERS === 'true';

  if (!debugRequests && !isDebugMode) {
    logger.info('Debug plugin registered but disabled. Set DEBUG_MODE=true to enable.');
    return;
  }

  logger.info('🔍 Debug plugin activated', {
    debugRequests,
    debugBodies,
    debugHeaders,
    isDebugMode,
    isDevEnv,
  });

  // Track request start time
  fastify.addHook('onRequest', async (request, _reply) => {
    request.startTime = Date.now();

    if (debugRequests) {
      const logData = {
        requestId: request.id,
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      };

      if (debugHeaders) {
        logData.headers = sanitize(request.headers);
      }

      if (request.query && Object.keys(request.query).length > 0) {
        logData.query = request.query;
      }

      logger.request(request.method, request.url, logData);
    }
  });

  // Log request body (POST/PUT/PATCH)
  fastify.addHook('preHandler', async (request, _reply) => {
    if (debugBodies && request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const sanitizedBody = sanitize(request.body);
      logger.debug('Request Body', {
        requestId: request.id,
        method: request.method,
        url: request.url,
        body: sanitizedBody,
      });
    }
  });

  // Log response
  fastify.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    const statusCode = reply.statusCode;

    if (debugRequests) {
      logger.response(request.method, request.url, statusCode, duration);

      // Log slow requests
      if (duration > 1000) {
        logger.warn('Slow request detected', {
          requestId: request.id,
          method: request.method,
          url: request.url,
          duration,
          statusCode,
        });
      }

      // Log user context if available
      if (request.user) {
        logger.debug('User context', {
          requestId: request.id,
          userId: request.user.id,
          username: request.user.username,
          role: request.user.role,
        });
      }
    }
  });

  // Log errors
  fastify.addHook('onError', async (request, reply, error) => {
    logger.error('Request error', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      error: error.message,
      stack: isDebugMode ? error.stack : undefined,
      statusCode: error.statusCode || 500,
    });
  });

  // Add debug helper to request object
  fastify.decorateRequest('debug', function (message, data = {}) {
    if (isDebugMode) {
      logger.debug(message, {
        requestId: this.id,
        method: this.method,
        url: this.url,
        ...data,
      });
    }
  });

  // Add performance tracker to request object
  fastify.decorateRequest('trackPerformance', function (operationName) {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      logger.performance(operationName, duration, {
        requestId: this.id,
        method: this.method,
        url: this.url,
      });
      return duration;
    };
  });
}

export default debuggerPlugin;
