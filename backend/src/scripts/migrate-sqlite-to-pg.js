#!/usr/bin/env node

/**
 * migrate-sqlite-to-pg.js
 *
 * One-shot migration from a SQLite database (the old Nuqta Plus format)
 * into the new PostgreSQL database.
 *
 * Usage:
 *   node src/scripts/migrate-sqlite-to-pg.js <path-to-sqlite.db>
 *
 * Prerequisites:
 *   - `better-sqlite3` must be installed (npm install better-sqlite3 --no-save)
 *   - PG connection is read from env vars (PG_HOST, PG_PORT, PG_DATABASE,
 *     PG_USER, PG_PASSWORD) or DATABASE_URL.  Same vars the backend uses.
 *   - The PG schema must already exist (run `npx drizzle-kit push` first).
 *
 * The script:
 *   1. Reads every row from each SQLite table.
 *   2. Maps column types (integer booleans → PG boolean, text dates → timestamp, etc.)
 *   3. Inserts into PG in FK-safe order inside a single transaction.
 *   4. Resets serial sequences so future inserts get the correct next ID.
 */

import { createRequire } from 'module';
import pg from 'pg';
import { getPgConfig } from '../utils/database.js';

const require = createRequire(import.meta.url);

// ── Config ───────────────────────────────────────────────────────────────────

const SQLITE_PATH = process.argv[2];

if (!SQLITE_PATH) {
  console.error('Usage: node src/scripts/migrate-sqlite-to-pg.js <path-to-sqlite.db>');
  process.exit(1);
}

// Columns that were integer 0/1 in SQLite and are now boolean in PG.
const BOOLEAN_COLUMNS = new Set([
  'is_active',
  'is_base_currency',
]);

// Columns that are timestamp in PG but were text in SQLite.
const TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'last_login_at',
  'payment_date',
  'paid_date',
]);

// Tables in FK-safe insertion order.
const TABLE_ORDER = [
  'users',
  'customers',
  'categories',
  'currency_settings',
  'settings',
  'products',
  'sales',
  'sale_items',
  'payments',
  'installments',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function convertValue(column, value) {
  if (value === null || value === undefined) return null;

  if (BOOLEAN_COLUMNS.has(column)) {
    return value === 1 || value === true || value === 'true';
  }

  if (TIMESTAMP_COLUMNS.has(column)) {
    if (typeof value === 'string' && value.trim() !== '') {
      // SQLite stores dates as ISO strings or "YYYY-MM-DD HH:MM:SS"
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  return value;
}

/**
 * Build a bulk INSERT statement with $1, $2, ... placeholders.
 * Returns { sql, values } ready for pgClient.query().
 */
function buildInsert(table, columns, rows) {
  const colList = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = [];
  const values = [];
  let idx = 1;

  for (const row of rows) {
    const rowPlaceholders = [];
    for (const col of columns) {
      rowPlaceholders.push(`$${idx++}`);
      values.push(convertValue(col, row[col]));
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const sql = `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(', ')}`;
  return { sql, values };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Open SQLite ──────────────────────────────────────────────────────────
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error(
      'better-sqlite3 is required for migration but not installed.\n' +
        'Install it temporarily:  npm install better-sqlite3 --no-save'
    );
    process.exit(1);
  }

  let sqlite;
  try {
    sqlite = new Database(SQLITE_PATH, { readonly: true });
    sqlite.pragma('journal_mode = WAL');
  } catch (err) {
    console.error(`Failed to open SQLite database: ${err.message}`);
    process.exit(1);
  }

  console.log(`SQLite source: ${SQLITE_PATH}`);

  // Get list of tables that actually exist in the SQLite database.
  const existingTables = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
  );

  // ── Connect to PG ───────────────────────────────────────────────────────
  const pgConfig = getPgConfig();
  const pool = new pg.Pool(pgConfig);
  const client = await pool.connect();

  console.log('Connected to PostgreSQL\n');

  try {
    await client.query('BEGIN');

    // Disable FK checks during import so insertion order doesn't matter
    // (we still respect FK order, but this is a safety net).
    await client.query('SET CONSTRAINTS ALL DEFERRED');

    let totalRows = 0;

    for (const table of TABLE_ORDER) {
      if (!existingTables.has(table)) {
        console.log(`  [skip] ${table} — not found in SQLite`);
        continue;
      }

      // Read all rows from SQLite
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();

      if (rows.length === 0) {
        console.log(`  [skip] ${table} — empty`);
        continue;
      }

      // Get column names from the first row
      const columns = Object.keys(rows[0]);

      // Clear the PG table before inserting (in case of re-run)
      await client.query(`DELETE FROM "${table}"`);

      // Insert in batches of 500 to avoid parameter limit
      const BATCH_SIZE = 500;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { sql, values } = buildInsert(table, columns, batch);
        await client.query(sql, values);
      }

      totalRows += rows.length;
      console.log(`  [done] ${table} — ${rows.length} rows`);
    }

    // ── Reset serial sequences ──────────────────────────────────────────
    console.log('\nResetting serial sequences...');
    for (const table of TABLE_ORDER) {
      if (!existingTables.has(table)) continue;

      // Check if table has an 'id' column with a sequence
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
        );
        console.log(`  [done] ${table}.id sequence reset`);
      } catch {
        // Table may not have a serial 'id' column — that's fine.
      }
    }

    await client.query('COMMIT');

    console.log(`\nMigration complete — ${totalRows} total rows migrated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nMigration FAILED — transaction rolled back.');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main();
