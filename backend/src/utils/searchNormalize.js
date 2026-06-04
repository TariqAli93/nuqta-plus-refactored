/**
 * Search text normalization — the JS half of a two-sided contract.
 *
 * The DB stores normalized copies of searchable columns (see
 * `src/db/searchInfrastructure.js`, functions `nuqta_normalize` /
 * `nuqta_normalize_code`). The query term must be normalized with the EXACT
 * same rules here, or `term ILIKE '%' || column || '%'` partial matches silently
 * fail. Keep the two implementations in lockstep — if you change a rule here,
 * change it in the SQL function too.
 *
 * Two flavours:
 *   - normalizeSearchTerm(): for human text (names, notes, address, unit…).
 *     Punctuation/whitespace collapse to single spaces so "Coca-Cola" and
 *     "coca cola" match. Used with trigram (partial) search.
 *   - normalizeCode(): for codes (barcode, SKU, invoice number). ALL
 *     non-alphanumerics are stripped so "SKU-001", "sku 001" and "SKU001"
 *     are equal. Used for exact (and prefix/partial) code matching.
 */

// Arabic-Indic (U+0660–U+0669) and Eastern-Arabic/Persian (U+06F0–U+06F9)
// digits → ASCII 0-9. Applied first so numbers/phones are comparable.
function mapDigits(s) {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// Fold Arabic letter variants to a single canonical form and strip the
// diacritics/tatweel that users rarely type. Mirrors the SQL translate().
function foldArabic(s) {
  return (
    s
      // harakat (fatha…sukun), superscript alef, and tatweel → removed
      .replace(/[ً-ْٰـ]/g, '')
      // آ أ إ ٱ → ا
      .replace(/[آأإٱ]/g, 'ا')
      // ى (alef maksura) → ي
      .replace(/ى/g, 'ي')
      // ة (taa marbuta) → ه
      .replace(/ة/g, 'ه')
      // ؤ → و
      .replace(/ؤ/g, 'و')
      // ئ → ي
      .replace(/ئ/g, 'ي')
  );
}

/**
 * Normalize free text for partial/trigram search.
 * @param {unknown} input
 * @returns {string} normalized text (may contain single spaces), or '' .
 */
export function normalizeSearchTerm(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).toLowerCase();
  s = mapDigits(s);
  s = foldArabic(s);
  // Collapse every run of non-letter / non-number (punctuation, symbols,
  // whitespace) to a single space. \p{L} keeps Arabic + Latin letters,
  // \p{N} keeps the now-ASCII digits.
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.trim();
}

/**
 * Normalize a code (barcode / SKU / invoice number) for exact matching.
 * Strips ALL non-alphanumerics (incl. spaces) after digit + case folding.
 * @param {unknown} input
 * @returns {string} compact code, or '' .
 */
export function normalizeCode(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).toLowerCase();
  s = mapDigits(s);
  // Latin letters + ASCII digits + Arabic letters are kept; everything else
  // (dashes, spaces, punctuation) is removed. Diacritics are dropped via the
  // fold so e.g. an Arabic-character SKU stays comparable.
  s = foldArabic(s);
  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  return s;
}

/**
 * Escape LIKE/ILIKE wildcard metacharacters in an already-normalized term so a
 * user typing `%` or `_` doesn't turn into a wildcard. The escape char is `\`
 * (Postgres default for LIKE).
 * @param {string} s
 * @returns {string}
 */
export function escapeLike(s) {
  return String(s).replace(/([\\%_])/g, '\\$1');
}

export default { normalizeSearchTerm, normalizeCode, escapeLike };
