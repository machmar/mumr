// The physics module: boxes with a quaternion and spin, fixed substeps, the room's surfaces, hands (docs/superpowers/specs/2026-10-26-physics-design.md).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const P = M.physics;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const G = 9.81;

test('mass is density times volume', () => {
  const b = P.makeBox({ size: [0.12, 0.12, 0.12], density: 1050 });
  near(b.mass, 1050 * 0.12 ** 3, 1050 * 0.12 ** 3 * 0.001, 'mass');
  near(b.inv, 1 / b.mass, 1e-9);
  near(b.inertia[0], (b.mass / 12) * (0.12 ** 2 + 0.12 ** 2), 1e-9, 'inertia of a cube');
});

test('free fall from 1 m takes sqrt(2h/g) within 1%', () => {
  const W = new P.World({ floor: false }), b = P.makeBox({ size: [0.12, 0.12, 0.12], p: [0, 0, 1.06] });
  W.add(b);
  let t = 0;
  while (b.p[2] > 0.06 && t < 2) { W.step(1 / 72); t += 1 / 72; }
  near(t, Math.sqrt(2 * 1 / G), Math.sqrt(2 / G) * 0.03, 'fall time');          // (3%: the frame is 1/72 s, a step of up to 14 ms)
  W.step(0);
  const c = P.makeBox({ size: [0.12, 0.12, 0.12], p: [0, 0, 1.06] }); const V = new P.World({ floor: false }); V.add(c);
  for (let i = 0; i < 240; i++) V.step(1 / 240);
  near(1.06 - c.p[2], 0.5 * G * 1, 0.5 * G * 0.01, 'distance after 1 s within 1%');
});

test('a spinning body keeps its angular velocity and its quaternion stays unit length', () => {
  const W = new P.World({ gravity: 0, floor: false }), b = P.makeBox({ size: [0.12, 0.12, 0.12], p: [0, 0, 1] });
  b.w = [0, 0, 3]; W.add(b);
  for (let i = 0; i < 10000; i++) W.step(1 / 240);
  near(Math.hypot(...b.q), 1, 1e-9, 'unit quaternion');
  near(b.w[2], 3, 1e-9, 'spin');
});

test('quat.rotate and slerp', () => {
  const q = P.quat.fromAxisAngle([0, 0, 1], Math.PI / 2), r = P.quat.rotate(q, [1, 0, 0]);
  near(r[0], 0, 1e-9); near(r[1], 1, 1e-9); near(r[2], 0, 1e-9);
  const h = P.quat.slerp([0, 0, 0, 1], q, 0.5), r2 = P.quat.rotate(h, [1, 0, 0]);
  near(r2[0], Math.SQRT1_2, 1e-9); near(r2[1], Math.SQRT1_2, 1e-9);
  assert.strictEqual(P.corners(P.makeBox({ size: [0.2, 0.2, 0.2], p: [0, 0, 1] })).length, 8);
});

// ---- contacts with the room (task 2)
const H = 0.06;
const d3 = 1 / Math.sqrt(3), CORNER_DOWN = P.quat.fromAxisAngle([-d3, d3, 0], Math.acos(-d3));                    // (the diagonal (1, 1, 1) turned to point straight down: axis = v x down = (-1, 1, 0))
const cube = (o = {}) => P.makeBox(Object.assign({ size: [0.12, 0.12, 0.12] }, o));
const run = (W, b, secs, fn) => { const n = Math.round(secs * 240); for (let i = 0; i < n; i++) { W.step(1 / 240); if (fn) fn(i / 240); } };
const energy = (b) => 0.5 * b.mass * b.v.reduce((a, c) => a + c * c, 0) + 0.5 * b.inertia.reduce((a, I, i) => a + I * b.w[i] * b.w[i], 0) + b.mass * G * b.p[2];
const plane = (l, v, p) => ({ l, v, p });
const tableRoom = () => ({ planes: [plane('table', false, [[1, 0, 0.7], [2, 0, 0.7], [2, 1, 0.7], [1, 1, 0.7]])] });
const wallRoom = () => ({ planes: [plane('wall', true, [[-3, 2, 0], [3, 2, 0], [3, 2, 2.4], [-3, 2, 2.4]])] });

test('no room: the floor at z = 0 carries a dropped cube, which rests on a face', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.5] }); W.add(b);
  run(W, b, 3);
  near(b.p[2], H, 0.002, 'resting height');
});

test('a dropped cube bounces to e squared of its drop height, within 5%', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 1 + H] }); W.add(b);
  let hit = false, apex = 0;
  run(W, b, 1.2, () => { if (b.v[2] > 0.5) hit = true; if (hit) apex = Math.max(apex, b.p[2] - H); });
  near(apex, 0.45 * 0.45, 0.45 * 0.45 * 0.05, 'first bounce apex');
});

