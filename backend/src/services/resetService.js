import { getSqlite } from '../db.js';

export default class ResetService {
  async resetDatabase() {
    const sqlite = await getSqlite();

    // Disable foreign keys
    sqlite.pragma('foreign_keys = OFF');

    // Get all user tables (excluding sqlite internal tables)
    const tables = sqlite
      .prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != '__drizzle_migrations'
      `
      )
      .all();

    // Delete all data from all tables using transaction
    const transaction = sqlite.transaction(() => {
      for (const { name } of tables) {
        sqlite.prepare(`DELETE FROM "${name}"`).run();
      }

      // Reset auto-increment sequences
      sqlite.prepare('DELETE FROM sqlite_sequence').run();
    });

    transaction();

    // Re-enable foreign keys
    sqlite.pragma('foreign_keys = ON');

    return { success: true, message: 'Database reset successfully.' };
  }
}
