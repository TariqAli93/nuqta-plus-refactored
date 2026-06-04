/**
 * Low-level Arabic text primitives for jsPDF.
 *
 * jsPDF (and jspdf-autotable) render glyphs in array order, left-to-right, and
 * apply NO OpenType shaping and NO BiDi. Raw Arabic therefore comes out
 * disconnected and reversed ("broken letters"). This module provides the two
 * primitives needed to fix that:
 *
 *   1. reshape()  — replace each base letter with its correct contextual
 *                   presentation form (isolated / initial / medial / final)
 *                   based on its neighbours, plus lam-alef ligatures.
 *   2. bidi()     — reorder a logically-ordered (RTL) string into the visual
 *                   order jsPDF needs, keeping embedded Latin/number runs LTR.
 *
 * IMPORTANT: these primitives are combined into exactly ONE public pipeline —
 * `formatPdfText()` in `reportExporters.js` — which is the only place allowed
 * to transform text before it is written to the PDF. Do not call reshape()/
 * bidi() directly elsewhere, and never manually reverse Arabic strings: that is
 * what caused the earlier double-processing / reversed-text bugs.
 */

// base codepoint -> [isolated, final, initial, medial] (null = form absent)
const FORMS = {
  0x0621: [0xfe80, null, null, null], // ء
  0x0622: [0xfe81, 0xfe82, null, null], // آ
  0x0623: [0xfe83, 0xfe84, null, null], // أ
  0x0624: [0xfe85, 0xfe86, null, null], // ؤ
  0x0625: [0xfe87, 0xfe88, null, null], // إ
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // ئ
  0x0627: [0xfe8d, 0xfe8e, null, null], // ا
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // ب
  0x0629: [0xfe93, 0xfe94, null, null], // ة
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // ت
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // ث
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // ج
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // ح
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // خ
  0x062f: [0xfea9, 0xfeaa, null, null], // د
  0x0630: [0xfeab, 0xfeac, null, null], // ذ
  0x0631: [0xfead, 0xfeae, null, null], // ر
  0x0632: [0xfeaf, 0xfeb0, null, null], // ز
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // س
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // ش
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // ص
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // ض
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // ط
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // ظ
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // ع
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // غ
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // ف
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // ق
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // ك
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // ل
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // م
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // ن
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // ه
  0x0648: [0xfeed, 0xfeee, null, null], // و
  0x0649: [0xfeef, 0xfef0, null, null], // ى
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // ي
  // Persian / Urdu extras (harmless for Arabic, useful if names contain them)
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59], // پ
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], // چ
  0x0698: [0xfb8a, 0xfb8b, null, null], // ژ
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91], // ک
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95], // گ
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff], // ی
};

const LAM = 0x0644;
// alef variant -> [isolated ligature, final ligature]
const LAM_ALEF = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

// Combining marks (harakat, superscript alef, ...): transparent to joining.
function isTransparent(cp) {
  return (
    (cp >= 0x064b && cp <= 0x065f) ||
    cp === 0x0670 ||
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x06d6 && cp <= 0x06ed)
  );
}

const hasFinal = (cp) => !!FORMS[cp] && FORMS[cp][1] != null; // can join to previous
const isDual = (cp) => !!FORMS[cp] && FORMS[cp][2] != null; // can join to next

/**
 * Replace base Arabic letters with their contextual presentation forms.
 * Keeps logical (reading) order; non-Arabic characters pass through untouched.
 */
export function reshape(input) {
  const text = String(input);
  const chars = Array.from(text);
  const out = [];
  let prevCp = null; // previous significant (non-transparent) Arabic letter, else null

  for (let i = 0; i < chars.length; i += 1) {
    const cp = chars[i].codePointAt(0);

    if (isTransparent(cp)) {
      out.push(chars[i]);
      continue;
    }

    const form = FORMS[cp];
    if (!form) {
      out.push(chars[i]);
      prevCp = null; // non-Arabic breaks the joining run
      continue;
    }

    // Look ahead to next significant (non-transparent) character.
    let nextCp = null;
    let nextIsAlefForLigature = false;
    for (let j = i + 1; j < chars.length; j += 1) {
      const c = chars[j].codePointAt(0);
      if (isTransparent(c)) continue;
      nextCp = c;
      nextIsAlefForLigature = cp === LAM && LAM_ALEF[c] != null;
      break;
    }

    const joinPrev = prevCp != null && isDual(prevCp) && hasFinal(cp);

    // Lam + Alef ligature.
    if (nextIsAlefForLigature) {
      const lig = LAM_ALEF[nextCp];
      out.push(String.fromCharCode(joinPrev ? lig[1] : lig[0]));
      // consume the alef (and any transparents already emitted stay before it)
      for (let j = i + 1; j < chars.length; j += 1) {
        if (isTransparent(chars[j].codePointAt(0))) {
          out.push(chars[j]);
          continue;
        }
        i = j; // skip the alef
        break;
      }
      prevCp = nextCp; // alef: right-joining, won't connect forward
      continue;
    }

    const joinNext = isDual(cp) && nextCp != null && hasFinal(nextCp);

    let chosen;
    if (joinPrev && joinNext) chosen = form[3];
    else if (joinPrev) chosen = form[1];
    else if (joinNext) chosen = form[2];
    else chosen = form[0];
    if (chosen == null) chosen = form[0];

    out.push(String.fromCharCode(chosen));
    prevCp = cp;
  }

  return out.join('');
}

const STRONG_LTR = /[A-Za-z0-9À-ɏ]/; // Latin letters + Western digits

/**
 * Reorder a base-RTL (already reshaped) string into visual order for jsPDF,
 * keeping embedded Latin/number runs in their natural left-to-right order.
 */
export function bidi(input) {
  const chars = Array.from(String(input));
  const tokens = [];
  let i = 0;
  while (i < chars.length) {
    if (STRONG_LTR.test(chars[i])) {
      // Extend through interior neutrals up to the last strong-LTR char.
      let j = i;
      let lastStrong = i;
      while (
        j < chars.length &&
        (STRONG_LTR.test(chars[j]) || /[\s.,:;/\\\-_+%()[\]{}#@&'"]/.test(chars[j]))
      ) {
        if (STRONG_LTR.test(chars[j])) lastStrong = j;
        j += 1;
      }
      tokens.push(chars.slice(i, lastStrong + 1).join(''));
      i = lastStrong + 1;
    } else {
      tokens.push(chars[i]);
      i += 1;
    }
  }
  // Base direction RTL: reverse token order; LTR runs keep their internal order.
  return tokens.join('');
}

// Arabic, Arabic Supplement, Extended-A, Presentation Forms-A & -B.
const ARABIC_RE = new RegExp(
  '[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]'
);

export const hasArabic = (text) => ARABIC_RE.test(String(text ?? ''));
