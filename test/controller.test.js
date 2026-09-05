'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../gala/js/controller.js');

test('money formats with a $, thousands separators and rounding', () => {
  assert.equal(C.money(0), '$0');
  assert.equal(C.money(1234.5), '$1,235');
  assert.equal(C.money(1000000), '$1,000,000');
  assert.equal(C.money('2500'), '$2,500');
  assert.equal(C.money(NaN), '$0');
  assert.equal(C.money(null), '$0');
});

test('csvCell quotes only when needed and escapes embedded quotes', () => {
  assert.equal(C.csvCell('plain'), 'plain');
  assert.equal(C.csvCell('a,b'), '"a,b"');
  assert.equal(C.csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(C.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(C.csvCell(null), '');
  assert.equal(C.csvCell(0), '0');
});

test('parseCsv handles quoted fields, commas, escaped quotes and CRLF', () => {
  const text = 'a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,plain,';
  const rows = C.parseCsv(text);
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['1', 'x,y', 'he said "hi"']);
  assert.deepEqual(rows[2], ['2', 'plain', '']);
});

test('parseCsv round-trips values quoted by csvCell', () => {
  const original = ['The Smith, Jones "Family"', '2500', 'a\nb'];
  const line = original.map(C.csvCell).join(',');
  assert.deepEqual(C.parseCsv(line)[0], original);
});

test('isPledged detects the pledged status field or a legacy flag', () => {
  assert.equal(C.isPledged({ fields: { status: 'Pledged' } }), true);
  assert.equal(C.isPledged({ fields: { status: 'Paid' } }), false);
  assert.equal(C.isPledged({ status: 'pledged' }), true);                  // legacy top-level
  assert.equal(C.isPledged({ fields: {} }), false);
  assert.equal(C.isPledged({ fields: { note: 'pledged in full' } }), true); // any "pledg…" value
});

test('migrate folds legacy top-level fields into .fields', () => {
  const out = C.migrate({ donations: [{ id: 'x', amount: 100, status: 'pledged', table: '5', place: 'Lahore', collector: 'Sam' }] });
  assert.deepEqual(out.donations[0].fields, { status: 'Pledged', table: '5', place: 'Lahore', collector: 'Sam' });
});

test('migrate supplies default fields and priced categories when missing', () => {
  const out = C.migrate({ donations: [] });
  assert.ok(Array.isArray(out.fields) && out.fields.length > 0);
  assert.ok(out.categories.some((c) => Number(c.monthly) > 0));
});

test('migrate is a no-op (same reference) for already-current state', () => {
  const s = {
    donations: [{ id: 'x', amount: 100, fields: { status: 'Paid' } }],
    fields: C.DEFAULTS.fields,
    categories: C.DEFAULTS.categories
  };
  assert.equal(C.migrate(s), s);
});

test('allFieldDefs keeps retired fields that still hold recorded values', () => {
  const s = {
    fields: [{ id: 'status', label: 'Status', type: 'choice', options: ['Paid', 'Pledged'] }],
    retiredFields: [{ id: 'oldnote', label: 'Old note', type: 'text' }],
    donations: [{ id: 'd1', amount: 100, fields: { status: 'Paid', oldnote: 'keep me' } }]
  };
  const ids = C.allFieldDefs(s).map((f) => f.id);
  assert.ok(ids.includes('status'));
  assert.ok(ids.includes('oldnote'));  // retired but a gift still carries its value
});

test('allFieldDefs drops retired fields with no recorded values', () => {
  const s = {
    fields: [{ id: 'status', label: 'Status', type: 'choice' }],
    retiredFields: [{ id: 'unused', label: 'Unused', type: 'text' }],
    donations: [{ id: 'd1', amount: 100, fields: { status: 'Paid' } }]
  };
  assert.ok(!C.allFieldDefs(s).map((f) => f.id).includes('unused'));
});

test('csvText writes one ledger row per gift, with quoting and the voided flag', () => {
  const comp = new C.Component();
  const s = {
    fields: [{ id: 'status', label: 'Status', type: 'choice' }],
    donations: [
      { id: 'a', ts: '2026-09-05T00:00:00.000Z', name: 'The Smith, Family', anon: false, amount: 2500, fields: { status: 'Paid' }, voided: false },
      { id: 'b', ts: '2026-09-05T00:01:00.000Z', name: '', anon: true, amount: 1000, fields: { status: 'Pledged' }, voided: true }
    ]
  };
  const rows = C.parseCsv(comp.csvText(s));
  assert.deepEqual(rows[0], ['Ref', 'Timestamp', 'Donor', 'Anonymous', 'Amount USD', 'Status', 'Voided']);
  assert.equal(rows[1][2], 'The Smith, Family');  // comma-containing name survives the round-trip
  assert.equal(rows[1][4], '2500');
  assert.equal(rows[1][5], 'Paid');
  assert.equal(rows[1][6], 'no');
  assert.equal(rows[2][2], 'Anonymous');
  assert.equal(rows[2][3], 'yes');                // anonymous
  assert.equal(rows[2][6], 'yes');                // voided
});
