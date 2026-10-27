// The Jolt-backed World (engine/client/physics-jolt.js) against the numbers physics.test.js holds the hand-made one to.
const { test, before } = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const jolt = require('../client/physics-jolt.js');
const P = M.physics;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const G = 9.81, H = 0.06;
const cube = (o = {}) => P.makeBox(Object.assign({ size: [0.12, 0.12, 0.12] }, o));
const plane = (l, v, p) => ({ l, v, p });
const tableRoom = () => ({ planes: [plane('table', false, [[1, 0, 0.7], [2, 0, 0.7], [2, 1, 0.7], [1, 1, 0.7]])] });
const wallRoom = () => ({ planes: [plane('wall', true, [[-3, 2, 0], [3, 2, 0], [3, 2, 2.4], [-3, 2, 2.4]])] });
const run = (W, secs, fn, fps = 72) => { const n = Math.round(secs * fps); for (let i = 0; i < n; i++) { W.step(1 / fps); if (fn) fn(i / fps); } };
let made = [];
const worldWith = (bodies, o) => { const W = new P.JoltWorld(o); made.push(W); bodies.forEach((b) => W.add(b)); return W; };
let ok = true;
before(async () => { try { await jolt.load(); } catch (e) { ok = false; } });
// (every world holds a few MB of the WebAssembly's memory: they are freed after each test)
const t = (name, fn) => test(name, (c) => { if (!ok) return c.skip('jolt-physics is not installed'); try { return fn(); } finally { made.forEach((W) => W.destroy()); made = []; } });

t('free fall from 1 m takes sqrt(2h/g) within 2%', () => {
  const b = cube({ p: [0, 0, 1.06] }), W = worldWith([b], { floor: false });
  let at = null; run(W, 1, (s) => { if (at === null && b.p[2] <= 0.06) at = s; }, 240);
  near(at, Math.sqrt(2 / G), Math.sqrt(2 / G) * 0.02, 'fall time');
});

t('a dropped cube rests on a face on the floor, and sleeps', () => {
  const b = cube({ p: [0, 0, 0.5] }), W = worldWith([b]);
  run(W, 3);
  near(b.p[2], H, 0.003, 'resting height'); assert.ok(b.asleep, 'asleep'); assert.deepStrictEqual(b.v, [0, 0, 0]);
});

t('a dropped cube bounces to about e squared of its drop height (e 0.45, within 10%)', () => {
  const b = cube({ p: [0, 0, 1 + H] }), W = worldWith([b]);
  let hit = false, apex = 0;
  run(W, 1.2, () => { if (b.v[2] > 0.5) hit = true; if (hit) apex = Math.max(apex, b.p[2] - H); }, 240);
  near(apex, 0.45 * 0.45, 0.45 * 0.45 * 0.1, 'first bounce apex');
});

t('it slides about v squared over 2 mu g and stops (2 m/s, mu 0.4, within 10%)', () => {
  const b = cube({ p: [0, 0, H] }); b.v = [2, 0, 0]; const W = worldWith([b]);
  run(W, 3);
  near(b.p[0], 4 / (2 * 0.4 * G), (4 / (2 * 0.4 * G)) * 0.1, 'slide distance');
  assert.ok(Math.hypot(...b.v) < 0.01, 'stopped'); near(b.p[2], H, 0.003, 'still flat');
});

t('a cube dropped on a corner spins after the hit and ends on a face', () => {
  const d3 = 1 / Math.sqrt(3), CORNER = P.quat.fromAxisAngle([-d3, d3, 0], Math.acos(-d3));
  const b = cube({ p: [0, 0, 0.5], q: P.quat.mul(P.quat.fromAxisAngle([1, 0.3, 0], 0.08), CORNER) }), W = worldWith([b]);
  let spin = 0; run(W, 4, () => { spin = Math.max(spin, Math.hypot(...b.w)); });
  assert.ok(spin > 1, `spin ${spin}`); near(b.p[2], H, 0.004, 'rests flat');
});

