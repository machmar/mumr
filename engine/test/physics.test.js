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
