/**
 * Search infrastructure — idempotent DB setup for the search system.
 *
 * Creates, in order:
 *   1. the pg_trgm extension (for fast `%infix%` ILIKE via GIN trigram indexes)
 *   2. two IMMUTABLE normalization functions used by the generated columns and
 *      by query-time predicates:
 *        - nuqta_normalize(text)      : human text  (fold + collapse to spaces)
 *        - nuqta_normalize_code(text) : codes       (fold + strip non-alnum)
 *      These MUST stay in lockstep with src/utils/searchNormalize.js.
 *   3. STORED generated columns holding the normalized copy of each searchable
 *      column (auto-maintained by Postgres on every write).
 *   4. GIN trigram indexes for partial search + btree indexes for exact/prefix.
 *
 * Everything is idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE) and
 * each statement runs independently — a single failure is logged and skipped
 * rather than aborting bootstrap. This runs on every boot from initDB(); after
 * the first successful run subsequent boots are near-instant no-ops.
 *
 * It is applied via raw SQL (not a drizzle migration) on purpose: generated
 * columns referencing a custom function, GIN trigram indexes, and CREATE
 * EXTENSION are not expressible through `drizzle-kit generate`.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('SearchInfra');

// translate() arguments shared by both functions. `from` lists every source
// character; `to` lists replacements positionally. Characters in `from` BEYOND
// the length of `to` are DELETED by translate() — so the fold + digit maps come
// first (aligned with `to`) and the harakat/tatweel come last (deleted).
//   fold (8):  آ أ إ ٱ → ا  |  ى → ي  |  ة → ه  |  ؤ → و  |  ئ → ي
//   ar digits: ٠..٩ → 0..9    fa digits: ۰..۹ → 0..9
//   deleted:   harakat U+064B–U+0652, superscript alef U+0670, tatweel U+0640
const TR_FROM = 'آأإٱىةؤئ' + '٠١٢٣٤٥٦٧٨٩' + '۰۱۲۳۴۵۶۷۸۹' + 'ًٌٍَُِّْ' + 'ٰ' + 'ـ';
const TR_TO = 'اااايهوي' + '0123456789' + '0123456789';

// Keep Latin alnum + the whole Arabic block (U+0600–U+06FF, covers Persian
// letters too). \u escapes are valid inside Postgres bracket expressions.
const KEEP_CLASS = 'a-z0-9\\u0600-\\u06FF';

const FN_NORMALIZE = `
CREATE OR REPLACE FUNCTION nuqta_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT btrim(
    regexp_replace(
      translate(lower($1), '${TR_FROM}', '${TR_TO}'),
      '[^${KEEP_CLASS}]+', ' ', 'g'
    )
  )
$fn$;`;

const FN_NORMALIZE_CODE = `
CREATE OR REPLACE FUNCTION nuqta_normalize_code(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT regexp_replace(
    translate(lower($1), '${TR_FROM}', '${TR_TO}'),
    '[^${KEEP_CLASS}]+', '', 'g'
  )
$fn$;`;

// Generated columns: [table, column, generationExpression]
const GENERATED_COLUMNS = [
  ['products', 'search_name', 'nuqta_normalize(name)'],
  ['products', 'search_description', 'nuqta_normalize(description)'],
  ['products', 'search_unit', 'nuqta_normalize(unit)'],
  ['products', 'search_supplier', 'nuqta_normalize(supplier)'],
  ['products', 'search_sku', 'nuqta_normalize_code(sku)'],
  ['products', 'search_barcode', 'nuqta_normalize_code(barcode)'],
  ['categories', 'search_name', 'nuqta_normalize(name)'],
  ['customers', 'search_name', 'nuqta_normalize(name)'],
  ['customers', 'search_address', 'nuqta_normalize(address)'],
  ['customers', 'search_notes', 'nuqta_normalize(notes)'],
  ['sales', 'search_invoice', 'nuqta_normalize_code(invoice_number)'],
  ['sales', 'search_notes', 'nuqta_normalize(notes)'],
  ['sale_items', 'search_product_name', 'nuqta_normalize(product_name)'],
  ['sale_items', 'search_product_sku', 'nuqta_normalize_code(product_sku)'],
  ['sale_items', 'search_barcode', 'nuqta_normalize_code(barcode)'],
];

// GIN trigram indexes — power `column ILIKE '%term%'` partial search.
// [indexName, table, column]
const GIN_INDEXES = [
  ['srch_products_name_gin', 'products', 'search_name'],
  ['srch_products_description_gin', 'products', 'search_description'],
  ['srch_products_unit_gin', 'products', 'search_unit'],
  ['srch_products_supplier_gin', 'products', 'search_supplier'],
  ['srch_products_sku_gin', 'products', 'search_sku'],
  ['srch_categories_name_gin', 'categories', 'search_name'],
  ['srch_customers_name_gin', 'customers', 'search_name'],
  ['srch_customers_address_gin', 'customers', 'search_address'],
  ['srch_customers_notes_gin', 'customers', 'search_notes'],
  ['srch_customers_phone_gin', 'customers', 'normalized_phone'],
  ['srch_sales_invoice_gin', 'sales', 'search_invoice'],
  ['srch_sales_notes_gin', 'sales', 'search_notes'],
  ['srch_sale_items_pname_gin', 'sale_items', 'search_product_name'],
];

// btree indexes — exact/prefix lookups (barcode, sku, invoice, phone) and the
// sale_items→sales correlation used by invoice item search.
// [indexName, table, columnsSql]
const BTREE_INDEXES = [
  ['srch_products_sku_btree', 'products', 'search_sku'],
  ['srch_products_barcode_btree', 'products', 'search_barcode'],
  ['srch_customers_phone_btree', 'customers', 'normalized_phone'],
  ['srch_sales_invoice_btree', 'sales', 'search_invoice'],
  ['srch_sale_items_sku_btree', 'sale_items', 'search_product_sku'],
  ['srch_sale_items_barcode_btree', 'sale_items', 'search_barcode'],
  ['srch_sale_items_sale_btree', 'sale_items', 'sale_id'],
];

async function runStatement(pool, label, sql) {
  try {
    await pool.query(sql);
    return { label, ok: true };
  } catch (err) {
    log.warn(`search infra step skipped: ${label}`, { error: err.message, code: err.code });
    return { label, ok: false, error: err.message };
  }
}

/**
 * Apply (idempotently) all search infrastructure. Never throws — failures are
 * logged and the rest continue so a partial DB still serves (degraded) search.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{trgm: boolean, applied: number, failed: number}>}
 */
