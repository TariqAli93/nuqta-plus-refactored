import { getDb, getBootstrapState } from '../db.js';

export default async function setupRoutes(fastify) {
  fastify.get('/status', async () => {
    const base = getBootstrapState();

    if (!base.databaseReady) {
      return {
        initialized: false,
        databaseReady: false,
        requiresSetup: true,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        reason: base.lastError || 'database_not_ready',
      };
    }

    try {
      const db = await getDb();
      await db.execute('SELECT 1');

      const usersResult = await db.execute("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
      const adminCount = usersResult.rows?.[0]?.count || 0;
      const requiresSetup = adminCount === 0;

      return {
        initialized: !requiresSetup,
        databaseReady: true,
        requiresSetup,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        reason: requiresSetup ? 'no_admin_user' : 'ready',
      };
    } catch (error) {
      return {
        initialized: false,
        databaseReady: false,
        requiresSetup: true,
        serverMode: process.env.NUQTA_APP_MODE || 'server',
        reason: error.message || 'setup_status_failed',
      };
    }
  });
}
