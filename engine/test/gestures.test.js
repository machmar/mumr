// The engine's gestures (grab.js) on made-up hands: a flat hand palm down and palm up, a fist, a pointing finger and what it points at;
// the cube pushed by one finger, put on a flat hand and carried by it.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const C = require('../../apps/cube/cube.js');
const G = M.grab;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

// A hand on the floor plan, its wrist at `at`, fingers along +y, lying flat. side 'left' / 'right'; palmUp; curled: which of index,
// middle, ring, pinky are curled in (towards the palm side). The 25 WebXR joints, and the points hands.js makes from them.
function hand(id, at, { palmUp = false, curled = [] } = {}) {
  const side = /left/.test(id) ? 'left' : 'right';
  // seen from above with the palm down, a right hand has its thumb on the left (-x); turned palm up, on the right
  const thumbX = (side === 'right') !== palmUp ? -1 : 1, down = palmUp ? 1 : -1;      // (down: the way the palm faces, in z)
  const j = new Array(25);
  const P = (x, y, z) => [at[0] + x, at[1] + y, at[2] + z];
  j[0] = P(0, 0, 0);
  const xs = { index: 0.03, middle: 0.01, ring: -0.01, pinky: -0.03 }, base = { index: 5, middle: 10, ring: 15, pinky: 20 };
  for (const f of Object.keys(xs)) {
    const x = xs[f] * thumbX, b = base[f], c = curled.includes(f);
    j[b] = P(x, 0.02, 0); j[b + 1] = P(x, 0.09, 0);
    if (c) { j[b + 2] = P(x, 0.115, 0.025 * down); j[b + 3] = P(x, 0.095, 0.045 * down); j[b + 4] = P(x, 0.065, 0.035 * down); }
    else { j[b + 2] = P(x, 0.13, 0); j[b + 3] = P(x, 0.155, 0); j[b + 4] = P(x, 0.175, 0); }
  }
  for (let k = 1; k <= 4; k++) j[k] = P(0.03 * thumbX + 0.012 * k * thumbX, 0.02 + 0.012 * k, 0);
  const tip = { thumb: 4, index: 9, middle: 14, ring: 19, pinky: 24 };
  const points = Object.entries(tip).map(([name, i]) => ({ name, x: j[i][0], y: j[i][1], z: j[i][2] }));
  const pm = [0, 1, 2].map((i) => (j[10][i] + j[11][i]) / 2);
  points.push({ name: 'palm', x: pm[0], y: pm[1], z: pm[2] });
  return { id, points, joints: j, pinch: false };
}
const ALL = ['index', 'middle', 'ring', 'pinky'];

test('a flat hand is a platform, palm down or palm up, for either hand and for another player\'s', () => {
  const g = new G.Grips();
  const [rd, ru, ld, lu] = g.update([hand('right', [0, 0, 1]), hand('right2', [1, 0, 1], { palmUp: true }), hand('left', [2, 0, 1]), hand('p1-left', [3, 0, 1], { palmUp: true })]);
  assert.deepStrictEqual([rd, ru, ld, lu].map((q) => q.palm && q.palm.face), ['down', 'up', 'down', 'up']);
  assert.deepStrictEqual([rd, ru, ld, lu].map((q) => q.gesture), ['flat', 'flat', 'flat', 'flat']);
  near(rd.palm.tilt, 0, 1e-6); near(rd.palm.z, 1 + G.PLAT.thick, 1e-6, 'its top');
  assert.ok(G.onPlatform(rd.palm, 0, 0.08) && !G.onPlatform(rd.palm, 0, 0.3), 'from the wrist to the fingertips');
});

