import 'dotenv/config';
import { dbFilePath } from './utils/database.js';

process.env.DATABASE_PATH = dbFilePath;

const DEFAULT_JWT_SECRET = 'nuqtaplus_2025_secure_jwt_secret_key_d8f7a6b5c4e3f2a1b0c9d8e7f6a5b4c3';
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const isProduction = NODE_ENV === 'production';

// Warn if using default JWT secret in production
if (isProduction && !process.env.JWT_SECRET) {
  console.warn('');
  console.warn('⚠️  SECURITY WARNING: Using default JWT secret in production!');
  console.warn('⚠️  This is insecure and should be changed immediately.');
  console.warn('⚠️  Please set the JWT_SECRET environment variable with a strong, random secret.');
  console.warn('⚠️  Example: JWT_SECRET="your-strong-random-secret-here"');
  console.warn('');
}

const config = {
  server: {
    port: process.env.PORT || 3050,
    host: process.env.HOST || '127.0.0.1',
    env: NODE_ENV,
  },
  jwt: {
    // JWT_SECRET environment variable should be set in production
    // See documentation for security requirements
    secret: JWT_SECRET,
    expiresIn: '7d',
  },
  database: {
    path: process.env.DATABASE_PATH || dbFilePath,
  },
  rateLimit: {
    // Rate limiting configuration
    // Note: High limits (1M requests per 15 min) are intentional for desktop app
    // The backend is only accessible from localhost, so these limits prevent abuse
    // while allowing legitimate high-frequency operations (e.g., real-time updates)
    // Adjust via RATE_LIMIT_MAX and RATE_LIMIT_TIMEWINDOW environment variables if needed
    max: parseInt(process.env.RATE_LIMIT_MAX || '1000000', 10),
    timeWindow: parseInt(process.env.RATE_LIMIT_TIMEWINDOW || '900000', 10), // 15 minutes in milliseconds
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // Use pretty logging only in development for better readability
    // In production, use structured JSON logs for better parsing and monitoring
    pretty: !isProduction,
  },
  cors: {
    origin: true,
    credentials: true,
  },
};

export default config;
