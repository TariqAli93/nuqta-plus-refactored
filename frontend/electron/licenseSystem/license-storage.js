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

// ── License storage ──────────────────────────────────────────────────────────

function storeLicense(licenseObj) {
  ensureDir();
  const json = JSON.stringify(licenseObj);
  const envelope = JSON.stringify({ payload: json, hmac: hmac(json) });
  fs.writeFileSync(LICENSE_FILE, envelope);
}

/**
 * Load and integrity-check the stored license.
 * Returns the license object, or null if nothing stored.
 * Throws if the file exists but has been tampered with.
 */
function loadLicense() {
  if (!fs.existsSync(LICENSE_FILE)) return null;

  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
  } catch {
    throw new Error('License storage is corrupted');
  }

  if (!envelope.payload || !envelope.hmac) {
    throw new Error('License storage is corrupted');
  }

  if (hmac(envelope.payload) !== envelope.hmac) {
    throw new Error('License storage integrity check failed — file may be tampered');
  }

  return JSON.parse(envelope.payload);
}

function removeLicense() {
  if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
}

// ── Run-state storage (last-run timestamp for rollback detection) ────────────

function saveState(state) {
  ensureDir();
  const json = JSON.stringify(state);
  const envelope = JSON.stringify({ payload: json, hmac: hmac(json) });
  fs.writeFileSync(STATE_FILE, envelope);
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

export {
  STORAGE_DIR,
  storeLicense,
  loadLicense,
  removeLicense,
  updateLastRun,
  getLastRun,
};