test('it slides v squared over 2 mu g and stops (2 m/s, mu 0.4, within 5%)', () => {
  const W = new P.World(), b = cube({ p: [0, 0, H] }); b.v = [2, 0, 0]; W.add(b);
  run(W, b, 3);
  near(b.p[0], 4 / (2 * 0.4 * G), 4 / (2 * 0.4 * G) * 0.05, 'slide distance');
  assert.ok(Math.hypot(...b.v) < 0.01, 'stopped');
  near(b.p[2], H, 0.002, 'still flat');
});

test('on a tilted plane it slips above atan(mu static) and holds below it, within 1 degree', () => {
  const slope = (deg) => {
    const th = (deg * Math.PI) / 180, n = [Math.sin(th), 0, Math.cos(th)];
    const W = new P.World({ floor: false, planes: [{ n, d: 0 }] }), b = cube({ p: n.map((c) => c * H), q: P.quat.fromAxisAngle([0, 1, 0], th) }); W.add(b);
    const p0 = b.p.slice(); run(W, b, 2);
    return Math.hypot(b.p[0] - p0[0], b.p[1] - p0[1], b.p[2] - p0[2]);
  };
  const lim = (Math.atan(0.45) * 180) / Math.PI;
  assert.ok(slope(lim + 1) > 0.5, 'slips one degree above');
  assert.ok(slope(lim - 1) < 0.005, 'holds one degree below');
});

test('energy never goes up by more than a hair in a step without a hand', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.8], q: CORNER_DOWN }); b.v = [0.5, 0.2, 0]; W.add(b);
  let e = energy(b), worst = 0;
  run(W, b, 2, () => { const n = energy(b); worst = Math.max(worst, n - e); e = n; });
  assert.ok(worst < 0.02, `largest rise in one step ${worst} J`);
});

test('a cube dropped on a corner spins after the hit and ends on a face', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.5], q: P.quat.mul(P.quat.fromAxisAngle([1, 0.3, 0], 0.08), CORNER_DOWN) }); W.add(b);          // (a little off true: exactly on its corner it would balance)
  let spin = 0; run(W, b, 4, () => { spin = Math.max(spin, Math.hypot(...b.w)); });
  assert.ok(spin > 1, `spin ${spin}`);
  near(b.p[2], H, 0.003, 'rests flat');
});

test('thrown at 10 m/s at a wall or down on a 5 cm table it does not pass', () => {
  const W = new P.World({ room: wallRoom() }), b = cube({ p: [0, 1.5, 1] }); b.v = [0, 10, 0]; W.add(b);
  let far = -9; run(W, b, 1, () => { far = Math.max(far, b.p[1] + H); });
  assert.ok(far < 2.01, `reached ${far}`);
  const T = new P.World({ room: tableRoom() }), c = cube({ p: [1.5, 0.5, 1.5] }); c.v = [0, 0, -10]; T.add(c);
  run(T, c, 3);
  near(c.p[2], 0.7 + H, 0.004, 'on the table top');
  const S = new P.World({ room: tableRoom() }), d = cube({ p: [0.2, 0.5, 0.68] }); d.v = [10, 0, 0]; S.add(d);
  let reach = 0; run(S, d, 0.5, () => { reach = Math.max(reach, d.p[0] + H); });
  assert.ok(reach < 1.03, `through the table edge: ${reach}`);
});

test('a cube put inside a wall is pushed out to the room side', () => {
  const W = new P.World({ room: wallRoom() }), b = cube({ p: [0, 1.99, 1] }); W.add(b);
  run(W, b, 0.3);
  assert.ok(P.corners(b).every((c) => c[1] < 2.005), 'all corners on the room side');
});

test('thrown up under a table it bounces off the underside', () => {
  const W = new P.World({ room: tableRoom() }), b = cube({ p: [1.5, 0.5, 0.4] }); b.v = [0, 0, 3]; W.add(b);
  let top = 0; run(W, b, 1, () => { top = Math.max(top, b.p[2] + H); });
  assert.ok(top < 0.665, `reached ${top}`);
});

test('a frame hitch of 0.2 s does not tunnel or make NaN', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.3] }); b.v = [0, 0, -8]; W.add(b);
  W.step(0.2); W.step(0.2);
  assert.ok(b.p.every(Number.isFinite) && b.q.every(Number.isFinite));
  assert.ok(b.p[2] > H - 0.01, `z ${b.p[2]}`);
});
