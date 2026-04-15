'use strict';

import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function extractValue(output, key) {
  // Handles "Key=Value" (wmic /VALUE) and "Key : Value" (systeminfo) formats
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(key.toLowerCase())) {
      const sep = trimmed.indexOf('=');
      if (sep !== -1) return trimmed.slice(sep + 1).trim();
      const col = trimmed.indexOf(':');
      if (col !== -1) return trimmed.slice(col + 1).trim();
    }
  }
  return '';
}

// ── Component collectors ─────────────────────────────────────────────────────

function getCpuId() {
  const platform = os.platform();

  if (platform === 'win32') {
    const out = tryExec('wmic cpu get ProcessorId /VALUE');
    const id = extractValue(out, 'ProcessorId');
    if (id) return id;
    // Fallback to PowerShell
    const ps = tryExec('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).ProcessorId"');
    if (ps) return ps;
  }

  if (platform === 'linux') {
    // Try /proc/cpuinfo "model name" + "cpu family" + "stepping"
    const cpuinfo = tryExec('cat /proc/cpuinfo');
    const model = extractValue(cpuinfo, 'model name');
    const family = extractValue(cpuinfo, 'cpu family');
    const stepping = extractValue(cpuinfo, 'stepping');
    if (model) return `${model}:${family}:${stepping}`;
  }

  if (platform === 'darwin') {
    const brand = tryExec('sysctl -n machdep.cpu.brand_string');
    if (brand) return brand;
  }

  // Universal fallback: first CPU model from os.cpus()
  const cpus = os.cpus();
  return cpus.length ? cpus[0].model : 'unknown-cpu';
}

function getMacAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      // Skip internal/loopback and all-zero MACs
      if (iface.internal) continue;
      if (iface.mac === '00:00:00:00:00:00') continue;
      return iface.mac;
    }
  }
  return 'no-mac';
}

function getDiskSerial() {
  const platform = os.platform();

  if (platform === 'win32') {
    const out = tryExec('wmic diskdrive get SerialNumber /VALUE');
    const serial = extractValue(out, 'SerialNumber');
    if (serial) return serial;
    const ps = tryExec('powershell -NoProfile -Command "(Get-CimInstance Win32_DiskDrive | Select-Object -First 1).SerialNumber"');
    if (ps) return ps.trim();
  }

  if (platform === 'linux') {
    // Try lsblk first
    const lsblk = tryExec('lsblk --nodeps -no serial 2>/dev/null | head -1');
    if (lsblk) return lsblk;
    // Fallback: /dev/sda or /dev/vda
    const udev = tryExec('udevadm info --query=property --name=/dev/sda 2>/dev/null | grep ID_SERIAL_SHORT');
    if (udev) return udev.split('=')[1] || '';
  }

  if (platform === 'darwin') {
    const out = tryExec('system_profiler SPStorageDataType 2>/dev/null');
    // Look for "Volume UUID" or "Device Name" – both are stable enough
    const uuid = extractValue(out, 'Volume UUID');
    if (uuid) return uuid;
  }

  return 'no-disk-serial';
}

function getSystemUUID() {
  const platform = os.platform();

  if (platform === 'win32') {
    const out = tryExec('wmic csproduct get UUID /VALUE');
    const uuid = extractValue(out, 'UUID');
    if (uuid && uuid !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF') return uuid;
    const ps = tryExec('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"');
    if (ps) return ps.trim();
  }

  if (platform === 'linux') {
    // /etc/machine-id is always readable and stable
    const mid = tryExec('cat /etc/machine-id 2>/dev/null');
    if (mid) return mid;
    // DMI product_uuid needs root but try anyway
    const dmi = tryExec('cat /sys/class/dmi/id/product_uuid 2>/dev/null');
    if (dmi) return dmi;
  }

  if (platform === 'darwin') {
    const out = tryExec('ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null');
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }

  return 'no-system-uuid';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a stable, deterministic machine identifier.
 * Combines CPU, MAC, disk serial, and system UUID into a single SHA-256 hash.
 */
function getMachineId() {
  const components = [
    getCpuId(),
    getMacAddress(),
    getDiskSerial(),
    getSystemUUID(),
  ];

  // Normalize: lowercase, strip whitespace, join with separator
  const normalized = components
    .map(c => c.toLowerCase().replace(/\s+/g, ''))
    .join('::');

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Return the raw components (useful for debugging).
 */
function getMachineIdComponents() {
  return {
    cpu: getCpuId(),
    mac: getMacAddress(),
    diskSerial: getDiskSerial(),
    systemUUID: getSystemUUID(),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);

if (isMainModule) {
  console.log('Machine ID Components:');
  const parts = getMachineIdComponents();
  for (const [k, v] of Object.entries(parts)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log();
  console.log(`Machine ID: ${getMachineId()}`);
}

export { getMachineId, getMachineIdComponents };