t('thrown at 10 m/s at a wall or down on a table it does not pass', () => {
  const b = cube({ p: [0, 1.5, 1] }); b.v = [0, 10, 0]; const W = worldWith([b], { room: wallRoom() });
  let far = -9; run(W, 1, () => { far = Math.max(far, b.p[1] + H); });
  assert.ok(far < 2.01, `reached ${far}`);
  const c = cube({ p: [1.5, 0.5, 1.5] }); c.v = [0, 0, -10]; const T = worldWith([c], { room: tableRoom() });
  run(T, 3); near(c.p[2], 0.7 + H, 0.01, 'on the table top');
  const d = cube({ p: [0.2, 0.5, 0.68] }); d.v = [10, 0, 0]; const S = worldWith([d], { room: tableRoom() });
  let reach = 0; run(S, 0.5, () => { reach = Math.max(reach, d.p[0] + H); });
  assert.ok(reach < 1.03, `through the table edge: ${reach}`);
});

t('a body written by the caller between steps is taken over (a packet puts it elsewhere)', () => {
  const b = cube({ p: [0, 0, H] }), W = worldWith([b]); run(W, 2); assert.ok(b.asleep);
  b.p = [1, 0, 0.5]; b.v = [0, 0, 0]; b.asleep = false; W.step(1 / 72);
  assert.ok(b.p[0] > 0.99 && b.p[2] < 0.5, `moved: ${b.p}`); run(W, 2); near(b.p[2], H, 0.003, 'fell to the floor there'); near(b.p[0], 1, 0.01);
});

t('bad numbers are put right, not passed on', () => {
  const b = cube({ p: [0, 0, 1] }), W = worldWith([b]);
  b.p = [NaN, 0, 1]; b.v = [Infinity, 0, 0]; b.q = [0, 0, 0, 0]; W.step(1 / 72);
  assert.ok(b.p.every(Number.isFinite) && b.v.every(Number.isFinite) && b.q.every(Number.isFinite) && b.w.every(Number.isFinite));
});

t('a stack of five stands and sleeps', () => {
  const s = Array.from({ length: 5 }, (_, i) => cube({ p: [0, 0, H + i * 0.12] })), W = worldWith(s);
  run(W, 4);
  s.forEach((b, i) => near(b.p[2], H + i * 0.12, 0.01, `box ${i}`));
  assert.ok(s.every((b) => b.asleep && Math.hypot(b.p[0], b.p[1]) < 0.01), 'asleep and in a column');
});

t('a pile of 50 dropped cubes settles, sleeps, has no cube inside another and costs under 2 ms a frame', () => {
  const bodies = Array.from({ length: 50 }, (_, i) => { const a = i * 2.4, r = 0.05 + 0.045 * (i % 7); return cube({ p: [Math.cos(a) * r, Math.sin(a) * r, H + 0.05 + i * 0.07] }); });
  const W = worldWith(bodies);
  const t0 = process.hrtime.bigint();
  run(W, 12);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / (72 * 12);
  assert.ok(bodies.every((b) => b.asleep), `still moving: ${bodies.filter((b) => !b.asleep).length}`);
  for (let i = 0; i < 50; i++) for (let j = i + 1; j < 50; j++) assert.ok(Math.hypot(...bodies[i].p.map((v, k) => v - bodies[j].p[k])) > 0.1, `${i} and ${j} are inside each other`);
  assert.ok(ms < 2, `${ms.toFixed(2)} ms per frame`);
});

t('a hold carries a cube along and turns it with the hand; release keeps its speed', () => {
  const b = cube({ p: [0, 0, 0.5] }), W = worldWith([b], { gravity: 0 });
  run(W, 1, (s) => { W.hold(b, { p: [0.5 * s, 0, 0.5], q: P.quat.fromAxisAngle([0, 0, 1], (Math.PI / 2) * s) }); });
  near(b.p[0], 0.5, 0.06, 'followed'); near(Math.abs(b.q[2]), Math.sin(Math.PI / 4), 0.1, 'turned with it');
  assert.strictEqual(W.hold(b, { p: [5, 0, 0.5], q: [0, 0, 0, 1] }), 'released');
  const c = cube({ p: [0, 0, 1] }), V = worldWith([c], { gravity: 0 });
  run(V, 0.5, (s) => { V.hold(c, { p: [2 * s, 0, 1], q: [0, 0, 0, 1], v: [2, 0, 0] }); }); V.release(c);
  const x = c.p[0]; run(V, 0.25);
  assert.ok(c.v[0] > 1.5, `kept its speed: ${c.v[0]}`); assert.ok(c.p[0] > x + 0.3, 'flew on');
});

