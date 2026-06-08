import AdmZip from 'adm-zip';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPool } from '../db.js';
import { ValidationError } from '../utils/errors.js';
import { encodeBackup, decodeBackup, sha256 } from '../utils/backupCodec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

// Format version of the backup itself (manifest schema). Bump when the layout
// changes in a way older apps can't read. Restore accepts any version <= this.
export const BACKUP_VERSION = 1;

// Reject decoded archives larger than this to bound memory use on restore.
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024; // 200 MB

const SENSITIVE_WARNING =
  'This backup may contain sensitive data (users, password hashes, customers, ' +
  'sales and payments). Store it securely and only restore on a trusted machine.';

/**
 * Selectable backup groups. Each maps to one or more REAL database tables
 * (verified against models/schema.js). `tables` are listed parent-first so a
 * group is internally consistent; the global RESTORE_ORDER below handles
 * cross-group ordering.
 */
export const BACKUP_GROUPS = Object.freeze({
  products: { label: 'المنتجات', tables: ['products'] },
  categories: { label: 'الفئات', tables: ['categories'] },
  branches: { label: 'الفروع', tables: ['branches'] },
  warehouses: { label: 'المخازن', tables: ['warehouses'] },
  productStock: { label: 'أرصدة المخزون', tables: ['product_stock'] },
  productStockEntries: { label: 'دفعات المخزون', tables: ['product_stock_entries'] },
  stockMovements: { label: 'حركات المخزون', tables: ['stock_movements'] },
  warehouseTransfers: { label: 'تحويلات المخازن', tables: ['warehouse_transfers'] },
  cashSessions: { label: 'جلسات الصندوق', tables: ['cash_sessions'] },
  sales: {
    label: 'المبيعات',
    tables: [
      'sales',
      'sale_items',
      'sale_item_stock_entries',
      'sale_returns',
      'sale_return_items',
    ],
  },
  payments: { label: 'المدفوعات', tables: ['payments'] },
  users: { label: 'المستخدمون', tables: ['users'] },
  customers: { label: 'العملاء', tables: ['customers'] },
  settings: { label: 'الإعدادات', tables: ['settings'] },
  expenses: { label: 'المصروفات', tables: ['expenses'] },
});

/**
 * Global table restore order (parents → children), derived from the real
 * foreign keys in models/schema.js. Restore inserts in this order and deletes
 * in the reverse. Only tables belonging to selected groups are touched.
 */
export const RESTORE_ORDER = Object.freeze([
  'settings',
  'users',
  'branches',
  'warehouses',
  'categories',
  'products',
  'customers',
  'product_stock',
  'product_stock_entries',
  'cash_sessions',
  'sales',
  'sale_items',
  'sale_item_stock_entries',
  'sale_returns',
  'sale_return_items',
  'payments',
  'stock_movements',
  'warehouse_transfers',
  'expenses',
]);

// Whitelist of every table any group can touch — used to reject unexpected
// identifiers before they ever reach a SQL string.
const ALLOWED_TABLES = new Set(Object.values(BACKUP_GROUPS).flatMap((g) => g.tables));

function assertKnownTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Refusing to operate on unknown table: ${table}`);
  }
}

/** Validate and de-duplicate a list of requested group keys. */
function normalizeGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new ValidationError('Select at least one data group to back up');
  }
  const known = new Set(Object.keys(BACKUP_GROUPS));
  const unknown = groups.filter((g) => !known.has(g));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown backup group(s): ${unknown.join(', ')}`);
  }
  // preserve canonical order so the manifest is deterministic
  return Object.keys(BACKUP_GROUPS).filter((g) => groups.includes(g));
}

/** Tables for a set of groups, in canonical restore order. */
export function tablesForGroups(groups) {
  const wanted = new Set(groups.flatMap((g) => BACKUP_GROUPS[g].tables));
  return RESTORE_ORDER.filter((t) => wanted.has(t));
}

/** Map a table back to the group that owns it. */
function groupOfTable(table) {
  for (const [key, def] of Object.entries(BACKUP_GROUPS)) {
    if (def.tables.includes(table)) return key;
  }
  return null;
}

export class DataBackupService {
  constructor() {
    this.appName = 'NuqtaPlus';
    this.appVersion = pkg.version || '1.0.0';
  }

