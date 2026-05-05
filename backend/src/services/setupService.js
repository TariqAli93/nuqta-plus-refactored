import { eq, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  getDb,
  getBootstrapState,
  ensureSchemaReady,
  BOOTSTRAP_REASONS,
} from '../db.js';
import { users, settings } from '../models/index.js';
import { hashPassword } from '../utils/helpers.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import auditService from './auditService.js';
import { setSetupMode } from './featureFlagsService.js';

/**
 * Setup status reasons surfaced to the frontend so it can decide whether to
 * route to FirstRun. The runtime backend only diagnoses — it never creates
 * the database or runs migrations. Those are owned by tools/bootstrap.bat.
 */
export const SETUP_REASONS = Object.freeze({
  ...BOOTSTRAP_REASONS,
  NO_ADMIN_USER: 'NO_ADMIN_USER',
  NO_COMPANY_SETTINGS: 'NO_COMPANY_SETTINGS',
  SETUP_COMPLETE: 'SETUP_COMPLETE',
});

const firstRunSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username cannot exceed 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  phone: z.string().optional(),
  company: z
    .object({
      name: z.string().min(1).optional(),
      city: z.string().optional(),
      area: z.string().optional(),
      street: z.string().optional(),
      phone: z.string().optional(),
      phone2: z.string().optional(),
      invoiceType: z.string().optional(),
    })
    .optional(),
});

