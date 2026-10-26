// Moving a real camera by hand with the line-up knobs (camknobs.js): where the knobs are, what a pull does, what lets go.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const { CamKnobs } = M.camknobs, C = M.cams;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const cam = () => ({ id: 'cam-1', x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27 });          // (own frame: z above this headset's floor)
const PLANE = 0.03;                                           // where the common floor lies in the headset's own frame
const knob = (K, cams, axis) => K.knobs(cams).find((k) => k.axis === axis);
const tip = (k, extra = {}) => Object.assign({ id: 'r', x: k.x, y: k.y, z: k.z, pinch: false }, extra);

test('three knobs for each camera: along on the point half a metre in front of it, across 12 cm to its left, up 12 cm above', () => {
  const K = new CamKnobs(), c = cam(), ks = K.knobs([c]), look = [Math.cos(c.yaw) * Math.cos(c.pitch), Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch)];
  assert.deepStrictEqual(ks.map((k) => k.axis), ['along', 'across', 'up']);
  const a = ks[0], B = [c.x + 0.5 * look[0], c.y + 0.5 * look[1], c.z + 0.5 * look[2]];
  for (let i = 0; i < 3; i++) near([a.x, a.y, a.z][i], B[i], 1e-9, `along ${i}`);
  near(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z), 0.5, 1e-9, 'half a metre');
  const s = ks[1], u = ks[2];
  near(Math.hypot(s.x - a.x, s.y - a.y, s.z - a.z), 0.12, 1e-9, 'across is 12 cm from the point');
  near((s.x - a.x) * Math.cos(c.yaw) + (s.y - a.y) * Math.sin(c.yaw), 0, 1e-9, 'sideways: at a right angle to the way it looks on the floor');
  near((s.x - a.x) * -Math.sin(c.yaw) + (s.y - a.y) * Math.cos(c.yaw), 0.12, 1e-9, 'and to its left');
  near(u.z - a.z, 0.12, 1e-9, 'up'); near(u.x, a.x, 1e-9); near(u.y, a.y, 1e-9);
  assert.deepStrictEqual(a.from, [c.x, c.y, c.z], 'the along knob hangs on a stalk from the camera'); assert.deepStrictEqual([s.from[0], u.from[0]], [a.x, a.x]); assert.deepStrictEqual([s.from[2], u.from[2]], [a.z, a.z], 'the others from the point in front of it');
  assert.strictEqual(K.knobs([]).length, 0); assert.strictEqual(new CamKnobs().knobs(null).length, 0);
});

test('a pinch at the along knob pulled 20 cm forward moves the camera 1 cm forward, and it still looks at the same point of the floor', () => {
  const K = new CamKnobs(), c = cam(), aim = C.aimPoint(c, PLANE), k0 = knob(K, [c], 'along');
  assert.ok(aim);
  let r = K.update([tip(k0)], [c], PLANE); assert.strictEqual(r.grabbed, false, 'an open hand takes nothing');
  r = K.update([tip(k0, { pinch: true })], [c], PLANE); assert.strictEqual(r.grabbed, true); assert.deepStrictEqual(K.held, { id: 'cam-1', axis: 'along', pull: 0 });
  assert.strictEqual(r.moves.length, 0);
  const fwd = [Math.cos(c.yaw), Math.sin(c.yaw)], last = [];
  for (let n = 1; n <= 10; n++) {
    r = K.update([tip(k0, { pinch: true, x: k0.x + fwd[0] * 0.02 * n, y: k0.y + fwd[1] * 0.02 * n })], [c], PLANE);
    assert.strictEqual(r.moves.length, 1); last.push(r.moves[0]);
  }
  const m = last[9];
  near(m.x - c.x, fwd[0] * 0.01, 1e-9, 'x'); near(m.y - c.y, fwd[1] * 0.01, 1e-9, 'y'); near(m.z, c.z, 1e-9, 'height');
  near(K.held.pull, 0.2, 1e-9, 'the hand has pulled 20 cm');
  const p = K.pose(c), again = C.aimPoint(p, PLANE);
  assert.ok(Math.hypot(again[0] - aim[0], again[1] - aim[1]) < 1e-9, 'the same point of the floor');
  assert.ok(p.pitch !== c.pitch || p.yaw !== c.yaw, 'so it turned a little');
  // the knobs go with the camera and the held one follows the hand
  const held = knob(K, [c], 'along');
  assert.strictEqual(held.held, true); near(Math.hypot(held.x - k0.x - fwd[0] * 0.2, held.y - k0.y - fwd[1] * 0.2), 0, 0.011, 'near the fingertip (the camera moved 1 cm)');
  r = K.update([tip(k0, { pinch: false })], [c], PLANE);
  assert.deepStrictEqual(r.release, { id: 'cam-1', x: m.x, y: m.y, z: m.z }); assert.strictEqual(K.held, null);
  assert.strictEqual(K.pose(c), c, 'and let go it is drawn where the world has it');
});

