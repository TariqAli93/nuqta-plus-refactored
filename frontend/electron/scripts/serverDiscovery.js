/**
 * mDNS / Bonjour discovery for NuqtaPlus server in CLIENT mode.
 *
 * Browses `_nuqtaplus._tcp.local` for a short window and returns a
 * normalized list of servers. Runs in the Electron main process — the
 * renderer talks to it over IPC (see main.js `mdns:discover`).
 *
 * The browse is intentionally short-lived (default 4s) and disposable:
 * each discovery call spins up a fresh Bonjour instance and tears it
 * down at the end. This avoids leaking sockets across rapid retries
 * and sidesteps a class of bugs where the underlying library doesn't
 * dedupe correctly when restarting the same browser.
 */
import { Bonjour } from 'bonjour-service';
import logger from './logger.js';

const SERVICE_TYPE = 'nuqtaplus';
const PROTOCOL = 'tcp';
const DEFAULT_DURATION_MS = 4000;

function pickIpv4Address(service) {
  if (!service) return '';
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  const ipv4 = addresses.find(
    (a) => typeof a === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(a)
  );
  if (ipv4) return ipv4;
  // Fall back to whatever the lib gave us (could be IPv6 — we keep it
  // around so the user can still see something rather than nothing).
  return addresses[0] || '';
}

function normalizeTxt(txt) {
  if (!txt || typeof txt !== 'object') return {};
  // bonjour-service usually returns string values, but be defensive.
  const out = {};
  for (const [k, v] of Object.entries(txt)) {
    if (v == null) continue;
    out[k] = Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  }
  return out;
}

function buildLocalUrl(ip, host, port) {
  const target = ip || host;
  if (!target) return '';
  // bonjour-service sometimes returns hostnames like "device.local." — strip the
  // trailing dot so it can be used as a URL host.
  const cleanTarget = String(target).replace(/\.$/, '');
  return `http://${cleanTarget}:${port}`;
}

function serviceToServer(service) {
  const txt = normalizeTxt(service.txt);
  const ip = pickIpv4Address(service);
  const host = service.host || service.fqdn || '';
  const port = Number(service.port) || 41732;

  // Stable id — prefer machineId from TXT, fall back to host+port.
  const id = txt.machineId || `${host || ip}:${port}`;

  return {
    id,
    name: service.name || txt.companyName || 'NuqtaPlus',
    host,
    ip,
    port,
    url: buildLocalUrl(ip, host, port),
    machineId: txt.machineId || '',
    companyName: txt.companyName || 'NuqtaPlus',
    branchName: txt.branchName || 'Main',
    version: txt.version || '',
    remoteUrl: txt.remoteUrl || '',
    app: txt.app || '',
    role: txt.role || '',
    source: 'mdns',
  };
}

/**
 * Browse for NuqtaPlus servers on the LAN for `durationMs` milliseconds.
 * Resolves with a deduplicated array of normalized server descriptors.
 *
 * Never throws — discovery errors are logged and resolved as an empty list.
 *
 * @param {Object} [opts]
 * @param {number} [opts.durationMs=4000] - Browse window in milliseconds.
 * @returns {Promise<Array<Object>>}
 */
export function discover({ durationMs = DEFAULT_DURATION_MS } = {}) {
  return new Promise((resolve) => {
    let bonjour;
    try {
      bonjour = new Bonjour();
    } catch (err) {
      logger.warn(`[mdns] failed to initialize Bonjour: ${err.message}`);
      logger.warn(
        '[mdns] LAN discovery unavailable. On Windows, ensure UDP port 5353 is allowed by the firewall.'
      );
      resolve([]);
      return;
    }

    const byId = new Map();

    let browser;
    try {
      browser = bonjour.find({ type: SERVICE_TYPE, protocol: PROTOCOL });
    } catch (err) {
      logger.warn(`[mdns] find() threw: ${err.message}`);
      try {
        bonjour.destroy();
      } catch {
        /* ignore */
      }
      resolve([]);
      return;
    }

    const collectService = (service) => {
      try {
        // Only accept records that look like ours. NuqtaPlus advertises with
        // app=NuqtaPlus + role=server in TXT — but be lenient (some stacks
        // deliver the `up` event before all TXT bytes are parsed).
        const server = serviceToServer(service);
        const role = (server.role || '').toLowerCase();
        const appName = (server.app || '').toLowerCase();
        if (appName && appName !== 'nuqtaplus') return;
        if (role && role !== 'server') return;

        const existing = byId.get(server.id);
        if (existing) {
          // Merge — keep whichever record has more populated fields.
          byId.set(server.id, { ...existing, ...server });
        } else {
          byId.set(server.id, server);
        }
      } catch (err) {
        logger.warn(`[mdns] failed to normalize service: ${err.message}`);
      }
    };

    browser.on('up', collectService);
    browser.on('down', (service) => {
      try {
        const server = serviceToServer(service);
        if (byId.has(server.id)) {
          byId.delete(server.id);
        }
      } catch {
        /* ignore */
      }
    });
    browser.on('error', (err) => {
      logger.warn(`[mdns] browser error: ${err?.message || err}`);
    });

    // Some services may already be cached on the browser instance.
    try {
      const initial = browser.services || [];
      initial.forEach(collectService);
    } catch {
      /* ignore */
    }

    const finish = () => {
      try {
        browser.stop();
      } catch {
        /* ignore */
      }
      try {
        bonjour.destroy();
      } catch {
        /* ignore */
      }
      const result = Array.from(byId.values());
      logger.info(`[mdns] discovery finished — found ${result.length} server(s)`);
      resolve(result);
    };

    setTimeout(finish, Math.max(500, durationMs));
  });
}

export default { discover };
