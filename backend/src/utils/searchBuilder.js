/**
 * Centralized search builder — the single, reusable engine that turns a raw
 * user query + a declarative list of "targets" into:
 *   - where        : a parameterized OR predicate (Drizzle SQL)
 *   - rankScore     : a CASE expression scoring each row by the strongest match
 *   - matchedField  : a CASE returning a stable label ('barcode','name',…)
 *   - matchedValue  : a CASE returning the original (un-normalized) matched value
 *
 * It is engine-only and schema-agnostic: each service passes its own target
 * list (see productService / saleService / customerService getAll). This keeps
 * search logic in ONE place (req #7) instead of duplicated per page.
 *
 * SAFETY: every user-derived value (the normalized term/code and LIKE patterns)
 * is interpolated as a Drizzle bound parameter — never string-concatenated into
 * SQL (req #8). Only fixed, code-controlled identifiers are emitted as text.
 *
 * Normalization is shared with the DB via searchNormalize.js so the query term
 * matches the stored `search_*` generated columns exactly.
 */

import { sql } from 'drizzle-orm';
import { normalizeSearchTerm, normalizeCode, escapeLike } from './searchNormalize.js';

/**
 * Ranking tiers (req #9). Higher = stronger match, surfaced first.
 * Order: exact barcode > exact SKU > exact invoice > exact phone > exact name
 *        > partial code > partial name > related/contextual > other fields >
 *        notes/details.
 */
export const RANK = Object.freeze({
  BARCODE_EXACT: 100,
  SKU_EXACT: 90,
  INVOICE_EXACT: 80,
  PHONE_EXACT: 75,
  NAME_EXACT: 70,
  CODE_PARTIAL: 60, // partial barcode / SKU / invoice number
  NAME_PARTIAL: 50,
  RELATED_MATCH: 45, // e.g. product inside an invoice, customer name on an invoice
  PHONE_PARTIAL: 44,
  FIELD_MATCH: 30, // unit, supplier, address, category
  DETAILS: 10, // notes / description
});

/**
 * Reference a (possibly non-schema) column as a quoted, table-qualified
 * identifier, e.g. ncol('products', 'search_name') -> "products"."search_name".
 * The arguments are fixed, code-controlled strings (never user input).
 */
export function ncol(table, column) {
  return sql`${sql.identifier(table)}.${sql.identifier(column)}`;
}

function predicateFor(target, ctx) {
  const { text, code, likeText, likeCode } = ctx;
  switch (target.kind) {
    case 'codeExact':
      return code ? sql`${target.norm} = ${code}` : null;
    case 'codePartial':
      return code ? sql`${target.norm} LIKE ${likeCode}` : null;
    case 'textExact':
      return text ? sql`${target.norm} = ${text}` : null;
    case 'textPartial':
      return text ? sql`${target.norm} LIKE ${likeText}` : null;
    case 'custom':
      return target.predicate ? target.predicate(ctx) : null;
    default:
      return null;
  }
}

/**
 * @typedef {Object} SearchTarget
 * @property {string} label   Stable field key returned as matchedField.
 * @property {number} rank    Tier from RANK.
 * @property {'codeExact'|'codePartial'|'textExact'|'textPartial'|'custom'} kind
 * @property {import('drizzle-orm').SQL} [norm]  Normalized column (for non-custom kinds), via ncol().
 * @property {import('drizzle-orm').SQL|import('drizzle-orm').Column|Function} [value]
 *           Original column (or fn(ctx)) used for matchedValue. Cast to text.
 * @property {Function} [predicate]  fn(ctx) -> SQL for kind 'custom'.
 */

/**
 * Build the search clauses from a target list + a raw query.
 * Returns `{ active:false }` (with null clauses) when the query is empty after
 * normalization — callers then fall back to the default list (req #11).
 *
 * @param {SearchTarget[]} targets
 * @param {string} rawTerm
 */
export function buildSearch(targets, rawTerm) {
  const text = normalizeSearchTerm(rawTerm);
  const code = normalizeCode(rawTerm);

  const empty = { where: null, rankScore: null, matchedField: null, matchedValue: null, active: false, text, code };
  if (!text && !code) return empty;

  const ctx = {
    raw: rawTerm == null ? '' : String(rawTerm),
    text,
    code,
    likeText: `%${escapeLike(text)}%`,
    likeCode: `%${escapeLike(code)}%`,
  };

  const active = [];
  for (const target of targets) {
    const pred = predicateFor(target, ctx);
    if (pred) active.push({ ...target, pred });
  }
  if (!active.length) return empty;

  // Highest rank first so the CASE returns the strongest match per row.
  const sorted = active.sort((a, b) => b.rank - a.rank);

  const where = sql`(${sql.join(
    sorted.map((t) => t.pred),
    sql` OR `
  )})`;

  const rankScore = sql`CASE ${sql.join(
    sorted.map((t) => sql`WHEN ${t.pred} THEN ${t.rank}`),
    sql` `
  )} ELSE 0 END`;

  const matchedField = sql`CASE ${sql.join(
    sorted.map((t) => sql`WHEN ${t.pred} THEN ${t.label}`),
    sql` `
  )} ELSE NULL END`;

  const valued = sorted.filter((t) => t.value !== undefined);
  const matchedValue = valued.length
    ? sql`CASE ${sql.join(
        valued.map((t) => {
          const v = typeof t.value === 'function' ? t.value(ctx) : t.value;
          return sql`WHEN ${t.pred} THEN ${v}::text`;
        }),
        sql` `
      )} ELSE NULL END`
    : sql`NULL`;

  return { where, rankScore, matchedField, matchedValue, active: true, text, code };
}

export default { RANK, ncol, buildSearch };
