// The camera calibration mode as a state machine (calmode.js): the three paths, what is ignored, what stays and says why, and the result with its cross-check.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const { CalMode, MSG } = M.calmode;

const QUAD = [[100, 80], [1180, 90], [1170, 650], [110, 640]];
const FIT = { ok: true, a1: -0.12, a2: 0.01, rmsBefore: 2.4, rmsAfter: 0.4, fovDeg: 64.5, n: 6 };
const LAT = { ok: true, medianMs: 85, minMs: 70, maxMs: 110, n: 12, unsteady: false };

test('off until opened; opening twice does nothing; the first step is the choice', () => {
  const m = new CalMode();
  assert.strictEqual(m.state.step, 'off'); assert.strictEqual(m.choose('fov'), false, 'nothing to choose from');
  assert.strictEqual(m.open(), true); assert.strictEqual(m.state.step, 'choose'); assert.strictEqual(m.state.msg, MSG.choose);
  assert.strictEqual(m.open(), false); assert.strictEqual(m.state.step, 'choose');
});

test('the field of view path: choose, measure, result', () => {
  const m = new CalMode(); m.open();
  assert.strictEqual(m.choose('nonsense'), false); assert.strictEqual(m.state.step, 'choose');
  assert.ok(m.choose('fov')); assert.strictEqual(m.state.step, 'fov'); assert.strictEqual(m.state.kind, 'fov');
  assert.strictEqual(m.fovDone({ fovDeg: NaN }), false); assert.strictEqual(m.state.step, 'fov'); assert.match(m.state.msg, /could not be measured/);
  assert.ok(m.fovDone({ fovDeg: 63.8, shots: 3, spread: 0.6 })); assert.strictEqual(m.state.step, 'result');
  const r = m.resultOf();
  assert.strictEqual(r.fovDeg, 63.8); assert.strictEqual(r.a1, null); assert.strictEqual(r.latencyMs, null); assert.strictEqual(r.warning, null);
});

test('distortion: the board, then the result; each call fits only its own step', () => {
  const m = new CalMode(); m.open(); m.choose('distortion');
  assert.strictEqual(m.state.step, 'board', 'no aim step: the board is what the camera has to see');
  for (const early of [() => m.aimed(QUAD), () => m.latencyDone(LAT), () => m.fovDone({ fovDeg: 60 })]) assert.strictEqual(early(), false);
  assert.strictEqual(m.state.step, 'board');
  assert.ok(m.boardDone(FIT)); assert.strictEqual(m.state.step, 'result'); assert.strictEqual(m.boardDone(FIT), false, 'already done');
  const r = m.resultOf();
  assert.deepStrictEqual([r.a1, r.a2, r.screenFovDeg, r.rmsBefore, r.rmsAfter], [-0.12, 0.01, 64.5, 2.4, 0.4]);
  assert.strictEqual(r.latencyMs, null, 'the distortion run measures no latency'); assert.strictEqual(r.latencyMinMs, null); assert.strictEqual(r.unsteady, false); assert.strictEqual(r.fovDeg, null, 'and does not measure the sheet');
});

test('latency: aim, latency, result; no board', () => {
  const m = new CalMode(); m.open(); m.choose('latency');
  assert.strictEqual(m.state.step, 'aim'); assert.strictEqual(m.boardDone(FIT), false); assert.strictEqual(m.latencyDone(LAT), false, 'not before the screen has been found');
  assert.ok(m.aimed(QUAD)); assert.strictEqual(m.state.step, 'latency'); assert.deepStrictEqual(m.state.quad, QUAD); assert.strictEqual(m.aimed(QUAD), false, 'already aimed'); assert.strictEqual(m.boardDone(FIT), false);
  m.latencyDone(LAT); const r = m.resultOf(); assert.strictEqual(r.a1, null); assert.strictEqual(r.latencyMs, 85); assert.deepStrictEqual([r.latencyMinMs, r.latencyMaxMs, r.unsteady], [70, 110, false]);
});

test('a screen that was not found, a refused fit and a latency that could not be measured stay where they are and say why', () => {
  const m = new CalMode(); m.open(); m.choose('latency');
  for (const bad of [null, [], [[0, 0], [1, 1], [2, 2]], [[0, 0], [0, 0], [0, 0], [0, 0]], [[0, 0], [1, NaN], [2, 2], [3, 3]], 'x']) assert.strictEqual(m.aimed(bad), false, JSON.stringify(bad));
  assert.strictEqual(m.state.step, 'aim'); assert.match(m.state.msg, /corner marks/);
  m.aimed(QUAD);
  assert.strictEqual(m.latencyDone({ ok: false, why: "The camera's picture never changed: is it pointed at the screen?" }), false);
  assert.strictEqual(m.state.step, 'latency'); assert.match(m.state.msg, /never changed/);
  assert.strictEqual(m.latencyDone(undefined), false);
  const d = new CalMode(); d.open(); d.choose('distortion');
  assert.strictEqual(d.boardDone({ ok: false, why: 'the snapshots are alike: move the camera nearer or farther' }), false);
  assert.strictEqual(d.state.step, 'board'); assert.match(d.state.msg, /alike/);
  assert.strictEqual(d.boardDone({ ok: true, a1: NaN, a2: 0 }), false); assert.strictEqual(d.boardDone(null), false); assert.strictEqual(d.state.step, 'board');
});

