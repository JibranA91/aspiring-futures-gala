/* controller.js — Gala Fundraising Controller.
 *
 * Ported verbatim from the original prototype's component logic, now
 * running on the local dcx.js runtime instead of the CDN React/streaming
 * runtime. The ONLY change from the prototype source: DISPLAY_FILE points at
 * this app's real audience page ("audience.html") instead of the .dc.html
 * design file. The template lives in <template id="tpl"> in index.html.
 */
const DCLogic = window.DCX.DCLogic;

const KEY = 'af-gala-state-v1';
const CODE_KEY = 'af-gala-link-ctrl-v1';
const POD = ['var(--color-accent-500)', 'var(--color-accent-2-400)', 'var(--color-accent-300)', 'var(--color-accent-2-600)', 'var(--color-neutral-400)', 'var(--color-accent-700)'];
const DISPLAY_FILE = 'audience.html';

const DEFAULTS = {
  eventName: 'An Evening for Aspiring Futures',
  tagline: 'The best way to predict the future is to shape it',
  goal: 100000, showGoal: false, showTotal: true,
  pace: 1, hold: false, autoExport: true,
  qrCaption: 'Scan to give — every gift is matched to a classroom in Pakistan.',
  categories: [
    { id: 'student', name: 'Student living & education', pct: 30, monthly: 65, unit: 'students' },
    { id: 'family', name: 'Family financial assistance', pct: 25, monthly: 120, unit: 'families' },
    { id: 'shelter', name: 'Shelter home living', pct: 25, monthly: 60, unit: 'children' },
    { id: 'books', name: 'Books, supplies & laptops', pct: 20, monthly: 15, unit: 'students' }
  ],
  fields: [
    { id: 'status', label: 'Status', type: 'choice', options: ['Paid', 'Pledged'], onScreen: true, wide: true, sticky: true },
    { id: 'table', label: 'Table / seat', type: 'text', onScreen: true },
    { id: 'collector', label: 'Collector', type: 'text', onScreen: false, sticky: true },
    { id: 'place', label: 'City or country', type: 'text', onScreen: true, wide: true }
  ],
  donations: [], stage: null
};

/* Donations written before fields were configurable keep their values at the top
   level; fold them into .fields once so every reader sees one shape. */
function migrate(s) {
  const legacy = { status: (d) => d.status === 'pledged' ? 'Pledged' : 'Paid', table: (d) => d.table, place: (d) => d.place, collector: (d) => d.collector };
  let touched = false;
  const donations = (s.donations || []).map((d) => {
    if (d.fields) return d;
    touched = true;
    const f = {};
    Object.keys(legacy).forEach((k) => { const v = legacy[k](d); if (v) f[k] = v; });
    return Object.assign({}, d, { fields: f });
  });
  if (!s.fields) { s.fields = DEFAULTS.fields.map((f) => Object.assign({}, f)); touched = true; }
  // Categories now carry a monthly sponsorship cost (they drive the impact
  // figures). State that predates this has none — upgrade it to the defaults.
  if (!s.categories || !s.categories.some((c) => c && Number(c.monthly) > 0)) {
    s.categories = DEFAULTS.categories.map((c) => Object.assign({}, c));
    touched = true;
  }
  return touched ? Object.assign({}, s, { donations }) : s;
}
/* Active fields plus any field that still has recorded values — a field removed
   mid-evening must never drop its already-collected data from the log or CSV. */
function allFieldDefs(s) {
  const out = (s.fields || []).slice();
  const seen = {};
  out.forEach((f) => { seen[f.id] = 1; });
  (s.retiredFields || []).forEach((f) => { if (!seen[f.id]) { out.push(Object.assign({}, f, { retired: true })); seen[f.id] = 1; } });
  (s.donations || []).forEach((d) => Object.keys(d.fields || {}).forEach((k) => {
    if (!seen[k]) { out.push({ id: k, label: k, type: 'text', retired: true }); seen[k] = 1; }
  }));
  return out.filter((f) => !f.retired || (s.donations || []).some((d) => (d.fields || {})[f.id]));
}
function isPledged(d) {
  if (d.status === 'pledged') return true;
  const f = d.fields || {};
  return Object.keys(f).some((k) => /^pledg/i.test(String(f[k] || '')));
}

function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
}

