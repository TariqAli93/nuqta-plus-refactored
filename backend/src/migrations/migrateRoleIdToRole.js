import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import config from '../config.js';

/**
 * Migration script to convert roleId to role enum
 * This handles existing databases that have roleId column
 *
 * Strategy:
 * 1. Check if roleId column exists
 * 2. If it exists, try to map roleId to role string based on roles table
 * 3. If roles table doesn't exist or mapping fails, use safe defaults:
 *    - First user (lowest ID) = 'admin'
 *    - All others = 'cashier'
 * 4. Add role column if it doesn't exist
 * 5. Backfill role values
 * 6. Note: roleId column is left in place (can be dropped manually later)
 */
async function migrateRoleIdToRole(sqliteInstance = null) {
  console.log('🔄 Starting roleId -> role migration...\n');

  try {
    let sqlite;
    let shouldClose = false;

    // If sqlite instance is provided, use it (from main app)
    // Otherwise, open our own instance
    if (sqliteInstance) {
      sqlite = sqliteInstance;
      console.log('→ Using provided SQLite instance');
    } else {
      // Get direct access to SQLite for raw SQL operations
      const dbPath = config.database.path;
      if (!existsSync(dbPath)) {
        console.log('✓ No database file found - migration not needed');
        return;
      }

      sqlite = new Database(dbPath);
      shouldClose = true;
    }

    // First, check if users table exists
    const usersTableCheck = sqlite
      .prepare(
        `
      SELECT name FROM sqlite_master WHERE type='table' AND name='users'
    `
      )
      .all();
    if (!usersTableCheck.length) {
      console.log('✓ Users table does not exist yet - migration will run when table is created');
      if (shouldClose) sqlite.close();
      return;
    }

    // Check if role column exists - ALWAYS ensure it exists
    const roleCheck = sqlite
      .prepare(
        `
      SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='role'
    `
      )
      .get();
    const hasRole = roleCheck && roleCheck.count > 0;

    // Add role column if it doesn't exist (CRITICAL - always do this)
    if (!hasRole) {
      console.log('→ Adding role column to users table...');
      sqlite.prepare(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'cashier'`).run();
      console.log('✓ Role column added');
    } else {
      console.log('✓ Role column already exists');
    }

    // Now check if roleId column exists (for migration from old schema)
    const roleIdCheck = sqlite
      .prepare(
        `
      SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='role_id'
    `
      )
      .get();
    const hasRoleId = roleIdCheck && roleIdCheck.count > 0;

    if (!hasRoleId) {
      console.log('✓ No roleId column found - schema is already using role column');
      // Ensure role column exists
      if (!hasRole) {
        console.log('→ Adding role column (no roleId migration needed)...');
        sqlite.prepare(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'cashier'`).run();
        console.log('✓ Role column added');
      }
      // Close if we opened our own instance
      if (shouldClose) {
        sqlite.close();
      }
      console.log('✅ Migration completed - role column ensured');
      return;
    }

    console.log('→ Found roleId column, migrating data to role column...');

    // Try to get role mapping from roles table if it exists
    let roleMapping = {};
    try {
      const rolesTableCheck = sqlite
        .prepare(
          `
        SELECT name FROM sqlite_master WHERE type='table' AND name='roles'
      `
        )
        .all();

      if (rolesTableCheck.length > 0) {
        console.log('→ Found roles table, attempting to map roleId to role...');
        const rolesData = sqlite.prepare(`SELECT id, name FROM roles`).all();

        if (rolesData.length > 0) {
          for (const row of rolesData) {
            roleMapping[row.id] = row.name;
          }
          console.log(`✓ Mapped ${Object.keys(roleMapping).length} roles`);
        }
      }
    } catch (error) {
      console.log('⚠️  Could not read roles table (may not exist), using safe defaults');
      console.error(error);
    }

    // Get all users with roleId
    const usersWithRoleId = sqlite
      .prepare(
        `
      SELECT id, role_id FROM users WHERE role_id IS NOT NULL
    `
      )
      .all();

    if (!usersWithRoleId.length) {
      console.log('→ No users with roleId found');
    } else {
      console.log(`→ Found ${usersWithRoleId.length} users with roleId, updating...`);

      // Find the first user (lowest ID) - will be admin
      const firstUserId = Math.min(...usersWithRoleId.map((u) => u.id));

      const updateStmt = sqlite.prepare(`UPDATE users SET role = ? WHERE id = ?`);

      for (const user of usersWithRoleId) {
        let roleValue = 'cashier'; // default

        // If we have a mapping, use it
        if (roleMapping[user.role_id]) {
          roleValue = roleMapping[user.role_id];
        } else if (user.id === firstUserId) {
          // First user becomes admin as safe default
          roleValue = 'admin';
          console.log(`  → User ${user.id} (first user) -> admin (safe default)`);
        }

        // Update user role
        updateStmt.run(roleValue, user.id);
      }

      console.log(`✓ Updated ${usersWithRoleId.length} users`);
    }

    // Update users without roleId to default 'cashier'
    const usersWithoutRoleId = sqlite
      .prepare(
        `
      SELECT id FROM users WHERE (role_id IS NULL OR role_id = '') AND (role IS NULL OR role = '')
    `
      )
      .all();

    if (usersWithoutRoleId.length > 0) {
      console.log(
        `→ Setting default role 'cashier' for ${usersWithoutRoleId.length} users without roleId...`
      );
      sqlite
        .prepare(
          `UPDATE users SET role = 'cashier' WHERE (role_id IS NULL OR role_id = '') AND (role IS NULL OR role = '')`
        )
        .run();
      console.log('✓ Default role set');
    }

    // Close if we opened our own instance
    if (shouldClose) {
      sqlite.close();
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('⚠️  Note: roleId column still exists but is no longer used.');
    console.log('   You can manually drop it later with: ALTER TABLE users DROP COLUMN role_id');
    console.log('   (Not done automatically to prevent data loss)');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    // Don't throw - allow app to continue even if migration fails
    console.log('⚠️  Continuing without migration...');
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateRoleIdToRole()
    .then(() => {
      console.log('\n✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration script failed:', error);
      process.exit(1);
    });
}

export default migrateRoleIdToRole;