test('back goes one step and forgets what that step measured; at the first step it says no; exit leaves from anywhere', () => {
  const m = new CalMode(); assert.strictEqual(m.back(), false);
  m.open(); assert.strictEqual(m.back(), false, 'at the choice: the page leaves the mode instead');
  m.choose('latency'); m.aimed(QUAD); m.latencyDone(LAT);
  assert.ok(m.back()); assert.strictEqual(m.state.step, 'latency'); assert.strictEqual(m.resultOf(), null);
  assert.ok(m.back()); assert.strictEqual(m.state.step, 'aim'); assert.strictEqual(m.state.quad, null);
  assert.ok(m.back()); assert.strictEqual(m.state.step, 'choose'); assert.strictEqual(m.state.kind, null);
  m.choose('distortion'); m.boardDone(FIT);
  assert.ok(m.back()); assert.strictEqual(m.state.step, 'board'); assert.strictEqual(m.resultOf(), null);
  assert.ok(m.back()); assert.strictEqual(m.state.step, 'choose');
  m.choose('fov'); m.fovDone({ fovDeg: 64 }); assert.strictEqual(m.exit(), true); assert.strictEqual(m.state.step, 'off'); assert.strictEqual(m.exit(), false);
  assert.ok(m.open(), 'and it can be opened again, empty'); assert.strictEqual(m.state.kind, null);
  assert.strictEqual(m.choose('both'), false, 'the old combined choice is gone');
});

test('the cross-check: the screen\'s field of view against the sheet\'s, a warning above 3 %, the sheet\'s value is the one kept', () => {
  const run = (screen, sheet) => { const m = new CalMode(); m.open(); m.choose('distortion'); m.boardDone(Object.assign({}, FIT, { fovDeg: screen })); return m.resultOf({ sheetFovDeg: sheet }); };
  let r = run(64.5, 64.0); assert.ok(r.crossCheckPct < 1); assert.strictEqual(r.warning, null); assert.strictEqual(r.sheetFovDeg, 64.0);
  r = run(60, 64); assert.ok(Math.abs(r.crossCheckPct - 6.25) < 1e-9); assert.match(r.warning, /differ by 6\.3 %/); assert.match(r.warning, /sheet's value is kept/);
  r = run(64, undefined); assert.strictEqual(r.crossCheckPct, null); assert.strictEqual(r.warning, null, 'no sheet value: nothing to compare with');
  r = run(65.9, 64); assert.strictEqual(r.warning, null, '2.97 percent is still fine');
});

test('home: back to the choice from anywhere, with nothing of the run left; nothing when it is not open', () => {
  const m = new CalMode(); assert.strictEqual(m.home(), false);
  m.open(); m.choose('distortion'); m.boardDone(FIT);
  assert.strictEqual(m.state.step, 'result'); assert.ok(m.resultOf());
  assert.ok(m.home()); assert.strictEqual(m.state.step, 'choose'); assert.strictEqual(m.state.kind, null); assert.strictEqual(m.state.quad, null); assert.strictEqual(m.resultOf(), null); assert.strictEqual(m.back(), false);
  assert.ok(m.choose('fov'), 'and it can go on from there');
});

test('the field of view from the sheet can bring a lens with it (the shots only agreed once the picture was straightened): it is in the result, marked as rough', () => {
  const m = new CalMode(); m.open(); m.choose('fov');
  assert.ok(m.fovDone({ fovDeg: 64.2, shots: 4, spread: 0.1, lens: { a1: -0.16, a2: 0 } }));
  const r = m.resultOf(); assert.deepStrictEqual([r.fovDeg, r.a1, r.a2, r.lensFromSheet], [64.2, -0.16, 0, true]);
  const n = new CalMode(); n.open(); n.choose('fov'); n.fovDone({ fovDeg: 64, shots: 3, spread: 0.2 });
  const q = n.resultOf(); assert.deepStrictEqual([q.a1, q.a2, q.lensFromSheet], [null, null, false]);
  const b = new CalMode(); b.open(); b.choose('fov'); b.fovDone({ fovDeg: 64, lens: { a1: NaN } }); assert.strictEqual(b.resultOf().a1, null, 'a lens that is not a number is not one');
});
