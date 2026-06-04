/**
 * Highlight helper for search results (req #13). Splits `text` into segments,
 * marking the parts that match the (Arabic/English-folded) query so the caller
 * can wrap matches in <mark> WITHOUT v-html (XSS-safe — segments render as
 * plain interpolated text).
 *
 * Folding here is strictly 1:1 (same string length) so match offsets in the
 * folded string map back onto the ORIGINAL text. It mirrors the search
 * normalizer's letter folds (alef/yaa/taa-marbuta/hamza + digit maps + lower)
 * but deliberately skips the length-changing steps (diacritic removal,
 * punctuation collapse).
 */

const FOLDS = [
  [/[أإآٱ]/g, 'ا'],
  [/ى/g, 'ي'],
  [/ة/g, 'ه'],
  [/ؤ/g, 'و'],
  [/ئ/g, 'ي'],
];

function fold(str) {
  let s = String(str ?? '').toLowerCase();
  for (const [re, to] of FOLDS) s = s.replace(re, to);
  s = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  return s;
}

/**
 * @param {string} text   original value to display
 * @param {string} query  raw user query
 * @returns {{ text: string, match: boolean }[]}
 */
export function highlightSegments(text, query) {
  const original = text == null ? '' : String(text);
  const q = String(query ?? '').trim();
  if (!original || !q) return [{ text: original, match: false }];

  const foldedText = fold(original);
  const tokens = [...new Set(fold(q).split(/\s+/).filter((t) => t.length >= 1))];
  if (!tokens.length) return [{ text: original, match: false }];

  // Collect every match range, then merge overlaps.
  const ranges = [];
  for (const token of tokens) {
    let from = 0;
    let idx;
    while ((idx = foldedText.indexOf(token, from)) !== -1) {
      ranges.push([idx, idx + token.length]);
      from = idx + token.length;
    }
  }
  if (!ranges.length) return [{ text: original, match: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  const segments = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: original.slice(cursor, start), match: false });
    segments.push({ text: original.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < original.length) segments.push({ text: original.slice(cursor), match: false });
  return segments;
}

export default { highlightSegments };
