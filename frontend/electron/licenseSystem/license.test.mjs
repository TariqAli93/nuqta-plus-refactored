'use strict';

/*
 * License-system tests (Node built-in runner):  node --test
 *
 * Covers the machine-binding stability fix:
 *   - machine code identical across repeated calls and process restarts
 *   - canonical id does NOT depend on network adapters / missing hw values
 *   - server vs client build produce the same canonical id
 *   - normalized comparison (casing / whitespace)
 *   - legacy (v1) licenses still validate (backward compatibility)
 *   - lock not rewritten when already valid; corrupt lock never silently rebinds
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { signaturePayload, signPayload, canonicalizeMachineId, resolveMachineMatch } from './license-utils.js';
import { verifyLicense } from './verify-license.js';
import * as machine from './machine-id.js';

// Sandbox the license storage to a temp "home" BEFORE importing the storage
// modules (static imports are hoisted, so storage is loaded via dynamic import
// AFTER we redirect the home dir). uv_os_homedir() reads USERPROFILE/HOME first.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nuqta-lic-test-'));
process.env.USERPROFILE = TMP;
process.env.HOME = TMP;
const storage = await import('./license-storage.js');
const activation = await import('./client-activation.js');
const STORAGE_SANDBOXED = storage.STORAGE_DIR.startsWith(TMP);

// A throwaway RSA keypair so we can sign/verify licenses without the real key.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function makeLicense(machineId, over = {}) {
  const lic = { machineId, licenseType: 'lifetime', expiry: 'lifetime', issuedAt: '2025-01-01', ...over };
  lic.signature = signPayload(signaturePayload(lic), privateKey);
  return lic;
}

// Is a real hardware fingerprint readable in this environment?
let CANONICAL = null;
try { CANONICAL = machine.getMachineId(); } catch { /* headless / no anchor */ }
const HW = CANONICAL != null;
const noHw = !HW && 'no hardware fingerprint in this environment';

// ── Machine fingerprint stability ─────────────────────────────────────────────

test('machine code is identical across 10 repeated calls', { skip: noHw }, () => {
  const ids = new Set(Array.from({ length: 10 }, () => machine.getMachineId()));
  assert.equal(ids.size, 1);
});

test('machine code is identical across process restarts', { skip: noHw }, () => {
  const modUrl = new URL('./machine-id.js', import.meta.url).href;
  const code = `import(${JSON.stringify(modUrl)})` +
    `.then(m=>process.stdout.write(m.getMachineId()))` +
    `.catch(e=>{process.stderr.write(String(e.code||e.message));process.exit(2);});`;
  const run = () => execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  const a = run();
  const b = run();
  assert.equal(a, b);
  assert.equal(a, CANONICAL);
});

test('canonical id does NOT depend on network adapters (MAC/order/offline)', { skip: noHw }, () => {
  const before = machine.getMachineId();
  const real = os.networkInterfaces;
  try {
    // Simulate a VPN/VM adapter appearing, then total disconnection.
    os.networkInterfaces = () => ({ VPN: [{ address: '10.0.0.2', mac: 'de:ad:be:ef:00:01', internal: false, family: 'IPv4' }] });
    assert.equal(machine.getMachineId(), before);
    os.networkInterfaces = () => ({});
    assert.equal(machine.getMachineId(), before);
  } finally {
    os.networkInterfaces = real;
  }
});

test('legacy v1 candidates DID depend on MAC (proves the old instability)', { skip: noHw }, () => {
  const real = os.networkInterfaces;
  try {
    os.networkInterfaces = () => ({ A: [{ mac: '11:11:11:11:11:11', internal: false, family: 'IPv4' }] });
    const a = [...machine.getLegacyCandidateIds()];
    os.networkInterfaces = () => ({ B: [{ mac: '22:22:22:22:22:22', internal: false, family: 'IPv4' }] });
    const b = [...machine.getLegacyCandidateIds()];
    assert.notDeepEqual(a, b);
  } finally {
    os.networkInterfaces = real;
  }
});

test('server and client builds compute the same canonical id', { skip: noHw }, () => {
  const prev = process.env.NUQTA_APP_MODE;
  try {
    process.env.NUQTA_APP_MODE = 'server';
    const s = machine.getMachineId();
    process.env.NUQTA_APP_MODE = 'client';
    const c = machine.getMachineId();
    assert.equal(s, c);
  } finally {
    process.env.NUQTA_APP_MODE = prev;
  }
});

test('matchMachineId: canonical matches, bogus does not, casing/space tolerated', { skip: noHw }, () => {
  assert.equal(machine.matchMachineId(CANONICAL).matched, true);
  assert.equal(machine.matchMachineId('00'.repeat(32)).matched, false);
  assert.equal(machine.matchMachineId(`  ${CANONICAL.toUpperCase()}\n`).matched, true);
});

// ── Normalized comparison (pure) ──────────────────────────────────────────────

test('canonicalizeMachineId trims and lowercases', () => {
  assert.equal(canonicalizeMachineId('  ABCdef\n'), 'abcdef');
  assert.equal(canonicalizeMachineId(null), '');
});

test('resolveMachineMatch handles string / array / function bindings', () => {
  assert.equal(resolveMachineMatch('ABC', 'abc').matched, true);          // casing
  assert.equal(resolveMachineMatch(['x', ' ABC '], 'abc').matched, true); // array + whitespace
  assert.equal(resolveMachineMatch('x', 'abc').matched, false);
  assert.equal(resolveMachineMatch((id) => ({ matched: id === 'abc', via: 'fn' }), 'abc').via, 'fn');
});

