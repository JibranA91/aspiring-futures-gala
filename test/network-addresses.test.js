'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { networkInfo } = require('../desktop/network-addresses.cjs');
const ipv4 = (address, extra = {}) => ({ family: 'IPv4', internal: false, address, ...extra });
const url = address => 'http://' + address + ':8080/audience.html';

test('Windows virtual adapters are hidden from links but retained in diagnostics', () => {
  const result = networkInfo({
    'vEthernet (WSL (Hyper-V firewall))': [ipv4('172.25.64.1')],
    'VMware Network Adapter VMnet8': [ipv4('192.168.56.1')],
    'Wi-Fi': [ipv4('10.0.0.156')]
  });
  assert.deepEqual(result.urls, [url('10.0.0.156')]);
  assert.deepEqual(result.adapters[0], { name: 'vEthernet (WSL (Hyper-V firewall))', address: '172.25.64.1', kind: 'virtual' });
  assert.equal(result.adapters[1].kind, 'virtual');
});

test('Mac and Linux virtual links are hidden without hiding Ethernet and Wi-Fi', () => {
  const names = ['utun4', 'awdl0', 'llw0', 'bridge100', 'docker0', 'veth123abc', 'br-ef0123', 'tun0', 'wg0', 'vboxnet0', 'Tailscale', 'WireGuard'];
  const interfaces = Object.fromEntries(names.map((name, i) => [name, [ipv4('10.9.0.' + (i + 1))]]));
  interfaces.en0 = [ipv4('192.168.1.20')];
  interfaces.en1 = [ipv4('192.168.2.20')];
  interfaces.wlp2s0 = [ipv4('192.168.3.20')];
  const result = networkInfo(interfaces);
  assert.deepEqual(result.urls, ['192.168.1.20', '192.168.2.20', '192.168.3.20'].map(url));
  assert.equal(result.adapters.filter(item => item.kind === 'virtual').length, names.length);
});

test('physical LAN addresses in the 172 range remain available', () => {
  const result = networkInfo({ Ethernet: [ipv4('172.25.64.1')], 'vEthernet (Default Switch)': [ipv4('10.0.0.5')] });
  assert.deepEqual(result.urls, [url('172.25.64.1')]);
});

test('loopback, unconfigured, IPv6 and link-local addresses do not become projector links', () => {
  const result = networkInfo({
    lo: [ipv4('127.0.0.1', { internal: true })],
    Ethernet: [ipv4('169.254.1.2'), ipv4('0.0.0.0'), { family: 'IPv6', address: 'fe80::1', internal: false }, ipv4('invalid')],
    missing: undefined
  });
  assert.deepEqual(result.urls, []);
  assert.equal(result.adapters.length, 3);
  assert.ok(result.adapters.every(item => item.kind === 'local'));
});

test('virtual-only networks never fall back to an unusable link and duplicate LAN links are removed', () => {
  assert.deepEqual(networkInfo({ 'vEthernet (WSL)': [ipv4('172.25.64.1')] }).urls, []);
  assert.deepEqual(networkInfo(null), { urls: [], adapters: [] });
  assert.deepEqual(networkInfo({ 'Wi-Fi': [ipv4('10.0.0.2'), ipv4('10.0.0.2', { family: 4 })] }).urls, [url('10.0.0.2')]);
});
