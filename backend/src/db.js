import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import * as schema from './models/index.js';

// Ensure data directory exists
const dbPath = config.database.path;
const dbDir = pathDirname(dbPath);
mkdirSync(dbDir, { recursive: true });

// Store sqlite instance for raw queries
let sqliteInstance = null;

// Initialize SQLite database with better-sqlite3
async function initDB() {
  // Open database file (better-sqlite3 works directly on file)
  const sqlite = new Database(dbPath);
  sqliteInstance = sqlite;

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  // Auto-close on process exit
  process.on('exit', () => {
    sqlite.close();
  });
  process.on('SIGINT', () => {
    sqlite.close();
    process.exit(0);
  });

  // Create Drizzle instance
  const db = drizzle(sqlite, { schema });

  // Check if migrations table exists
  const checkMigrationsTable = () => {
    try {
      const result = sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='__drizzle_migrations'
      `
        )
        .all();
      return result.length > 0;
    } catch {
      return false;
    }
  };

  // Run pending migrations only if migrations table doesn't exist or is empty
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = pathDirname(__filename);
  const migrationsFolder = join(__dirname, '../drizzle');

  try {
    const hasMigrationsTable = checkMigrationsTable();

    if (!hasMigrationsTable) {
      // First time - run migrations
      await migrate(db, { migrationsFolder });
      console.log('✅ Database migrations applied successfully');
    } else {
      // Check if all tables exist
      const result = sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='users'
      `
        )
        .all();
      const tablesExist = result.length > 0;

      if (!tablesExist) {
        // Tables missing - run migrations
        await migrate(db, { migrationsFolder });
        console.log('✅ Database migrations applied successfully');
      } else {
        console.log('ℹ️  Database already migrated - skipping');
      }
    }
  } catch (error) {
    // If migration fails because tables exist, it's okay
    if (error.message?.includes('already exists')) {
      console.log('⚠️  Migrations skipped - tables already exist');
    } else {
      throw error;
    }
  }

  // Run roleId -> role migration if needed
  try {
    const { default: migrateRoleIdToRole } = await import('./migrations/migrateRoleIdToRole.js');
    await migrateRoleIdToRole(sqlite); // Pass the sqlite instance
  } catch (error) {
    // Migration is optional - log but don't fail
    console.log('⚠️  Role migration check skipped:', error.message);
  }

  return db;
}

// Export async initialized db promise
export const dbPromise = initDB();

// Cache the resolved db instance
let dbInstance = null;

// Helper to get the db instance (resolves promise once and caches)
export const getDb = async () => {
  if (dbInstance) return dbInstance;
  dbInstance = await dbPromise;
  return dbInstance;
};

// Helper to get the raw SQLite instance for raw queries
export const getSqlite = async () => {
  if (!sqliteInstance) {
    await dbPromise; // Ensure DB is initialized
  }
  return sqliteInstance;
};

// saveDatabase is no longer needed (better-sqlite3 saves automatically)
// But we keep it for backward compatibility (it will be a no-op)
export const saveDatabase = () => {
  // No-op: better-sqlite3 saves automatically
};

export default dbPromise;
