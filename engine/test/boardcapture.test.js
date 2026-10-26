// Taking snapshots of the marker board (boardcapture.js): steady for half a second, at a new place, enough markers.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const BC = M.boardcapture, SC = M.screencodes, SIM = M.webcamsim;

const W = 1280, H = 720, BOARD = SC.board({ w: 1920, h: 1080 }), IDS = BOARD.markers.map((m) => m.id);
const NEAR = { d: 0.34, tilt: 0, yaw: 0 }, FAR = { d: 0.6, tilt: 0, yaw: 0 }, LEFT = { d: 0.45, tilt: 0, yaw: 35 }, RIGHT = { d: 0.45, tilt: 0, yaw: -35 };
const view = (pose, seed = 1, noise = 0.3) => SIM.boardCorners(pose, { a1: -0.1, a2: 0 }, { board: BOARD, W, H, noise, seed });
// feed the same view for `ms` (8 frames a second) with a little tremble
function hold(cap, pose, t0, ms, noise = 0.6) { let st = null, t = t0; for (; t <= t0 + ms; t += 125) st = cap.feed(view(pose, Math.round(t), noise), t); return { st, t }; }

test('a view held still for half a second is one snapshot; it is the average of the frames, with every marker of the board that was seen', () => {
  const cap = new BC.BoardCapture({ ids: IDS, W, H });
  const { st } = hold(cap, NEAR, 0, 900);
  assert.strictEqual(cap.count, 1); assert.strictEqual(st.state, 'taken'); assert.strictEqual(st.count, 1);
  const s = cap.snapshots[0], truth = view(NEAR, 1, 0);
  assert.ok(s.markers.length >= 12 && s.markers.length === truth.length, `${s.markers.length} of ${truth.length}`);
  for (const m of s.markers) { const t = truth.find((x) => x.id === m.id); for (let i = 0; i < 4; i++) assert.ok(Math.hypot(m.corners[i][0] - t.corners[i][0], m.corners[i][1] - t.corners[i][1]) < 1.2); }
  assert.match(st.msg, /Snapshot 1 taken|Got it/); assert.strictEqual(st.next.n, 2); assert.match(st.next.text, /twice as far/);
});

test('nothing is taken while it is moving, or before half a second, or with fewer than 12 markers', () => {
  const cap = new BC.BoardCapture({ ids: IDS, W, H });
  let t = 0; for (let k = 0; k < 20; k++, t += 125) cap.feed(view({ d: 0.34 + 0.012 * k, tilt: 0, yaw: 0 }, k, 0.2), t);                // the board moves 4 mm in every frame
  assert.strictEqual(cap.count, 0);
  const c2 = new BC.BoardCapture({ ids: IDS, W, H }); const early = hold(c2, NEAR, 0, 375); assert.strictEqual(c2.count, 0); assert.ok(early.st.progress > 0 && early.st.progress < 1);
  const c3 = new BC.BoardCapture({ ids: IDS, W, H }); let st; for (let k = 0; k < 12; k++) st = c3.feed(view(NEAR, 1, 0.3).slice(0, 8), k * 125);
  assert.strictEqual(c3.count, 0); assert.match(st.msg, /8 markers are seen, 12 are needed/);
  assert.match(c3.feed([], 2000).msg, /Point the camera at the screen/);
});

test('the same place twice is not taken twice: it says so, and the next snapshot waits for the board to move', () => {
  const cap = new BC.BoardCapture({ ids: IDS, W, H });
  let r = hold(cap, NEAR, 0, 900);                                     // 1
  r = hold(cap, FAR, r.t + 125, 900); assert.strictEqual(cap.count, 2);
  r = hold(cap, FAR, r.t + 125, 900);                                  // still there: nothing new
  assert.strictEqual(cap.count, 2);
  // away (lost for a moment) and back at the same place as the first one: refused
  cap.feed([], r.t + 125); cap.feed([], r.t + 700); r = hold(cap, NEAR, r.t + 800, 900);
  assert.strictEqual(cap.count, 2); assert.match(r.st.msg, /same place as an earlier snapshot/);
  r = hold(cap, LEFT, r.t + 125, 900); assert.strictEqual(cap.count, 3);
  r = hold(cap, RIGHT, r.t + 125, 900); assert.strictEqual(cap.count, 4);
  assert.match(r.st.next.text, /one side|nearer|corner/);
});

test('markers that are not the board\'s are ignored; the frames of a snapshot must show the same markers', () => {
  const cap = new BC.BoardCapture({ ids: IDS, W, H });
  const extra = { id: 999, corners: [[5, 5], [30, 5], [30, 30], [5, 30]] }, corner0 = { id: 0, corners: [[40, 40], [60, 40], [60, 60], [40, 60]] };
  let t = 0, st; for (; t <= 900; t += 125) st = cap.feed(view(NEAR, Math.round(t), 0.5).concat([extra, corner0]), t);
  assert.strictEqual(cap.count, 1); assert.ok(!cap.snapshots[0].markers.some((m) => m.id === 999 || m.id === 0));
  const c2 = new BC.BoardCapture({ ids: IDS, W, H });
  for (let k = 0, tt = 0; k < 14; k++, tt += 125) { const v = view(NEAR, k, 0.3); c2.feed(k % 2 ? v.slice(1) : v, tt); }                // a marker blinks in and out in every other frame
  assert.strictEqual(c2.count, 0, 'a view whose markers keep changing is not steady');
});

test('it stops at 8 snapshots; reset starts again; nonsense is ignored', () => {
  const cap = new BC.BoardCapture({ ids: IDS, W, H }); let t = 0;
  const poses = [NEAR, FAR, LEFT, RIGHT, { d: 0.4, tilt: 30, yaw: 0, left: 0.06 }, { d: 0.55, tilt: -30, yaw: 15, left: -0.05, up: 0.04 }, { d: 0.38, tilt: 0, yaw: 20, up: 0.05 }, { d: 0.7, tilt: 25, yaw: -20, left: 0.05 }];
  for (const p of poses) { const r = hold(cap, p, t, 900); t = r.t + 125; cap.feed([], t); cap.feed([], t + 600); t += 700; }
  assert.strictEqual(cap.count, 8); assert.strictEqual(cap.full, true); assert.strictEqual(cap.status().next, null);
  assert.strictEqual(cap.feed(view(NEAR, 5), t).msg, 'Enough snapshots');
  cap.reset(); assert.strictEqual(cap.count, 0); assert.strictEqual(cap.full, false);
  for (const junk of [null, undefined, 'x', 5, [null, 3, {}]]) assert.doesNotThrow(() => cap.feed(junk, 1));
});
