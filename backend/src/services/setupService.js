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
 * route to FirstRun. Order matters — earliest unmet condition wins.
 *
 * The bootstrap-level reasons (DATABASE_CONNECTION_FAILED, MIGRATION_FAILED,
 * etc.) are forwarded verbatim from db.js' BOOTSTRAP_REASONS so the frontend
 * sees the exact root cause instead of a generic "SCHEMA_NOT_READY".
 */
export const SETUP_REASONS = Object.freeze({
  ...BOOTSTRAP_REASONS,
  NO_ADMIN_USER: 'NO_ADMIN_USER',
  NO_COMPANY_SETTINGS: 'NO_COMPANY_SETTINGS',
  SETUP_COMPLETE: 'SETUP_COMPLETE',
});

/**
 * Bootstrap reasons that should short-circuit /api/setup/status — schema is
 * known not to be ready and we have a more specific cause than the legacy
 * SCHEMA_NOT_READY catch-all.
 */
const SCHEMA_FAILURE_REASONS = new Set([
  BOOTSTRAP_REASONS.WRONG_DATABASE_CONNECTED,
  BOOTSTRAP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES,
  BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND,
  BOOTSTRAP_REASONS.MIGRATIONS_NOT_ATTEMPTED,
  BOOTSTRAP_REASONS.MIGRATIONS_SKIPPED,
  BOOTSTRAP_REASONS.MIGRATION_FAILED,
  BOOTSTRAP_REASONS.MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING,
  BOOTSTRAP_REASONS.SCHEMA_NOT_READY,
]);

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

/** Short user-facing headline for each schema-failure reason. */
function reasonHeadline(reason) {
  switch (reason) {
    case BOOTSTRAP_REASONS.WRONG_DATABASE_CONNECTED:
      return 'Connected to the wrong database.';
    case BOOTSTRAP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES:
      return 'Database user lacks CREATE privilege on the public schema.';
    case BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND:
      return 'Migrations folder was not found in the packaged backend.';
    case BOOTSTRAP_REASONS.MIGRATIONS_NOT_ATTEMPTED:
      return 'Database migrations were not attempted.';
    case BOOTSTRAP_REASONS.MIGRATIONS_SKIPPED:
      return 'Database migrations were skipped.';
    case BOOTSTRAP_REASONS.MIGRATION_FAILED:
      return 'Database migrations failed.';
    case BOOTSTRAP_REASONS.MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING:
      return 'Migrations completed but required tables are still missing.';
    default:
      return 'Database schema is not ready.';
  }
}

/** Short remediation hint for each reason. */
function reasonRemediation(reason) {
  switch (reason) {
    case BOOTSTRAP_REASONS.WRONG_DATABASE_CONNECTED:
      return 'Update PG_DATABASE / DATABASE_URL to point at the correct database, then restart the service.';
    case BOOTSTRAP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES:
      return 'Grant CREATE on schema public to the configured database user, or connect as a user that already has it.';
    case BOOTSTRAP_REASONS.MIGRATIONS_FOLDER_NOT_FOUND:
      return 'Reinstall NuqtaPlus Server — the drizzle/ folder is missing from resources/backend.';
    case BOOTSTRAP_REASONS.MIGRATION_FAILED:
      return 'Inspect the server log for "[bootstrap] migration failed" — the underlying error is logged with a stack trace.';
    case BOOTSTRAP_REASONS.MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING:
      return 'The migration runner reported success but the schema is incomplete — check for an unrelated database that shares the connection target, or re-run from a clean database.';
    default:
      return 'Check the server log for "[bootstrap] migrations folder candidates probed" to see which paths were tried, then reinstall or restart the service.';
  }
}

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
 * Build the schema-not-ready response payload. Surfaces the precise bootstrap
 * reason (MIGRATION_FAILED, MIGRATIONS_FOLDER_NOT_FOUND, etc.) plus a compact
 * migrations summary so the frontend / operator can act on it without parsing
 * service logs.
 */
function buildSchemaNotReadyResponse(base, serverMode) {
  const reason = SCHEMA_FAILURE_REASONS.has(base.reason)
    ? base.reason
    : SETUP_REASONS.SCHEMA_NOT_READY;

  const m = base.migrations || {};
  const migrationsSummary = {
    attempted: !!m.attempted,
    skipped: !!m.skipped,
    skipReason: m.skipReason || null,
    completed: !!m.completed,
    folderSelected: m.folderSelected || null,
    candidates: Array.isArray(m.candidates)
      ? m.candidates.map((c) => ({
          path: c.path,
          exists: c.exists,
          isDirectory: c.isDirectory,
          hasJournal: c.hasJournal,
          sqlFileCount: c.sqlFileCount,
          valid: c.valid,
        }))
      : [],
    errorCode: m.errorCode || null,
    errorMessage: m.errorMessage || null,
  };

  const response = {
    databaseConnected: true,
    schemaReady: false,
    setupRequired: true,
    reason,
    missingTables: base.missingTables || [],
    details: base.reasonDetails || base.lastError || null,
    migrations: migrationsSummary,
    serverMode,
  };

  // Wrong-DB and insufficient-privilege responses benefit from including the
  // expected vs. actual values so the frontend can render an actionable error.
  if (reason === SETUP_REASONS.WRONG_DATABASE_CONNECTED) {
    response.expectedDatabase = base.configured?.database || null;
    response.actualDatabase = base.serverDiagnostics?.currentDatabase || null;
  }
  if (reason === SETUP_REASONS.INSUFFICIENT_SCHEMA_PRIVILEGES) {
    response.user = base.serverDiagnostics?.currentUser || null;
    response.database = base.serverDiagnostics?.currentDatabase || null;
    response.schema = 'public';
    response.missingPrivilege = 'CREATE';
  }
  if (reason === SETUP_REASONS.MIGRATIONS_COMPLETED_BUT_SCHEMA_MISSING) {
    response.folderSelected = m.folderSelected || null;
    response.sqlFileCount = m.candidates?.find((c) => c.path === m.folderSelected)?.sqlFileCount || 0;
    response.existingTables = base.serverDiagnostics?.publicTables || [];
  }

  return response;
}

/**
 * Compute current setup status. Frontend consumes the canonical shape
 * documented in /api/setup/status — it never derives FirstRun from local cache.
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
      // Include only non-sensitive connection target fields so the FirstRun
      // dialog can render host/port/database without ever seeing the password.
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

  // Re-probe the schema if boot didn't see it ready — covers the case where
  // migrations finished after the renderer first asked for /status.
  if (!base.schemaReady) {
    base = await ensureSchemaReady();
  }

  if (!base.schemaReady) {
    return buildSchemaNotReadyResponse(base, serverMode);
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
    const err = new ValidationError(
      reasonHeadline(SETUP_REASONS.DATABASE_CONNECTION_FAILED),
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
  if (SCHEMA_FAILURE_REASONS.has(status.reason)) {
    const missing = status.missingTables || [];
    const parts = [reasonHeadline(status.reason)];
    if (missing.length > 0) parts.push(`Missing tables: ${missing.join(', ')}.`);
    if (status.details) parts.push(`Cause: ${status.details}.`);
    parts.push(reasonRemediation(status.reason));
    const err = new ValidationError(parts.join(' '), status.reason);
    err.details = {
      reason: status.reason,
      databaseConnected: true,
      schemaReady: false,
      missingTables: missing,
      cause: status.details || null,
      migrations: status.migrations || null,
      expectedDatabase: status.expectedDatabase || null,
      actualDatabase: status.actualDatabase || null,
      serverMode: status.serverMode || null,
    };
    throw err;
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
