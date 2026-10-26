const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const CAMS = M.cams, AL = M.align;

const GOOD = { id: 'cam-1', name: 'Laptop webcam', x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27, hfov: 1.0996, aspect: 1.7778 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('clean: a good camera comes back as it is (numbers to a tenth of a millimetre)', () => {
  const c = CAMS.clean(Object.assign({}, GOOD, { x: 3.2000001, yaw: 2.190000001 }));
  assert.deepStrictEqual(c, GOOD);
});

test('clean: the name is trimmed and squeezed, at most 40 characters, "Webcam" when there is none', () => {
  assert.strictEqual(CAMS.clean(Object.assign({}, GOOD, { name: '  Desk   cam ' })).name, 'Desk cam');
  assert.strictEqual(CAMS.clean(Object.assign({}, GOOD, { name: 'x'.repeat(60) })).name.length, 40);
  for (const bad of [undefined, null, '', '   ', 7, {}]) assert.strictEqual(CAMS.clean(Object.assign({}, GOOD, { name: bad })).name, 'Webcam');
});

test('clean: the angle is wrapped, the tilt and the field of view must make sense, anything that is not a number is refused', () => {
  assert.ok(Math.abs(CAMS.clean(Object.assign({}, GOOD, { yaw: GOOD.yaw + 4 * Math.PI })).yaw - GOOD.yaw) < 1e-3, 'turns are dropped');
  for (const bad of [{ id: '' }, { id: 'a b' }, { id: 'x'.repeat(41) }, { id: 5 }, { x: NaN }, { x: 'a' }, { x: 5000 }, { y: -5000 }, { z: 500 }, { z: -50 },
    { pitch: 2 }, { hfov: 0.01 }, { hfov: 3.5 }, { aspect: 0 }, { aspect: 20 }, { yaw: Infinity }, { yaw: null }]) {
    assert.strictEqual(CAMS.clean(Object.assign({}, GOOD, bad)), null, JSON.stringify(bad));
  }
  assert.strictEqual(CAMS.clean(null), null); assert.strictEqual(CAMS.clean('rubbish'), null); assert.strictEqual(CAMS.clean({}), null);
});

test('event: the cam+ event a page sends, from a camera and its id', () => {
  const e = CAMS.event(GOOD);
  assert.deepStrictEqual(e, Object.assign({ k: 'cam+' }, GOOD));
  assert.strictEqual(CAMS.event(Object.assign({}, GOOD, { x: NaN })), null);
});

test('toOwn: the same real camera is where it really is in every headset own frame (two headsets, two frames)', () => {
  const A = { x: 1, y: 2, yaw: 0.3, z: 0.065 }, B = { x: -0.5, y: 3, yaw: -2.1, z: 0.03 };
  const a = CAMS.toOwn(A, GOOD), b = CAMS.toOwn(B, GOOD);
  for (const [f, o] of [[A, a], [B, b]]) {
    const back = AL.toCommon(f, o.x, o.y);                                              // own -> common: the camera again
    near(back[0], GOOD.x, 1e-9, 'x'); near(back[1], GOOD.y, 1e-9, 'y');
    near(o.z - (f.z || 0), GOOD.z, 1e-9, 'height above the common floor');
    near(AL.yawToCommon(f, o.yaw), GOOD.yaw, 1e-9, 'heading');
    assert.strictEqual(o.pitch, GOOD.pitch); assert.strictEqual(o.id, GOOD.id); assert.strictEqual(o.name, GOOD.name);
    // a point one metre in front of the lens: the same real point from both headsets
    const ahead = [o.x + Math.cos(o.yaw), o.y + Math.sin(o.yaw)], c = AL.toCommon(f, ahead[0], ahead[1]);
    near(c[0], GOOD.x + Math.cos(GOOD.yaw), 1e-9, 'ahead x'); near(c[1], GOOD.y + Math.sin(GOOD.yaw), 1e-9, 'ahead y');
  }
  assert.deepStrictEqual(CAMS.toOwn(null, GOOD), null, 'no frame (not lined up): it cannot be placed');
});

test('others: every camera but the given one, in the order of the document; nothing from a document without cameras', () => {
  const doc = { cameras: { a: Object.assign({}, GOOD, { id: 'a' }), b: Object.assign({}, GOOD, { id: 'b' }), c: Object.assign({}, GOOD, { id: 'c' }) } };
  assert.deepStrictEqual(CAMS.others(doc, 'b').map((c) => c.id), ['a', 'c']);
  assert.deepStrictEqual(CAMS.others(doc, null).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(CAMS.others({}, 'x'), []); assert.deepStrictEqual(CAMS.others(null, 'x'), []);
});

test('same: a pose that has not moved (to a millimetre and a few hundredths of a degree) is not sent again', () => {
  assert.ok(CAMS.same(GOOD, Object.assign({}, GOOD, { x: GOOD.x + 0.0004, yaw: GOOD.yaw + 0.0002 })));
  for (const d of [{ x: GOOD.x + 0.003 }, { z: GOOD.z - 0.003 }, { yaw: GOOD.yaw + 0.002 }, { pitch: GOOD.pitch + 0.002 }, { hfov: GOOD.hfov + 0.002 }, { name: 'Other' }, { id: 'cam-2' }]) {
    assert.ok(!CAMS.same(GOOD, Object.assign({}, GOOD, d)), JSON.stringify(d));
  }
  assert.ok(!CAMS.same(null, GOOD)); assert.ok(!CAMS.same(GOOD, null));
});

test('MAX: how many cameras one world holds', () => { assert.strictEqual(CAMS.MAX, 8); });

test('a camera moved by hand keeps looking at the point it looked at: the same axis meets the floor at the same place', () => {
  const C = M.cams, c = { id: 'a', x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27 }, aim = C.aimPoint(c);
  assert.ok(aim, 'it looks down at the floor'); assert.strictEqual(aim[2], 0);
  assert.ok(Math.abs((aim[0] - c.x) * Math.sin(c.yaw) - (aim[1] - c.y) * Math.cos(c.yaw)) < 1e-9, 'on its line of sight');
  const same = C.lookAt([c.x, c.y, c.z], aim, c);                                      // not moved: nothing changes
  assert.ok(Math.abs(same.yaw - c.yaw) < 1e-9 && Math.abs(same.pitch - c.pitch) < 1e-9);
  for (const [dx, dy, dz] of [[0.3, 0, 0], [0, -0.4, 0], [0, 0, 0.5], [-0.2, 0.2, -0.3], [1.5, 1.5, 0.1]]) {
    const pos = [c.x + dx, c.y + dy, c.z + dz], look = C.lookAt(pos, aim, c), moved = Object.assign({}, c, { x: pos[0], y: pos[1], z: pos[2] }, look);
    const again = C.aimPoint(moved);
    assert.ok(again && Math.hypot(again[0] - aim[0], again[1] - aim[1]) < 1e-9, `still at the aim after ${dx},${dy},${dz}`);
  }
});

test('the aim point: none when the camera does not look down; the floor plane can be any height; the middle of the spots is the other choice', () => {
  const C = M.cams, c = { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 };
  assert.strictEqual(C.aimPoint(c), null, 'level');
  assert.strictEqual(C.aimPoint(Object.assign({}, c, { pitch: 0.3 })), null, 'looking up');
  assert.strictEqual(C.aimPoint(Object.assign({}, c, { z: 3, pitch: -0.021 })), null, 'lands 140 m away: not a point to look at');
  assert.strictEqual(C.aimPoint(Object.assign({}, c, { z: -1, pitch: -0.5 })), null, 'under the floor');
  assert.deepStrictEqual(C.aimPoint({ x: 0, y: 0, z: 1.5, yaw: 0, pitch: -Math.PI / 4 }, 0.5).map((v) => +v.toFixed(9)), [1, 0, 0.5], 'a floor 0.5 up');
  assert.deepStrictEqual(C.centre([[0, 0], [3, 0], [0, 3]]), [1, 1, 0]);
  assert.deepStrictEqual(C.centre([[0, 0], null, [2, 4], [NaN, 1]]), [1, 2, 0]);
  assert.strictEqual(C.centre([]), null);
  // without an aim, or on top of it, the camera keeps its look
  assert.deepStrictEqual(C.lookAt([0, 0, 1], null, c), { yaw: 0, pitch: 0 });
  assert.deepStrictEqual(C.lookAt([1, 1, 1], [1, 1, 1.02], { yaw: 0.7, pitch: -0.1 }), { yaw: 0.7, pitch: -0.1 });
  // straight above the aim: it looks straight down (clamped) and keeps its heading
  const down = C.lookAt([2, 2, 1], [2, 2, 0], { yaw: 0.7, pitch: -0.1 });
  assert.strictEqual(down.yaw, 0.7); assert.ok(down.pitch <= -1.49 && down.pitch >= -1.5);
});