class Component extends DCLogic {
  state = {
    s: null,
    f: { name: '', amount: '', anon: false, vals: { status: 'Paid' } },
    goalDraft: 100000, err: '', savedAt: null, exportedAt: null, live: false, restoreNote: '',
    mode: 'paired', code: '', link: null, copied: 0, settingsOpen: false,
    fsSupported: false, backupName: '', backupReady: false, backupPrompt: false, confirmReset: false
  };
  fileHandle = null;

  componentDidMount() {
    let init = null;
    try { init = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const s = migrate(Object.assign({}, DEFAULTS, init || {}));
    s.stage = null;
    this.setState({ s, goalDraft: s.goal, restoreNote: init && (init.donations || []).length ? 'Restored ' + init.donations.length + ' gifts from this browser\u2019s local backup.' : '' });
    this.persist(s);

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CODE_KEY) || 'null'); } catch (e) {}
    const mode = saved && saved.mode === 'local' ? 'local' : 'paired';
    const gl = window.GalaLink;
    let code = saved && saved.code;
    if (!code || !(gl && gl.parseCode(code))) code = gl ? gl.newCode() : '';
    this.setState({ mode, code });
    this.bootLink(mode, code);

    this.tick = setInterval(() => {
      const live = !!this.lastAlive && Date.now() - this.lastAlive < 5000;
      if (live !== this.state.live) this.setState({ live });
    }, 1000);

    this.onKeyDoc = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.add(true); }
      if (e.key === 'Escape' && this.state.settingsOpen) this.setState({ settingsOpen: false });
    };
    window.addEventListener('keydown', this.onKeyDoc);

    this.setState({ fsSupported: !!window.showSaveFilePicker });
    if (window.showSaveFilePicker) {
      this._loadHandle().then((h) => {
        if (!h) return;
        this.fileHandle = h;
        const done = (ready) => this.setState({ backupName: h.name, backupReady: ready, backupPrompt: !ready });
        if (h.queryPermission) h.queryPermission({ mode: 'readwrite' }).then((p) => done(p === 'granted')).catch(() => done(false));
        else done(true);
      });
    }
  }

  componentWillUnmount() {
    clearInterval(this.tick);
    clearInterval(this.beat);
    if (this.link) this.link.destroy();
    window.removeEventListener('keydown', this.onKeyDoc);
  }

  bootLink(mode, code) {
    const start = () => {
      if (!window.GalaLink) { setTimeout(start, 200); return; }
      if (!this.state.code && code === '') {
        const c = window.GalaLink.newCode();
        this.setState({ code: c });
        code = c;
      }
      if (!this.link) {
        this.link = window.GalaLink.create({
          role: 'controller',
          onMessage: (kind, body) => {
            if (kind === 'hello') { this.broadcast(); this.lastAlive = Date.now(); }
            if (kind === 'presence' && body && body.role === 'display') this.lastAlive = Date.now();
          },
          onStatus: (st) => this.setState({ link: st })
        });
      }
      this.link.setMode(mode, code).then(() => {
        this.broadcast();
        this.link.send('presence', { role: 'controller', t: Date.now() });
      });
      clearInterval(this.beat);
      this.beat = setInterval(() => {
        if (!this.link) return;
        this.link.send('presence', { role: 'controller', t: Date.now() });
      }, 4000);
      try { localStorage.setItem(CODE_KEY, JSON.stringify({ mode, code })); } catch (e) {}
    };
    start();
  }

  persist(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); this.setState({ savedAt: Date.now() }); } catch (e) {}
  }
  broadcast(s) {
    const st = s || this.state.s;
    if (!st || !this.link) return;
    this.link.send('state', st);
  }
  commit(patch) {
    const s = Object.assign({}, this.state.s || DEFAULTS, patch, { rev: Date.now() });
    this.setState({ s });
    this.persist(s);
    this.broadcast(s);
    return s;
  }

  setF(k, v) { this.setState({ f: Object.assign({}, this.state.f, { [k]: v }), err: '' }); }
  setV(id, v) {
    const vals = Object.assign({}, this.state.f.vals, { [id]: v });
    this.setState({ f: Object.assign({}, this.state.f, { vals }), err: '' });
  }

  add(show) {
    const f = this.state.f;
    const amount = Number(f.amount);
    if (!(amount > 0)) { this.setState({ err: 'Enter an amount greater than zero.' }); return; }
    if (!f.anon && !f.name.trim()) { this.setState({ err: 'Add a donor name, or mark the gift anonymous.' }); return; }
    const defs = this.state.s.fields || [];
    const vals = {};
    defs.forEach((fd) => {
      const raw = f.vals[fd.id];
      const v = typeof raw === 'string' ? raw.trim() : raw;
      if (v !== '' && v != null) vals[fd.id] = v;
    });
    const d = { id: uid(), ts: new Date().toISOString(), name: f.anon ? '' : f.name.trim(), anon: !!f.anon, amount, fields: vals, voided: false };
    const s = this.commit({
      donations: (this.state.s.donations || []).concat([d]),
      stage: show ? { token: Date.now(), id: d.id } : this.state.s.stage
    });
    const keep = {};
    defs.forEach((fd) => {
      if (fd.type === 'choice' || fd.sticky) { const v = f.vals[fd.id]; if (v != null && v !== '') keep[fd.id] = v; }
    });
    this.setState({ f: { name: '', amount: '', anon: false, vals: keep }, err: '' });
    this.writeBackup();
  }

  showOne(id) { this.commit({ stage: { token: Date.now(), id } }); }

  // Fire a celebratory burst on the audience screen (and the live preview). It's
  // a transient cue, not board state, so it rides the link as its own message
  // rather than through the persisted, retained state.
  fire(type) { if (this.link) this.link.send('celebrate', { type }); }

  // The CSV is a plain ledger of the gift entries exactly as typed in "New gift"
  // — donor, amount, and the configured gift fields. No category-allocation
  // columns and no TOTAL summary row.
  csvText(s) {
    const defs = allFieldDefs(s);
    const head = ['Ref', 'Timestamp', 'Donor', 'Anonymous', 'Amount USD']
      .concat(defs.map((f) => f.label + (f.retired ? ' (removed)' : '')))
      .concat(['Voided']);
    const rows = (s.donations || []).map((d, i) => [
      i + 1, d.ts, d.anon ? 'Anonymous' : d.name, d.anon ? 'yes' : 'no', Number(d.amount) || 0
    ].concat(defs.map((f) => (d.fields || {})[f.id] == null ? '' : (d.fields || {})[f.id]))
      .concat([d.voided ? 'yes' : 'no']));
    return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\n');
  }

  exportCsv = (silent) => {
    const s = this.state.s;
    if (!s) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = 'aspiring-futures-gala-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.csv';
    try {
      const blob = new Blob(['\ufeff' + this.csvText(s)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.setState({ exportedAt: Date.now() });
    } catch (e) {
      if (!silent) this.setState({ restoreNote: 'Export failed — copy the log manually.' });
    }
  };

  // ── Background backup to a single file (File System Access API) ──────────
  // The operator picks a CSV file once; after that every gift silently rewrites
  // it — no download, no per-gift dialog. localStorage already saves every gift,
  // and the manual Export button is the fallback where this API is unavailable.
  _idb() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('af-gala-backup', 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = () => { try { r.result.createObjectStore('handles'); } catch (e) {} };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  _saveHandle(h) {
    return this._idb().then((db) => new Promise((res) => {
      try { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(h, 'backup'); tx.oncomplete = () => res(); tx.onerror = () => res(); }
      catch (e) { res(); }
    })).catch(() => {});
  }
  _loadHandle() {
    return this._idb().then((db) => new Promise((res) => {
      try { const g = db.transaction('handles').objectStore('handles').get('backup'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }
      catch (e) { res(null); }
    })).catch(() => null);
  }
  _clearHandle() {
    return this._idb().then((db) => new Promise((res) => {
      try { const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').delete('backup'); tx.oncomplete = () => res(); tx.onerror = () => res(); }
      catch (e) { res(); }
    })).catch(() => {});
  }

  pickBackupFile = async () => {
    if (!window.showSaveFilePicker) return;
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: 'aspiring-futures-gala.csv',
        types: [{ description: 'CSV spreadsheet', accept: { 'text/csv': ['.csv'] } }]
      });
      this.fileHandle = h;
      await this._saveHandle(h);
      this.setState({ backupName: h.name, backupReady: true, backupPrompt: false });
      await this.writeBackup(true);
      this.setState({ restoreNote: 'Backing up to ' + h.name + ' — every gift now saves here automatically.' });
    } catch (e) { /* the operator dismissed the picker */ }
  };

  writeBackup = async (loud) => {
    const h = this.fileHandle, s = this.state.s;
    if (!h || !s) return;
    try {
      if (h.queryPermission) {
        const p = await h.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted') { this.setState({ backupReady: false, backupPrompt: true }); return; }
      }
      const w = await h.createWritable();
      await w.write(new Blob(['﻿' + this.csvText(s)], { type: 'text/csv;charset=utf-8' }));
      await w.close();
      this.setState({ exportedAt: Date.now(), backupReady: true, backupPrompt: false });
    } catch (e) {
      this.setState({ backupReady: false, backupPrompt: true });
      if (loud) this.setState({ restoreNote: 'Could not write the backup file — reconnect it, or use Export CSV.' });
    }
  };

  reconnectBackup = async () => {
    const h = this.fileHandle;
    if (!h) { this.pickBackupFile(); return; }
    try {
      const p = h.requestPermission ? await h.requestPermission({ mode: 'readwrite' }) : 'granted';
      if (p === 'granted') { this.setState({ backupReady: true, backupPrompt: false }); await this.writeBackup(true); this.setState({ restoreNote: 'Reconnected — saving to ' + h.name + '.' }); }
      else this.setState({ restoreNote: 'Permission was denied — pick a file again to back up.' });
    } catch (e) {}
  };

  disconnectBackup = () => {
    this.fileHandle = null;
    this._clearHandle();
    this.setState({ backupName: '', backupReady: false, backupPrompt: false, restoreNote: 'Stopped writing the backup file. Every gift is still saved in this browser.' });
  };

  // ── Reset to a fresh event ───────────────────────────────────────────────
  askReset = () => this.setState({ confirmReset: true });
  cancelReset = () => this.setState({ confirmReset: false });
  doReset = () => {
    this.setState({ confirmReset: false, f: { name: '', amount: '', anon: false, vals: { status: 'Paid' } }, err: '', exportedAt: null, restoreNote: 'New event started — the board is clear.' });
    this.commit({ donations: [], stage: null, retiredFields: [] });
    if (this.fileHandle) {
      this.fileHandle = null;
      this._clearHandle();
      this.setState({ backupName: '', backupReady: false, backupPrompt: false });
      this.pickBackupFile(); // begin a fresh CSV file (within this click gesture)
    }
  };

  onRestore = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = parseCsv(String(r.result || '').replace(/^\ufeff/, ''));
      if (rows.length < 2) { this.setState({ restoreNote: 'That file had no rows I could read.' }); return; }
      const head = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
      const defs = (this.state.s && this.state.s.fields) || [];
      const colOf = (label) => head.indexOf(String(label).trim().toLowerCase());
      const voidCol = colOf('voided');
      const donations = [];
      for (let i = 1; i < rows.length; i++) {
        const r0 = rows[i];
        if (!r0 || !r0[1] || String(r0[0]).toUpperCase() === 'TOTAL') continue;
        const amount = Number(String(r0[4] || '').replace(/[^0-9.\-]/g, ''));
        if (!(amount > 0)) continue;
        const fields = {};
        defs.forEach((f) => {
          const c = colOf(f.label);
          if (c > -1 && r0[c] != null && String(r0[c]).trim() !== '') fields[f.id] = String(r0[c]).trim();
        });
        donations.push({
          id: uid(), ts: r0[1], anon: /^yes$/i.test(r0[3] || ''),
          name: /^yes$/i.test(r0[3] || '') ? '' : (r0[2] || ''), amount, fields,
          voided: voidCol > -1 ? /^yes$/i.test(r0[voidCol] || '') : false
        });
      }
      this.commit({ donations, stage: null });
      this.setState({ restoreNote: 'Restored ' + donations.length + ' gifts from ' + file.name + '.' });
    };
    r.readAsText(file);
    e.target.value = '';
  };

  openDisplay = () => {
    const base = location.href.split('/').slice(0, -1).join('/');
    const w = window.open(base + '/' + encodeURIComponent(DISPLAY_FILE) + '#local=1', 'af-gala-display');
    if (w) setTimeout(() => this.broadcast(), 1200);
    else this.setState({ restoreNote: 'The pop-up was blocked — allow pop-ups, or open "' + DISPLAY_FILE + '" in a second window yourself.' });
  };

  renderVals() {
    const s = Object.assign({}, DEFAULTS, this.state.s || {});
    const f = this.state.f;
    const all = s.donations || [];
    const live = all.filter((d) => !d.voided);
    const total = live.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const paid = live.filter((d) => !isPledged(d)).reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const defs = s.fields || [];
    const allDefs = allFieldDefs(s);
    const cats = (s.categories || []);
    const sum = cats.reduce((a, c) => a + (Number(c.pct) || 0), 0);
    const last = all.length ? all[all.length - 1] : null;
    const staged = s.stage ? all.find((d) => d.id === s.stage.id) : null;
    const on = 'var(--color-accent-2-600)';
    const off = 'transparent';
    const ex = this.state.exportedAt;

    const lk = this.state.link || {};
    const paired = this.state.mode === 'paired';
    const bstate = lk.broker || 'off';

    return {
      settingsOpen: this.state.settingsOpen,
      openSettings: () => this.setState({ settingsOpen: true }),
      closeSettings: () => this.setState({ settingsOpen: false }),
      stopClick: (e) => e.stopPropagation(),
      isPaired: paired, isLocal: !paired,
      pairedBg: paired ? on : off, localBg: paired ? off : on,
      code: this.state.code || '—',
      setPaired: () => { this.setState({ mode: 'paired' }); this.bootLink('paired', this.state.code); },
      setLocal: () => { this.setState({ mode: 'local' }); this.bootLink('local', ''); },
      newCode: () => {
        const c = window.GalaLink ? window.GalaLink.newCode() : '';
        this.setState({ code: c });
        this.bootLink('paired', c);
      },
      copyLabel: Date.now() - this.state.copied < 2500 ? 'Link copied' : 'Copy audience link',
      copyLink: () => {
        const base = location.href.split('/').slice(0, -1).join('/');
        const url = base + '/' + encodeURIComponent(DISPLAY_FILE) + '#code=' + this.state.code;
        try {
          navigator.clipboard.writeText(url);
          this.setState({ copied: Date.now(), restoreNote: 'Audience link copied — open it on the projector laptop.' });
        } catch (e) {
          this.setState({ restoreNote: url });
        }
      },
      brokerColor: bstate === 'connected' ? 'var(--color-accent-2-400)' : bstate === 'connecting' ? 'var(--color-accent-400)' : 'var(--color-neutral-600)',
      brokerLabel: bstate === 'connected'
        ? 'Relay connected via ' + (lk.brokerName || 'relay')
        : bstate === 'connecting' ? 'Connecting to the relay…' : 'Relay off',
      showPreview: this.props.showPreview !== false,
      logHeight: (Math.max(2, Number(this.props.logRows) || 9) * 66) + 'px',
      statusColor: this.state.live ? 'var(--color-accent-2-400)' : 'var(--color-neutral-600)',
      statusLabel: this.state.live
        ? 'Audience screen live'
        : !paired ? 'Audience window not open'
        : bstate === 'connected' ? 'Relay up · waiting for the projector laptop'
        : bstate === 'connecting' ? 'Connecting to the relay…'
        : 'Relay offline',
      savedLabel: this.state.savedAt ? 'saved locally ' + new Date(this.state.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'saving locally',
      openDisplay: this.openDisplay,
      clearScreen: () => this.commit({ stage: null }),
      exportCsv: () => this.exportCsv(false),

      fireConfetti: () => this.fire('confetti'),
      fireBalloons: () => this.fire('balloons'),
      fireFireworks: () => this.fire('fireworks'),
      fireBig: () => this.fire('all'),

      fName: f.name, fAmount: f.amount, fAnon: f.anon,
      onName: (e) => this.setF('name', e.target.value),
      onAmount: (e) => this.setF('amount', e.target.value),
      onKey: (e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.add(true); } },
      setNamed: () => this.setF('anon', false),
      setAnon: () => this.setF('anon', true),
      namedBg: f.anon ? off : on, anonBg: f.anon ? on : off,

      formFields: defs.map((fd) => ({
        label: fd.label,
        basis: fd.wide || fd.type === 'choice' ? '100%' : 'calc(50% - 7px)',
        isChoice: fd.type === 'choice',
        isPlain: fd.type !== 'choice',
        inputType: fd.type === 'number' ? 'number' : 'text',
        value: f.vals[fd.id] == null ? '' : f.vals[fd.id],
        onInput: (e) => this.setV(fd.id, e.target.value),
        opts: (fd.options || []).map((o) => ({
          label: o, bg: String(f.vals[fd.id] || '') === o ? on : off,
          pick: () => this.setV(fd.id, o)
        }))
      })),

      fieldRows: defs.map((fd, i) => ({
        label: fd.label,
        typeLabel: fd.type === 'choice' ? 'Choices' : fd.type === 'number' ? 'Number' : 'Text',
        isChoice: fd.type === 'choice',
        optionsText: (fd.options || []).join(', '),
        onLabel: (e) => this.commit({ fields: defs.map((x, j) => j === i ? Object.assign({}, x, { label: e.target.value }) : x) }),
        cycleType: () => {
          const order = ['text', 'number', 'choice'];
          const next = order[(order.indexOf(fd.type || 'text') + 1) % order.length];
          const patch = { type: next };
          if (next === 'choice' && !(fd.options || []).length) patch.options = ['Yes', 'No'];
          this.commit({ fields: defs.map((x, j) => j === i ? Object.assign({}, x, patch) : x) });
        },
        onOptions: (e) => this.commit({
          fields: defs.map((x, j) => j === i ? Object.assign({}, x, { options: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }) : x)
        }),
        onScreenBg: fd.onScreen ? on : off,
        onScreenLabel: fd.onScreen ? 'On screen' : 'Console only',
        toggleScreen: () => this.commit({ fields: defs.map((x, j) => j === i ? Object.assign({}, x, { onScreen: !x.onScreen }) : x) }),
        wideBg: fd.wide ? on : off,
        toggleWide: () => this.commit({ fields: defs.map((x, j) => j === i ? Object.assign({}, x, { wide: !x.wide }) : x) }),
        remove: () => this.commit({
          fields: defs.filter((x, j) => j !== i),
          retiredFields: (s.retiredFields || []).filter((x) => x.id !== fd.id).concat([fd])
        })
      })),
      addField: () => this.commit({
        fields: defs.concat([{ id: 'f' + uid(), label: 'New field', type: 'text', onScreen: false }])
      }),
      onScreenCount: defs.filter((fd) => fd.onScreen).length,
      screenNote: defs.filter((fd) => fd.onScreen).length > 3
        ? 'The audience screen shows the first three on-screen fields — the rest stay in the console and the CSV.'
        : 'Marked fields appear beside the donor name on the audience screen. Three is the comfortable maximum.',
      quick: [100, 250, 500, 1000, 2500, 5000, 10000, 25000].map((v) => ({
        label: v >= 1000 ? '$' + (v / 1000) + 'k' : '$' + v,
        set: () => this.setF('amount', String(v))
      })),
      formError: this.state.err,
      addAndShow: () => this.add(true),
      addQuiet: () => this.add(false),

      stageLabel: staged ? (staged.anon ? 'A friend of Aspiring Futures' : staged.name) + ' · ' + money(staged.amount) : 'Ambient board — totals, categories and the rising bar.',
      fieldsSummary: defs.length ? defs.map((fd) => fd.label).join(' · ') : 'Name and amount only.',
      replay: () => { if (last) this.showOne(last.id); },
      noLast: !last,
      toggleHold: () => this.commit({ hold: !s.hold }),
      holdBg: s.hold ? on : off,
      holdLabel: s.hold ? 'Holding on screen — tap to release' : 'Hold gift on screen',

      totalLabel: money(total), giftCount: live.length,
      paidLabel: money(paid), pledgedLabel: money(total - paid),
      goalPctLabel: Number(s.goal) > 0 ? Math.round(total / Number(s.goal) * 100) + '%' : '—',

      log: all.slice().reverse().map((d) => ({
        name: d.anon ? 'Anonymous' : (d.name || 'Anonymous'),
        amountLabel: money(d.amount),
        opacity: d.voided ? 0.4 : 1,
        meta: [new Date(d.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })]
          .concat(allDefs.map((fd) => {
            const v = (d.fields || {})[fd.id];
            return v ? (fd.type === 'choice' ? String(v) : fd.label + ' ' + v) : null;
          }))
          .concat([d.voided ? 'VOIDED' : null])
          .filter(Boolean).join(' · '),
        show: () => this.showOne(d.id),
        voidLabel: d.voided ? 'Restore' : 'Void',
        toggleVoid: () => this.commit({
          donations: all.map((x) => x.id === d.id ? Object.assign({}, x, { voided: !x.voided }) : x)
        })
      })),
      logEmpty: all.length === 0,

      goalDraft: this.state.goalDraft,
      onGoalDraft: (e) => this.setState({ goalDraft: e.target.value }),
      applyGoal: () => {
        const g = Number(this.state.goalDraft);
        if (g > 0) this.commit({ goal: g, showGoal: true });
      },
      toggleGoal: () => this.commit({ showGoal: !s.showGoal }),
      goalOnBg: s.showGoal ? on : off,
      goalOnLabel: s.showGoal ? 'Goal is on screen' : 'Reveal the goal on screen',
      toggleTotal: () => this.commit({ showTotal: !s.showTotal }),
      totalOnBg: s.showTotal ? on : off,
      totalOnLabel: s.showTotal ? 'Running total is on screen' : 'Reveal the running total',

      catRows: cats.map((c, i) => ({
        name: c.name, pct: c.pct, monthly: c.monthly, color: POD[i % POD.length],
        onName: (e) => this.commit({ categories: cats.map((x, j) => j === i ? Object.assign({}, x, { name: e.target.value }) : x) }),
        onPct: (e) => this.commit({ categories: cats.map((x, j) => j === i ? Object.assign({}, x, { pct: Number(e.target.value) || 0 }) : x) }),
        onMonthly: (e) => this.commit({ categories: cats.map((x, j) => j === i ? Object.assign({}, x, { monthly: Number(e.target.value) || 0 }) : x) }),
        remove: () => this.commit({ categories: cats.filter((x, j) => j !== i) })
      })),
      sumLabel: Math.round(sum) + '% allocated',
      sumColor: Math.abs(sum - 100) < 0.5 ? 'var(--color-accent-2-300)' : 'var(--color-accent-300)',
      addCat: () => this.commit({ categories: cats.concat([{ id: uid(), name: 'New program', pct: 10, monthly: 50, unit: 'children' }]) }),
      normalize: () => {
        const t = sum || 1;
        this.commit({ categories: cats.map((c) => Object.assign({}, c, { pct: Math.round((Number(c.pct) || 0) / t * 1000) / 10 })) });
      },

      eventName: s.eventName, tagline: s.tagline, qrCaption: s.qrCaption,
      onEventName: (e) => this.commit({ eventName: e.target.value }),
      onTagline: (e) => this.commit({ tagline: e.target.value }),
      onQrCaption: (e) => this.commit({ qrCaption: e.target.value }),
      paces: [['Brisk', 0.7], ['Standard', 1], ['Slow', 1.35]].map(([label, v]) => ({
        label, bg: Math.abs(Number(s.pace) - v) < 0.01 ? on : off,
        set: () => this.commit({ pace: v })
      })),

      fsSupported: this.state.fsSupported,
      hasBackup: !!(this.state.backupReady || this.state.backupPrompt),
      showBackupBtn: !!this.state.fsSupported,
      backupStatus: this.state.backupReady
        ? ('Auto-saving to ' + (this.state.backupName || 'a file'))
        : this.state.backupPrompt
          ? ('Backup paused — reconnect ' + (this.state.backupName || 'the file'))
          : !this.state.fsSupported
            ? 'This browser can’t write a live file — use Export CSV'
            : 'Not saving to a file yet',
      backupStatusColor: this.state.backupReady ? 'var(--color-accent-2-300)' : (this.state.backupPrompt ? 'var(--color-accent-300)' : 'var(--color-neutral-400)'),
      backupBtnLabel: this.state.backupPrompt ? ('Reconnect ' + (this.state.backupName || 'file')) : this.state.backupReady ? 'Change file' : 'Back up to a file…',
      backupAction: () => { if (this.state.backupPrompt) this.reconnectBackup(); else this.pickBackupFile(); },
      stopBackup: this.disconnectBackup,
      backupLine: !this.state.fsSupported
        ? 'Live file backup needs Chrome or Edge. Every gift is still saved in this browser — use Export CSV for a copy.'
        : ex
          ? ('Last saved ' + new Date(ex).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + '. One CSV file is rewritten silently after every gift; each gift is also kept in this browser.')
          : 'Pick one CSV file and every gift rewrites it silently in the background. Every gift is also kept in this browser.',
      confirmReset: this.state.confirmReset,
      giftCountAll: (s.donations || []).length,
      askReset: this.askReset,
      cancelReset: this.cancelReset,
      doReset: this.doReset,
      onRestore: this.onRestore,
      restoreNote: this.state.restoreNote
    };
  }
}

DCX.boot({
  container: document.getElementById('dc-root'),
  template: document.getElementById('tpl').content,
  Logic: Component,
  props: { showPreview: true, logRows: 9 }
});
