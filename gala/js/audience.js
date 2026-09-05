/* audience.js — Gala Audience Screen (the projector view).
 *
 * Ported verbatim from the original prototype's component logic, now
 * running on the local dcx.js runtime. Props the prototype received from its
 * host (embedded / showQr / wallLength) are read here from the URL instead:
 *   #embed=1   → embedded preview mode (used by the controller's <iframe>)
 *   #qr=0      → hide the give-from-your-seat QR panel
 *   #wall=N    → number of donor rows on the wall
 * (#local=1 and #code=XXXXX-XXXXX are read inside the component, unchanged.)
 * The template lives in <template id="tpl"> in audience.html.
 */
const DCLogic = window.DCX.DCLogic;

const KEY = 'af-gala-state-v1';
const CODE_KEY = 'af-gala-link-v1';
const POD = ['var(--color-accent-500)', 'var(--color-accent-2-400)', 'var(--color-accent-300)', 'var(--color-accent-2-600)', 'var(--color-neutral-400)', 'var(--color-accent-700)'];
const STAGE_COL = ['var(--color-accent-500)', 'var(--color-accent-2-400)', 'var(--color-accent-300)', 'var(--color-accent-2-500)', 'var(--color-neutral-300)', 'var(--color-accent-600)'];

const DEFAULTS = {
  eventName: 'An Evening for Aspiring Futures',
  tagline: 'The best way to predict the future is to shape it',
  goal: 100000, showGoal: false, showTotal: true,
  pace: 1, hold: false,
  qrCaption: 'Scan to give — every gift is matched to a classroom in Pakistan.',
  categories: [
    { id: 'student', name: 'Student living & education', pct: 30, monthly: 65, unit: 'students' },
    { id: 'family', name: 'Family financial assistance', pct: 25, monthly: 120, unit: 'families' },
    { id: 'shelter', name: 'Shelter home living', pct: 25, monthly: 60, unit: 'children' },
    { id: 'books', name: 'Books, supplies & laptops', pct: 20, monthly: 15, unit: 'students' }
  ],
  donations: [], stage: null
};