t('a held cube does not sag under gravity, and stops at a wall', () => {
  const b = cube({ p: [0, 0, 1] }), W = worldWith([b]);
  run(W, 1, () => { W.hold(b, { p: [0, 0, 1], q: [0, 0, 0, 1] }); }); near(b.p[2], 1, 0.02, 'held in the air');
  const c = cube({ p: [0, 1.85, 1] }), V = worldWith([c], { room: wallRoom(), gravity: 0 });
  let far = 0; run(V, 1, () => { V.hold(c, { p: [0, 2.05, 1], q: [0, 0, 0, 1] }); far = Math.max(far, c.p[1] + H); });
  assert.ok(far < 2.02, `through the wall: ${far}`);
});

t('a fingertip pushes a resting cube; a pill across the palm too; far-away hands do nothing', () => {
  const b = cube({ p: [0.3, 0, H] }), W = worldWith([b]);
  for (let i = 0; i < 40; i++) { const x = 0.15 + i * 0.006; W.setHands([{ id: 'h', spheres: [{ p: [x - 0.08, 0, 0.06], q: [x, 0, 0.06], r: 0.025 }], plate: null }], i / 72); W.step(1 / 72); }
  assert.ok(b.p[0] > 0.3 + 0.02, `pushed: ${b.p[0]}`);
  const c = cube({ p: [0.3, 0, H] }), V = worldWith([c]);
  for (let i = 0; i < 72; i++) { V.setHands([{ id: 'h', spheres: [{ p: [-3, 0, 0.06], r: 0.012 }, { p: [NaN, 0, 0], r: 0.012 }], plate: null }], i / 72); V.step(1 / 72); }
  near(c.p[0], 0.3, 1e-4, 'not moved');
});

t('a flat hand (a plate) carries a cube on it', () => {
  const b = cube({ p: [0, 0, 0.8 + H] }), W = worldWith([b]);
  const plate = (x) => ({ centre: [x, 0, 0.8], normal: [0, 0, 1], axes: [[1, 0, 0], [0, 1, 0]], half: [0.09, 0.08] });
  run(W, 1.5, (s) => W.setHands([{ id: 'h', spheres: [], plate: plate(0.3 * s) }], s));
  near(b.p[2], 0.8 + H, 0.02, 'rides on the plate'); assert.ok(b.p[0] > 0.1, `carried: ${b.p[0]}`);
});

t('changing the room rebuilds it only when its numbers change, and wakes what rests', () => {
  const b = cube({ p: [1.5, 0.5, 0.2] }), W = worldWith([b]); run(W, 2); near(b.p[2], H, 0.003); assert.ok(b.asleep);
  W.setRoom(tableRoom()); assert.ok(!b.asleep, 'woken'); run(W, 1);
  const first = W._statics.slice(); W.setRoom(tableRoom()); assert.deepStrictEqual(W._statics, first, 'the same room: nothing rebuilt');
});

// Marek's run, 2026-10-26: a quick hand sent the cubes flying. Hand packets came at ~30/s with gaps up to 170 ms; the body must have the hand's own
// (smoothed) speed, not the speed of the jumps of its position, and a hand does not bounce a cube.
t('a hand whose packets come in bunches (gaps of 170 ms) sends a cube off at the hand\'s speed, not faster', () => {
  const TAU = 0.04, PREDICT = 0.05;
  for (const speed of [1, 1.5, 2.5]) for (const seed of [977, 1954, 2931]) {
    let rnd = seed; const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    const cube = cube_(); const W = worldWith([cube]);
    let next = 0, pkt = null, v = 0, peak = 0;
    for (let k = 0; k < 400; k++) {
      const now = k * 0.011;
      while (next <= now) {
        const px = -0.3 + speed * next, dt = pkt ? next - pkt.t : 0;
        if (pkt && dt > 0) v += ((px - pkt.x) / dt - v) * (1 - Math.exp(-dt / TAU));
        pkt = { t: next, x: px, at: now }; next += rand() < 0.08 ? 0.17 : 0.022 + rand() * 0.02;
      }
      const hx = pkt.x + v * Math.min(PREDICT, now - pkt.at);
      W.setHands([{ id: 'h', spheres: [0, 0.02, -0.02].map((y) => ({ p: [hx, y, 0.06], r: 0.012, v: [v, 0, 0] })), plate: null }], now);
      W.step(0.011); peak = Math.max(peak, cube.v[0]);
    }
    W.destroy(); made = made.filter((x) => x !== W);                      // (nine worlds in one test: freed as it goes)
    assert.ok(peak > speed * 0.85 && peak < speed * 1.1, `hand ${speed} m/s, packets ${seed}: the cube went ${peak.toFixed(2)} m/s`);
  }
});
function cube_() { return cube({ p: [0.5, 0, H] }); }

