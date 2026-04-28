/**
 * Iraq-first phone normaliser used for outbound messaging.
 *
 * Rules — applied in order:
 *   1. Strip every character except digits and a leading '+'.
 *   2. "00" prefix → "+".
 *   3. "+964..." → "964..." (canonical international form, no plus).
 *   4. "0..." (10 digits) → drop leading 0, prefix "964" (Iraq local form).
 *   5. Bare 9-10 digits starting with 7 → prefix "964" (Iraq mobile).
 *   6. Anything else with 8+ digits is accepted as-is.
 *
 * Returns null when the input is empty or can't be normalised — the queue
 * worker treats null as "invalid recipient" and marks the notification failed
 * without contacting the provider.
 */
export function normalizeIraqPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Keep digits and a leading +
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) s = s.slice(1);

  // Local 0XXXXXXXXX → strip leading 0 and prefix country code
  if (/^0\d{9,10}$/.test(s)) {
    s = '964' + s.slice(1);
  } else if (/^7\d{8,9}$/.test(s)) {
    // Bare local mobile e.g. 7901234567 → prefix country code
    s = '964' + s;
  }

  // Reject impossibly short/long values
  if (!/^\d{8,15}$/.test(s)) return null;
  return s;
}

export function isValidPhone(raw) {
  return normalizeIraqPhone(raw) != null;
}