function money(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function liveTotal(s) {
  return (s.donations || []).reduce((a, d) => d.voided ? a : a + (Number(d.amount) || 0), 0);
}
function niceCeil(t) {
  const steps = [5000, 10000, 25000, 50000, 100000, 150000, 250000, 500000, 1000000, 2500000];
  for (const s of steps) if (s >= t * 1.12) return s;
  return Math.ceil(t / 1000000) * 1000000;
}

function singularUnit(u) {
  return u === 'children' ? 'child' : u === 'families' ? 'family' : String(u || 'children').replace(/s$/, '');
}

class Component extends DCLogic {
  state = {
    s: null, current: null, annLeaving: false, annCat: null, ambientIdx: 0,
    sparkOn: false, goalTok: 0, banner: null, scale: 1,
    mode: null, code: '', codeDraft: '', pairError: '', link: null, ctrlSeen: 0, now: Date.now()
  };
  timers = [];
  queue = [];
  rev = 0;

  componentDidMount() {
    let init = null;
    try { init = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { init = null; }
    if (init) { this.setState({ s: init }); this.rev = Number(init.rev) || 0; }

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CODE_KEY) || 'null'); } catch (e) {}
    const urlCode = (function () {
      const m = (location.hash + '&' + location.search).match(/code=(\d{4})/);
      return m ? m[1] : '';
    })();
    const forceLocal = /local=1/.test(location.hash + location.search);
    let code = urlCode || (saved && saved.code) || '';
    if (code && !(window.GalaLink && window.GalaLink.parseCode(code))) code = '';
    const mode = (this.props.embedded || forceLocal) ? 'local'
      : (code ? 'paired' : (saved && saved.mode === 'local' ? 'local' : null));
    this.setState({ mode, code, codeDraft: code });

    this.bootLink(mode, code);

    this.onStore = (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try { this.apply(JSON.parse(e.newValue)); } catch (err) {}
    };
    window.addEventListener('storage', this.onStore);
    this.clock = setInterval(() => this.setState({ now: Date.now() }), 2000);

    this.measure();
    if (window.ResizeObserver && this.root) {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(this.root);
    }
    window.addEventListener('resize', this.measure);
    // Cycle the board's impact figure through the programs.
    this.ambientCycle = setInterval(() => this.setState({ ambientIdx: (this.state.ambientIdx || 0) + 1 }), 4500);
    this.syncCounters();
  }

  componentWillUnmount() {
    this.timers.forEach(clearTimeout);
    clearTimeout(this._hold);
    clearTimeout(this._out);
    clearInterval(this.alive);
    clearInterval(this.clock);
    clearInterval(this.ambientCycle);
    if (this.ro) this.ro.disconnect();
    if (this.link) this.link.destroy();
    window.removeEventListener('storage', this.onStore);
    window.removeEventListener('resize', this.measure);
  }

  bootLink(mode, code) {
    if (!mode) return;
    const start = () => {
      if (!window.GalaLink) { setTimeout(start, 200); return; }
      if (!this.link) {
        this.link = window.GalaLink.create({
          role: 'display',
          onMessage: (kind, body) => {
            if (kind === 'state') this.apply(body);
            if (kind === 'presence' && body && body.role === 'controller') this.setState({ ctrlSeen: Date.now() });
          },
          onStatus: (st) => this.setState({ link: st })
        });
      }
      this.link.setMode(mode, code);
      this.link.send('hello', { role: 'display' });
      clearInterval(this.alive);
      if (!this.props.embedded) {
        this.alive = setInterval(() => this.link.send('presence', { role: 'display', t: Date.now() }), 2000);
      }
    };
    start();
  }

  connectCode = () => {
    const p = window.GalaLink && window.GalaLink.parseCode(this.state.codeDraft);
    if (!p) { this.setState({ pairError: 'The code is four digits, like 1234.' }); return; }
    try { localStorage.setItem(CODE_KEY, JSON.stringify({ mode: 'paired', code: p.code })); } catch (e) {}
    this.setState({ mode: 'paired', code: p.code, codeDraft: p.code, pairError: '' });
    this.bootLink('paired', p.code);
  };

  useLocal = () => {
    try { localStorage.setItem(CODE_KEY, JSON.stringify({ mode: 'local', code: '' })); } catch (e) {}
    this.setState({ mode: 'local', code: '', pairError: '' });
    this.bootLink('local', '');
  };

  componentDidUpdate() { this.syncCounters(); }

  measure = () => {
    const el = this.root;
    if (!el) return;
    const w = el.clientWidth || 1920, h = el.clientHeight || 1080;
    const scale = Math.min(w / 1920, h / 1080);
    if (Math.abs(scale - this.state.scale) > 0.002) this.setState({ scale });
  };

  setRoot = (el) => { if (el) { this.root = el; requestAnimationFrame(this.measure); } };
  setFrame = (el) => { this.frame = el; };

  apply(next) {
    if (!next) return;
    const nrev = Number(next.rev) || 0;
    if (nrev && nrev < this.rev) return;
    this.rev = nrev;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    const prev = this.state.s;
    const pt = prev ? liveTotal(prev) : 0;
    const nt = liveTotal(next);
    this.setState({ s: next });

    if (nt > pt) this.spark();
    if (prev && Number(next.goal) !== Number(prev.goal)) {
      this.setState({ goalTok: Date.now() });
      if (next.showGoal) this.flash('A new goal: ' + money(next.goal));
    }
    if (prev && next.showGoal && !prev.showGoal) this.flash('Our goal tonight: ' + money(next.goal));
    if (next.showGoal && Number(next.goal) > 0 && nt > pt) {
      const g = Number(next.goal);
      const marks = [[0.25, 'A quarter of the way there'], [0.5, 'Halfway to the goal'], [0.75, 'Three quarters of the way'], [1, 'We reached the goal!']];
      for (const [k, label] of marks) if (pt / g < k && nt / g >= k) this.flash(label);
    }

    const ps = prev && prev.stage ? prev.stage.token : null;
    if (next.stage && next.stage.token !== ps) this.enqueue(next.stage.id);
    if (!next.stage && ps) this.clearStage();
    if (prev && !!prev.hold !== !!next.hold && this.state.current) {
      if (next.hold) { clearTimeout(this._hold); clearTimeout(this._out); }
      else this.scheduleExit();
    }
  }

  flash(text) {
    clearTimeout(this._bt);
    this.setState({ banner: text });
    this._bt = setTimeout(() => this.setState({ banner: null }), 5200);
  }

  spark() {
    clearTimeout(this._st);
    this.setState({ sparkOn: false });
    requestAnimationFrame(() => this.setState({ sparkOn: true }));
    this._st = setTimeout(() => this.setState({ sparkOn: false }), 2200);
  }

  // Each shown gift is announced in a compact in-place card. Gifts that arrive
  // while one is on screen queue up instead of interrupting it.
  enqueue(id) {
    if (!id) return;
    if (this.state.current === id) return;
    if (this.queue.indexOf(id) !== -1) return;
    this.queue.push(id);
    if (this.state.current == null) this.playNext();
    else this.forceUpdate();
  }

  playNext() {
    clearTimeout(this._hold);
    clearTimeout(this._out);
    const id = this.queue.shift();
    if (id == null) { this.setState({ current: null, annLeaving: false, annCat: null }); return; }
    this.setState({ current: id, annLeaving: false, annCat: this.pickCategoryFor(id) });
    this.scheduleExit();
  }

  scheduleExit() {
    clearTimeout(this._hold);
    clearTimeout(this._out);
    const cur = this.state.s || {};
    if (cur.hold) return; // held on screen until the operator releases it
    const pace = Number(cur.pace) || 1;
    this._hold = setTimeout(() => {
      this.setState({ annLeaving: true });
      this._out = setTimeout(() => this.playNext(), 420);
    }, 2600 * pace);
  }

  clearStage() {
    clearTimeout(this._hold);
    clearTimeout(this._out);
    this.queue = [];
    this.setState({ current: null, annLeaving: false, annCat: null });
  }

  categoryList() {
    const s = this.state.s || {};
    const cats = (s.categories || []).filter((c) => c && c.name && Number(c.monthly) > 0);
    return cats.length ? cats : DEFAULTS.categories;
  }

  // Pick a program (a "Where it goes" category) for a gift — random among those
  // the gift can fund at least a full year of; falls back to any priced one.
  pickCategoryFor(id) {
    const s = this.state.s || {};
    const d = (s.donations || []).find((x) => x.id === id);
    const amount = d ? Number(d.amount) || 0 : 0;
    const cats = this.categoryList();
    const elig = cats.filter((c) => amount >= Number(c.monthly) * 12);
    const pool = elig.length ? elig : cats;
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  syncCounters() {
    const root = this.root;
    if (!root) return;
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = Number(el.getAttribute('data-to')) || 0;
      if (el.__to === to) return;
      const from = el.__cur == null ? 0 : el.__cur;
      el.__to = to;
      const dur = Number(el.getAttribute('data-dur')) || 1200;
      const mode = el.getAttribute('data-count');
      const t0 = performance.now();
      cancelAnimationFrame(el.__raf);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const v = from + (to - from) * e;
        el.__cur = v;
        el.textContent = mode === 'int' ? Math.round(v).toLocaleString('en-US') : money(v);
        if (k < 1) el.__raf = requestAnimationFrame(step);
        else { el.__cur = to; el.textContent = mode === 'int' ? Math.round(to).toLocaleString('en-US') : money(to); }
      };
      el.__raf = requestAnimationFrame(step);
    });
  }

  renderVals() {
    const s = Object.assign({}, DEFAULTS, this.state.s || {});
    const live = (s.donations || []).filter((d) => !d.voided);
    const total = live.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const cats = (s.categories || []).filter((c) => c && c.name);
    const sum = cats.reduce((a, c) => a + (Number(c.pct) || 0), 0) || 1;
    const goal = Number(s.goal) || 0;
    const showGoal = !!s.showGoal && goal > 0;
    const ceiling = showGoal ? goal : niceCeil(total);
    const pct = ceiling > 0 ? Math.min(1, total / ceiling) : 0;

    const curId = this.state.current;
    const annD = curId ? (s.donations || []).find((d) => d.id === curId) : null;
    const announce = !!annD;
    const amt = annD ? Number(annD.amount) || 0 : 0;
    const nm = annD ? (annD.anon ? 'A friend of Aspiring Futures' : (annD.name || 'A friend of Aspiring Futures')) : '';
    const defs = (s.fields || []).filter((f) => f && f.onScreen);
    const shown = (d, max, dropStatus) => {
      if (!d) return [];
      const legacy = { table: d.table ? 'Table ' + d.table : '', place: d.place, status: d.status === 'pledged' ? 'Pledged' : '' };
      const out = [];
      defs.forEach((f) => {
        const raw = d.fields ? d.fields[f.id] : legacy[f.id];
        if (!raw) return;
        const v = String(raw);
        if (/^paid$/i.test(v)) return;
        if (dropStatus && /^pledg/i.test(v)) return;
        out.push(f.type === 'choice' ? v : (/^(table|seat)/i.test(f.label) ? f.label.split('/')[0].trim() + ' ' + v : v));
      });
      return out.slice(0, max);
    };
    const pledged = annD ? (annD.status === 'pledged' || Object.keys(annD.fields || {}).some((k) => /^pledg/i.test(String(annD.fields[k] || '')))) : false;
    const meta = annD
      ? shown(annD, 3, true).map((t) => ({ t })).concat([{ t: pledged ? 'Pledged' : 'Received with thanks' }])
      : [];
    // Per-gift impact: how many people this gift could sponsor for a full year of
    // one randomly chosen "Where it goes" program (see pickCategoryFor).
    const annProg = annD ? cats.find((c) => c.id === this.state.annCat) || null : null;
    const annAnnual = annProg ? (Number(annProg.monthly) || 0) * 12 : 0;
    const annCount = annProg && annAnnual > 0 ? Math.max(1, Math.floor(amt / annAnnual)) : 0;
    const annUnitRaw = annProg ? (annProg.unit || 'children') : '';
    const annUnit = annProg ? (annCount === 1 ? singularUnit(annUnitRaw) : annUnitRaw) : '';
    // Board figure cycles through the programs (see the ambient cycle timer),
    // each showing how many people its own share of the total supports for a
    // full year — honest, and never pooled into a single program.
    const impactCats = cats.filter((c) => Number(c.monthly) > 0);
    const ambCat = impactCats.length ? impactCats[(this.state.ambientIdx || 0) % impactCats.length] : null;
    const ambAnnual = ambCat ? (Number(ambCat.monthly) || 0) * 12 : 0;
    const ambCount = ambCat && ambAnnual > 0 ? Math.floor((total * (Number(ambCat.pct) || 0) / sum) / ambAnnual) : 0;
    const ambUnitRaw = ambCat ? (ambCat.unit || 'children') : 'children';

    const lk = this.state.link || {};
    const paired = this.state.mode === 'paired';
    const brokerOk = lk.broker === 'connected';
    const ctrlGap = this.state.now - (this.state.ctrlSeen || 0);
    let chip = null, chipColor = 'var(--color-accent-300)';
    if (paired && !brokerOk) chip = 'Link lost — reconnecting…';
    else if (paired && !this.state.ctrlSeen) chip = 'Linked · waiting for Gala Control';
    else if (paired && ctrlGap > 16000) chip = 'Gala Control has gone quiet';
    if (chip && brokerOk && this.state.ctrlSeen) chipColor = 'var(--color-neutral-400)';

    return {
      needsPairing: !this.props.embedded && !this.state.mode,
      codeDraft: this.state.codeDraft,
      onCodeDraft: (e) => this.setState({ codeDraft: window.GalaLink ? window.GalaLink.format(e.target.value) : e.target.value, pairError: '' }),
      onCodeKey: (e) => { if (e.key === 'Enter') this.connectCode(); },
      connectCode: this.connectCode,
      useLocal: this.useLocal,
      pairError: this.state.pairError,
      linkChip: chip, linkChipColor: chipColor,
      rootHeight: this.props.embedded ? '100%' : '100vh',
      frameTransform: 'translate(-50%,-50%) scale(' + this.state.scale + ')',
      setRoot: this.setRoot, setFrame: this.setFrame,
      eventName: s.eventName, tagline: s.tagline,
      showTotal: !!s.showTotal, hideTotal: !s.showTotal,
      total, giftCount: live.length,
      showGoal, hideGoal: !showGoal,
      goalLabel: money(goal), goalTok: this.state.goalTok,
      levelHeight: Math.max(1.5, pct * 100).toFixed(2) + '%',
      levelPctLabel: Math.round(pct * 100) + '%',
      tubeAnim: this.state.sparkOn ? 'afTubePulse 1.6s ease-out both' : 'none',
      sparkOn: this.state.sparkOn,
      sparks: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        x: (8 + i * 13) + '%',
        size: (i % 3 === 0 ? 14 : 9) + 'px',
        delay: (i * 0.09).toFixed(2) + 's'
      })),
      cats: cats.map((c, i) => ({
        name: c.name,
        pctLabel: Math.round((Number(c.pct) || 0) / sum * 100) + '%',
        amount: total * (Number(c.pct) || 0) / sum,
        color: POD[i % POD.length]
      })),
      ambientChildren: ambCount,
      ambientUnit: ambCount === 1 ? singularUnit(ambUnitRaw) : ambUnitRaw,
      ambientProgramName: ambCat ? ambCat.name : 'Tonight’s gifts',
      ambientKey: ambCat ? ambCat.id : 'none',
      costLine: ambCat ? ('Funded from ' + Math.round((Number(ambCat.pct) || 0) / sum * 100) + '% of tonight’s gifts.') : 'Funded across every program.',
      wall: live.slice().reverse().slice(0, Math.max(1, Number(this.props.wallLength) || 7)).map((d) => ({
        name: d.anon ? 'A friend of Aspiring Futures' : (d.name || 'A friend of Aspiring Futures'),
        amountLabel: money(d.amount),
        meta: shown(d, 2).join(' · ')
      })),
      wallEmpty: live.length === 0,
      showQr: this.props.showQr !== false,
      qrCaption: s.qrCaption,
      banner: this.state.banner,
      ambientOpacity: announce ? 0.82 : 1,
      announce: announce,
      annKey: curId || 0,
      annAnim: this.state.annLeaving
        ? 'afCardOut .42s cubic-bezier(.4,0,.6,1) both'
        : 'afCardIn .5s cubic-bezier(.2,.8,.2,1) both',
      annName: nm,
      annNameSize: (nm.length <= 14 ? 84 : nm.length <= 22 ? 66 : nm.length <= 32 ? 52 : 42) + 'px',
      annAmount: money(amt),
      annMeta: meta,
      annImpactCount: annCount,
      annImpactLine: annProg
        ? (annUnit + ' supported for a year of ' + annProg.name.charAt(0).toLowerCase() + annProg.name.slice(1))
        : 'toward tonight’s goal',
      annQueue: this.queue.length > 0,
      annQueueLabel: '+' + this.queue.length + ' more'
    };
  }
}

function galaProps() {
  var h = location.hash + '&' + location.search;
  var wall = (h.match(/wall=(\d+)/) || [])[1];
  return {
    embedded: /embed=1/.test(h),
    showQr: !/qr=0/.test(h),
    wallLength: wall ? Number(wall) : 7
  };
}

DCX.boot({
  container: document.getElementById('dc-root'),
  template: document.getElementById('tpl').content,
  Logic: Component,
  props: galaProps()
});
