import Fastify from 'fastify';
import config from './config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
const version = packageJson.version || '1.0.0';
// Plugins
import websocket from '@fastify/websocket';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/errorHandler.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import productRoutes from './routes/productRoutes.js';
import saleRoutes from './routes/saleRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import userRoutes from './routes/userRoutes.js';
import currencyRoutes from './routes/currencyRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import backupRoutes from './routes/backupRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import alertWsRoutes from './routes/alertWsRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import resetRoutes from './routes/resetRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import branchRoutes from './routes/branchRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import warehouseTransferRoutes from './routes/warehouseTransferRoutes.js';
import featureFlagsRoutes from './routes/featureFlagsRoutes.js';

// Debug features - only in development
const isProduction = config.server.env === 'production';

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: config.logging.level || 'info',
    transport: config.logging.pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  },
});

// Log server startup information using Fastify logger
// Note: Logger will be available after fastify is initialized

// Start server
const start = async () => {
  try {
    // Register plugins
    // Only register debugger plugin in development
    if (!isProduction) {
      const { default: debuggerPlugin } = await import('./plugins/debugger.js');
      await fastify.register(debuggerPlugin);
    }
    await fastify.register(websocket);
    await fastify.register(securityPlugin);
    await fastify.register(authPlugin);
    await fastify.register(errorHandlerPlugin);

    // Audit logging — auto-logs all mutating API requests
    const { default: auditLogPlugin } = await import('./plugins/auditLog.js');
    await fastify.register(auditLogPlugin);

    // Health check route
    fastify.get('/', async () => {
      return {
        status: 'ok',
        service: 'nuqtaplus Backend API',
        version: version,
        timestamp: new Date().toISOString(),
      };
    });

    fastify.get('/health', async () => {
      return {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    });

    // Infrastructure route: version compatibility check used by Electron
    fastify.get('/version', async () => {
      return { version };
    });

    // Server info endpoint — used by client apps to discover and identify the server.
    // Responds without authentication so clients can probe before login.
    fastify.get('/server-info', async (request) => {
      return {
        name: 'Nuqta Plus Server',
        version,
        mode: 'server',
        host: config.server.host,
        port: config.server.port,
        timestamp: new Date().toISOString(),
        clientIp: request.ip,
      };
    });

    // Register API routes
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(customerRoutes, { prefix: '/api/customers' });
    await fastify.register(productRoutes, { prefix: '/api/products' });
    await fastify.register(saleRoutes, { prefix: '/api/sales' });
    await fastify.register(categoryRoutes, { prefix: '/api/categories' });
    await fastify.register(userRoutes, { prefix: '/api/users' });
    await fastify.register(currencyRoutes, { prefix: '/api/currencies' });
    await fastify.register(settingsRoutes, { prefix: '/api/settings' });
    await fastify.register(backupRoutes, { prefix: '/api/settings/backups' });
    await fastify.register(alertRoutes, { prefix: '/api/alerts' });
    await fastify.register(alertWsRoutes, { prefix: '/api/alerts' });
    await fastify.register(auditRoutes, { prefix: '/api/audit' });
    await fastify.register(resetRoutes, { prefix: '/api/reset' });
    await fastify.register(jobRoutes, { prefix: '/api/jobs' });
    await fastify.register(branchRoutes, { prefix: '/api/branches' });
    await fastify.register(warehouseRoutes, { prefix: '/api/warehouses' });
    await fastify.register(inventoryRoutes, { prefix: '/api/inventory' });
    await fastify.register(warehouseTransferRoutes, { prefix: '/api/warehouse-transfers' });
    await fastify.register(featureFlagsRoutes, { prefix: '/api/feature-flags' });
    // Only register debug routes in development
    if (!isProduction) {
      const { default: debugRoutes } = await import('./routes/debugRoutes.js');
      await fastify.register(debugRoutes, { prefix: '/debug' });
    }

    // Authenticated shutdown route — only admins can trigger
    fastify.post('/__shutdown__', {
      onRequest: [fastify.authenticate],
      config: { skipAudit: true },
    }, async (req, res) => {
      if (req.user?.role !== 'admin') {
        return res.code(403).send({ error: 'Forbidden' });
      }
      fastify.log.info('Shutdown requested via authenticated API call');
      res.send({ message: 'Shutting down...' });
      setTimeout(async () => {
        try {
          await closeServer();
          process.exit(0);
        } catch (err) {
          fastify.log.error('Error closing server:', err);
          process.exit(1);
        }
      }, 200);
    });

    // Delete old draft sales on startup
    try {
      const { SaleService } = await import('./services/saleService.js');
      const saleService = new SaleService();
      const deletedCount = await saleService.deleteOldDrafts();
      if (deletedCount > 0) {
        fastify.log.info(`Deleted ${deletedCount} old draft sale(s) on startup`);
      }
    } catch (error) {
      fastify.log.warn('Failed to delete old drafts on startup:', error.message);
    }

    // Register background jobs (daily credit scoring, etc.)
    try {
      const { registerDefaultJobs } = await import('./jobs/scheduler.js');
      registerDefaultJobs(fastify);
    } catch (error) {
      fastify.log.warn('Failed to register background jobs:', error.message);
    }

    // Initialize ONNX credit scoring model (optional — falls back to rules if absent)
    try {
      const { initCreditScoreModel, getModelStatus } = await import(
        './services/onnxCreditScoringService.js'
      );
      await initCreditScoreModel();
      const status = getModelStatus();
      if (status.available) {
        fastify.log.info(`ONNX credit model loaded: ${status.modelPath}`);
      } else {
        fastify.log.info('ONNX credit model not available — using rule-based scoring');
      }
    } catch (error) {
      fastify.log.warn(`ONNX model init skipped: ${error.message}`);
    }

    // Start listening
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    fastify.log.info('Server successfully started');
    fastify.log.info(`Server running on http://${config.server.host}:${config.server.port}`);
    fastify.log.info(`Environment: ${config.server.env}`);
    fastify.log.info(`Log Level: ${config.logging.level}`);
    fastify.log.info('Ready to accept requests');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

export const closeServer = async () => {
  fastify.log.info('Shutting down server...');
  await fastify.close();

  // Close the PostgreSQL connection pool
  const { closeDatabase } = await import('./db.js');
  await closeDatabase();

  fastify.log.info('Server shut down complete.');
};

start();

// Graceful shutdown on process signals
const gracefulShutdown = async (signal) => {
  fastify.log.info(`${signal} received — shutting down gracefully`);
  try {
    await closeServer();
    process.exit(0);
  } catch (err) {
    fastify.log.error(`Error during ${signal} shutdown:`, err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