test('a fist, a pointing finger and what it points at; a pointing hand is not a fist', () => {
  const g = new G.Grips();
  let [f] = g.update([hand('right', [0, 0, 1], { curled: ALL })]);
  assert.strictEqual(f.kind, 'fist'); assert.strictEqual(f.gesture, 'fist');
  [f] = g.update([hand('right', [0, 0, 1])]);
  assert.strictEqual(f.kind, null, 'opened');
  const [p] = g.update([hand('right', [0, 0, 1], { curled: ['middle', 'ring', 'pinky'] })]);
  assert.strictEqual(p.gesture, 'point'); assert.strictEqual(p.kind, null, 'not a fist');
  near(p.point.dir[1], 1, 1e-6, 'along the finger');
  const box = { id: 'cube', label: 'cube', x: 0.03, y: 1, z: 1, half: 0.06, yaw: 0.3 };
  const hit = G.pointAt(p.point, [box], null);
  assert.strictEqual(hit.what, 'thing'); assert.strictEqual(hit.id, 'cube'); assert.ok(hit.at[1] > 1 - 0.085 && hit.at[1] < 1, `on its near side: ${hit.at[1]}`);
  const room = { planes: [{ l: 'wall', v: true, p: [[-2, 3, 0], [2, 3, 0], [2, 3, 2.4], [-2, 3, 2.4]] }] };
  const w = G.pointAt(p.point, [], room);
  assert.strictEqual(w.what, 'wall'); near(w.at[1], 3, 1e-9);
});

test('the cube: one pointing finger pushes it; put on a flat hand it is carried, and falls when the hand tilts', () => {
  const cube = new C.Cube();
  cube.place(0, 0.3);
  let t = 0;
  // a right hand pointing along +y, its index tip moving into the cube's near face (y = 0.24) at fingertip height
  for (let k = 0; k < 30; k++) {
    const h = hand('right', [-0.03, 0.3 - C.HALF - 0.2 + k * 0.004, C.HALF], { curled: ['middle', 'ring', 'pinky'] });
    cube.step(0.016, t += 0.016, [h]);
  }
  assert.ok(cube.y > 0.31, `pushed along by one finger: ${cube.y}`);
  // on a flat hand: dropped onto a hand held palm up 30 cm above the floor
  const P = (x, y, opts) => hand('left', [x, y, 0.3], Object.assign({ palmUp: true }, opts || {}));
  cube.place(0, 0.1); cube.z = 0.6;
  for (let k = 0; k < 60; k++) cube.step(0.016, t += 0.016, [P(0, 0)]);
  assert.strictEqual(cube.onHand && cube.onHand.id, 'left', 'it lies on the hand');
  near(cube.z, 0.3 + G.PLAT.thick + C.HALF, 3e-3);
  for (let k = 1; k <= 60; k++) cube.step(0.016, t += 0.016, [P(0.25 * (1 - Math.cos((Math.PI * k) / 60)), 0)]);       // (a hand speeds up and slows down over a second, at most 2.7 m/s2: a jerk of 4 g would leave a cube behind on a hand 8 cm wide)
  near(cube.x, 0.5, 0.05, 'carried 50 cm'); assert.ok(cube.onHand);
  // turned on its side (a hand held upright: no platform) it falls
  const side = P(0.5, 0); side.joints = side.joints.map((q) => [q[0], q[1], 0.3 + (q[0] - 0.5) * 3]);      // (tilted about 70 degrees)
  for (let k = 0; k < 60; k++) cube.step(0.016, t += 0.016, [side]);
  assert.strictEqual(cube.onHand, null); assert.ok(cube.z < 0.3, `fell: ${cube.z}`);
});

test('a fist that moves something else (marked noHold) does not take the cube; the same fist without the mark does', () => {
  const run = (mark) => {
    const cube = new C.Cube();
    cube.place(0, 0);
    const palm = [C.HALF + 0.05, 0, C.HALF], h = (curled) => Object.assign(hand('left', palm, { curled }), mark ? { noHold: true } : {});      // (a left hand: its thumb points away from the cube)
    cube.step(0.016, 0.016, [h([])]); cube.step(0.016, 0.032, [h(ALL)]);
    return cube.held && cube.held.kind;
  };
  assert.strictEqual(run(true), null, 'noHold: not taken');
  assert.strictEqual(run(false), 'fist');
});
