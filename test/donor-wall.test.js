'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../gala/js/audience.js');

const GAP = 12; // must match the flex gap between donor rows

// Drive the donor-wall fit the way the runtime does: render rows for the current
// wallFit, run measureWall, and re-run it whenever it calls setState — exactly the
// cycle that infinite-looped and froze the console preview. If measureWall never
// stops calling setState, this throws (bounded) instead of hanging the test.
function driveWall(opts) {
  const wallLength = opts.wallLength == null ? null : opts.wallLength; // null → auto-fit
  const candidates = opts.candidates;
  const avail = opts.avail;
  const heightFor = typeof opts.rowHeight === 'function' ? opts.rowHeight : function () { return opts.rowHeight; };

  const comp = new A.Component();
  comp.props = { wallLength: wallLength, embedded: wallLength != null };
  comp.state = Object.assign({}, comp.state, { wallFit: opts.initialWallFit || 8 });
  comp._wallCandidates = candidates;
  comp._wallDirty = true;

  const box = { clientHeight: avail, children: [] };
  comp.wallBox = box;

  function renderRows() {
    const n = (comp.props.wallLength != null)
      ? Math.max(1, comp.props.wallLength)
      : Math.max(1, comp.state.wallFit || 8);
    const count = Math.min(n, candidates);
    box.children = [];
    let top = 0;
    for (let i = 0; i < count; i++) {
      const h = heightFor(i);
      box.children.push({ offsetTop: top, offsetHeight: h });
      top += h + GAP;
    }
  }

  let renders = 0;
  let needMeasure = true;
  comp.setState = function (patch) { Object.assign(comp.state, patch); needMeasure = true; };
  while (needMeasure) {
    if (++renders > 500) throw new Error('measureWall did not converge (' + renders + ' renders) — infinite render loop');
    needMeasure = false;
    renderRows();
    comp.measureWall();
  }
  return { renders: renders, wallFit: comp.state.wallFit, rowsShown: box.children.length };
}

test('the fixed-count preview never loops (regression: the frozen console)', () => {
  // Embedded preview: a fixed count of 4, but 16 donors available. The fit routine
  // must NOT keep trying to render all 16 — that was the freeze.
  const r = driveWall({ wallLength: 4, candidates: 16, avail: 670, rowHeight: 42 });
  assert.equal(r.rowsShown, 4);   // honours its fixed count
  assert.ok(r.renders <= 5, 'converged without looping, got ' + r.renders + ' renders');
});

test('auto-fit converges and fills uniform rows', () => {
  // 670px tall, 42px rows + 12px gaps → 12 fit (11*54+42=636 ≤ 670; a 12th would be 690).
  const r = driveWall({ candidates: 16, avail: 670, rowHeight: 42 });
  assert.equal(r.rowsShown, 12);
  assert.ok(r.renders <= 10, 'converged quickly, got ' + r.renders + ' renders');
});

test('auto-fit never shows more donors than exist', () => {
  const r = driveWall({ candidates: 5, avail: 670, rowHeight: 42 });
  assert.equal(r.rowsShown, 5);
});

test('auto-fit packs by real row height — one tall row does not shrink the count', () => {
  // One 60px row among 42px rows. Real-height packing still fits ~12; a worst-case
  // "assume every row is 60px" estimate would fit only ~9.
  const r = driveWall({ candidates: 20, avail: 670, rowHeight: function (i) { return i === 3 ? 60 : 42; } });
  assert.ok(r.rowsShown >= 11, 'expected >= 11 (real-height packing), got ' + r.rowsShown);
  assert.ok(r.renders <= 10);
});

test('auto-fit never clips — the last shown row fully fits, and one more would not', () => {
  const avail = 500, rowHeight = 42, perRow = rowHeight + GAP;
  const r = driveWall({ candidates: 30, avail: avail, rowHeight: rowHeight });
  const lastBottom = (r.rowsShown - 1) * perRow + rowHeight;
  const nextBottom = r.rowsShown * perRow + rowHeight;
  assert.ok(lastBottom <= avail, 'last row bottom ' + lastBottom + ' fits within ' + avail);
  assert.ok(nextBottom > avail, 'fits as many as possible (next would be ' + nextBottom + ')');
});
