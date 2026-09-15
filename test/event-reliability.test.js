'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Component: Controller, DEFAULTS } = require('../gala/js/controller.js');
const { Component: Audience } = require('../gala/js/audience.js');
const { EventStore, validateState, selectRecovery } = require('../desktop/event-store.cjs');

function controller() {
  const app = new Controller();
  app.state.s = structuredClone(DEFAULTS);
  app.setState = patch => Object.assign(app.state, patch);
  app.persist = () => {};
  app.broadcast = () => {};
  app.writeBackup = () => {};
  return app;
}
function gift(id = 'gift-1', amount = 200) {
  return { id, amount, name: 'Test donor', ts: '2026-01-01T12:34:56Z', fields: { status: 'Paid', removed: 'keep me' }, voided: false };
}

test('100 rapid gifts keep unique IDs, the exact total and monotonically increasing revisions', () => {
  const app = controller(), revisions = [], tokens = [];
  app.persist = state => { revisions.push(state.rev); tokens.push(state.stage.token); };
  for (let i = 0; i < 100; i++) {
    app.state.f = { name: 'Donor ' + i, amount: String(i + 1), anon: false, vals: { status: 'Paid', collector: 'Operator' } };
    app.add(true);
  }
  assert.equal(app.state.s.donations.length, 100);
  assert.equal(new Set(app.state.s.donations.map(d => d.id)).size, 100);
  assert.equal(new Set(tokens).size, 100, 'each gift must trigger its own announcement, even within one millisecond');
  assert.equal(app.state.s.donations.reduce((sum, d) => sum + d.amount, 0), 5050);
  assert.ok(revisions.every((rev, i) => !i || rev > revisions[i - 1]));
  assert.equal(app.state.f.amount, '');
  assert.equal(app.state.f.vals.collector, 'Operator');
});

test('empty, negative, zero, nonnumeric and infinite gifts never enter the ledger', () => {
  const app = controller();
  for (const amount of ['', '-1', '0', 'not money', 'Infinity']) {
    app.state.f = { name: 'Donor', amount, vals: {} };
    app.add(true);
    assert.equal(app.state.s.donations.length, 0);
    assert.ok(app.state.err);
  }
  app.state.f = { name: '   ', amount: '50', vals: {} };
  app.add(true);
  assert.equal(app.state.s.donations.length, 0);
});

test('double submission cannot duplicate the cleared gift form', () => {
  const app = controller();
  app.state.f = { name: 'One donor', amount: '250', vals: {} };
  app.add(true); app.add(true);
  assert.equal(app.state.s.donations.length, 1);
});

test('edit, void and restore keep IDs, timestamps and removed field values', () => {
  const app = controller(), original = gift();
  app.state.s.donations = [original];
  app.openEdit(original.id);
  app.setEditF('name', 'Corrected donor');
  app.setEditF('amount', '900');
  app.toggleEditVoid(); app.saveEdit();
  let updated = app.state.s.donations[0];
  assert.equal(updated.id, original.id);
  assert.equal(updated.ts, original.ts);
  assert.equal(updated.fields.removed, 'keep me');
  assert.equal(updated.amount, 900);
  assert.equal(updated.voided, true);
  app.openEdit(original.id); app.toggleEditVoid(); app.saveEdit();
  updated = app.state.s.donations[0];
  assert.equal(updated.voided, false);
  assert.equal(app.state.s.donations.length, 1);
});

test('canceling an edit and rejecting an invalid edit leave the original gift unchanged', () => {
  const app = controller(), original = gift();
  app.state.s.donations = [original];
  app.openEdit(original.id); app.setEditF('amount', '777'); app.closeEdit();
  assert.deepEqual(app.state.s.donations, [original]);
  app.openEdit(original.id); app.setEditF('amount', 'Infinity'); app.saveEdit();
  assert.deepEqual(app.state.s.donations, [original]);
  assert.ok(app.state.editErr);
});

