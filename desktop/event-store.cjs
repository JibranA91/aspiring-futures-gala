'use strict';
const fs = require('node:fs');
const path = require('node:path');

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.donations)) {
    throw new Error('This is not a fundraising event file.');
  }
  const ids = new Set();
  for (const key of ['fields', 'retiredFields', 'categories']) {
    if (state[key] !== undefined && (!Array.isArray(state[key]) || state[key].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
      throw new Error('The event has invalid ' + key + '.');
    }
  }
  if (state.branding !== undefined && (!state.branding || typeof state.branding !== 'object' || Array.isArray(state.branding))) throw new Error('The event has invalid branding.');
  if (state.branding?.currency && !['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'PKR', 'INR'].includes(state.branding.currency)) throw new Error('The event has an unsupported currency.');
  if (state.anonymousLabel !== undefined && (typeof state.anonymousLabel !== 'string' || state.anonymousLabel.length > 160)) throw new Error('The anonymous donor wording must be text up to 160 characters.');
  for (const field of [...(state.fields || []), ...(state.retiredFields || [])]) {
    if (typeof field.id !== 'string' || typeof field.label !== 'string' || (field.options !== undefined && (!Array.isArray(field.options) || field.options.some(value => typeof value !== 'string')))) {
      throw new Error('The event has an invalid gift field definition.');
    }
  }
  for (const category of state.categories || []) {
    if (typeof category.id !== 'string' || typeof category.name !== 'string' || (category.unit !== undefined && typeof category.unit !== 'string')) throw new Error('The event has an invalid program.');
  }
  for (const gift of state.donations) {
    if (!gift || typeof gift.id !== 'string' || ids.has(gift.id) || !Number.isFinite(gift.amount) || gift.amount <= 0) {
      throw new Error('The event contains an invalid or duplicate gift.');
    }
    ids.add(gift.id);
    if (gift.name !== undefined && typeof gift.name !== 'string') throw new Error('A gift has an invalid donor name.');
    if (gift.fields !== undefined && (!gift.fields || typeof gift.fields !== 'object' || Array.isArray(gift.fields))) throw new Error('A gift has invalid fields.');
  }
  if (JSON.stringify(state).length > 20 * 1024 * 1024) throw new Error('This event is too large (maximum 20 MB).');
  return state;
}

function selectRecovery(disk, cached) {
  try {
    validateState(cached);
    if (!disk || Number(cached.rev) > (Number(disk.rev) || 0)) return cached;
  } catch {}
  return disk;
}

function atomicWrite(filename, contents) {
  const temp = filename + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, contents, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, filename);
}

class EventStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'event.json');
    this.backup = path.join(directory, 'event.previous.json');
    this.recovered = false;
    fs.mkdirSync(directory, { recursive: true });
  }
  load() {
    if (!fs.existsSync(this.file) && !fs.existsSync(this.backup)) return null;
    try { return validateState(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (error) {
      try {
        const state = validateState(JSON.parse(fs.readFileSync(this.backup, 'utf8')));
        this.recovered = true;
        return state;
      } catch { throw new Error('The saved event could not be read. Your files have been left untouched. Restore an event backup before continuing.'); }
    }
  }
  save(state) {
    validateState(state);
    if (fs.existsSync(this.file)) {
      const old = fs.readFileSync(this.file, 'utf8');
      try { validateState(JSON.parse(old)); atomicWrite(this.backup, old); }
      catch (error) { if (!this.recovered) throw error; }
    }
    atomicWrite(this.file, JSON.stringify(state));
    this.recovered = false;
  }
  archive(state) {
    if (!state) return;
    const name = 'event-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    atomicWrite(path.join(this.directory, name), JSON.stringify(validateState(state)));
  }
  preserveUnreadable() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const file of [this.file, this.backup]) {
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(this.directory, stamp + '-unreadable-' + path.basename(file)));
    }
    this.recovered = true;
  }
}

function publicState(state) {
  if (!state) return null;
  const fields = (state.fields || []).filter(f => f.onScreen).map(({ id, label, type }) => ({ id, label, type, onScreen: true }));
  const allowed = new Set(fields.map(f => f.id));
  const result = {};
  for (const key of ['eventName', 'tagline', 'goal', 'showGoal', 'showTotal', 'pace', 'hold', 'qrCaption', 'anonymousLabel', 'categories', 'stage', 'rev', 'branding']) {
    if (state[key] !== undefined) result[key] = state[key];
  }
  result.fields = fields;
  result.donations = state.donations.filter(d => !d.voided).map(d => ({
    id: d.id, ts: d.ts, amount: d.amount, anon: !!d.anon, name: d.anon ? '' : d.name,
    status: Object.values(d.fields || {}).some(v => /^pledg/i.test(String(v))) ? 'pledged' : 'paid',
    fields: Object.fromEntries(Object.entries(d.fields || {}).filter(([key]) => allowed.has(key)))
  }));
  return result;
}

module.exports = { EventStore, atomicWrite, validateState, publicState, selectRecovery };
