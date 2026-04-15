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
import resetRoutes from './routes/resetRoutes.js';

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
    await fastify.register(securityPlugin);
    await fastify.register(authPlugin);
    await fastify.register(errorHandlerPlugin);

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
    await fastify.register(resetRoutes, { prefix: '/api/reset' });
    // Only register debug routes in development
    if (!isProduction) {
      const { default: debugRoutes } = await import('./routes/debugRoutes.js');
      await fastify.register(debugRoutes, { prefix: '/debug' });
    }

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
  fastify.log.info('Server shut down complete.');
};

fastify.post('/__shutdown__', async (req, res) => {
  fastify.log.info('🛑 Shutdown requested from Electron');
  res.send({ message: 'Shutting down...' });

  setTimeout(async () => {
    try {
      await closeServer();
      fastify.log.info('✅ Server closed via HTTP shutdown route');
      process.exit(0);
    } catch (err) {
      fastify.log.error('❌ Error closing server:', err);
      process.exit(1);
    }
  }, 200);
});

start();
