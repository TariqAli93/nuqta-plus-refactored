'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

// ── Storage paths ────────────────────────────────────────────────────────────

function getStorageDir() {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === 'win32')
    return path.join(home, 'AppData', 'Roaming', '@nuqtaplus', 'license');
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', '@nuqtaplus', 'license');
  return path.join(home, '.config', '@nuqtaplus', 'license');
}

const STORAGE_DIR  = getStorageDir();
const LICENSE_FILE = path.join(STORAGE_DIR, 'license.dat');
const STATE_FILE   = path.join(STORAGE_DIR, 'state.dat');

// HMAC key — in production, derive from an obfuscated constant or machine-id
const INTEGRITY_KEY = 'app-license-integrity-check-v1';

// ── HMAC helpers ─────────────────────────────────────────────────────────────

function hmac(data) {
  return crypto.createHmac('sha256', INTEGRITY_KEY).update(data).digest('hex');
}

function ensureDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Atomic write: write a temp file in the same directory, flush it, then rename
 * over the target. Rename is atomic on a single volume, so a crash or power loss
 * mid-write can never leave a half-written (corrupt) license/state file. On
 * Windows the rename can transiently fail if an AV/indexer holds the target, so
 * we retry a few times.
 */
function writeFileAtomic(file, data) {
  ensureDir();
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file); // replaces existing on Win (libuv MOVEFILE_REPLACE_EXISTING)
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  throw lastErr;
}

// ── License storage ──────────────────────────────────────────────────────────

function storeLicense(licenseObj) {
  const json = JSON.stringify(licenseObj);

  // Do not rewrite the lock if an identical, valid license is already stored —
  // avoids needless churn on every (re)activation of the same license.
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const cur = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
      if (cur && cur.payload === json && cur.hmac === hmac(json)) return;
    }
  } catch { /* unreadable/corrupt — fall through and write a fresh, valid file */ }

  const envelope = JSON.stringify({ payload: json, hmac: hmac(json) });
  writeFileAtomic(LICENSE_FILE, envelope);
}

/**
 * Load and integrity-check the stored license.
 * Returns the license object, or null if nothing stored.
 * Throws if the file exists but has been tampered with.
 */
function loadLicense() {
  if (!fs.existsSync(LICENSE_FILE)) return null;

  const corrupt = (msg) => {
    const e = new Error(msg);
    e.code = 'STORAGE_CORRUPT';
    return e;
  };

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
  } catch {
    throw corrupt('License storage is corrupted');
  }

  if (!envelope.payload || !envelope.hmac) {
    throw corrupt('License storage is corrupted');
  }

  if (hmac(envelope.payload) !== envelope.hmac) {
    const e = new Error('License storage integrity check failed — file may be tampered');
    e.code = 'STORAGE_TAMPERED';
    throw e;
  }

  try {
    return JSON.parse(envelope.payload);
  } catch {
    throw corrupt('License storage is corrupted');
  }
}

function removeLicense() {
  if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
}

// ── Run-state storage (last-run timestamp for rollback detection) ────────────

function saveState(state) {
  const json = JSON.stringify(state);
  const envelope = JSON.stringify({ payload: json, hmac: hmac(json) });
  writeFileAtomic(STATE_FILE, envelope);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
  if (!envelope.payload || !envelope.hmac) return {};
  if (hmac(envelope.payload) !== envelope.hmac) return {};

  try { return JSON.parse(envelope.payload); } catch { return {}; }
}

function updateLastRun() {
  const state = loadState();
  state.lastRun = new Date().toISOString();
  saveState(state);
  return state.lastRun;
}

function getLastRun() {
  return loadState().lastRun || null;
}

// ── Diagnostics (safe to log — paths & flags only, no license contents) ───────

function getStorageInfo() {
  let exists = false;
  let readable = false;
  let bytes = 0;
  try {
    exists = fs.existsSync(LICENSE_FILE);
    if (exists) {
      bytes = fs.statSync(LICENSE_FILE).size;
      JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
      readable = true;
    }
  } catch { /* readable stays false */ }
  return { storageDir: STORAGE_DIR, licenseFile: LICENSE_FILE, exists, readable, bytes };
}

export {
  STORAGE_DIR,
  LICENSE_FILE,
  storeLicense,
  loadLicense,
  removeLicense,
  updateLastRun,
  getLastRun,
  getStorageInfo,
};
