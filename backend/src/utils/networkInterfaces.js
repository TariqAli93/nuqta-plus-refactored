import os from 'node:os';

export function getLanAddresses() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.internal) continue;
      if (iface.family !== 'IPv4') continue;
      out.push({ interface: name, address: iface.address, mac: iface.mac });
    }
  }
  return out;
}
