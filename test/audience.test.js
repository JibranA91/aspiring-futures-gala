'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../gala/js/audience.js');

test('money matches the controller formatting', () => {
  assert.equal(A.money(0), '$0');
  assert.equal(A.money(2500), '$2,500');
  assert.equal(A.money(999.6), '$1,000');
});

test('liveTotal sums non-voided donations only', () => {
  const s = { donations: [
    { amount: 2500, voided: false },
    { amount: 5000, voided: false },
    { amount: 9999, voided: true }   // excluded from the running total
  ] };
  assert.equal(A.liveTotal(s), 7500);
});

test('liveTotal handles empty or missing donations', () => {
  assert.equal(A.liveTotal({}), 0);
  assert.equal(A.liveTotal({ donations: [] }), 0);
});

test('niceCeil returns a comfortable ceiling above the total', () => {
  assert.ok(A.niceCeil(7500) >= 7500 * 1.12);
  assert.equal(A.niceCeil(7500), 10000);    // next round step up
  assert.equal(A.niceCeil(80000), 100000);
  assert.ok(A.niceCeil(3000000) >= 3000000); // beyond the table, rounds up to the next million
});

test('singularUnit singularizes program units', () => {
  assert.equal(A.singularUnit('children'), 'child');
  assert.equal(A.singularUnit('families'), 'family');
  assert.equal(A.singularUnit('students'), 'student');
});

test('renderVals builds the board bindings without throwing', () => {
  const comp = new A.Component();
  comp.props = { wallLength: null, showQr: true, embedded: false };
  comp.state = Object.assign({}, comp.state, {
    s: {
      goal: 10000, showGoal: true, showTotal: true,
      categories: A.DEFAULTS.categories,
      fields: [{ id: 'status', label: 'Status', type: 'choice', options: ['Paid', 'Pledged'], onScreen: true }],
      donations: [
        { id: 'a', ts: '2026-09-05T00:00:00.000Z', name: 'The Rahman Family', anon: false, amount: 2500, fields: { status: 'Pledged' }, voided: false },
        { id: 'b', ts: '2026-09-05T00:01:00.000Z', name: '', anon: true, amount: 1000, fields: { status: 'Paid' }, voided: true }
      ]
    }
  });
  const rv = comp.renderVals();
  assert.equal(rv.total, 2500);        // the voided gift is excluded
  assert.equal(rv.giftCount, 1);
  assert.equal(rv.goalLabel, '$10,000');
  assert.ok(Array.isArray(rv.cats) && rv.cats.length === 4);
  assert.equal(rv.wall.length, 1);     // only the non-voided donor reaches the wall
  assert.equal(rv.wall[0].name, 'The Rahman Family');
  assert.equal(rv.wall[0].meta, 'Pledged');
});
