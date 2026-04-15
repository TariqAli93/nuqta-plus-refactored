/**
 * Enhanced Logger Utility
 * نظام تسجيل محسّن للتتبع والتصحيح
 *
 * Usage:
 * import logger from './utils/logger.js';
 * logger.info('User logged in', { userId: 123 });
 * logger.error('Failed to save', { error });
 * logger.debug('Processing data', { data });
 */

import pino from 'pino';
import config from '../config.js';

// Create base logger instance
const baseLogger = pino({
  level: process.env.LOG_LEVEL || config.logging.level || 'info',
  transport: config.logging.pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '{levelLabel} [{context}] {msg}',
        },
      }
    : undefined,
});

/**
 * Create a context-aware logger
 * إنشاء مسجل بسياق محدد
 *
 * @param {string} context - Context name (e.g., 'AuthController', 'UserService')
 * @returns {Object} Logger instance with context
 */
const createLogger = (context = 'App') => {
  return {
    /**
     * Log info level message
     * @param {string} message - Log message
     * @param {Object} meta - Additional metadata
     */
    info: (message, meta = {}) => {
      baseLogger.info({ context, ...meta }, message);
    },

    /**
     * Log error level message
     * @param {string} message - Error message
     * @param {Error|Object} error - Error object or metadata
     */
    error: (message, error = {}) => {
      const errorData =
        error instanceof Error ? { error: error.message, stack: error.stack } : { ...error };
      baseLogger.error({ context, ...errorData }, message);
    },

    /**
     * Log warning level message
     * @param {string} message - Warning message
     * @param {Object} meta - Additional metadata
     */
    warn: (message, meta = {}) => {
      baseLogger.warn({ context, ...meta }, message);
    },

    /**
     * Log debug level message (only in development)
     * @param {string} message - Debug message
     * @param {Object} meta - Additional metadata
     */
    debug: (message, meta = {}) => {
      if (process.env.DEBUG_MODE === 'true' || config.server.env === 'development') {
        baseLogger.debug({ context, ...meta }, message);
      }
    },

    /**
     * Log trace level message (very detailed)
     * @param {string} message - Trace message
     * @param {Object} meta - Additional metadata
     */
    trace: (message, meta = {}) => {
      if (process.env.DEBUG_MODE === 'true') {
        baseLogger.trace({ context, ...meta }, message);
      }
    },

    /**
     * Log successful operation
     * @param {string} message - Success message
     * @param {Object} meta - Additional metadata
     */
    success: (message, meta = {}) => {
      baseLogger.info({ context, success: true, ...meta }, `✅ ${message}`);
    },

    /**
     * Log database query
     * @param {string} query - SQL query or operation
     * @param {Object} params - Query parameters
     */
    query: (query, params = {}) => {
      if (process.env.DEBUG_SQL === 'true') {
        baseLogger.debug({ context: `${context}:DB`, query, params }, 'Database Query');
      }
    },

    /**
     * Log API request
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @param {Object} meta - Additional metadata
     */
    request: (method, url, meta = {}) => {
      baseLogger.info({ context: `${context}:Request`, method, url, ...meta }, 'API Request');
    },

    /**
     * Log API response
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @param {number} statusCode - Response status code
     * @param {number} duration - Request duration in ms
     */
    response: (method, url, statusCode, duration) => {
      const level = statusCode >= 400 ? 'error' : 'info';
      baseLogger[level](
        { context: `${context}:Response`, method, url, statusCode, duration },
        `${method} ${url} - ${statusCode} (${duration}ms)`
      );
    },

    /**
     * Log performance metrics
     * @param {string} operation - Operation name
     * @param {number} duration - Duration in ms
     * @param {Object} meta - Additional metadata
     */
    performance: (operation, duration, meta = {}) => {
      const level = duration > 1000 ? 'warn' : 'debug';
      baseLogger[level](
        { context: `${context}:Performance`, operation, duration, ...meta },
        `${operation} took ${duration}ms`
      );
    },
  };
};

// Export default logger and factory
export default createLogger('App');
export { createLogger };
