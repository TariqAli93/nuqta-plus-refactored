/**
 * connectionResolver — picks the right server URL when the client app starts.
 *
 * Priority order:
 *   1. The saved server (if any), if its /health passes.
 *   2. mDNS discovery — auto-connect when exactly one server is found.
 *   3. Multiple discovered servers → UI prompts the user.
 *   4. Manual IP entry (UI).
 *   5. Optional user-selected remote URL (UI).
 *
 * This module returns a *resolution* describing what to do; it never blocks
 * on UI. The caller (ServerSetup.vue) handles step 3+ interactively.
 */
import { useConnectionStore } from '@/stores/connection';
import { discoverServers } from './serverDiscovery.service.js';

const DEFAULT_DISCOVERY_MS = 4000;

/**
 * @typedef {Object} ConnectionResolution
 * @property {'saved' | 'mdns-single' | 'mdns-multiple' | 'none'} kind
 * @property {boolean} connected           - true if the store ended up connected
 * @property {Array<Object>} [servers]     - mDNS results when kind=mdns-multiple
 * @property {Object} [server]             - selected server when kind=mdns-single
 * @property {string} [error]              - last attempt error, if any
 */

/**
 * Try to establish a connection automatically.
 *
 * @param {Object} [opts]
 * @param {number} [opts.durationMs=4000]
 * @returns {Promise<ConnectionResolution>}
 */
export async function resolveConnection({ durationMs = DEFAULT_DISCOVERY_MS } = {}) {
  const store = useConnectionStore();

  // Server mode never needs a remote connection.
  if (store.isServerMode) {
    store.isConnected = true;
    return { kind: 'saved', connected: true };
  }

  // 1. Saved server — try first.
  store.loadSavedConnection();
  if (store.serverHost || store.overrideUrl) {
    const ok = await store.verifySavedConnection();
    if (ok) {
      return { kind: 'saved', connected: true };
    }
  }

  // 2. mDNS discovery.
  const servers = await discoverServers({ durationMs });

  if (servers.length === 1) {
    const server = servers[0];
    if (server.ip || server.host) {
      const host = server.ip || server.host;
      const res = await store.connect(host, server.port, {
        machineId: server.machineId,
        name: server.name,
        mode: 'mdns',
      });
      if (res.success) {
        return { kind: 'mdns-single', connected: true, server };
      }
      return {
        kind: 'mdns-single',
        connected: false,
        server,
        error: res.error || 'فشل الاتصال بالخادم المكتشف',
      };
    }
  }

  if (servers.length > 1) {
    return { kind: 'mdns-multiple', connected: false, servers };
  }

  return { kind: 'none', connected: false, servers: [] };
}

/**
 * Connect to a specific server descriptor returned by mDNS discovery.
 */
export async function connectToDiscoveredServer(server) {
  if (!server) return { success: false, error: 'لا يوجد سيرفر للاتصال به' };
  const store = useConnectionStore();
  const host = server.ip || server.host;
  if (!host) {
    return { success: false, error: 'الخادم المختار لا يحتوي على عنوان IP صالح' };
  }
  return store.connect(host, server.port || 41732, {
    machineId: server.machineId,
    name: server.name,
    mode: 'mdns',
  });
}

/**
 * Connect via the optional Cloudflare-tunnel public URL advertised by a server,
 * or one the user typed in manually.
 */
export async function connectViaRemoteUrl(url, opts = {}) {
  const store = useConnectionStore();
  return store.connectRemoteUrl(url, opts);
}

export default {
  resolveConnection,
  connectToDiscoveredServer,
  connectViaRemoteUrl,
};
