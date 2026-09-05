'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const GL = require('../gala/js/gala-link.js');

test('newCode returns a 4-digit numeric string', () => {
  for (let i = 0; i < 100; i++) assert.match(GL.newCode(), /^\d{4}$/);
});

test('parseCode accepts a 4-digit code and derives a stable room', () => {
  const a = GL.parseCode('1234');
  assert.ok(a);
  assert.equal(a.code, '1234');
  assert.equal(a.secret, '1234');
  assert.match(a.room, /^r/);
  assert.equal(GL.parseCode('1234').room, a.room); // deterministic — both ends must agree
});

test('parseCode normalizes digits and rejects the wrong length', () => {
  assert.equal(GL.parseCode('123'), null);   // too short
  assert.equal(GL.parseCode('ab'), null);
  assert.equal(GL.parseCode(''), null);
  assert.equal(GL.parseCode(null), null);
  assert.equal(GL.parseCode('12ab34').code, '1234');  // strips non-digits
  assert.equal(GL.parseCode('123456').code, '1234');  // caps at four
});

test('format strips non-digits and caps at four', () => {
  assert.equal(GL.format('12ab34'), '1234');
  assert.equal(GL.format('999999'), '9999');
  assert.equal(GL.format(''), '');
});

test('cipher round-trips arbitrary JSON, including unicode', () => {
  const key = GL._keyFor('7788');
  const obj = { kind: 'state', body: { name: 'José — Ünïcödé 🎉', amount: 2500, list: [1, 2, 3] }, from: 'controller' };
  const sealed = GL._seal(key, obj);
  assert.equal(typeof sealed, 'string');   // a JSON string is what rides the broker
  assert.doesNotMatch(sealed, /José/);     // donor name is not visible in the ciphertext
  assert.deepEqual(GL._unseal(key, sealed), obj);
});

test('a different code cannot recover the payload', () => {
  const good = GL._keyFor('1111');
  const bad = GL._keyFor('2222');
  const original = { secret: 'donor data', amount: 9999 };
  const sealed = GL._seal(good, original);
  assert.deepEqual(GL._unseal(good, sealed), original); // right code works
  let recovered;
  try { recovered = GL._unseal(bad, sealed); } catch (e) { recovered = 'THREW'; }
  assert.notDeepEqual(recovered, original);             // wrong code never recovers it
});

test('each seal uses a fresh nonce, so identical input yields different ciphertext', () => {
  const key = GL._keyFor('5555');
  const obj = { a: 1 };
  assert.notEqual(GL._seal(key, obj), GL._seal(key, obj));
  assert.deepEqual(GL._unseal(key, GL._seal(key, obj)), obj); // …and both still decrypt
});