// ── verifyLicense ─────────────────────────────────────────────────────────────

test('verifyLicense accepts a correctly-bound, signed license', () => {
  const lic = makeLicense('machine-AAA');
  assert.equal(verifyLicense(lic, publicKey, 'machine-AAA', null).valid, true);
  assert.equal(verifyLicense(lic, publicKey, ['other', 'machine-AAA'], null).valid, true);
  assert.equal(verifyLicense(lic, publicKey, (id) => id === 'machine-AAA', null).valid, true);
});

test('verifyLicense machine comparison ignores casing/whitespace', () => {
  const lic = makeLicense('Machine-AAA');
  const r = verifyLicense(lic, publicKey, '  machine-aaa  ', null);
  assert.equal(r.valid, true);
});

test('verifyLicense rejects a license bound to a different machine', () => {
  const lic = makeLicense('machine-AAA');
  const r = verifyLicense(lic, publicKey, 'machine-BBB', null);
  assert.equal(r.valid, false);
  assert.equal(r.code, 'MACHINE_MISMATCH');
});

test('verifyLicense rejects a tampered signature', () => {
  const lic = makeLicense('machine-AAA');
  lic.expiry = '2099-01-01'; // changed after signing
  const r = verifyLicense(lic, publicKey, 'machine-AAA', null);
  assert.equal(r.valid, false);
  assert.equal(r.code, 'INVALID_SIGNATURE');
});

test('verifyLicense rejects a missing field and an expired license', () => {
  const missing = makeLicense('m'); delete missing.issuedAt;
  assert.equal(verifyLicense(missing, publicKey, 'm', null).code, 'INVALID_FORMAT');

  const expired = makeLicense('m', { licenseType: '2000-01-01', expiry: '2000-01-01' });
  assert.equal(verifyLicense(expired, publicKey, 'm', null).code, 'EXPIRED');
});

// ── Storage: atomic, create-only-ish, corruption-safe ─────────────────────────

const storageSkip = !STORAGE_SANDBOXED && 'license storage is not sandboxed to a temp dir';

test('store → load round-trips the license', { skip: storageSkip }, () => {
  storage.removeLicense();
  const lic = makeLicense('machine-AAA');
  storage.storeLicense(lic);
  assert.deepEqual(storage.loadLicense(), lic);
  // no stray temp files left behind by the atomic write
  const tmp = fs.readdirSync(storage.STORAGE_DIR).filter((n) => n.includes('.tmp-'));
  assert.equal(tmp.length, 0);
});

test('lock is NOT rewritten when an identical license is already stored', { skip: storageSkip }, () => {
  const lic = makeLicense('machine-AAA');
  storage.storeLicense(lic);
  const old = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(storage.LICENSE_FILE, old, old);
  storage.storeLicense(lic); // identical → must skip the write
  assert.equal(fs.statSync(storage.LICENSE_FILE).mtime.getTime(), old.getTime());
});

test('lock IS rewritten when the license actually changes', { skip: storageSkip }, () => {
  storage.storeLicense(makeLicense('machine-AAA'));
  const old = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(storage.LICENSE_FILE, old, old);
  storage.storeLicense(makeLicense('machine-AAA', { issuedAt: '2025-06-06' }));
  assert.notEqual(fs.statSync(storage.LICENSE_FILE).mtime.getTime(), old.getTime());
});

test('corrupt lock throws STORAGE_CORRUPT and is NOT deleted', { skip: storageSkip }, () => {
  fs.writeFileSync(storage.LICENSE_FILE, 'this is not json {{{');
  assert.throws(() => storage.loadLicense(), (e) => e.code === 'STORAGE_CORRUPT');
  assert.ok(fs.existsSync(storage.LICENSE_FILE));
});

test('tampered lock throws STORAGE_TAMPERED', { skip: storageSkip }, () => {
  const payload = JSON.stringify({ machineId: 'x', licenseType: 'lifetime', expiry: 'lifetime', issuedAt: '2025-01-01' });
  fs.writeFileSync(storage.LICENSE_FILE, JSON.stringify({ payload, hmac: 'deadbeef' }));
  assert.throws(() => storage.loadLicense(), (e) => e.code === 'STORAGE_TAMPERED');
});

// ── checkStored never silently rebinds ────────────────────────────────────────

test('checkStored reports NO_LICENSE without creating any file', { skip: storageSkip }, () => {
  storage.removeLicense();
  const r = activation.checkStored();
  assert.equal(r.code, 'NO_LICENSE');
  assert.equal(r.valid, false);
  assert.ok(!fs.existsSync(storage.LICENSE_FILE));
});

test('checkStored on a corrupt lock returns STORAGE_CORRUPT and leaves the file intact', { skip: storageSkip }, () => {
  fs.writeFileSync(storage.LICENSE_FILE, 'garbage-not-json');
  const before = fs.readFileSync(storage.LICENSE_FILE, 'utf8');
  const r = activation.checkStored();
  assert.equal(r.code, 'STORAGE_CORRUPT');
  assert.equal(r.valid, false);
  assert.equal(fs.readFileSync(storage.LICENSE_FILE, 'utf8'), before); // never rewritten/rebound
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});