async function probeDatabase() {
  try {
    const db = await getDb();
    await db.execute('SELECT 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || 'database probe failed' };
  }
}

async function countAdmins(db) {
  const result = await db.execute(
    "SELECT COUNT(*)::int AS count FROM users WHERE role IN ('admin','global_admin')"
  );
  return result.rows?.[0]?.count || 0;
}

async function hasCompanySettings(db) {
  const rows = await db
    .select()
    .from(settings)
    .where(like(settings.key, 'company.%'))
    .limit(1);
  return rows.length > 0;
}

/**
 * Compute current setup status. Diagnostic only — never repairs.
 *
 * Possible reasons:
 *   DATABASE_CONNECTION_FAILED → backend cannot reach PostgreSQL
 *   SCHEMA_NOT_READY           → schema is missing; run tools\bootstrap.bat
 *   NO_ADMIN_USER              → schema is ready, FirstRun should run
 *   NO_COMPANY_SETTINGS        → admin exists but company settings unset
 *   SETUP_COMPLETE             → fully ready
 */
export async function getSetupStatus() {
  const serverMode = process.env.NUQTA_APP_MODE || 'server';
  let base = getBootstrapState();

  if (!base.databaseReady) {
    return {
      databaseConnected: false,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.DATABASE_CONNECTION_FAILED,
      details: base.reasonDetails || base.lastError || null,
      configured: base.configured
        ? {
            host: base.configured.host,
            port: base.configured.port,
            database: base.configured.database,
            user: base.configured.user,
          }
        : null,
      serverMode,
    };
  }

  const probe = await probeDatabase();
  if (!probe.ok) {
    return {
      databaseConnected: false,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.DATABASE_CONNECTION_FAILED,
      details: probe.message,
      serverMode,
    };
  }

  if (!base.schemaReady) {
    base = await ensureSchemaReady();
  }

  if (!base.schemaReady) {
    return {
      databaseConnected: true,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.SCHEMA_NOT_READY,
      missingTables: base.missingTables || [],
      details:
        base.reasonDetails ||
        'Database schema is not ready. Run tools\\bootstrap.bat as Administrator to apply migrations, then restart the NuqtaPlusBackend service.',
      serverMode,
    };
  }

  const db = await getDb();

  try {
    const adminCount = await countAdmins(db);
    if (adminCount === 0) {
      return {
        databaseConnected: true,
        schemaReady: true,
        setupRequired: true,
        reason: SETUP_REASONS.NO_ADMIN_USER,
        serverMode,
      };
    }

    const companyConfigured = await hasCompanySettings(db);
    if (!companyConfigured) {
      return {
        databaseConnected: true,
        schemaReady: true,
        setupRequired: true,
        reason: SETUP_REASONS.NO_COMPANY_SETTINGS,
        serverMode,
      };
    }

    return {
      databaseConnected: true,
      schemaReady: true,
      setupRequired: false,
      reason: SETUP_REASONS.SETUP_COMPLETE,
      serverMode,
    };
  } catch (error) {
    return {
      databaseConnected: true,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.SCHEMA_NOT_READY,
      details: error.message,
      serverMode,
    };
  }
}

/**
 * Idempotent first-run handler. Creates the first admin user and seeds
 * company settings only — never creates the database or applies migrations.
 * The bootstrap script must have prepared the schema before this runs.
 */
export async function runFirstRun(input, { ipAddress } = {}) {
  const data = firstRunSchema.parse(input);

  const status = await getSetupStatus();
  if (!status.setupRequired) {
    throw new ConflictError('Setup is already complete.');
  }
  if (status.reason === SETUP_REASONS.DATABASE_CONNECTION_FAILED) {
    const err = new ValidationError(
      'Database connection failed. Run tools\\bootstrap.bat as Administrator.',
      SETUP_REASONS.DATABASE_CONNECTION_FAILED
    );
    err.details = {
      reason: status.reason,
      databaseConnected: false,
      schemaReady: false,
      cause: status.details || null,
      serverMode: status.serverMode || null,
    };
    throw err;
  }
  if (status.reason === SETUP_REASONS.SCHEMA_NOT_READY) {
    const missing = status.missingTables || [];
    const parts = ['Database schema is not ready.'];
    if (missing.length > 0) parts.push(`Missing tables: ${missing.join(', ')}.`);
    parts.push(
      'Run tools\\bootstrap.bat as Administrator to apply migrations, then restart the NuqtaPlusBackend service.'
    );
    const err = new ValidationError(parts.join(' '), SETUP_REASONS.SCHEMA_NOT_READY);
    err.details = {
      reason: status.reason,
      databaseConnected: true,
      schemaReady: false,
      missingTables: missing,
      cause: status.details || null,
      serverMode: status.serverMode || null,
    };
    throw err;
  }

  const db = await getDb();

  const adminCount = await countAdmins(db);
  let createdUser = null;

  if (adminCount === 0) {
    const hashedPassword = await hashPassword(data.password);
    const [newUser] = await db
      .insert(users)
      .values({
        username: data.username,
        password: hashedPassword,
        fullName: data.fullName,
        phone: data.phone || null,
        role: 'admin',
        isActive: true,
      })
      .returning({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        role: users.role,
      });
    createdUser = newUser;
    console.log(`[bootstrap] first-run admin created: ${newUser.username}`);
  }

  const company = data.company || {};
  const companyName = company.name || data.fullName || 'My Company';
  const updates = [
    { key: 'company.name', value: String(companyName), description: 'Company name' },
  ];
  for (const field of ['city', 'area', 'street', 'phone', 'phone2', 'invoiceType']) {
    const value = company[field];
    if (value !== undefined && value !== null && value !== '') {
      updates.push({
        key: `company.${field}`,
        value: String(value),
        description: `Company ${field}`,
      });
    }
  }

  for (const u of updates) {
    const [existing] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, u.key))
      .limit(1);
    if (existing) {
      await db
        .update(settings)
        .set({ value: u.value, updatedAt: new Date(), updatedBy: createdUser?.id || null })
        .where(eq(settings.key, u.key));
    } else {
      await db.insert(settings).values({
        ...u,
        updatedBy: createdUser?.id || null,
      });
    }
  }

  try {
    await setSetupMode('done', createdUser?.id || null);
  } catch (error) {
    console.warn(`[bootstrap] could not mark setup mode done: ${error.message}`);
  }

  if (createdUser) {
    await auditService.log({
      userId: createdUser.id,
      username: createdUser.username,
      action: 'system:first-run',
      resource: 'users',
      resourceId: createdUser.id,
      details: { role: 'admin' },
      ipAddress,
    });
  }

  console.log('[bootstrap] setup complete');

  return {
    setupRequired: false,
    reason: SETUP_REASONS.SETUP_COMPLETE,
    user: createdUser
      ? {
          id: createdUser.id,
          username: createdUser.username,
          fullName: createdUser.fullName,
          role: createdUser.role,
        }
      : null,
  };
}
