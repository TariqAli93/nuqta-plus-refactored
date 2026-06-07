'use strict';

import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/*
 * Machine fingerprinting for license binding.
 *
 * v2 (current): the canonical machine id is the SHA-256 of a SINGLE stable
 * hardware/OS anchor:
 *   - Windows : SMBIOS UUID (Win32_ComputerSystemProduct, via CIM) — motherboard
 *               bound, so it resists disk-image cloning and survives an OS
 *               reinstall; MachineGuid (registry, via reg.exe) is the fallback
 *               for VMs / boards that report no usable SMBIOS UUID.
 *   - macOS   : IOPlatformUUID
 *   - Linux   : /etc/machine-id
 * Unstable inputs (network MAC / adapter order, "first" disk serial) are NO
 * LONGER part of the canonical id — they were the cause of intermittent
 * "License is bound to a different machine" errors, especially on Windows 11
 * 24H2+ where `wmic` is removed and every lookup silently fell back to a slow
 * PowerShell call that could time out and flip the whole hash.
 *
 * v1 (legacy): the previous algorithm hashed CPU + MAC + disk-serial + SMBIOS
 * UUID together. Already-issued licenses are bound to that hash, so we can still
 * REPRODUCE it (see getLegacyCandidateIds) and accept it during verification —
 * existing licenses keep working without any forced re-binding.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const HASH_NS_V2 = 'nuqtaplus:machine:v2';

// Absolute, non-PATH-hijackable paths to the Windows tools we shell out to.
const WIN_DIR = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
const SYS32 = path.join(WIN_DIR, 'System32');
const REG_EXE = path.join(SYS32, 'reg.exe');
const PS_EXE = path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// SMBIOS UUIDs that some firmware reports instead of a real one.
const BAD_UUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '03000200-0400-0500-0006-000700080009',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Canonical form for any identifier compared as a string: trim + lowercase. */
function canon(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function v2Hash(kind, value) {
  return sha256hex(`${HASH_NS_V2}|${kind}|${canon(value)}`);
}

function isUsableUuid(uuid) {
  const c = canon(uuid);
  if (!c) return false;
  if (BAD_UUIDS.has(c)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c);
}

function tryExecFile(file, args, timeout = 8000) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// ── Stable anchor readers ─────────────────────────────────────────────────────

/** Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid (stable per OS install). */
function readMachineGuid() {
  if (os.platform() !== 'win32') return '';
  const out = tryExecFile(REG_EXE, [
    'query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64',
  ], 4000);
  const m = out.match(/MachineGuid\s+REG_\w+\s+([0-9a-fA-F-]{32,40})/i);
  return m ? m[1].trim() : '';
}

let _wmiCache; // { uuid, cpu, disk } — one PowerShell round-trip, memoised per process.

/**
 * Windows: fetch SMBIOS UUID + ProcessorId + first disk serial in a SINGLE
 * PowerShell/CIM call (wmic is removed on 24H2+). Memoised so we never spawn
 * PowerShell more than once per process. Retried once if the UUID (our primary
 * binding anchor) comes back unusable, so a transient WMI hiccup at boot does
 * not silently change the fingerprint.
 */
function readWmiBundle() {
  if (_wmiCache) return _wmiCache;
  if (os.platform() !== 'win32') {
    _wmiCache = { uuid: '', cpu: '', disk: '' };
    return _wmiCache;
  }
  const script =
    "$u=(Get-CimInstance Win32_ComputerSystemProduct).UUID;" +
    "$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId;" +
    "$d=(Get-CimInstance Win32_DiskDrive | Select-Object -First 1).SerialNumber;" +
    "Write-Output \"UUID=$u\"; Write-Output \"CPU=$c\"; Write-Output \"DISK=$d\"";
  let result = { uuid: '', cpu: '', disk: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = tryExecFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 7000);
    const pick = (key) => {
      const m = out.match(new RegExp(`^${key}=(.*)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    result = { uuid: pick('UUID'), cpu: pick('CPU'), disk: pick('DISK') };
    if (isUsableUuid(result.uuid)) break;
  }
  _wmiCache = result;
  return _wmiCache;
}

function readDarwinPlatformUuid() {
  if (os.platform() !== 'darwin') return '';
  const out = tryExecFile('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  return m ? m[1].trim() : '';
}

function readLinuxMachineId() {
  if (os.platform() === 'win32' || os.platform() === 'darwin') return '';
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    } catch { /* next */ }
  }
  // DMI product UUID (often needs root, best-effort).
  try {
    const v = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim();
    if (v) return v;
  } catch { /* ignore */ }
  return '';
}

// ── Canonical (v2) machine id ─────────────────────────────────────────────────

/**
 * Anchor sources for this platform, in priority order. Each `read` is a lazy
 * thunk so the canonical id can stop at the first (cheapest) available anchor
 * without paying for the slower ones.
 */
function anchorReaders() {
  const platform = os.platform();
  if (platform === 'win32') {
    return [
      { kind: 'win-smbios', read: () => readWmiBundle().uuid, valid: isUsableUuid },       // motherboard UUID (clone-resistant)
      { kind: 'win-machineguid', read: readMachineGuid, valid: (v) => !!v },               // registry fallback (VMs / no SMBIOS UUID)
    ];
  }
  if (platform === 'darwin') {
    return [{ kind: 'darwin-platform-uuid', read: readDarwinPlatformUuid, valid: (v) => !!v }];
  }
  return [{ kind: 'linux-machine-id', read: readLinuxMachineId, valid: (v) => !!v }];
}

/**
 * All v2 ids this machine can legitimately present, in priority order.
 * Each entry derives from a real, stable identifier the machine owns.
 * NOTE: this evaluates every anchor (including slow ones) — use only on the
 * verification fallback path, never on the hot startup path.
 */
function getV2Candidates() {
  const out = [];
  for (const a of anchorReaders()) {
    const v = a.read();
    if (a.valid(v)) out.push({ kind: a.kind, id: v2Hash(a.kind, v) });
  }
  return out;
}

/**
 * The canonical machine id. Deterministic and stable across restarts, network
 * changes, VPN/VM adapters and offline state. This is what is shown in the
 * activation window and what new licenses should be bound to.
 *
 * Stops at the first available anchor (Windows SMBIOS UUID via CIM; the result
 * is memoised so it is read at most once per process). Falls back to MachineGuid
 * only when no usable SMBIOS UUID exists (e.g. some VMs).
 *
 * Throws { code: 'FINGERPRINT_UNAVAILABLE' } only if NO stable anchor can be
 * read at all — callers must treat that as a recoverable error and must NOT
 * re-bind or discard an existing license.
 */
function getMachineId() {
  for (const a of anchorReaders()) {
    const v = a.read();
    if (a.valid(v)) return v2Hash(a.kind, v);
  }
  const err = new Error('Hardware fingerprint source is unavailable');
  err.code = 'FINGERPRINT_UNAVAILABLE';
  throw err;
}

// ── Legacy (v1) reproduction — backward compatibility only ────────────────────

/** Exact normalisation the v1 algorithm used: lowercase + strip ALL whitespace. */
function v1Norm(c) {
  return String(c == null ? '' : c).toLowerCase().replace(/\s+/g, '');
}

function v1Hash(cpu, mac, disk, uuid) {
  return sha256hex([cpu, mac, disk, uuid].map(v1Norm).join('::'));
}

/** Every non-internal MAC currently visible (the v1 hash used whichever was first). */
function listMacCandidates() {
  const macs = new Set();
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.internal) continue;
      if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue;
      macs.add(iface.mac);
    }
  }
  return macs;
}

/**
 * Reproduce the set of v1 ids this machine could have been bound to. The only
 * genuinely unstable v1 input was the MAC (adapter order), so we enumerate every
 * visible MAC plus the "no-mac" fallback, keeping CPU/disk/SMBIOS-UUID fixed.
 */
function getLegacyCandidateIds() {
  const platform = os.platform();
  let cpu = '';
  let disk = '';
  let uuid = '';

  if (platform === 'win32') {
    const b = readWmiBundle();
    cpu = b.cpu || (os.cpus().length ? os.cpus()[0].model : 'unknown-cpu');
    disk = b.disk || 'no-disk-serial';
    uuid = b.uuid || 'no-system-uuid';
  } else {
    // Non-Windows v1 collectors were already stable enough; reuse os-level data.
    cpu = os.cpus().length ? os.cpus()[0].model : 'unknown-cpu';
    disk = 'no-disk-serial';
    uuid = readDarwinPlatformUuid() || readLinuxMachineId() || 'no-system-uuid';
  }

  const ids = new Set();
  const macs = listMacCandidates();
  const macValues = macs.size ? [...macs, 'no-mac'] : ['no-mac'];
  for (const mac of macValues) ids.add(v1Hash(cpu, mac, disk, uuid));
  return ids;
}

// ── Matching (used by license verification) ───────────────────────────────────

/**
 * Does `boundId` (the machineId stored in a license) belong to THIS machine?
 * Tries the cheap canonical id first, then other v2 anchors, then legacy v1.
 * Comparison is normalised (trim + lowercase) on both sides.
 *
 * @returns {{ matched: boolean, via: string|null }}
 */
function matchMachineId(boundId) {
  const bound = canon(boundId);
  if (!bound) return { matched: false, via: null };

  // Primary canonical anchor first (memoised after the first read).
  let primary = null;
  try { primary = getMachineId(); } catch { /* fall through to other sources */ }
  if (primary && canon(primary) === bound) return { matched: true, via: 'v2-primary' };

  // Other v2 anchors (e.g. SMBIOS UUID).
  for (const c of getV2Candidates()) {
    if (canon(c.id) === bound) return { matched: true, via: c.kind };
  }

  // Legacy v1 ids (existing licenses).
  for (const id of getLegacyCandidateIds()) {
    if (canon(id) === bound) return { matched: true, via: 'v1-legacy' };
  }

  return { matched: false, via: null };
}

// ── Diagnostics (safe to log — prefixes & availability only) ───────────────────

/**
 * Returns ONLY non-sensitive data: which hardware sources are available and a
 * short hash prefix of the canonical id. No raw serials/UUIDs/MACs are exposed.
 */
function getMachineDiagnostics() {
  const platform = os.platform();
  let canonical = null;
  let source = null;
  try {
    const candidates = getV2Candidates();
    if (candidates.length) {
      canonical = candidates[0].id;
      source = candidates[0].kind;
    }
  } catch { /* unavailable */ }

  const sources = { machineGuid: false, smbiosUuid: false, platformUuid: false, macCount: 0 };
  if (platform === 'win32') {
    sources.machineGuid = !!readMachineGuid();
    sources.smbiosUuid = isUsableUuid(readWmiBundle().uuid);
  } else if (platform === 'darwin') {
    sources.platformUuid = !!readDarwinPlatformUuid();
  } else {
    sources.platformUuid = !!readLinuxMachineId();
  }
  sources.macCount = listMacCandidates().size;

  return {
    platform,
    canonicalSource: source,
    canonicalPrefix: canonical ? canonical.slice(0, 12) : null,
    available: canonical != null,
    sources,
  };
}

/** Raw v2 + legacy components (verbose; for the CLI / manual debugging only). */
function getMachineIdComponents() {
  if (os.platform() === 'win32') {
    const b = readWmiBundle();
    return { machineGuid: readMachineGuid(), smbiosUuid: b.uuid, cpu: b.cpu, diskSerial: b.disk };
  }
  return {
    platformUuid: readDarwinPlatformUuid() || readLinuxMachineId(),
    cpu: os.cpus().length ? os.cpus()[0].model : 'unknown-cpu',
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

if (isMainModule) {
  console.log('Machine fingerprint diagnostics:');
  console.log(JSON.stringify(getMachineDiagnostics(), null, 2));
  console.log();
  try {
    console.log(`Canonical Machine ID (v2): ${getMachineId()}`);
  } catch (e) {
    console.log(`Canonical Machine ID (v2): <unavailable: ${e.code || e.message}>`);
  }
  console.log(`Legacy (v1) candidate count: ${getLegacyCandidateIds().size}`);
}

export {
  getMachineId,
  matchMachineId,
  getMachineDiagnostics,
  getMachineIdComponents,
  // exported for tests / advanced callers:
  getV2Candidates,
  getLegacyCandidateIds,
};
