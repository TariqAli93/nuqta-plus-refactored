#!/usr/bin/env node
'use strict';

// import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseLicenseInput, verifyLicense } from './verify-license.js';
import { getMachineId, matchMachineId, getMachineDiagnostics } from './machine-id.js';
import {
  storeLicense, loadLicense, removeLicense,
  getLastRun, updateLastRun, getStorageInfo,
} from './license-storage.js';

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const PUBLIC_KEY_PATH = path.join(__dirname, 'public_key.pem');


// ── Helpers ──────────────────────────────────────────────────────────────────

function loadPublicKey() {
  const raw = `
    -----BEGIN PUBLIC KEY-----
    MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlF7ICo6h08hHQQknTsbj
    QYRfHWxkeZa8Uf84QefW14e/yP+Vv5PuycmR2oWSfY71vsneWrrTmEToMe2IXQX7
    1cD9eq4bWyNGsGPvDxtF8ReCfYo6Vrpk6P0JeAsfPW0OL9W0Yk3ojP8jXs6xmHsO
    ZAa9hfEGeNK/aYQS6h0X5RSy3gDiA6KsN5l2BTgwPzD3jMdMJ3XMdrIhb/gDlHLM
    w0tvv+P6wSAX/9uAbeFj6paoCXY3YBYB0osdH8bOTzRJRuWlGVo4nIdRSXxxxWjP
    kShPtLqXQjRkxQkSPDPn5a5nZJfPeUo3B40jOSKYI7CGNam5X/zfzm6Y9d2yAsiI
    AQIDAQAB
    -----END PUBLIC KEY-----
  `;
  // Strip the indentation added by the template literal so Node.js crypto
  // receives a valid PEM (each line must have no leading whitespace).
  return raw.split('\n').map(l => l.trim()).filter(l => l).join('\n');
}

function printResult(result) {
  if (result.valid) {
    console.log();
    console.log('  Activation successful!');
    console.log(`  License Type : ${result.license.licenseType}`);
    console.log(`  Expiry       : ${result.license.expiry}`);
    console.log(`  Issued       : ${result.license.issuedAt}`);
    console.log(`  Machine      : ${result.license.machineId.slice(0, 12)}...`);
    console.log();
  } else {
    console.error();
    console.error(`  Activation FAILED: ${result.error}`);
    if (result.details) console.error(`  ${result.details}`);
    console.error();
  }
}

// ── Activation flows ─────────────────────────────────────────────────────────

/**
 * Activate from a .lic file path or a base64 license string.
 * Returns the verification result.
 */
function activate(input) {
  const publicKey = loadPublicKey();
  const lastRun = getLastRun();

  const license = parseLicenseInput(input);
  // Bind check via the hardware matcher so a legacy (v1) license still activates
  // on the machine it belongs to, without forcing a re-issue.
  const result = verifyLicense(license, publicKey, matchMachineId, lastRun);

  if (result.valid) {
    storeLicense(license);
    updateLastRun();
  }

  return result;
}

const prefix = (s) => (s ? String(s).slice(0, 12) : null);

/**
 * Check the currently stored license without re-activating.
 *
 * Never throws and never rewrites/removes the lock. Returns a structured result
 * with a machine-readable `code` and safe `diag` (prefixes & flags only) so the
 * caller can distinguish a real machine mismatch from an unreadable fingerprint
 * or a corrupt store — and react without silently re-binding.
 */
function checkStored() {
  const storage = getStorageInfo();

  // 1. Load the stored license. A corrupt/tampered store is a RECOVERABLE error,
  //    not "unlicensed" — surface it clearly and leave the file untouched.
  let license;
  try {
    license = loadLicense();
  } catch (err) {
    return {
      valid: false,
      code: err.code || 'STORAGE_CORRUPT',
      error: err.message,
      diag: { storageDir: storage.storageDir, lockExists: storage.exists, lockReadable: false },
    };
  }

  if (!license) {
    return {
      valid: false,
      code: 'NO_LICENSE',
      error: 'No license stored',
      diag: { storageDir: storage.storageDir, lockExists: false, lockReadable: false },
    };
  }

  const publicKey = loadPublicKey();
  const lastRun = getLastRun();
  const result = verifyLicense(license, publicKey, matchMachineId, lastRun);

  if (result.valid) {
    updateLastRun();
    return {
      ...result,
      code: 'OK',
      diag: {
        storageDir: storage.storageDir,
        lockExists: true,
        lockReadable: true,
        matchedVia: result.via,
        boundPrefix: prefix(license.machineId),
      },
    };
  }

  // Invalid. For a machine mismatch, add fingerprint diagnostics and, if NO
  // hardware anchor could be read at all, report that distinctly (a transient,
  // recoverable condition — not a real "different machine").
  const diag = {
    storageDir: storage.storageDir,
    lockExists: true,
    lockReadable: true,
    boundPrefix: prefix(license.machineId),
  };

  if (result.code === 'MACHINE_MISMATCH') {
    const md = getMachineDiagnostics();
    diag.canonicalSource = md.canonicalSource;
    diag.currentPrefix = md.canonicalPrefix;
    diag.sources = md.sources;
    if (!md.available) {
      return { valid: false, code: 'FINGERPRINT_UNAVAILABLE',
        error: 'Could not read this machine\'s hardware fingerprint', diag };
    }
  }

  return { ...result, diag };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function cli() {
  const args = process.argv.slice(2);

  // --machine-id  →  print and exit
  if (args.includes('--machine-id')) {
    console.log(`Machine ID: ${getMachineId()}`);
    return;
  }

  // --check  →  validate stored license
  if (args.includes('--check')) {
    try {
      const r = checkStored();
      printResult(r);
      if (!r.valid) process.exit(1);
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // --file <path>
  if (args[0] === '--file' && args[1]) {
    const r = activate(args[1]);
    printResult(r);
    if (!r.valid) process.exit(1);
    return;
  }

  // --key <base64>
  if (args[0] === '--key' && args[1]) {
    const r = activate(args[1]);
    printResult(r);
    if (!r.valid) process.exit(1);
    return;
  }

  // --deactivate
  if (args.includes('--deactivate')) {
    removeLicense();
    console.log('License removed.');
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('=== License Activation ===');
  console.log(`Machine ID: ${getMachineId()}`);
  console.log();

  const choice = await ask('Activate via (1) license file or (2) pasted key? [1/2]: ');

  let result;
  if (choice.trim() === '1') {
    const filePath = await ask('License file path: ');
    result = activate(filePath.trim());
  } else if (choice.trim() === '2') {
    const key = await ask('Paste base64 license key: ');
    result = activate(key.trim());
  } else {
    console.error('Invalid choice.');
    rl.close();
    process.exit(1);
  }

  printResult(result);
  rl.close();
  if (!result.valid) process.exit(1);
}

const isMainModule = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

if (isMainModule) {
  cli().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

export { activate, checkStored };