test('gift announcements queue in order and ignore duplicate deliveries', () => {
  const audience = new Audience();
  audience.setState = patch => Object.assign(audience.state, patch);
  audience.forceUpdate = () => {};
  audience.scheduleExit = () => {};
  audience.pickCategoryFor = () => 'program';
  audience.enqueue('a'); audience.enqueue('b'); audience.enqueue('c'); audience.enqueue('b'); audience.enqueue('a');
  assert.equal(audience.state.current, 'a');
  assert.deepEqual(audience.queue, ['b', 'c']);
  audience.playNext(); assert.equal(audience.state.current, 'b');
  audience.playNext(); assert.equal(audience.state.current, 'c');
  audience.playNext(); assert.equal(audience.state.current, null);
});

test('clearing the announcement queue stops current and pending announcements', () => {
  const audience = new Audience();
  audience.setState = patch => Object.assign(audience.state, patch);
  audience.state.current = 'a'; audience.queue = ['b', 'c'];
  audience.clearStage();
  assert.equal(audience.state.current, null);
  assert.deepEqual(audience.queue, []);
});

test('stale state messages cannot roll back the current donation total', () => {
  const audience = new Audience();
  audience.setState = patch => Object.assign(audience.state, patch);
  audience.rev = 20; audience.state.s = { rev: 20, donations: [gift()] };
  audience.apply({ rev: 19, donations: [] });
  assert.equal(audience.state.s.donations.length, 1);
  assert.equal(audience.rev, 20);
});

test('a failed atomic write leaves the last saved event recoverable', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new EventStore(directory), previous = { donations: [gift()] };
  store.save(previous);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === store.file) throw Object.assign(new Error('Disk unavailable'), { code: 'EIO' });
    return rename(source, target);
  });
  assert.throws(() => store.save({ donations: [gift(), gift('new')] }), /Disk unavailable/);
  assert.deepEqual(store.load(), previous);
});

test('two corrupt backups fail visibly without overwriting either file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-corrupt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new EventStore(directory);
  fs.writeFileSync(store.file, 'corrupt current'); fs.writeFileSync(store.backup, 'corrupt backup');
  assert.throws(() => store.load(), /left untouched/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'corrupt current');
  assert.equal(fs.readFileSync(store.backup, 'utf8'), 'corrupt backup');
});

test('event validation rejects unusable structures and invalid gift amounts', () => {
  for (const state of [null, [], {}, { donations: null }, { donations: [gift('bad', -5)] }, { donations: [gift('bad', Infinity)] },
    { donations: [], categories: 'broken' }, { donations: [], fields: [null] }, { donations: [{ ...gift(), fields: 'broken' }] },
    { donations: [], fields: [{ id: 'x', label: 'Choice', options: 'not an array' }] },
    { donations: [], categories: [{ id: 'x', name: 42 }] }, { donations: [], branding: { currency: 'bad-currency' } }]) {
    assert.throws(() => validateState(state));
  }
});

test('explicit recovery preserves unreadable originals before saving the imported event', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-import-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new EventStore(directory);
  fs.writeFileSync(store.file, 'corrupt original');
  fs.writeFileSync(store.backup, 'corrupt backup');
  store.preserveUnreadable();
  store.save({ donations: [gift()] });
  assert.equal(store.load().donations.length, 1);
  const preserved = fs.readdirSync(directory).filter(name => name.includes('-unreadable-'));
  assert.equal(preserved.length, 2);
  assert.ok(preserved.some(name => fs.readFileSync(path.join(directory, name), 'utf8') === 'corrupt original'));
});

test('recovery prefers a newer pending snapshot but never an older or invalid cache', () => {
  const disk = { rev: 20, donations: [gift()] };
  const pending = { rev: 21, donations: [gift(), gift('pending')] };
  assert.equal(selectRecovery(disk, pending), pending);
  assert.equal(selectRecovery(disk, { rev: 19, donations: [] }), disk);
  assert.equal(selectRecovery(disk, { rev: 30, donations: 'broken' }), disk);
  assert.equal(selectRecovery(null, pending), pending);
});