  // ── Encoding helpers (delegated, kept here for a single import surface) ────
  encodeBackup = encodeBackup;
  decodeBackup = decodeBackup;

  /**
   * Build the encoded .nqbackup archive from already-fetched data. Pure: no
   * database access, so it is fully unit-testable.
   *
   * @param {Object<string, Array>} dataByTable  table name -> rows
   * @param {string[]} groups  selected group keys (canonical order)
   * @param {Object} [meta]  { dbVersion, createdAt }
   * @returns {{ buffer: Buffer, content: string, manifest: object }}
   */
  buildArchive(dataByTable, groups, meta = {}) {
    const zip = new AdmZip();
    const files = {};
    const counts = {};

    for (const group of groups) {
      counts[group] = 0;
      for (const table of BACKUP_GROUPS[group].tables) {
        const rows = dataByTable[table] || [];
        const path = `data/${table}.json`;
        const json = JSON.stringify(rows, null, 2);
        const buf = Buffer.from(json, 'utf8');
        zip.addFile(path, buf);
        files[table] = {
          path,
          group,
          rows: rows.length,
          checksum: sha256(buf),
        };
        counts[group] += rows.length;
      }
    }

    const manifest = {
      app: this.appName,
      backupVersion: BACKUP_VERSION,
      appVersion: this.appVersion,
      createdAt: (meta.createdAt || new Date()).toISOString?.() ?? meta.createdAt,
      database: { type: 'postgresql', version: meta.dbVersion || null },
      selectedGroups: groups,
      counts,
      files,
      warning: SENSITIVE_WARNING,
    };

    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    const buffer = zip.toBuffer();
    return { buffer, content: encodeBackup(buffer), manifest };
  }

  /**
   * Create a backup for the selected groups: fetch from the DB, build the
   * archive, and return the encoded file content ready to save.
   */
  async create(groups) {
    const selected = normalizeGroups(groups);
    const pool = await getPool();

    let dbVersion = null;
    try {
      const r = await pool.query('SELECT version() AS v');
      dbVersion = r.rows[0]?.v?.split(',')[0] || null;
    } catch {
      // version() is best-effort metadata; never fail a backup over it.
    }

    const colMeta = await this._loadColumnMeta(pool);
    const dataByTable = {};
    for (const table of tablesForGroups(selected)) {
      assertKnownTable(table);
      // Exclude generated columns (e.g. the search_* columns added by the
      // search infrastructure) — they can't be re-inserted on restore.
      const meta = colMeta.get(table);
      const cols = meta.ordered.filter((c) => !meta.generated.has(c));
      const select = cols.map((c) => `"${c}"`).join(', ');
      const result = await pool.query(`SELECT ${select} FROM "${table}" ORDER BY id`);
      dataByTable[table] = result.rows;
    }

    const createdAt = new Date();
    const { content, manifest } = this.buildArchive(dataByTable, selected, {
      dbVersion,
      createdAt,
    });

    return { filename: this._filename(createdAt), content, manifest };
  }

  /**
   * Decode, open, and fully validate an encoded backup. Verifies the codec
   * header, ZIP integrity, manifest shape, version compatibility, entry paths
   * (no traversal), and every declared checksum.
   *
   * @returns {{ manifest: object, zip: AdmZip }}
   */
  parseBackup(content) {
    const buffer = decodeBackup(content); // throws on bad header / corrupt base64
    if (buffer.length > MAX_BACKUP_BYTES) {
      throw new ValidationError('Backup file exceeds the maximum allowed size');
    }

    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new ValidationError('Backup file is not a valid archive');
    }

