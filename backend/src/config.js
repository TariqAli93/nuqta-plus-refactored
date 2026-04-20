import 'dotenv/config';
import { getPgConfig } from './utils/database.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// ── JWT secret ────────────────────────────────────────────────────────────
// In production, a strong random secret MUST be provided via JWT_SECRET env.
// The default is only acceptable during local development.
const DEFAULT_JWT_SECRET = 'nuqtaplus_2025_secure_jwt_secret_key_d8f7a6b5c4e3f2a1b0c9d8e7f6a5b4c3';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (isProduction && !process.env.JWT_SECRET) {
  console.warn('');
  console.warn('  SECURITY WARNING: Using default JWT secret in production!');
  console.warn('  Set the JWT_SECRET environment variable with a strong, random secret.');
  console.warn('');
}

const config = {
  server: {
    // Default port 41732 — matches packages/shared BACKEND_PORT.
    port: parseInt(process.env.PORT || '41732', 10),
    // Bind to 0.0.0.0 so LAN clients can connect.
    // In development, you can override to 127.0.0.1 via HOST env.
    host: process.env.HOST || '0.0.0.0',
    env: NODE_ENV,
  },
  jwt: {
    secret: JWT_SECRET,
    expiresIn: '7d',
  },
  database: getPgConfig(),
  rateLimit: {
    // High limits intentional — backend serves a desktop app.
    // Adjust via RATE_LIMIT_MAX and RATE_LIMIT_TIMEWINDOW env vars.
    max: parseInt(process.env.RATE_LIMIT_MAX || '1000000', 10),
    timeWindow: parseInt(process.env.RATE_LIMIT_TIMEWINDOW || '900000', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: !isProduction,
  },
  cors: {
    // Allow all origins — the backend is on a LAN, not the public internet.
    // Electron and browser clients from any LAN IP need to connect.
    origin: true,
    credentials: true,
  },
};

export default config;
