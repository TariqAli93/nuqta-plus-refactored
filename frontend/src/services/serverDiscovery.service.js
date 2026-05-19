/**
 * Thin renderer-side wrapper around the Electron main process's mDNS
 * discovery handler. Returns a normalized list of NuqtaPlus servers
 * visible on the LAN, or an empty list when discovery is unavailable
 * (e.g. browser context, firewall blocking, etc).
 */

const DEFAULT_DURATION_MS = 4000;

function hasElectronBridge() {
  return (
    typeof window !== 'undefined' &&
    window.electronAPI &&
    typeof window.electronAPI.discoverServers === 'function'
  );
}

/**
 * Browse the LAN for NuqtaPlus servers.
 *
 * @param {Object} [opts]
 * @param {number} [opts.durationMs=4000] - How long to collect responses for.
 * @returns {Promise<Array<Object>>}
 */
export async function discoverServers({ durationMs = DEFAULT_DURATION_MS } = {}) {
  if (!hasElectronBridge()) {
    return [];
  }
  try {
    const result = await window.electronAPI.discoverServers({ durationMs });
    if (!result || !result.success) return [];
    return Array.isArray(result.servers) ? result.servers : [];
  } catch {
    return [];
  }
}

export default { discoverServers };