export async function ensureSearchInfrastructure(pool) {
  const results = [];

  // 1. pg_trgm — degrade to btree-only if unavailable.
  const trgmRes = await runStatement(pool, 'extension pg_trgm', 'CREATE EXTENSION IF NOT EXISTS pg_trgm');
  const trgm = trgmRes.ok;
  results.push(trgmRes);
  if (!trgm) {
    log.warn('pg_trgm unavailable — partial (%term%) search will fall back to btree and be slower on large tables');
  }

  // 2. normalization functions
  results.push(await runStatement(pool, 'fn nuqta_normalize', FN_NORMALIZE));
  results.push(await runStatement(pool, 'fn nuqta_normalize_code', FN_NORMALIZE_CODE));

  // 3. generated columns
  for (const [table, col, expr] of GENERATED_COLUMNS) {
    results.push(
      await runStatement(
        pool,
        `column ${table}.${col}`,
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} text GENERATED ALWAYS AS (${expr}) STORED`
      )
    );
  }

  // 4a. GIN trigram indexes (or btree fallback when pg_trgm is missing)
  for (const [name, table, col] of GIN_INDEXES) {
    const sql = trgm
      ? `CREATE INDEX IF NOT EXISTS ${name} ON ${table} USING gin (${col} gin_trgm_ops)`
      : `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${col})`;
    results.push(await runStatement(pool, `index ${name}`, sql));
  }

  // 4b. btree indexes
  for (const [name, table, cols] of BTREE_INDEXES) {
    results.push(
      await runStatement(pool, `index ${name}`, `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols})`)
    );
  }

  const applied = results.filter((r) => r.ok).length;
  const failed = results.length - applied;
  if (failed === 0) {
    log.success(`search infrastructure ready (${applied} steps, trgm=${trgm})`);
  } else {
    log.warn(`search infrastructure applied with ${failed} skipped step(s)`, { applied, failed, trgm });
  }
  return { trgm, applied, failed };
}

export default { ensureSearchInfrastructure };
