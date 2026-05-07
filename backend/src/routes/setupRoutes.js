import { getDb, getBootstrapState, getBootstrapDiagnostics } from '../db.js';

export default async function setupRoutes(fastify) {
  fastify.get('/status', async () => {
    const base = getBootstrapState();

    if (!base.databaseReady) {
      return {
        initialized: false,
        databaseReady: false,
        requiresSetup: true,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        // base.lastError is always populated by the new bootstrap pipeline —
        // never falls through to the bare 'database_not_ready' literal.
        reason: base.lastError,
        reasonCode: base.reasonCode,
        attempts: base.attempts,
      };
    }

    try {
      const db = await getDb();
      await db.execute('SELECT 1');

      const usersResult = await db.execute(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
      );
      const adminCount = usersResult.rows?.[0]?.count || 0;
      const requiresSetup = adminCount === 0;

      return {
        initialized: !requiresSetup,
        databaseReady: true,
        requiresSetup,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        reason: requiresSetup ? 'no_admin_user' : 'ready',
        reasonCode: requiresSetup ? 'no_admin_user' : 'ready',
      };
    } catch (error) {
      return {
        initialized: false,
        databaseReady: false,
        requiresSetup: true,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        reason: error.message || 'setup_status_failed',
        reasonCode: 'setup_status_query_failed',
      };
    }
  });

  /**
   * Full bootstrap diagnostics. Returns every fact captured during startup —
   * runtime context (cwd, paths, env file resolution, migrations folder
   * existence), masked DB config, recent log events, and the persistent log
   * file path. The endpoint is intentionally unauthenticated because it's the
   * primary way an admin diagnoses why the backend is not ready (no admin
   * exists yet to authenticate).
   *
   * Secrets are NEVER returned — passwords are masked, tokens are not
   * captured.
   */
  fastify.get('/diagnostics', async () => {
    return getBootstrapDiagnostics();
  });
}
