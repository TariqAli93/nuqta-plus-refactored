/**
 * Iraq-first phone normalizer mirroring backend/src/services/notifications/phone.js.
 *
 * Kept in lockstep with the backend so previews and search inputs the user
 * sees in the UI match exactly what the API will store and look up.
 *
 * Returns null when the input is empty or can't be normalised.
 */
export function normalizeIraqPhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) s = s.slice(1);

  if (/^0\d{9,10}$/.test(s)) {
    s = '964' + s.slice(1);
  } else if (/^7\d{8,9}$/.test(s)) {
    s = '964' + s;
  }

  if (!/^\d{8,15}$/.test(s)) return null;
  return s;
}

export function isValidPhone(raw) {
  return normalizeIraqPhone(raw) != null;
}
