/**
 * mDNS / Bonjour LAN advertisement for NuqtaPlus server.
 *
 * Publishes a `_nuqtaplus._tcp.local` service so client desktops on the same
 * LAN can discover the server automatically. The TXT record carries the
 * metadata that clients use to label and pre-select the right server in
 * multi-server setups.
 *
 * Only intended to run in SERVER mode. The backend is mode-agnostic at the
 * process level, so the caller (server.js) is responsible for deciding when
 * to start advertising — typically right after fastify.listen() succeeds.
 */
import os from 'node:os';
import { Bonjour } from 'bonjour-service';

const SERVICE_TYPE = 'nuqtaplus'; // becomes _nuqtaplus._tcp.local
const PROTOCOL = 'tcp';

let bonjourInstance = null;
let publishedService = null;
let lastMetadata = null;
let log = console;

function setLogger(externalLogger) {
  if (externalLogger && typeof externalLogger.info === 'function') {
    log = externalLogger;
  }
}

function buildServiceName({ companyName, branchName }) {
  const safeCompany = (companyName || 'NuqtaPlus').trim() || 'NuqtaPlus';
  const safeBranch = (branchName || 'Main').trim() || 'Main';
  // Keep the name reasonably short — some Bonjour stacks truncate at ~63 bytes.
  const raw = `NuqtaPlus - ${safeCompany} - ${safeBranch}`;
  return raw.length > 60 ? raw.slice(0, 60) : raw;
}

function buildTxtRecord(meta) {
  const txt = {
    app: 'NuqtaPlus',
    role: 'server',
    machineId: String(meta.machineId || ''),
    companyName: String(meta.companyName || 'NuqtaPlus'),
    branchName: String(meta.branchName || 'Main'),
    version: String(meta.version || ''),
    hostname: os.hostname(),
  };
  if (meta.remoteUrl) {
    txt.remoteUrl = String(meta.remoteUrl);
  }
  return txt;
}

function metadataChanged(prev, next) {
  if (!prev) return true;
  const keys = [
    'port',
    'machineId',
    'companyName',
    'branchName',
    'version',
    'remoteUrl',
  ];
  return keys.some((k) => prev[k] !== next[k]);
}

/**
 * Start advertising the server on LAN. Idempotent — calling start() again
 * with the same metadata is a no-op; with changed metadata, the previous
 * advertisement is stopped and a fresh one is published.
 *
 * @param {Object} options
 * @param {number} options.port           - TCP port the HTTP API listens on (e.g. 41732)
 * @param {string} options.machineId      - Stable machine identifier
 * @param {string} [options.companyName]  - Display label (defaults to "NuqtaPlus")
 * @param {string} [options.branchName]   - Display label (defaults to "Main")
 * @param {string} [options.version]      - Backend version
 * @param {string} [options.remoteUrl]    - Optional Cloudflare-tunnel public URL
 * @param {Object} [options.log]          - Fastify-style logger
 * @returns {Promise<{ name: string, type: string, port: number }>}
 */
export async function start(options = {}) {
  if (options.log) setLogger(options.log);

  const meta = {
    port: Number(options.port) || 41732,
    machineId: options.machineId || '',
    companyName: options.companyName || 'NuqtaPlus',
    branchName: options.branchName || 'Main',
    version: options.version || '',
    remoteUrl: options.remoteUrl || '',
  };

  // Idempotency guard.
  if (publishedService && !metadataChanged(lastMetadata, meta)) {
    log.info(`[mdns] advertisement already running for ${buildServiceName(meta)} — skipping re-publish`);
    return {
      name: publishedService.name,
      type: SERVICE_TYPE,
      port: meta.port,
    };
  }

  // If something is already published but metadata changed, tear it down first.
  if (publishedService) {
    log.info('[mdns] metadata changed — restarting advertisement');
    await stop({ keepInstance: true });
  }

  if (!bonjourInstance) {
    try {
      bonjourInstance = new Bonjour();
    } catch (err) {
      log.error(`[mdns] failed to initialize Bonjour stack: ${err.message}`);
      log.warn(
        '[mdns] LAN discovery will be unavailable. On Windows, make sure UDP port 5353 is allowed through the firewall.'
      );
      bonjourInstance = null;
      throw err;
    }
  }

  const name = buildServiceName(meta);
  const txt = buildTxtRecord(meta);

  try {
    publishedService = bonjourInstance.publish({
      name,
      type: SERVICE_TYPE,
      protocol: PROTOCOL,
      port: meta.port,
      txt,
    });
  } catch (err) {
    log.error(`[mdns] publish() threw: ${err.message}`);
    publishedService = null;
    throw err;
  }

  publishedService.on('up', () => {
    log.info(
      `[mdns] advertising ${name} on _${SERVICE_TYPE}._${PROTOCOL}.local port=${meta.port}`
    );
  });

  publishedService.on('error', (err) => {
    const msg = err && err.message ? err.message : String(err);
    log.warn(`[mdns] advertisement error: ${msg}`);
    log.warn(
      '[mdns] If this persists on Windows, confirm "Bonjour Service" / mDNS UDP 5353 is allowed by the firewall.'
    );
  });

  lastMetadata = meta;
  log.info(`[mdns] published service "${name}" port=${meta.port}`);

  return { name, type: SERVICE_TYPE, port: meta.port };
}

/**
 * Stop the current advertisement and (optionally) destroy the Bonjour stack.
 * Safe to call multiple times.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.keepInstance=false] - if true, do not destroy the
 *   underlying Bonjour socket. Used internally by restart-on-metadata-change.
 */
export async function stop(opts = {}) {
  const { keepInstance = false } = opts;

  if (publishedService) {
    try {
      await new Promise((resolve) => {
        try {
          publishedService.stop(() => resolve());
        } catch (err) {
          log.warn(`[mdns] stop() threw: ${err.message}`);
          resolve();
        }
      });
      log.info('[mdns] advertisement stopped');
    } catch (err) {
      log.warn(`[mdns] error stopping advertisement: ${err.message}`);
    }
    publishedService = null;
  }
  lastMetadata = null;

  if (!keepInstance && bonjourInstance) {
    try {
      bonjourInstance.destroy();
    } catch (err) {
      log.warn(`[mdns] destroy() threw: ${err.message}`);
    }
    bonjourInstance = null;
  }
}

/**
 * Convenience accessor for diagnostics / admin endpoints.
 */
export function getStatus() {
  return {
    active: !!publishedService,
    serviceType: SERVICE_TYPE,
    protocol: PROTOCOL,
    metadata: lastMetadata,
  };
}

export default { start, stop, getStatus };