// ---- apps/jenga: a hold with a limited force, and solver knobs for a stack of small blocks
// a block of 15 x 25 x 75 mm (pine) under a load, as in a tower
const slab = (o = {}) => P.makeBox(Object.assign({ size: [0.075, 0.025, 0.015], density: 600, restitution: 0.1, friction: { s: 0.4, k: 0.4 } }, o));
const small = { sleepAfter: 0.4, sleepV: 0.02, substep: 1 / 240, slop: 0.0005, maxMove: 0.004, velocitySteps: 20, positionSteps: 6 };
function loaded() {                     // three slabs side by side with a 0.7 kg weight over all of them (the middle one is pulled), as in a tower
  const b = slab({ p: [0, 0, 0.0075] }), sides = [-0.025, 0.025].map((y) => slab({ p: [0, y, 0.0075], density: 20000 }));      // (heavy: they do not follow the load)
  const top = P.makeBox({ size: [0.075, 0.075, 0.03], density: 4000, friction: { s: 0.4, k: 0.4 }, p: [0, 0, 0.015 + 0.015] });
  const W = worldWith([b, top].concat(sides), small);
  run(W, 1, null, 60);
  return { b, top, W };
}
const pullTo = (W, b, force, secs = 3) => {
  let t = 0;
  run(W, secs, () => { t += 1 / 60; W.hold(b, { p: [b.p[0] * 0 + Math.min(0.1, 0.05 * t), 0, 0.0075], q: [0, 0, 0, 1], v: [0.05, 0, 0] }, { force, omega: 80, spring: 20, breakAway: 1 }); }, 60);
  W.release(b);
};

t('hold with a force: a block under a load is pulled out by a strong enough grip, and the load stays where it is', () => {
  const { b, top, W } = loaded(), top0 = top.p.slice();
  pullTo(W, b, 4);
  assert.ok(b.p[0] > 0.09, `the block came out (${b.p[0]})`);
  assert.ok(Math.abs(top.p[0] - top0[0]) < 0.01, `the load stayed (${top.p[0] - top0[0]})`);
});

t('hold with a force: a grip that is too weak gives instead of tearing (the block stays under the load)', () => {
  const { b, W } = loaded();
  pullTo(W, b, 0.2);
  assert.ok(b.p[0] < 0.01, `the block did not come out (${b.p[0]})`);
});

t('hold without a force is the velocity motor of before (an unloaded body is carried to the target)', () => {
  const b = slab({ p: [0, 0, 0.5] }), W = worldWith([b], small);
  run(W, 2, () => W.hold(b, { p: [0.3, 0, 0.5], q: [0, 0, 0, 1] }, { spring: 20, speed: 5, breakAway: 1 }), 60);
  near(b.p[0], 0.3, 0.01, 'carried');
});

t('solver knobs: a tower of 54 blocks stands still on 20 velocity and 6 position steps, and sleeps', () => {
  const L = 0.075, Wd = 0.025, Hh = 0.015, blocks = [];
  for (let lv = 0; lv < 18; lv++) for (let i = 0; i < 3; i++) {
    const along = lv % 2 === 0, off = (i - 1) * Wd;
    blocks.push(slab({ size: along ? [L, Wd, Hh] : [Wd, L, Hh], p: [along ? 0 : off, along ? off : 0, Hh / 2 + lv * Hh] }));
  }
  const W = worldWith(blocks, small);
  run(W, 6, null, 60);
  assert.ok(blocks.every((b) => b.asleep), 'asleep');
  const drift = Math.max(...blocks.map((b, i) => Math.hypot(b.p[0] - (Math.floor(i / 3) % 2 ? ((i % 3) - 1) * Wd : 0), b.p[1] - (Math.floor(i / 3) % 2 ? 0 : ((i % 3) - 1) * Wd))));
  assert.ok(drift < 0.004, `drift ${drift}`);
  near(blocks[53].p[2], Hh / 2 + 17 * Hh, 0.004, 'top block');
});
