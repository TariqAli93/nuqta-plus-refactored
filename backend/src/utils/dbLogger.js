/**
 * Database Query Logger
 * مسجل استعلامات قاعدة البيانات
 *
 * Tracks all database operations for debugging
 * يتتبع جميع عمليات قاعدة البيانات للتصحيح
 *
 * Usage:
 * import { logQuery } from './utils/dbLogger.js';
 * logQuery('SELECT', 'users', { where: { id: 1 } });
 */

import { createLogger } from './logger.js';

const logger = createLogger('Database');
const isDebugSQL = process.env.DEBUG_SQL === 'true' || process.env.DEBUG_MODE === 'true';

// Track query statistics
const queryStats = {
  total: 0,
  byType: {},
  byTable: {},
  slowQueries: [],
};

/**
 * Log database query
 * @param {string} operation - Operation type (SELECT, INSERT, UPDATE, DELETE)
 * @param {string} table - Table name
 * @param {Object} details - Query details
 * @param {number} duration - Query duration in ms
 */
export const logQuery = (operation, table, details = {}, duration = null) => {
  if (!isDebugSQL) return;

  queryStats.total++;
  queryStats.byType[operation] = (queryStats.byType[operation] || 0) + 1;
  queryStats.byTable[table] = (queryStats.byTable[table] || 0) + 1;

  const logData = {
    operation,
    table,
    ...details,
  };

  if (duration !== null) {
    logData.duration = duration;

    // Track slow queries (> 100ms)
    if (duration > 100) {
      queryStats.slowQueries.push({
        operation,
        table,
        duration,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 50 slow queries
      if (queryStats.slowQueries.length > 50) {
        queryStats.slowQueries.shift();
      }

      logger.warn('Slow query detected', logData);
    } else {
      logger.query(operation, logData);
    }
  } else {
    logger.query(operation, logData);
  }
};

/**
 * Wrap database operation with performance tracking
 * @param {string} operation - Operation name
 * @param {string} table - Table name
 * @param {Function} fn - Function to execute
 * @returns {Promise} Result of the function
 */
export const trackQuery = async (operation, table, fn) => {
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    logQuery(operation, table, { success: true }, duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logQuery(
      operation,
      table,
      {
        success: false,
        error: error.message,
      },
      duration
    );

    throw error;
  }
};

/**
 * Get query statistics
 * @returns {Object} Query statistics
 */
export const getQueryStats = () => {
  return {
    ...queryStats,
    slowQueries: [...queryStats.slowQueries],
  };
};

/**
 * Reset query statistics
 */
export const resetQueryStats = () => {
  queryStats.total = 0;
  queryStats.byType = {};
  queryStats.byTable = {};
  queryStats.slowQueries = [];
  logger.info('Query statistics reset');
};

/**
 * Print query statistics
 */
export const printQueryStats = () => {
  if (!isDebugSQL) return;

  logger.info('📊 Query Statistics', {
    total: queryStats.total,
    byType: queryStats.byType,
    byTable: queryStats.byTable,
    slowQueriesCount: queryStats.slowQueries.length,
  });

  if (queryStats.slowQueries.length > 0) {
    logger.warn('🐌 Slow Queries', {
      count: queryStats.slowQueries.length,
      queries: queryStats.slowQueries.slice(-10), // Last 10
    });
  }
};

// Print stats every 5 minutes in debug mode
if (isDebugSQL) {
  setInterval(printQueryStats, 5 * 60 * 1000);
}

export default {
  logQuery,
  trackQuery,
  getQueryStats,
  resetQueryStats,
  printQueryStats,
};
