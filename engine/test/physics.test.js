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
  const W = new P.World({ gravity: 0, floor: false }), b = P.makeBox({ size: [0.12, 0.12, 0.12], p: [0, 0, 1], angularDamping: 0 });
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

// ---- rest, damping and sleep (task 3)
const upAxisTilt = (b) => { const up = [0, 1, 2].map((i) => P.quat.rotate(b.q, [i === 0, i === 1, i === 2].map(Number))[2]); return Math.acos(Math.min(1, Math.max(...up.map(Math.abs)))) * 180 / Math.PI; };

test('dropped on a corner it is lying on a face within 3 s, within 2 degrees', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.5], q: P.quat.mul(P.quat.fromAxisAngle([1, 0.3, 0], 0.08), CORNER_DOWN) }); W.add(b);
  run(W, b, 3);
  assert.ok(upAxisTilt(b) < 2, `tilt ${upAxisTilt(b)}`);
  near(b.p[2], H, 0.002, 'on its face');
});

test('it falls asleep within 2 s of settling and does not move after', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.3] }); W.add(b);
  run(W, b, 3);
  assert.strictEqual(b.asleep, true);
  const p0 = b.p.slice(); run(W, b, 1);
  assert.ok(Math.hypot(b.p[0] - p0[0], b.p[1] - p0[1], b.p[2] - p0[2]) < 0.001);
});

test('setRoom and wake bring a sleeping body back; a moving body never sleeps', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.3] }); W.add(b); run(W, b, 3);
  assert.strictEqual(b.asleep, true);
  W.setRoom(tableRoom()); assert.strictEqual(b.asleep, false);
  run(W, b, 3); assert.strictEqual(b.asleep, true);
  W.wake(b); assert.strictEqual(b.asleep, false);
  const m = cube({ p: [0, 0, H] }); m.v = [1, 0, 0]; const V = new P.World(); V.add(m); run(V, m, 0.4);
  assert.strictEqual(m.asleep, false);
});

test('a cube with its middle past a table edge tips off and rests on the floor', () => {
  const W = new P.World({ room: tableRoom() }), b = cube({ p: [2.04, 0.5, 0.7 + H] }); W.add(b);
  run(W, b, 3);
  near(b.p[2], H, 0.003, 'on the floor');
  assert.ok(upAxisTilt(b) < 2, 'on a face');
});

// ---- hands, hold, throw, the flat hand (task 4)
const frames = (W, secs, each) => { const n = Math.round(secs * 72); for (let i = 0; i < n; i++) { const t = i / 72; each(t, i); W.step(1 / 72); } };
const tip = (id, p, r = 0.012) => ({ id, spheres: [{ p, r }], plate: null });

test('a fingertip moving into a resting cube sets it moving at about the fingertip speed', () => {
  const W = new P.World(), b = cube({ p: [0, 0, H] }); W.add(b);
  frames(W, 0.4, (t) => W.setHands([tip('a', [-0.2 + t * 1, 0, H])], t));
  near(b.v[0], 1, 0.25, 'cube speed');
});

test('an off-centre push turns the cube', () => {
  const W = new P.World(), b = cube({ p: [0, 0, H] }); W.add(b);
  let spin = 0; frames(W, 0.4, (t) => { W.setHands([tip('a', [-0.2 + t * 1, 0.05, H])], t); spin = Math.max(spin, Math.abs(b.w[2])); });
  assert.ok(spin > 0.5, `spin ${spin}`);
});

test('a hand that jumps 5 m in one frame does not launch the cube, and a NaN hand is ignored', () => {
  const W = new P.World(), b = cube({ p: [0, 0, H] }); W.add(b);
  W.setHands([tip('a', [-5, 0, H])], 0); W.step(1 / 72);
  W.setHands([tip('a', [0, 0, H])], 1 / 72); W.step(1 / 72);
  assert.ok(Math.hypot(...b.v) < 4.6, `speed ${Math.hypot(...b.v)}`);
  const V = new P.World(), c = cube({ p: [0, 0, H] }); V.add(c);
  V.setHands([{ id: 'a', spheres: [{ p: [NaN, 0, H], r: 0.012 }, { p: [0, Infinity, 0], r: 0.012 }], plate: null }], 0); V.step(1 / 72);
  assert.ok(c.p.every(Number.isFinite) && c.v.every(Number.isFinite)); assert.ok(Math.hypot(...c.v) < 0.01 && Math.abs(c.p[0]) < 1e-3, 'unmoved');
});

