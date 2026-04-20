import { getPool } from '../db.js';

export default class ResetService {
  async resetDatabase() {
    const pool = await getPool();

    // Use a single transaction to truncate all application tables.
    // CASCADE ensures dependent rows are also removed.
    // RESTART IDENTITY resets all serial sequences to 1.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get all user tables (excluding drizzle migration tracking)
      const { rows: tables } = await client.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename != '__drizzle_migrations'
      `);

      for (const { tablename } of tables) {
        await client.query(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { success: true, message: 'Database reset successfully.' };
  }
}
