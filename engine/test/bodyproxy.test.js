// The stand-in bodies that hide the world behind real people on the webcam page (webcam/bodyproxy.js).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const B = M.bodyproxy;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const hand = (id, x, y, z) => ({ id, points: [{ name: 'wrist', x, y, z }, { name: 'index', x: x + 0.08, y, z }, { name: 'thumb', x: x + 0.05, y: y + 0.03, z }] });
const lowest = (ps) => Math.min(...ps.flatMap((p) => [p.a[2], p.b[2]]));

test('a standing head: a head sphere, and a body down to the floor', () => {
  const ps = B.build([1, 2, 0, 1.65, 0], []);
  const h = ps.find((p) => p.kind === 'sphere');
  assert.ok(h, 'a head sphere');
  near(h.a[2], 1.65, 1e-9, 'at the eyes\' height'); near(h.r, B.HEAD_R, 1e-9);
  assert.ok(h.a[0] < 1, 'a little behind the eyes (the head looks along +x)');
  near(lowest(ps), 0, 1e-9, 'down to the floor');
  assert.ok(ps.filter((p) => p.kind === 'capsule').length >= 2, 'a chest and legs');
});

test('the heading turns the shoulders: an arm starts to the side of the way the head looks', () => {
  for (const yaw of [0, Math.PI / 2, 2.3]) {
    const fwd = [Math.cos(yaw), Math.sin(yaw)], right = [Math.sin(yaw), -Math.cos(yaw)];
    const w = [0.4 * fwd[0] + 0.25 * right[0], 0.4 * fwd[1] + 0.25 * right[1], 1.2];
    const ps = B.build([0, 0, yaw, 1.6, 0], [hand('left', ...w)]);
    const arm = ps.find((p) => p.kind === 'capsule' && Math.abs(p.r - B.ARM_R) < 1e-9);
    near(arm.a[0] * right[0] + arm.a[1] * right[1], B.SHOULDER_SIDE, 1e-9, `yaw ${yaw}: the shoulder is to the right`);
    near(arm.a[2], 1.6 - B.SHOULDER_DROP, 1e-9);
  }
});

test('a hand on the left goes to the left shoulder, whatever its id', () => {
  const ps = B.build([0, 0, 0, 1.6, 0], [hand('right', 0.4, 0.3, 1.2)]);           // looking along +x, +y is to the left
  const arm = ps.find((p) => p.kind === 'capsule' && Math.abs(p.r - B.ARM_R) < 1e-9);
  near(arm.a[1], B.SHOULDER_SIDE, 1e-9, 'the left shoulder');
  assert.deepStrictEqual(arm.b, [0.4, 0.3, 1.2], 'to the wrist');
});

test('an arm stretched further than a straight arm gets an elbow below its middle', () => {
  const ps = B.build([0, 0, 0, 1.6, 0], [hand('r', 0.9, -0.3, 1.3)]);
  const arms = ps.filter((p) => p.kind === 'capsule' && Math.abs(p.r - B.ARM_R) < 1e-9);
  assert.strictEqual(arms.length, 2);
  assert.deepStrictEqual(arms[0].b, arms[1].a, 'joined at the elbow');
  assert.ok(arms[0].b[2] < (arms[0].a[2] + arms[1].b[2]) / 2, 'which hangs');
});

test('the 25 joints of a tracked hand become the fingers; the feet put the legs over them', () => {
  const joints = Array.from({ length: 25 }, (_, i) => [0.4 + 0.004 * i, -0.2, 1.1]);
  const ps = B.build([0, 0, 0, 1.6, 0], [{ id: 'r', points: [], joints }, { foot: true, points: [{ x: 0.3, y: 0.2, z: 0 }, { x: 0.1, y: 0.2, z: 0 }] }]);
  assert.strictEqual(ps.filter((p) => Math.abs(p.r - B.HAND_R) < 1e-9).length, 24, 'the five chains from the wrist');
  const legs = ps.find((p) => Math.abs(p.r - B.LEGS_R) < 1e-9);
  assert.deepStrictEqual(legs.b, [0.2, 0.2, 0], 'down between the feet');
});

test('nonsense gives nothing, and never throws', () => {
  for (const h of [null, undefined, [], [NaN, 0, 0, 1.6], [0, 0, 0, -0.2], [0, 0, 0, 0.1], 'head', [0, 0, 0, Infinity]]) assert.deepStrictEqual(B.build(h, []), [], JSON.stringify(h));
  assert.ok(B.build([0, 0, 0, 1.6, 0], [null, { id: 'x' }, { id: 'y', points: [{ x: NaN }] }, { joints: [[1, 2]] }]).length > 0, 'a good head with bad hands: the body without them');
  assert.ok(B.build([0, 0, NaN, 1.6], null).length >= 3, 'no heading: still a body');
});

test('grow adds the same margin to every radius', () => {
  const src = [hand('l', 0.3, 0.3, 1.2)], a = B.build([0, 0, 0.4, 1.7, 0], src), b = B.build([0, 0, 0.4, 1.7, 0], src, { grow: B.GROW_CRUDE });
  assert.strictEqual(a.length, b.length);
  a.forEach((p, i) => near(b[i].r - p.r, B.GROW_CRUDE, 1e-12));
  assert.ok(B.GROW_ML > B.GROW_CRUDE);
});

test('buildInto: the same stand-ins into a pool kept between frames, several players one after the other', () => {
  const pool = { items: [], n: 0 }, h1 = [0, 0, 0.3, 1.6, 0], h2 = [2, 1, 2, 1.75, 0], src = [hand('l', 0.3, 0.3, 1.2)];
  const n1 = B.buildInto(pool, h1, src, { grow: 0.06 }), n2 = B.buildInto(pool, h2, [], { grow: 0.06 });
  const want = B.build(h1, src, { grow: 0.06 }).concat(B.build(h2, [], { grow: 0.06 }));
  assert.strictEqual(n1 + n2, want.length); assert.strictEqual(pool.n, want.length);
  want.forEach((w, i) => { const it = pool.items[i]; assert.strictEqual(it.kind, w.kind); near(it.r, w.r, 1e-12); [0, 1, 2].forEach((k) => { near(it.a[k], w.a[k], 1e-12); near(it.b[k], w.b[k], 1e-12); }); });
  const items = pool.items.slice(); pool.n = 0; B.buildInto(pool, h1, src, { grow: 0.06 });
  assert.ok(pool.items.every((it, i) => it === items[i]), 'the next frame reuses the same objects');
  assert.strictEqual(B.buildInto(pool, [0, 0, 0, -1], []), 0, 'nonsense: nothing');
});
