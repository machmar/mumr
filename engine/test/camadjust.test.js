// The webcam page's side of moving its camera from a headset (camadjust.js): a move keeps the point looked at, a new solution or a reset takes it back.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const { CamAdjust, PoseKeeper } = M.camadjust, C = M.cams;

const solved = () => ({ x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27, hfov: 1.0996, aspect: 1.7778 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('untouched, the pose is the solved one itself; nothing is moved until asked', () => {
  const a = new CamAdjust(), P = solved();
  assert.strictEqual(a.pose(null), null); assert.strictEqual(a.ask({ x: 1, y: 1, z: 1 }), false, 'no camera yet');
  assert.strictEqual(a.pose(P), P); assert.strictEqual(a.moved, false);
  assert.ok(a.aim && a.aim[2] === 0, 'the point it looks at is on the floor');
});

test('a move puts the camera at the new place, looking at the same point; field of view and aspect stay', () => {
  const a = new CamAdjust(), P = solved(); a.pose(P);
  const aim = a.aim.slice();
  assert.strictEqual(a.ask({ x: P.x + 0.3, y: P.y - 0.1, z: P.z + 0.2 }), true);
  const q = a.pose(P);
  near(q.x, P.x + 0.3, 1e-9); near(q.y, P.y - 0.1, 1e-9); near(q.z, P.z + 0.2, 1e-9);
  assert.strictEqual(q.hfov, P.hfov); assert.strictEqual(q.aspect, P.aspect);
  const again = C.aimPoint(q, 0);
  near(again[0], aim[0], 1e-9); near(again[1], aim[1], 1e-9);
  near(a.moved, Math.hypot(0.3, 0.1, 0.2), 1e-9);
  a.ask({ x: P.x, y: P.y, z: P.z });                                                          // asked back to exactly where it was: the same look
  const z = a.pose(P); near(z.yaw, P.yaw, 1e-9); near(z.pitch, P.pitch, 1e-9);
});

test('Reset, a new solution and the camera going away all take the hand\'s work back', () => {
  const a = new CamAdjust(), P = solved(); a.pose(P);
  a.ask({ x: P.x + 0.5, y: P.y, z: P.z });
  assert.ok(a.pose(P).x !== P.x);
  assert.strictEqual(a.ask({ reset: true }), true); assert.strictEqual(a.pose(P), P); assert.strictEqual(a.moved, false);
  a.ask({ x: P.x + 0.5, y: P.y, z: P.z });
  const P2 = Object.assign(solved(), { x: P.x + 0.1 });                                      // the spots were clicked again: a new solution
  assert.strictEqual(a.pose(P2), P2, 'the new solution is used as it is'); assert.strictEqual(a.moved, false);
  const aim2 = a.aim.slice(); a.ask({ x: P2.x, y: P2.y + 0.4, z: P2.z });
  assert.ok(C.aimPoint(a.pose(P2), 0).every((v, i) => Math.abs(v - aim2[i]) < 1e-9), 'and the point to look at is the new solution\'s');
  a.pose(null); assert.strictEqual(a.moved, false); assert.strictEqual(a.ask({ x: 1, y: 1, z: 1 }), false);
});

test('a solution that only wobbles by a millimetre is not a new one', () => {
  const a = new CamAdjust(), P = solved(); a.pose(P); a.ask({ x: P.x + 0.2, y: P.y, z: P.z });
  const q = a.pose(Object.assign({}, P, { x: P.x + 0.001, yaw: P.yaw + 0.0005 }));
  near(q.x, P.x + 0.2, 1e-9, 'still moved');
});

test('nonsense is not taken: not a number, or farther than a hand at a twentieth of its reach can have gone', () => {
  const a = new CamAdjust(), P = solved(); a.pose(P);
  for (const r of [{ x: NaN, y: 0, z: 0 }, { x: 1, y: 'a', z: 0 }, { x: P.x, y: P.y }, { x: P.x + 4, y: P.y, z: P.z }, null, {}]) assert.strictEqual(a.ask(r), false);
  assert.strictEqual(a.moved, false);
});

test('a camera that looks level has no floor point: it looks at the middle of the spots', () => {
  const a = new CamAdjust({ spots: () => [[0, 0], [3, 0], [0, 3]] }), P = Object.assign(solved(), { x: 5, y: 5, z: 1, yaw: Math.PI, pitch: 0 }); a.pose(P);
  assert.deepStrictEqual(a.aim, [1, 1, 0]);
  a.ask({ x: 5, y: 5, z: 1.5 }); const q = a.pose(P);
  const d = [1 - 5, 1 - 5, 0 - 1.5]; near(q.yaw, Math.atan2(d[1], d[0]), 1e-9); near(q.pitch, Math.atan2(d[2], Math.hypot(d[0], d[1])), 1e-9);
});

// ---- kept between launches
const memory = () => { const m = new Map(); return { m, get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) }; };

test('export and restore: the original pose and the hand\'s place come back, and Reset still goes back to the original', () => {
  const a = new CamAdjust(), P = solved(); assert.strictEqual(a.export(), null);
  a.pose(P); a.ask({ x: P.x + 0.2, y: P.y - 0.1, z: P.z + 0.1 });
  const e = JSON.parse(JSON.stringify(a.export()));
  const b = new CamAdjust(); assert.strictEqual(b.restore(e), true);
  // no live solution yet (nobody is lined up): the kept pose is used, place and all
  const q = b.pose(null); near(q.x, P.x + 0.2, 1e-3); near(q.y, P.y - 0.1, 1e-3); near(q.z, P.z + 0.1, 1e-3); near(b.moved, Math.hypot(0.2, 0.1, 0.1), 2e-3);
  const same = a.pose(P); near(q.yaw, same.yaw, 1e-3); near(q.pitch, same.pitch, 1e-3);
  assert.strictEqual(b.ask({ reset: true }), true, 'Reset works before any live solution');
  const o = b.pose(null); near(o.x, P.x, 1e-3); near(o.yaw, P.yaw, 1e-4); assert.strictEqual(b.moved, false);
  assert.strictEqual(b.export().place, null); near(b.export().solved.x, P.x, 1e-3);
});

test('a restored hand place stays when the live solution is near the kept one, and goes when it is far, as a new solution always did', () => {
  const P = solved(), mk = () => { const a = new CamAdjust({ keepNear: 0.15 }); a.pose(P); a.ask({ x: P.x + 0.2, y: P.y, z: P.z }); const b = new CamAdjust({ keepNear: 0.15 }); b.restore(a.export()); return b; };
  let b = mk(); const near1 = Object.assign({}, P, { x: P.x + 0.05, y: P.y - 0.04 });
  const q = b.pose(near1); near(q.x, P.x + 0.2, 1e-3, 'the hand\'s place'); assert.strictEqual(b.held, false); near(b.moved, Math.hypot(0.15, 0.04), 2e-3, 'measured from the new original');
  assert.strictEqual(b.ask({ reset: true }), true); assert.strictEqual(b.pose(near1), near1, 'Reset goes to the live original');
  b = mk(); const far = Object.assign({}, P, { x: P.x + 0.6 });
  assert.strictEqual(b.pose(far), far, 'a different room: the old place means nothing'); assert.strictEqual(b.moved, false);
  b = mk(); b.pose(near1); const wobble = Object.assign({}, near1, { x: near1.x + 0.08 }); near(b.pose(wobble).x, P.x + 0.2, 1e-3, 'and it stays through later small changes of the spots');
  assert.strictEqual(new CamAdjust().pose(null), null, 'without a restore nothing is held');
});

test('restore refuses what is not a kept pose', () => {
  const e = new CamAdjust(); const P = solved(); e.pose(P); e.ask({ x: P.x + 0.1, y: P.y, z: P.z }); const good = e.export();
  for (const bad of [null, undefined, {}, { solved: null }, { solved: Object.assign({}, good.solved, { x: NaN }) }, { solved: Object.assign({}, good.solved, { hfov: 4 }) }, { solved: Object.assign({}, good.solved, { aspect: 0 }) },
    { solved: good.solved, place: [1, 2], aim: [0, 0, 0] }, { solved: good.solved, place: [1, 2, 3], aim: null }, { solved: good.solved, place: [1, 'a', 3], aim: [0, 0, 0] }]) {
    const a = new CamAdjust(); assert.strictEqual(a.restore(bad), false, JSON.stringify(bad)); assert.strictEqual(a.pose(null), null);
  }
  assert.strictEqual(new CamAdjust().restore({ solved: good.solved, place: null }), true, 'no hand place is fine');
});

test('PoseKeeper: kept per camera, used from the start of the next launch, given up when the clicks change, and not used for another camera', () => {
  const st = memory(), P = solved(), KEY = 'cam.1280x720';
  // first launch: a camera, a live solution, a move by hand
  let adj = new CamAdjust({ keepNear: 0.15 }), k = new PoseKeeper(adj, st);
  assert.strictEqual(k.pose(false, KEY, 'sig1', null, 0), null, 'no picture: no pose'); assert.strictEqual(st.m.size, 0);
  assert.strictEqual(k.pose(true, KEY, 'sig1', P, 0), P); assert.ok(st.m.has(`${KEY}.pose`), 'the original is kept straight away');
  assert.strictEqual(st.get(`${KEY}.pose`).place, null);
  adj.ask({ x: P.x + 0.3, y: P.y, z: P.z });
  k.pose(true, KEY, 'sig1', P, 200); assert.strictEqual(st.get(`${KEY}.pose`).place, null, 'at most once a second');
  const q1 = k.pose(true, KEY, 'sig1', P, 1500); const d = st.get(`${KEY}.pose`);
  assert.ok(d.place && Math.abs(d.place[0] - (P.x + 0.3)) < 1e-3 && Math.abs(d.solved.x - P.x) < 1e-3, 'the place and the original are both there'); assert.strictEqual(d.sig, 'sig1');
  // the next launch: a new page, nobody lined up (no live solution)
  adj = new CamAdjust({ keepNear: 0.15 }); k = new PoseKeeper(adj, st);
  const q2 = k.pose(true, KEY, 'sig1', null, 0); assert.ok(q2, 'a pose from the start'); near(q2.x, q1.x, 1e-3); near(q2.yaw, q1.yaw, 1e-3); assert.strictEqual(k.restored, true);
  // Reset from a headset goes back to the kept original, and that is kept too
  assert.strictEqual(adj.ask({ reset: true }), true); near(k.pose(true, KEY, 'sig1', null, 2000).x, P.x, 1e-3); assert.strictEqual(st.get(`${KEY}.pose`).place, null);
  // another camera, or the same one at another size: nothing of it
  k = new PoseKeeper(new CamAdjust(), st);
  assert.strictEqual(k.pose(true, 'other.1280x720', 'sig1', null, 0), null); assert.strictEqual(k.pose(true, 'cam.640x480', 'sig1', null, 0), null);
  // the clicks (the sig) changed since: the kept pose is not used
  const a0 = new CamAdjust(); a0.pose(P); a0.ask({ x: P.x + 0.2, y: P.y, z: P.z }); st.set(`${KEY}.pose`, Object.assign({ v: 1, sig: 'sig1' }, a0.export()));
  k = new PoseKeeper(new CamAdjust(), st); assert.strictEqual(k.pose(true, KEY, 'sig2', null, 0), null, 'other clicks: not used');
  // and a live solution with the clicks changed while it ran takes the hand's work away
  adj = new CamAdjust({ keepNear: 0.15 }); k = new PoseKeeper(adj, st); k.pose(true, KEY, 'sig1', null, 0); assert.ok(adj.held);
  const r = k.pose(true, KEY, 'sig3', P, 10); assert.strictEqual(r, P); assert.strictEqual(adj.moved, false); assert.strictEqual(st.get(`${KEY}.pose`).sig, 'sig3');
  // the camera stops: nothing held, and a restart reads it again
  assert.strictEqual(k.pose(false, KEY, 'sig3', null, 20), null); assert.strictEqual(adj.solved, null);
  // corrupt storage is ignored
  st.m.set(`${KEY}.pose`, '{"v":1,"sig":"sig3","solved":{"x":"a"}}'); k = new PoseKeeper(new CamAdjust(), st); assert.strictEqual(k.pose(true, KEY, 'sig3', null, 0), null);
});
