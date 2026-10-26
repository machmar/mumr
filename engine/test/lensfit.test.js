// Working out the lens from pictures of the marker board (lensfit.js), on synthetic cameras that have a lens (webcamsim.boardCorners).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const LF = M.lensfit, SIM = M.webcamsim, SC = M.screencodes, LN = M.lens;

const W = 1280, H = 720, BOARD = SC.board({ w: 1920, h: 1080 });
const POSES = [
  { d: 0.34, tilt: 0, yaw: 0 },                                   // near, face on
  { d: 0.6, tilt: 0, yaw: 0 },                                    // far
  { d: 0.45, tilt: 0, yaw: 35 },                                  // turned one way
  { d: 0.45, tilt: 0, yaw: -35 },                                 // the other
  { d: 0.5, tilt: 35, yaw: 0, left: 0.05, up: 0.03 },             // leaning back, a little to a side
  { d: 0.4, tilt: -25, yaw: 10, left: -0.04, up: -0.02 },         // leaning forward
];
const snaps = (a1, a2, noise, seed, poses = POSES, hfovDeg = 70) => poses.map((p, i) => ({ markers: SIM.boardCorners(p, { a1, a2 }, { board: BOARD, W, H, hfovDeg, noise, seed: seed + i }) }));

test('the synthetic camera: the board is seen whole from every pose, with enough markers in each snapshot', () => {
  for (const s of snaps(-0.12, 0.01, 0.5, 1)) assert.ok(s.markers.length >= 12, `${s.markers.length} markers`);
  const none = SIM.boardCorners({ d: 3, tilt: 0 }, { a1: 0, a2: 0 }, { board: BOARD, W, H });
  assert.ok(none.length === BOARD.markers.length, 'a far board is whole too (it is just small)');
  assert.ok(SIM.boardCorners({ d: 0.1, tilt: 0 }, { a1: 0, a2: 0 }, { board: BOARD, W, H }).length < 12, 'a board held too near is cut off by the picture');
});

// How straight the markers of a snapshot are through a lens: the rms (pixels) of their corners from the best flat board
const WCm = M.webcam;
function straight(snapshots, lens) {
  let s = 0, n = 0;
  for (const sn of snapshots) {
    const src = [], dst = [];
    for (const m of sn.markers) { const b = BOARD.markers.find((x) => x.id === m.id); for (let i = 0; i < 4; i++) { src.push(SC.cornerPoint(b, i)); dst.push(LN.toIdeal({ a1: lens.a1, a2: lens.a2, W, H }, m.corners[i][0], m.corners[i][1])); } }
    const Hm = WCm.homography(src, dst);
    for (let i = 0; i < src.length; i++) { const q = WCm.applyH(Hm, src[i][0], src[i][1]); s += (q[0] - dst[i][0]) ** 2 + (q[1] - dst[i][1]) ** 2; n++; }
  }
  return Math.sqrt(s / n);
}
const FRESH = [{ d: 0.37, tilt: 10, yaw: 20 }, { d: 0.55, tilt: -15, yaw: -25, left: 0.03 }, { d: 0.42, tilt: 25, yaw: 5, up: 0.03 }];     // (other poses than the ones fitted)

test('a lens is found: on new pictures, other poses and other noise, the markers are as straight through it as through the true lens, and much straighter than with none; the field of view comes out near 70 degrees', () => {
  // (what the pictures can tell is how straight the markers become. A bend that a change of the field of view can imitate is not in them, so the two numbers themselves may differ from the truth by a little.)
  for (const [a1, a2] of [[-0.12, 0.01], [0.1, 0], [-0.3, 0.08], [0.2, -0.03], [-0.15, 0]]) {
    const r = LF.fit(snaps(a1, a2, 1, 5), { W, H, board: BOARD });
    assert.ok(r.ok, `${a1}, ${a2}: ${r.why}`);
    const fresh = snaps(a1, a2, 1, 900, FRESH), through = straight(fresh, r), truth = straight(fresh, { a1, a2 }), none = straight(fresh, { a1: 0, a2: 0 });
    assert.ok(through <= truth * 1.1 + 0.05, `${a1}, ${a2}: through the fitted lens ${through.toFixed(2)} px, through the true one ${truth.toFixed(2)} px`);
    assert.ok(none > truth * 1.25, `${a1}, ${a2}: the lens is worth finding: ${none.toFixed(2)} px without it against ${truth.toFixed(2)}`);
    assert.ok(Math.sign(r.a1) === Math.sign(a1) && Math.abs(r.a1 - a1) < 0.08, `${a1}, ${a2} came out (${r.a1.toFixed(3)}, ${r.a2.toFixed(3)})`);
    assert.ok(r.rmsAfter < r.rmsBefore, `${r.rmsBefore.toFixed(2)} -> ${r.rmsAfter.toFixed(2)}`);
    assert.ok(r.fovDeg !== null && Math.abs(r.fovDeg - 70) / 70 < 0.05, `${a1}, ${a2}: field of view ${r.fovDeg}`);
    assert.strictEqual(r.n, 6); assert.strictEqual(r.why, null);
  }
});