test('a held cube follows a moving target and turns with it', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.5] }); W.add(b);
  frames(W, 1, (t) => { W.hold(b, { p: [0.5 * t, 0, 0.5], q: P.quat.fromAxisAngle([0, 0, 1], (Math.PI / 2) * t) }); });
  near(b.p[0], 0.5, 0.06, 'x'); near(b.p[2], 0.5, 0.03, 'z');
  const r = P.quat.rotate(b.q, [1, 0, 0]); near(Math.atan2(r[1], r[0]), Math.PI / 2, 0.1, 'turned a quarter');
});

test('a hold lets go beyond 0.3 m, and stays on its side of a wall', () => {
  const W = new P.World(), b = cube({ p: [0, 0, 0.5] }); W.add(b);
  assert.strictEqual(W.hold(b, { p: [0.1, 0, 0.5], q: [0, 0, 0, 1] }), 'holding');
  assert.strictEqual(W.hold(b, { p: [1, 0, 0.5], q: [0, 0, 0, 1] }), 'released');
  assert.strictEqual(b.held, null);
  const V = new P.World({ room: wallRoom() }), c = cube({ p: [0, 1.85, 1] }); V.add(c);
  let far = 0, state = ''; frames(V, 1, () => { state = V.hold(c, { p: [0, 2.05, 1], q: [0, 0, 0, 1] }); far = Math.max(far, c.p[1] + H); });
  assert.ok(far < 2.01, `through the wall: ${far}`); assert.strictEqual(state, 'holding');
});

test('release keeps the velocity of the hold, which is a throw', () => {
  const W = new P.World({ gravity: 0 }), b = cube({ p: [0, 0, 1] }); W.add(b);
  frames(W, 0.5, (t) => { W.hold(b, { p: [2 * t, 0, 1], q: [0, 0, 0, 1], v: [2, 0, 0] }); });
  W.release(b);
  const x0 = b.p[0]; near(b.v[0], 2, 0.2, 'throw speed'); frames(W, 0.5, () => {});
  near(b.p[0] - x0, 1, 0.15, 'it flew on');
});

test('a cube on a moving flat hand is carried; tilted past atan(mu) it slides off', () => {
  const plate = (cx, tilt) => { const n = [Math.sin(tilt), 0, Math.cos(tilt)], u = [Math.cos(tilt), 0, -Math.sin(tilt)]; return { centre: [cx, 0, 0.8], normal: n, axes: [u, [0, 1, 0]], half: [0.1, 0.09] }; };
  const W = new P.World(), b = cube({ p: [0, 0, 0.8 + H] }); W.add(b);
  frames(W, 1, (t) => W.setHands([{ id: 'h', spheres: [], plate: plate(0.3 * t, 0) }], t));
  near(b.p[0], 0.3, 0.06, 'carried'); near(b.p[2], 0.8 + H, 0.01, 'on the hand');
  const tilted = (deg) => { const th = (deg * Math.PI) / 180, V = new P.World(), c = cube({ p: [0, 0, 0.8 + H / Math.cos(th)], q: P.quat.fromAxisAngle([0, 1, 0], th) }); V.add(c);
    frames(V, 1.5, (t) => V.setHands([{ id: 'h', spheres: [], plate: plate(0, th) }], t)); return c.p[2]; };
  assert.ok(tilted(35) < 0.3, 'slid off at 35 degrees'); assert.ok(tilted(15) > 0.75, 'stays at 15 degrees');
});

test('handSpheres takes the points and joints of a source, plate takes a grab.js platform', () => {
  const s = P.handSpheres({ points: [{ name: 'index', x: 1, y: 2, z: 3 }, { name: 'bad', x: NaN, y: 0, z: 0 }], joints: [[4, 5, 6]] });
  assert.strictEqual(s.length, 3); assert.deepStrictEqual([s[0].p, s[2].p], [[1, 2, 3], [4, 5, 6]]); assert.ok(!s[1].p.every(Number.isFinite), 'a bad point stays, not finite'); assert.strictEqual(s[0].r, 0.012);
  const pl = P.plate({ palm: { cx: 1, cy: 2, z: 0.9, nx: 0, ny: 0, nz: 1, ang: 0, hx: 0.1, hy: 0.04 } });
  assert.deepStrictEqual(pl.centre, [1, 2, 0.9]); near(pl.axes[0][0], 1, 1e-9); near(pl.axes[1][1], 1, 1e-9); assert.deepStrictEqual(pl.half, [0.1, 0.04]);
  assert.strictEqual(P.plate({ palm: null }), null);
});

