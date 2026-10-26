// What of the real room hides the virtual world in the mixed view (occluders.js): which boxes, and how high.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const O = M.occluders;

const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const rect = (x0, y0, x1, y1, h) => [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]];
// a scan in the common frame: a floor, a wall along y = -3 (4 m, 2.4 m high), a door frame, a table top at 0.74 m, a bed (0.5 m), a ceiling
const ROOM = { planes: [
  { l: 'floor', v: false, p: rect(-2, -3, 2, 3, 0) },
  { l: 'wall', v: true, p: [[-2, -3, 0], [2, -3, 0], [2, -3, 2.4], [-2, -3, 2.4]] },
  { l: 'door frame', v: true, p: [[2, 0, 0], [2, 1, 0], [2, 1, 2], [2, 0, 2]] },
  { l: 'table', v: false, p: rect(-1.6, 1, -0.4, 1.8, 0.74) },
  { l: 'bed', v: false, p: rect(0.5, 0.5, 1.5, 2.5, 0.5) },
  { l: 'ceiling', v: false, p: rect(-2, -3, 2, 3, 2.4) },
] };

test('a wall is a slab along its two ends from its lowest to its highest point; a door frame, floor and ceiling are not occluders', () => {
  const l = O.list(ROOM), w = l.filter((b) => b.kind === 'wall');
  assert.strictEqual(w.length, 1);
  near(w[0].cx, 0); near(w[0].cy, -3); near(w[0].hx, 2); near(w[0].hy, O.WALL_T / 2); near(w[0].z0, 0); near(w[0].z1, 2.4);
  assert.ok(Math.abs(Math.sin(w[0].ang)) < 1e-9, 'it lies along x');
  assert.strictEqual(l.length, 3, 'wall, table top and bed only');
});

test('a table top is a thin slab and a bed is a block from the floor, each as the smallest turned rectangle round its outline', () => {
  const l = O.list(ROOM), t = l.find((b) => b.kind === 'top'), f = l.find((b) => b.kind === 'furniture');
  near(t.z1, 0.74); near(t.z0, 0.74 - O.TABLE_T); near(t.cx, -1); near(t.cy, 1.4); near(Math.max(t.hx, t.hy), 0.6, 1e-6); near(Math.min(t.hx, t.hy), 0.4, 1e-6);
  near(f.z0, 0); near(f.z1, 0.5); near(f.cx, 1); near(f.cy, 1.5);
});

test('a table that stands turned is held by a turned box, not by the box round its corners', () => {
  const a = 0.6, c = Math.cos(a), s = Math.sin(a), at = (u, v) => [2 + u * c - v * s, 1 + u * s + v * c, 0.7];
  const room = { planes: [{ l: 'table', v: false, p: [at(-0.5, -0.3), at(0.5, -0.3), at(0.5, 0.3), at(-0.5, 0.3)] }] };
  const t = O.list(room)[0];
  near(t.cx, 2, 1e-6); near(t.cy, 1, 1e-6); near(t.hx * t.hy, 0.5 * 0.3, 1e-6, 'the area of the table, not of its bounding box');
});

test('nothing, or nonsense, gives no boxes and no error', () => {
  for (const r of [null, undefined, {}, { planes: 5 }, { planes: [] }]) assert.deepStrictEqual(O.list(r), []);
  assert.deepStrictEqual(O.list({ planes: [{ l: 'table', v: false, p: [[0, 0, 0.7], [0, 0, 0.7], [0, 0, 0.7]] }] }), [], 'a table with no area is no box');
});

test('there is a limit to how many are made', () => {
  const many = { planes: Array.from({ length: O.MAX + 50 }, (_, i) => ({ l: 'table', v: false, p: rect(i, 0, i + 0.2, 0.2, 0.7) })) };
  assert.strictEqual(O.list(many).length, O.MAX);
});