test('a lens too weak to show (a1 = -0.05: 1.7 px at most over the markers) is called no measurable distortion rather than guessed', () => {
  const r = LF.fit(snaps(-0.05, 0, 1, 5), { W, H, board: BOARD });
  assert.ok(r.ok, r.why); assert.ok((r.a1 === 0 && r.a2 === 0 && r.why === 'no measurable distortion') || r.a1 < 0, 'either it says none, or it finds the right sign');
  const fresh = snaps(-0.05, 0, 1, 900, FRESH); assert.ok(straight(fresh, r) < straight(fresh, { a1: 0, a2: 0 }) + 0.05, 'and it is no worse than none');
});

test('a camera with no lens: zero comes out and the answer says so; it does not invent a lens from noise', () => {
  for (const seed of [1, 20, 300]) {
    const r = LF.fit(snaps(0, 0, 1, seed), { W, H, board: BOARD });
    assert.ok(r.ok, r.why); assert.strictEqual(r.a1, 0); assert.strictEqual(r.a2, 0); assert.strictEqual(r.why, 'no measurable distortion');
    assert.ok(r.rmsBefore < 1.5, `the markers were already straight to ${r.rmsBefore}`);
  }
});

test('the field of view comes from the tilted views, and a different field of view is found', () => {
  const r = LF.fit(snaps(-0.1, 0, 0.7, 9, POSES, 55), { W, H, board: BOARD });
  assert.ok(r.ok && Math.abs(r.fovDeg - 55) / 55 < 0.04, `${r.fovDeg}`);
});

test('too few snapshots, snapshots that are alike, markers that never reach the edges: refused, with the reason', () => {
  const all = snaps(-0.12, 0.01, 0.5, 1);
  let r = LF.fit(all.slice(0, 4), { W, H, board: BOARD }); assert.strictEqual(r.ok, false); assert.match(r.why, /At least 5 snapshots/);
  const same = Array.from({ length: 6 }, (_, i) => ({ markers: SIM.boardCorners(POSES[0], { a1: -0.12, a2: 0.01 }, { board: BOARD, W, H, noise: 0.5, seed: 40 + i }) }));
  r = LF.fit(same, { W, H, board: BOARD }); assert.strictEqual(r.ok, false); assert.match(r.why, /alike/);
  const far = [1.2, 1.5, 1.8, 2.0, 2.2, 2.5].map((d, i) => ({ markers: SIM.boardCorners({ d, tilt: 0 }, { a1: -0.12, a2: 0.01 }, { board: BOARD, W, H, noise: 0.5, seed: 70 + i }) }));
  r = LF.fit(far, { W, H, board: BOARD }); assert.strictEqual(r.ok, false); assert.match(r.why, /edges/);
});

test('a snapshot with fewer than 12 markers is not counted; extra ids that are not on the board are ignored', () => {
  const all = snaps(-0.12, 0.01, 0.5, 1), thin = { markers: all[0].markers.slice(0, 6) };
  let r = LF.fit(all.slice(0, 4).concat([thin]), { W, H, board: BOARD }); assert.strictEqual(r.ok, false); assert.match(r.why, /4 of 5 have that many|have that many/);
  r = LF.fit(all.concat([thin]), { W, H, board: BOARD }); assert.ok(r.ok, r.why); assert.strictEqual(r.n, 6, 'the thin one is left out');
  const noisy = all.map((s) => ({ markers: s.markers.concat([{ id: 999, corners: [[10, 10], [20, 10], [20, 20], [10, 20]] }, { id: 0, corners: [[5, 5], [9, 5], [9, 9], [5, 9]] }]) }));
  r = LF.fit(noisy, { W, H, board: BOARD }); assert.ok(r.ok, r.why); assert.ok(Math.abs(r.a1 + 0.12) < 0.02, 'unknown ids, and the corner ids that the board does not have, do no harm');
});

test('nonsense in, an answer that says it cannot, never an exception', () => {
  for (const [s, o] of [[null, { W, H, board: BOARD }], [[], { W, H, board: BOARD }], [snaps(-0.1, 0, 0.5, 1), { W, H }], [snaps(-0.1, 0, 0.5, 1), { board: BOARD }], [snaps(-0.1, 0, 0.5, 1), null], ['x', { W, H, board: BOARD }],
    [[{ markers: [{ id: 4, corners: 'x' }] }, null, {}, { markers: null }], { W, H, board: BOARD }]]) {
    const r = LF.fit(s, o); assert.strictEqual(r.ok, false); assert.ok(typeof r.why === 'string' && r.why.length > 3);
  }
});