// ---- the final review's findings (2026-10-26)
const tableAt = (h) => ({ planes: [plane('table', false, [[1, 0, h], [2, 0, h], [2, 1, h], [1, 1, h]])] });

test('a huge or non-finite velocity or orientation does not hang the step and is put right', () => {
  for (const v of [[1e30, 0, 0], [Infinity, 0, 0], [NaN, 0, 0]]) {
    const W = new P.World(), b = cube({ p: [0, 0, 1] }); b.v = v; W.add(b);
    const t0 = Date.now(); W.step(1 / 72);
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
    assert.ok(b.p.every(Number.isFinite) && b.v.every(Number.isFinite) && Math.hypot(...b.v) <= 30.01, `v ${b.v}`);
  }
  for (const q of [[NaN, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 1e30]]) {
    const W = new P.World(), b = cube({ p: [0, 0, 1], q }); W.add(b); W.step(1 / 72);
    assert.ok(b.q.every(Number.isFinite) && Math.abs(Math.hypot(...b.q) - 1) < 1e-6, `q ${b.q}`);
  }
  const W = new P.World(), b = cube({ p: [0, 0, 1] }); W.add(b);
  assert.strictEqual(W.hold(b, { p: [0, 0, 1], q: [NaN, 0, 0, 1] }), 'released'); assert.strictEqual(b.held, null);
});

test('a hand point that is not finite for a frame does not change the speed of the others', () => {
  const W = new P.World(), b = cube({ p: [0, 0, H] }); W.add(b);
  const at = (bad) => [{ id: 'a', spheres: P.handSpheres({ points: [{ x: -0.074, y: 0.03, z: H }, { x: bad ? NaN : -0.074, y: -0.03, z: H }, { x: -0.074, y: 0, z: 0.02 }] }), plate: null }];
  assert.strictEqual(P.handSpheres({ points: [{ x: 1, y: 1, z: 1 }, { x: NaN, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }] }).length, 3, 'every point keeps its place');
  for (let k = 0; k < 20; k++) { W.setHands(at(k === 10), k / 72); W.step(1 / 72); }
  assert.ok(Math.hypot(...b.v) < 0.05 && Math.abs(b.p[0]) < 0.01, `kicked to ${b.v}`);
});

test('a table that rises, or appears around the cube, puts it on top and never leaves it in the slab', () => {
  const W = new P.World({ room: tableAt(0.7) }), b = cube({ p: [1.5, 0.5, 0.7 + H] }); W.add(b); run(W, b, 3);
  assert.strictEqual(b.asleep, true);
  W.setRoom(tableAt(0.735)); run(W, b, 2);                                                 // (a refined scan: 3.5 cm higher)
  near(b.p[2], 0.735 + H, 0.004, 'on the higher top');
  const V = new P.World({ room: tableAt(0.7) }), c = cube({ p: [1.5, 0.5, 0.68] }); V.add(c); run(V, c, 2);             // (its middle inside the slab, corners outside it)
  near(c.p[2], 0.7 + H, 0.004, 'put on the table');
});

test('the same drop twice ends the same way, and one cube with a hitch near a table costs little', () => {
  const drop = () => { const W = new P.World({ room: tableRoom() }), b = cube({ p: [1.2, 0.4, 0.5], q: P.quat.fromAxisAngle([1, 0.3, 0], 0.7) }); b.v = [0.8, 0.2, 0]; W.add(b); run(W, b, 3); return [b.p, b.q]; };
  assert.deepStrictEqual(drop(), drop());
  const W = new P.World({ room: tableRoom() }), b = cube({ p: [0.2, 0.5, 0.8] }); W.add(b); b.v = [8, 0, 0];
  const hands = [0, 1].map((h) => ({ id: `h${h}`, spheres: Array.from({ length: 60 }, (_, i) => ({ p: [0.9 + 0.01 * i, 0.5 + 0.2 * h, 0.8], r: 0.012 })), plate: null }));
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 72; k++) { W.setHands(hands, k / 72); W.step(1 / 72); if (k % 18 === 0) { b.p = [0.2, 0.5, 0.8]; b.v = [8, 0, 0]; W.wake(b); } }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 72;
  assert.ok(ms < 1.5, `${ms.toFixed(2)} ms per frame`);
});

