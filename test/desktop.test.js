'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { EventStore, publicState } = require('../desktop/event-store.cjs');
const { LANServer, assetPath } = require('../desktop/lan-server.cjs');
const { Supervisor } = require('../desktop/supervisor.cjs');
const Brand = require('../gala/js/branding.js');
const { Component } = require('../gala/js/controller.js');

const example = () => ({ rev: 1, goal: 10000, eventName: 'Test event', branding: Brand.defaults,
  fields: [{ id: 'table', label: 'Table', onScreen: true }, { id: 'phone', label: 'Private phone', onScreen: false }],
  retiredFields: [{ id: 'notes', label: 'Notes' }],
  donations: [{ id: 'gift-1', ts: '2026-01-01', name: 'Private identity', anon: true, amount: 250, fields: { table: '5', phone: '555-secret', notes: 'private notes' } }] });

test('event file saves survive a new store and recover a corrupt latest file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new EventStore(directory), original = example();
  store.save(original);
  assert.deepEqual(new EventStore(directory).load(), original);
  store.save({ ...original, goal: 20000 });
  fs.writeFileSync(store.file, '{partial');
  const recovery = new EventStore(directory);
  assert.deepEqual(recovery.load(), original);
  assert.equal(recovery.recovered, true);
  recovery.save({ ...original, goal: 30000 });
  assert.equal(recovery.load().goal, 30000);
});

test('invalid event files cannot replace a valid event; archives preserve all fields', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new EventStore(directory), original = example();
  store.save(original);
  assert.throws(() => store.save({ donations: [...original.donations, ...original.donations] }), /duplicate/);
  assert.deepEqual(store.load(), original);
  store.archive(original);
  const archived = fs.readdirSync(directory).find(name => name.startsWith('event-'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, archived))), original);
});

test('audience payload excludes anonymous names, private and retired fields, and voided gifts', () => {
  const state = example();
  state.donations.push({ id: 'voided', name: 'Hidden void', amount: 200, voided: true });
  const snapshot = publicState(state);
  assert.equal(snapshot.donations.length, 1);
  assert.equal(snapshot.donations[0].name, '');
  assert.deepEqual(snapshot.donations[0].fields, { table: '5' });
  assert.doesNotMatch(JSON.stringify(snapshot), /Private identity|555-secret|private notes|Hidden void|phone|retiredFields/);
});

test('branding validates images, colors, currency, and preserves legacy appearance', () => {
  assert.equal(Brand.normalize().organization, 'Aspiring Futures');
  assert.equal(Brand.normalize(Brand.defaults).organization, 'Your organization');
  const invalid = Brand.normalize({ primary: 'red; background:url(evil)', logo: 'https://remote/logo', donationUrl: 'javascript:alert(1)', currency: 'BAD' });
  assert.equal(invalid.primary, Brand.defaults.primary);
  assert.equal(invalid.logo, '');
  assert.equal(invalid.donationUrl, '');
  assert.equal(invalid.currency, 'USD');
  assert.equal(Brand.money(250, 'GBP'), '£250');
  assert.ok(Brand.contrast('#000000', '#ffffff') >= 21);
  const csv = Component.prototype.csvText.call({}, { ...example(), branding: { currency: 'GBP' } });
  assert.match(csv, /Amount GBP/);
});

test('LAN pairing is rate-limited and read-only, with reconnectable audience state', async t => {
  const options = { root: path.resolve('gala'), code: '0123', secret: 'secret-for-this-test', state: publicState(example()) };
  let server = new LANServer(options);
  const port = await server.start(0, '127.0.0.1');
  t.after(() => server.stop());
  const base = 'http://127.0.0.1:' + port;
  const pair = code => fetch(base + '/api/pair', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ code }) });
  assert.equal((await fetch(base + '/api/events')).status, 401);
  assert.equal((await fetch(base + '/api/pair', { method: 'POST', body: '{"code":"0123"}' })).status, 403);
  assert.equal((await fetch(base + '/api/restart', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/js/controller.js')).status, 404);
  assert.match(await (await fetch(base + '/')).text(), /Pair with the recording laptop/);
  assert.equal((await pair('9999')).status, 401);
  const { token } = await (await pair('0123')).json();
  assert.ok(server.authorized(token));
  assert.equal(server.authorized(token + 'x'), false);
  assert.equal(server.authorized(token + '.suffix'), false);
  const cancel = new AbortController();
  const response = await fetch(base + '/api/events?token=' + token, { signal: cancel.signal });
  const first = new TextDecoder().decode((await response.body.getReader().read()).value);
  assert.match(first, /Test event/);
  assert.doesNotMatch(first, /Private identity|555-secret/);
  cancel.abort();
  await server.stop();
  server = new LANServer({ ...options, state: { ...options.state, goal: 12345 } });
  await server.start(port, '127.0.0.1');
  assert.ok(server.authorized(token), 'same token works after a server restart');
  for (let i = 0; i < 5; i++) await pair('9999');
  assert.equal((await pair('9999')).status, 429);
  assert.equal(assetPath(path.resolve('gala'), '/../package.json'), null);
  assert.equal(assetPath(path.resolve('gala'), '/js/..\\..\\package.json'), null);
});

test('a real occupied loopback port is rejected without taking over the other server', async t => {
  const http = require('node:http');
  const existing = http.createServer((_, res) => res.end('existing app'));
  await new Promise(resolve => existing.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { existing.close(resolve); existing.closeAllConnections(); }));
  const port = existing.address().port;
  const server = new LANServer({ root: path.resolve('gala'), code: '1234', secret: 'secret' });
  await assert.rejects(server.start(port), { code: 'EADDRINUSE' });
  assert.equal(await (await fetch('http://127.0.0.1:' + port)).text(), 'existing app');
});

test('supervisor retains the latest state and restarts without replacing pairing', async t => {
  const workers = [];
  const spawn = () => {
    const worker = new EventEmitter(); worker.messages = [];
    worker.postMessage = value => worker.messages.push(value);
    worker.kill = () => process.nextTick(() => worker.emit('exit', 0));
    workers.push(worker); return worker;
  };
  const supervisor = new Supervisor(spawn, { code: '1234', secret: 'secret', state: { rev: 1 } });
  t.after(() => supervisor.stop());
  supervisor.start();
  workers[0].emit('message', { type: 'ready' });
  assert.equal(supervisor.status, 'running');
  supervisor.send('state', { rev: 2 });
  await supervisor.restart();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].messages[0].options, { code: '1234', secret: 'secret', state: { rev: 2 } });
  workers[1].emit('message', { type: 'error', code: 'EADDRINUSE' });
  assert.match(supervisor.error, /Port 8080 is in use/);
  assert.equal(supervisor.status, 'failed');
  assert.equal(supervisor.worker, null);
});
