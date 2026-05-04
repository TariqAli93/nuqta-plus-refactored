import { eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, getBootstrapState } from '../db.js';
import { users, settings } from '../models/index.js';
import { hashPassword } from '../utils/helpers.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import auditService from './auditService.js';
import { setSetupMode } from './featureFlagsService.js';

/**
 * Setup status reasons surfaced to the frontend so it can decide whether to
 * route to FirstRun. Order matters — earliest unmet condition wins.
 */
export const SETUP_REASONS = Object.freeze({
  DATABASE_CONNECTION_FAILED: 'DATABASE_CONNECTION_FAILED',
  SCHEMA_NOT_READY: 'SCHEMA_NOT_READY',
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
 * Compute current setup status. Frontend consumes the canonical shape
 * documented in /api/setup/status — it never derives FirstRun from local cache.
 */
export async function getSetupStatus() {
  const base = getBootstrapState();
  const serverMode = process.env.NUQTA_APP_MODE || 'server';

  if (!base.databaseReady) {
    return {
      databaseConnected: false,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.DATABASE_CONNECTION_FAILED,
      details: base.lastError || null,
      serverMode,
    };
  }

  // Bootstrap thinks the DB is ready, but verify with a live ping so a pool
  // that died after startup isn't reported as healthy.
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
    return {
      databaseConnected: true,
      schemaReady: false,
      setupRequired: true,
      reason: SETUP_REASONS.SCHEMA_NOT_READY,
      details: base.lastError || null,
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
 * Idempotent first-run handler. Refuses to run when setup is already complete
 * so a leaked endpoint can't reset the admin or replace company settings.
 *
 * Never returns the password or any auth token in the response — the client
 * is expected to log in via /api/auth/login afterwards using the credentials
 * the user just typed.
 */
export async function runFirstRun(input, { ipAddress } = {}) {
  const data = firstRunSchema.parse(input);

  const status = await getSetupStatus();
  if (!status.setupRequired) {
    throw new ConflictError('Setup is already complete.');
  }
  if (status.reason === SETUP_REASONS.DATABASE_CONNECTION_FAILED) {
    throw new ValidationError('Database is not available.');
  }
  if (status.reason === SETUP_REASONS.SCHEMA_NOT_READY) {
    throw new ValidationError('Database schema is not ready.');
  }

  const db = await getDb();

  // Re-check inside a critical section so concurrent first-run calls cannot
  // both create an admin. The unique constraint on users.username also blocks
  // duplicates at the DB level, but checking first lets us return a clean
  // error.
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

  // Company settings — upsert under company.* keys. Always at least seed the
  // company name so a subsequent /status returns SETUP_COMPLETE.
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

  // Mark feature-flag setup wizard as no longer pending so the dashboard
  // doesn't immediately bounce the new admin into the wizard.
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
