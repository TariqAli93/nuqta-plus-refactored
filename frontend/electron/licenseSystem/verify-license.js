'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signaturePayload, verifyPayload } from './license-utils.js';
import { getMachineId } from './machine-id.js';

// ── Error codes ──────────────────────────────────────────────────────────────

const ERR = {
  INVALID_FORMAT:     'License format is invalid or corrupted',
  INVALID_SIGNATURE:  'Signature verification failed — license may be tampered',
  MACHINE_MISMATCH:   'License is bound to a different machine',
  EXPIRED:            'License has expired',
  CLOCK_ROLLBACK:     'System clock appears to have been rolled back',
  STORAGE_TAMPERED:   'License storage integrity check failed',
};

// ── Parse any input to a license object ──────────────────────────────────────

/**
 * Accept a file path, a JSON string, or a base64-encoded JSON string.
 * Returns the parsed license object.
 */
function parseLicenseInput(input) {
  // 1. File on disk
  if (typeof input === 'string' && fs.existsSync(input)) {
    const raw = fs.readFileSync(input, 'utf8').trim();
    return parseRawLicense(raw);
  }

  // 2. Inline string (JSON or base64)
  if (typeof input === 'string') {
    return parseRawLicense(input);
  }

  // 3. Already an object
  if (typeof input === 'object' && input !== null) {
    return input;
  }

  throw new Error(ERR.INVALID_FORMAT);
}

function parseRawLicense(raw) {
  // Try JSON first
  try { return JSON.parse(raw); } catch { /* not JSON */ }

  // Try base64 → JSON
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch { /* not base64-JSON */ }

  throw new Error(ERR.INVALID_FORMAT);
}

// ── Core verification ────────────────────────────────────────────────────────

/**
 * Verify a license object.
 *
 * @param {object}  license          - The parsed license
 * @param {string}  publicKeyPem     - PEM-encoded RSA public key
 * @param {string}  currentMachineId - SHA-256 hex of this machine
 * @param {string|null} lastRunISO   - ISO timestamp of last successful run (for rollback check)
 * @returns {{ valid: boolean, error?: string, details?: string, license?: object }}
 */
function verifyLicense(license, publicKeyPem, currentMachineId, lastRunISO) {
  // 1. Structure
  const required = ['machineId', 'licenseType', 'expiry', 'issuedAt', 'signature'];
  for (const f of required) {
    if (license[f] === undefined || license[f] === null || license[f] === '') {
      return { valid: false, error: ERR.INVALID_FORMAT, details: `Missing field: ${f}` };
    }
  }

  // 2. Signature
  const payload = signaturePayload(license);
  let sigOk;
  try {
    sigOk = verifyPayload(payload, license.signature, publicKeyPem);
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return { valid: false, error: ERR.INVALID_SIGNATURE };
  }

  // 3. Machine binding
  if (license.machineId !== currentMachineId) {
    return { valid: false, error: ERR.MACHINE_MISMATCH };
  }

  // 4. Expiry
  if (license.expiry !== 'lifetime') {
    const now = new Date();
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const expiryMs = new Date(license.expiry + 'T23:59:59.999Z').getTime();
    if (todayMs > expiryMs) {
      return { valid: false, error: ERR.EXPIRED, details: `Expired on ${license.expiry}` };
    }
  }

  // 5. Clock rollback detection (allow 5 min drift)
  if (lastRunISO) {
    const lastMs = new Date(lastRunISO).getTime();
    const nowMs  = Date.now();
    if (nowMs < lastMs - 5 * 60 * 1000) {
      return { valid: false, error: ERR.CLOCK_ROLLBACK };
    }
  }

  return {
    valid: true,
    license: {
      machineId:   license.machineId,
      licenseType: license.licenseType,
      expiry:      license.expiry,
      issuedAt:    license.issuedAt,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node verify-license.js <license-file-or-base64> [--pubkey ./public_key.pem]');
    process.exit(1);
  }

  const input = args[0];
  let pubkeyPath = './public_key.pem';
  const pkIdx = args.indexOf('--pubkey');
  if (pkIdx !== -1 && args[pkIdx + 1]) pubkeyPath = args[pkIdx + 1];

  if (!fs.existsSync(pubkeyPath)) {
    console.error(`Public key not found: ${pubkeyPath}`);
    process.exit(1);
  }

  const publicKeyPem = fs.readFileSync(pubkeyPath, 'utf8');
  const machineId = getMachineId();

  let license;
  try {
    license = parseLicenseInput(input);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }

  const result = verifyLicense(license, publicKeyPem, machineId, null);

  if (result.valid) {
    console.log('License is VALID.');
    console.log(`  Type:   ${result.license.licenseType}`);
    console.log(`  Expiry: ${result.license.expiry}`);
    console.log(`  Issued: ${result.license.issuedAt}`);
  } else {
    console.error(`License is INVALID: ${result.error}`);
    if (result.details) console.error(`  ${result.details}`);
    process.exit(1);
  }
}

export { parseLicenseInput, verifyLicense, ERR };
