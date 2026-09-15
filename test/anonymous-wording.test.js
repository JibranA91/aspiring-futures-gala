'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Brand = require('../gala/js/branding.js');
const Controller = require('../gala/js/controller.js');
const Audience = require('../gala/js/audience.js');
const { EventStore, publicState, validateState } = require('../desktop/event-store.cjs');

const event = () => ({ ...structuredClone(Controller.DEFAULTS),
  branding: { organization: 'Community Partners' },
  donations: [{ id: 'private-gift', name: 'Private identity', anon: true, amount: 250, ts: '2026-01-01', fields: { collector: 'Private operator' } }],
  stage: { id: 'private-gift', token: 'cue-1' }
});

test('anonymous wording defaults work for existing events, custom organizations and a blank organization', () => {
  assert.equal(Brand.anonymousName(), 'A friend of Aspiring Futures');
  assert.equal(Brand.anonymousName(event()), 'A friend of Community Partners');
  assert.equal(Brand.anonymousName({ branding: { organization: '  ' } }), 'A friend of our community');
  for (const anonymousLabel of ['', '  ', null, 4, {}]) {
    assert.equal(Brand.anonymousName({ ...event(), anonymousLabel }), 'A friend of Community Partners');
  }
});

test('custom wording replaces organization tokens as literal text, without evaluating markup or other placeholders', () => {
  assert.equal(Brand.anonymousName({ ...event(), anonymousLabel: 'A generous friend' }), 'A generous friend');
  assert.equal(Brand.anonymousName({ branding: { organization: '$& Helpers' }, anonymousLabel: '{organization name} / {Organization Name}' }), '$& Helpers / $& Helpers');
  assert.equal(Brand.anonymousName({ ...event(), anonymousLabel: '<b>A friend</b> {donor name}' }), '<b>A friend</b> {donor name}');
  assert.equal(Brand.anonymousName({ anonymousLabel: 'x'.repeat(200) }).length, 160);
});

test('controller and audience use the same wording while the private log and CSV keep the recorded name', () => {
  const state = { ...event(), anonymousLabel: 'Friends of {organization name}' };
  const controller = new Controller.Component(); controller.props = {}; controller.state.s = state;
  const audience = new Audience.Component(); audience.props = {}; audience.state.s = state; audience.state.current = 'private-gift';
  const consoleView = controller.renderVals(), publicView = audience.renderVals();
  assert.equal(consoleView.anonymousPreview, 'Friends of Community Partners');
  assert.equal(consoleView.stageLabel, 'Friends of Community Partners · $250');
  assert.equal(consoleView.log[0].name, 'Private identity');
  assert.match(controller.csvText(state), /Private identity/);
  assert.equal(publicView.annName, 'Friends of Community Partners');
  assert.equal(publicView.wall[0].name, 'Friends of Community Partners');
  state.donations[0].anon = false;
  assert.equal(audience.renderVals().annName, 'Private identity');
});

test('the projector payload carries custom wording but no anonymous donor identity or private fields', () => {
  const state = { ...event(), anonymousLabel: 'A generous friend' };
  const snapshot = publicState(state);
  assert.equal(snapshot.anonymousLabel, 'A generous friend');
  assert.equal(snapshot.donations[0].name, '');
  assert.deepEqual(snapshot.donations[0].fields, {});
  assert.doesNotMatch(JSON.stringify(snapshot), /Private identity|Private operator/);
});

test('custom wording survives file saves and invalid imported wording is rejected', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fundraiser-wording-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = { ...event(), anonymousLabel: 'Friends of {organization name}' };
  new EventStore(directory).save(state);
  assert.equal(new EventStore(directory).load().anonymousLabel, state.anonymousLabel);
  for (const anonymousLabel of [null, {}, [], 5, 'x'.repeat(161)]) {
    assert.throws(() => validateState({ ...state, anonymousLabel }), /anonymous donor wording/);
  }
  assert.equal(validateState({ ...state, anonymousLabel: '' }).anonymousLabel, '');
});