    // Reject any entry with a traversal or absolute path before reading.
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      if (name.includes('..') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
        throw new ValidationError(`Unsafe path in backup archive: ${name}`);
      }
      if (name !== 'manifest.json' && !name.startsWith('data/')) {
        throw new ValidationError(`Unexpected entry in backup archive: ${name}`);
      }
    }

    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      throw new ValidationError('Backup is missing manifest.json');
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch {
      throw new ValidationError('Backup manifest is not valid JSON');
    }

    if (manifest.app !== this.appName) {
      throw new ValidationError('This file is not a NuqtaPlus backup');
    }
    if (!Number.isInteger(manifest.backupVersion) || manifest.backupVersion > BACKUP_VERSION) {
      throw new ValidationError(
        `Unsupported backup version ${manifest.backupVersion}. Please update the app.`
      );
    }
    if (!manifest.files || typeof manifest.files !== 'object') {
      throw new ValidationError('Backup manifest is missing the files section');
    }

    // Verify every declared file exists and matches its checksum.
    for (const info of Object.values(manifest.files)) {
      const entry = zip.getEntry(info.path);
      if (!entry) {
        throw new ValidationError(`Backup is missing data file: ${info.path}`);
      }
      const data = entry.getData();
      if (info.checksum && sha256(data) !== info.checksum) {
        throw new ValidationError(`Checksum mismatch for ${info.path} — backup is corrupt`);
      }
    }

    return { manifest, zip };
  }

  /** Decode and return only the manifest, for the restore preview screen. */
  preview(content) {
    const { manifest } = this.parseBackup(content);
    return manifest;
  }

  /** Read and structurally validate one table's rows from an opened archive. */
  _readTable(zip, manifest, table) {
    const info = manifest.files[table];
    const entry = zip.getEntry(info.path);
    let rows;
    try {
      rows = JSON.parse(entry.getData().toString('utf8'));
    } catch {
      throw new ValidationError(`Data file ${info.path} is not valid JSON`);
    }
    if (!Array.isArray(rows)) {
      throw new ValidationError(`Data file ${info.path} must be a JSON array`);
    }
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new ValidationError(`Data file ${info.path} contains an invalid row`);
      }
    }
    return rows;
  }

  /**
   * Restore selected groups from an encoded backup, transactionally.
   *
   * @param {Object} opts
   * @param {string} opts.content       encoded .nqbackup file content
   * @param {string[]} [opts.groups]    groups to restore (defaults to all in the backup)
   * @param {'replace'} [opts.mode]     restore mode (only 'replace' supported)
   * @returns {Promise<object>} summary { mode, restoredGroups, skippedGroups, counts }
   */
  async restore({ content, groups, mode = 'replace' }) {
    if (mode !== 'replace') {
      throw new ValidationError(`Unsupported restore mode: ${mode}`);
    }

    const { manifest, zip } = this.parseBackup(content);
    const available = manifest.selectedGroups || [];

    // Resolve which groups to restore: requested ∩ available, or all available.
    let requested;
    if (Array.isArray(groups) && groups.length > 0) {
      const normalized = normalizeGroups(groups);
      const missing = normalized.filter((g) => !available.includes(g));
      if (missing.length > 0) {
        throw new ValidationError(
          `Selected group(s) are not in this backup: ${missing.join(', ')}`
        );
      }
      requested = normalized;
    } else {
      requested = normalizeGroups(available);
    }

    const skippedGroups = available.filter((g) => !requested.includes(g));

    // Tables to restore, in dependency order, only those actually present.
    const tables = tablesForGroups(requested).filter((t) => manifest.files[t]);

    // Read + validate ALL JSON up front so a structural error aborts before we
    // touch the database (never a partial restore).
    const dataByTable = {};
    for (const table of tables) {
      assertKnownTable(table);
      dataByTable[table] = this._readTable(zip, manifest, table);
    }

    const pool = await getPool();
    const replicaOk = await this._canBypassFk(pool);
    const colMeta = await this._loadColumnMeta(pool);
    const restoredCounts = await this._applyRestore(pool, tables, dataByTable, replicaOk, colMeta);

    // Ensure every requested group shows up in the summary, even if empty.
    for (const g of requested) restoredCounts[g] = restoredCounts[g] || 0;

    return {
      mode,
      restoredGroups: requested,
      skippedGroups,
      counts: restoredCounts,
      createdAt: manifest.createdAt,
    };
  }

  /**
   * Run the delete → insert → resequence steps inside one transaction.
   * Extracted so it can be unit-tested with a fake pool. On ANY error the whole
   * transaction is rolled back — there is no partial restore.
   *
   * @returns {Promise<Object<string, number>>} restored row count per group
   */
  async _applyRestore(pool, tables, dataByTable, replicaOk, colMeta) {
    const client = await pool.connect();
    const restoredCounts = {};
    try {
      await client.query('BEGIN');
      // Disable FK/trigger enforcement for THIS transaction only. SET LOCAL is
      // automatically reverted on COMMIT/ROLLBACK, so constraints are never
      // left disabled. Without it, circular FKs (branches<->warehouses) and
      // cross-group references would block a selective restore.
      if (replicaOk) {
        await client.query("SET LOCAL session_replication_role = 'replica'");
      }

      // Delete children → parents.
      for (const table of [...tables].reverse()) {
        await client.query(`DELETE FROM "${table}"`);
      }

      // Insert parents → children.
      for (const table of tables) {
        const realCols = colMeta?.get(table)?.real;
        const inserted = await this._insertRows(client, table, dataByTable[table], realCols);
        const group = groupOfTable(table);
        restoredCounts[group] = (restoredCounts[group] || 0) + inserted;
      }

      // Realign identity sequences so future inserts don't collide.
      for (const table of tables) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'),
                         GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1))`,
          [table]
        );
      }

      await client.query('COMMIT');
      return restoredCounts;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Bulk-insert rows into a table. Builds a parameterized multi-row INSERT from
   * the row keys (already snake_case from SELECT *). jsonb values are
   * stringified; everything else is coerced by PostgreSQL from text.
   */
  async _insertRows(client, table, rows, realCols) {
    assertKnownTable(table);
    if (rows.length === 0) return 0;

    // Restore only columns that still exist as real (non-generated) columns in
    // the target schema. This drops generated columns and tolerates a backup
    // taken from a slightly older/newer schema instead of failing outright.
    let columns = Object.keys(rows[0]);
    if (realCols) columns = columns.filter((c) => realCols.has(c));
    if (columns.length === 0) return 0;
    const quotedCols = columns.map((c) => `"${c}"`).join(', ');

    // Stay well under PostgreSQL's 65535 bind-parameter ceiling.
    const maxRows = Math.max(1, Math.floor(60000 / columns.length));
    let total = 0;

    for (let start = 0; start < rows.length; start += maxRows) {
      const batch = rows.slice(start, start + maxRows);
      const values = [];
      const tuples = batch.map((row) => {
        const placeholders = columns.map((col) => {
          values.push(serializeValue(row[col]));
          return `$${values.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      await client.query(
        `INSERT INTO "${table}" (${quotedCols}) VALUES ${tuples.join(', ')}`,
        values
      );
      total += batch.length;
    }
    return total;
  }

  /**
   * Load column metadata for every backup-eligible table: ordered column list,
   * the set of real (insertable) columns, and the set of generated columns.
   * Used to build SELECT lists on export and to filter INSERT columns on
   * restore. One round-trip for all tables.
   *
   * @returns {Promise<Map<string, {ordered: string[], real: Set, generated: Set}>>}
   */
  async _loadColumnMeta(pool) {
    const map = new Map();
    for (const t of ALLOWED_TABLES) {
      map.set(t, { ordered: [], real: new Set(), generated: new Set() });
    }
    const res = await pool.query(
      `SELECT table_name, column_name, is_generated
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [[...ALLOWED_TABLES]]
    );
    for (const row of res.rows) {
      const meta = map.get(row.table_name);
      if (!meta) continue;
      meta.ordered.push(row.column_name);
      if (row.is_generated === 'ALWAYS') meta.generated.add(row.column_name);
      else meta.real.add(row.column_name);
    }
    return map;
  }

  /**
   * Probe whether the current role may set session_replication_role. Done on a
   * throwaway statement OUTSIDE any transaction so a lack of privilege doesn't
   * poison the restore transaction. Superusers (the default `postgres` role)
   * can; if not, we fall back to plain dependency-ordered restore.
   */
  async _canBypassFk(pool) {
    try {
      await pool.query("SET session_replication_role = 'replica'");
      await pool.query("SET session_replication_role = 'origin'");
      return true;
    } catch {
      return false;
    }
  }

  _filename(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const stamp =
      `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
      `-${p(date.getHours())}-${p(date.getMinutes())}`;
    return `nuqtaplus-backup-${stamp}.nqbackup`;
  }
}

/**
 * Coerce a JS value (parsed from backup JSON) into a value pg can bind. jsonb
 * columns arrive as objects/arrays and must be stringified; null/scalars pass
 * through and PostgreSQL casts text → the real column type on insert.
 */
function serializeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export default new DataBackupService();
