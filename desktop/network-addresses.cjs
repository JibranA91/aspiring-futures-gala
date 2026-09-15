'use strict';
const os = require('node:os');
const { isIPv4 } = require('node:net');

// Classify known virtual adapters by name, never by their private IP range.
const VIRTUAL_ADAPTER = /\b(?:vEthernet|WSL|Hyper-V|Docker|VMware|VirtualBox|VPN|Tailscale|ZeroTier|WireGuard|TAP-Windows)\b|^(?:(?:docker|virbr|vmnet|vboxnet|utun|tun|tap|wg|awdl|llw|p2p|bridge)\d+(?:$|[ :._-])|(?:veth|br-)[\da-f]+$)/i;

function networkInfo(interfaces = os.networkInterfaces()) {
  const adapters = [], urls = new Set();
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const entry of addresses || []) {
      if (!entry || !['IPv4', 4].includes(entry.family) || !isIPv4(entry.address)) continue;
      const address = entry.address;
      const local = entry.internal || address.startsWith('127.') || address.startsWith('169.254.') || address === '0.0.0.0';
      const kind = local ? 'local' : VIRTUAL_ADAPTER.test(name) ? 'virtual' : 'lan';
      adapters.push({ name, address, kind });
      if (kind === 'lan') urls.add('http://' + address + ':8080/audience.html');
    }
  }
  return { urls: [...urls], adapters };
}

module.exports = { networkInfo };
