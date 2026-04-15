'use strict';

import crypto from 'node:crypto';

// ── Date helpers ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION_RE = /^(\d+)(d|mo|yr)$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function todayUTC() {
  return formatDate(new Date());
}

// ── Duration parsing ─────────────────────────────────────────────────────────

function parseDuration(str) {
  const m = str.match(DURATION_RE);
  return m ? { value: parseInt(m[1], 10), unit: m[2] } : null;
}

function addDuration(baseISO, dur) {
  const d = new Date(baseISO + 'T00:00:00Z');
  switch (dur.unit) {
    case 'd':  d.setUTCDate(d.getUTCDate() + dur.value);           break;
    case 'mo': d.setUTCMonth(d.getUTCMonth() + dur.value);         break;
    case 'yr': d.setUTCFullYear(d.getUTCFullYear() + dur.value);   break;
  }
  return formatDate(d);
}

// ── License type validation & expiry resolution ──────────────────────────────

function validateLicenseType(raw) {
  if (raw === 'trial' || raw === 'lifetime') return true;
  if (parseDuration(raw)) return true;
  if (isValidDate(raw)) return true;
  return false;
}

/**
 * Resolve the expiry string from a licenseType and issuedAt date.
 * Returns 'lifetime' or an ISO date string (YYYY-MM-DD).
 */
function resolveExpiry(licenseType, issuedAt) {
  if (licenseType === 'lifetime') return 'lifetime';

  if (licenseType === 'trial') {
    return addDuration(issuedAt, { value: 7, unit: 'd' });
  }

  const dur = parseDuration(licenseType);
  if (dur) return addDuration(issuedAt, dur);

  // Absolute date
  if (isValidDate(licenseType)) {
    if (licenseType < issuedAt) {
      throw new Error(`Expiry "${licenseType}" is before issuedAt "${issuedAt}"`);
    }
    return licenseType;
  }

  throw new Error(
    `Invalid license type: "${licenseType}". ` +
    'Expected: trial | lifetime | <N>d | <N>mo | <N>yr | YYYY-MM-DD'
  );
}

// ── Signature helpers ────────────────────────────────────────────────────────

/**
 * Build the canonical string that is signed / verified.
 * Fields are joined with '|' to avoid concatenation ambiguity.
 */
function signaturePayload(data) {
  return [data.machineId, data.licenseType, data.expiry, data.issuedAt].join('|');
}

function signPayload(payload, privateKeyPem) {
  const signer = crypto.createSign('SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

function verifyPayload(payload, signature, publicKeyPem) {
  const verifier = crypto.createVerify('SHA256');
  verifier.update(payload);
  verifier.end();
  return verifier.verify(publicKeyPem, signature, 'base64');
}

export {
  isValidDate,
  formatDate,
  todayUTC,
  parseDuration,
  addDuration,
  validateLicenseType,
  resolveExpiry,
  signaturePayload,
  signPayload,
  verifyPayload,
};