// ---- boxes against boxes (the lab's piles and stacks)
const stackOf = (n, dx = 0) => Array.from({ length: n }, (_, i) => cube({ p: [dx * i, 0, H + i * 0.12] }));
const worldWith = (bodies, o) => { const W = new P.World(o); bodies.forEach((b) => W.add(b)); return W; };
const supported = (b, all) => b.p[2] < H + 0.004 || all.some((o) => o !== b && Math.abs(o.p[0] - b.p[0]) < 0.12 && Math.abs(o.p[1] - b.p[1]) < 0.12 && b.p[2] - o.p[2] > 0.114 && b.p[2] - o.p[2] < 0.126);

test('a cube dropped on another lands on it and both come to rest', () => {
  const a = cube({ p: [0, 0, H] }), b = cube({ p: [0.02, 0.01, 0.5] }), W = worldWith([a, b]);
  for (let i = 0; i < 240 * 4; i++) W.step(1 / 240);
  near(a.p[2], H, 0.003, 'the lower one stays'); near(b.p[2], 3 * H, 0.004, 'the upper one rests on it');
  assert.ok(a.asleep && b.asleep, 'both asleep');
});

test('a stack of five stands, and sleeps', () => {
  const s = stackOf(5), W = worldWith(s);
  for (let i = 0; i < 240 * 4; i++) W.step(1 / 240);
  s.forEach((b, i) => near(b.p[2], H + i * 0.12, 0.006, `box ${i}`));
  assert.ok(s.every((b) => b.asleep && Math.hypot(b.p[0], b.p[1]) < 0.01), 'asleep and still in a column');
});

test('two cubes thrown at each other bounce apart and keep the momentum', () => {
  const a = cube({ p: [-0.3, 0, 1] }), b = cube({ p: [0.3, 0, 1] }); a.v = [2, 0, 0]; b.v = [-2, 0, 0];
  const W = worldWith([a, b], { gravity: 0, floor: false });
  for (let i = 0; i < 120; i++) W.step(1 / 240);
  near(a.v[0], -0.9, 0.15, 'A bounced back'); near(b.v[0], 0.9, 0.15, 'B bounced back'); near(a.v[0] + b.v[0], 0, 0.05, 'momentum');
});

test('a cube that hits a sleeping stack wakes it, and nothing is left floating', () => {
  const s = stackOf(3), hit = cube({ p: [-1, 0, H] }); hit.v = [3, 0, 0];
  const W = worldWith(s.concat(hit));
  for (let i = 0; i < 240 * 3; i++) W.step(1 / 240);
  const all = s.concat(hit);
  assert.ok(all.every((b) => b.asleep), 'all asleep again');
  assert.ok(all.every((b) => supported(b, all)), `floating: ${all.map((b) => b.p.map((v) => v.toFixed(2)).join(',')).join(' | ')}`);
  assert.ok(Math.hypot(s[0].p[0], s[0].p[1]) > 0.01 || Math.hypot(s[2].p[0], s[2].p[1]) > 0.01, 'the stack was moved');
});

test('a pile of 30 dropped cubes settles, sleeps and has no cube inside another', () => {
  const bodies = Array.from({ length: 30 }, (_, i) => { const a = i * 2.4, r = 0.05 + 0.045 * (i % 7); return cube({ p: [Math.cos(a) * r, Math.sin(a) * r, H + 0.05 + i * 0.07] }); });
  const W = worldWith(bodies);
  const t0 = process.hrtime.bigint();
  for (let f = 0; f < 72 * 10; f++) W.step(1 / 72);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / (72 * 10);
  assert.ok(bodies.every((b) => b.asleep), `still moving: ${bodies.filter((b) => !b.asleep).length}`);
  for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) assert.ok(Math.hypot(...bodies[i].p.map((v, k) => v - bodies[j].p[k])) > 0.1, `${i} and ${j} are inside each other`);
  assert.ok(ms < 4, `${ms.toFixed(2)} ms per frame over 10 s`);
});