test('across moves it sideways and up moves it higher, a twentieth as far as the hand', () => {
  const c = cam(), left = [-Math.sin(c.yaw), Math.cos(c.yaw)];
  let K = new CamKnobs(), k = knob(K, [c], 'across');
  K.update([tip(k, { pinch: true })], [c], PLANE);
  let r = K.update([tip(k, { pinch: true, x: k.x + left[0] * 0.4, y: k.y + left[1] * 0.4 })], [c], PLANE);
  near(r.moves[0].x - c.x, left[0] * 0.02, 1e-9); near(r.moves[0].y - c.y, left[1] * 0.02, 1e-9);
  K = new CamKnobs(); k = knob(K, [c], 'up');
  K.update([tip(k, { pinch: true })], [c], PLANE);
  r = K.update([tip(k, { pinch: true, z: k.z + 0.3 })], [c], PLANE);
  near(r.moves[0].z - c.z, 0.015, 1e-9); near(r.moves[0].x, c.x, 1e-9); near(r.moves[0].y, c.y, 1e-9);
  // a hand that moves across the knob's direction moves nothing
  r = K.update([tip(k, { pinch: true, z: k.z + 0.3, x: k.x + 0.5 })], [c], PLANE);
  assert.strictEqual(r.moves.length, 0);
});

test('only a pinch that starts at a knob takes it; one that starts elsewhere and moves onto it takes nothing; a second hand cannot take it while it is held', () => {
  const K = new CamKnobs(), c = cam(), k = knob(K, [c], 'along');
  assert.strictEqual(K.update([tip(k, { pinch: true, x: k.x + 0.1 })], [c], PLANE).grabbed, false, '10 cm away');
  assert.strictEqual(K.update([tip(k, { pinch: true })], [c], PLANE).grabbed, false, 'the pinch was already on when it got there');
  K.update([tip(k)], [c], PLANE);                                                                // the pinch ends
  assert.strictEqual(K.update([tip(k, { pinch: true, x: k.x + 0.039 })], [c], PLANE).grabbed, true, '4 cm is within reach');
  const k2 = knob(K, [c], 'across');
  assert.strictEqual(K.update([tip(k, { pinch: true, x: k.x + 0.039 }), tip(k2, { id: 'l', pinch: true })], [c], PLANE).grabbed, false, 'the other hand finds it held');
  assert.strictEqual(K.held.axis, 'along');
});

test('a hand that tracking loses, and a camera that goes away, let go; cancel lets go of everything', () => {
  const c = cam();
  let K = new CamKnobs(), k = knob(K, [c], 'along');
  K.update([tip(k, { pinch: true })], [c], PLANE);
  K.update([tip(k, { pinch: true, x: k.x + 0.2 })], [c], PLANE);
  let r = K.update([], [c], PLANE);
  assert.ok(r.release && r.release.id === 'cam-1', 'the last place is asked for'); assert.strictEqual(K.held, null);
  K = new CamKnobs(); K.update([tip(k, { pinch: true })], [c], PLANE);
  r = K.update([tip(k, { pinch: true, x: k.x + 0.2 })], [], PLANE);
  assert.strictEqual(r.release, null); assert.strictEqual(K.held, null, 'the camera is gone: nothing to ask for');
  K = new CamKnobs(); K.update([tip(k, { pinch: true })], [c], PLANE); K.cancel();
  assert.strictEqual(K.held, null); assert.strictEqual(K.pose(c), c);
});

test('two cameras have three knobs each; a pinch takes the nearest', () => {
  const K = new CamKnobs(), a = cam(), b = Object.assign(cam(), { id: 'cam-2', x: -1, y: 2, yaw: 0.3 }), cams = [a, b];
  assert.strictEqual(K.knobs(cams).length, 6);
  const kb = K.knobs(cams).find((q) => q.id === 'cam-2' && q.axis === 'up');
  K.update([tip(kb, { pinch: true })], cams, PLANE);
  assert.deepStrictEqual(K.held, { id: 'cam-2', axis: 'up', pull: 0 });
});
