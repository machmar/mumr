// The tower's physics world (tower.js) on Jolt, with pretend hands: it stands, a pinch pulls a block out of it under its weight and puts it on
// top, a push that is too hard brings it down and the first block on the ground is named, the die is read where it lies.
const { test, before } = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const jolt = require('../../engine/client/physics-jolt.js');
const S = require('./spec.js');
const { Tower } = require('./tower.js');
let ok = true;
before(async () => { try { await jolt.load(); } catch (e) { ok = false; } });
let made = [];
const t = (name, fn) => test(name, (c) => { if (!ok) return c.skip('jolt-physics is not installed'); try { return fn(); } finally { made.forEach((x) => x.destroy()); made = []; } });
const tower = (o = {}) => { const w = new Tower(Object.assign({ Engine: M.physics.JoltWorld, size: 'normal', seed: 3, place: { x: 1, y: 0.5, yaw: 0.4 } }, o)); made.push(w); return w; };

// a pretend hand: its pinch point (common frame), pinching or not
const hand = (id, at, pinch, v) => ({ id, pinch, points: [{ name: 'thumb', x: at[0] - 0.004, y: at[1], z: at[2], v }, { name: 'index', x: at[0] + 0.004, y: at[1], z: at[2], v }, { name: 'palm', x: at[0], y: at[1], z: at[2] + 0.05 }] });
const run = (w, secs, hands = () => [], fps = 60) => { for (let i = 0; i < secs * fps; i++) { w.t0 = (w.t0 || 0) + 1 / fps; w.step(1 / fps, w.t0, hands(i / fps)); } };
const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);

t('the tower stands: 54 blocks in 18 levels of three, asleep, the right heights for the three sizes', () => {
  for (const [size, h] of [['normal', 0.27], ['huge', 0.75], ['giant', 1.5]]) {
    const w = tower({ size });
    assert.ok(Math.abs(w.d.height - h) < 1e-9, `${size} height ${w.d.height}`);
    const lv = w.levels();
    assert.deepStrictEqual(lv.counts, Array(18).fill(3));
    assert.strictEqual(lv.full, 17); assert.strictEqual(lv.top, 17);
    run(w, 3);
    assert.ok(w.blocks.every((b) => b.body.asleep), `${size}: asleep`);
    const top = w.blocks[53].body.p[2], expect = w.lay.plinth.top + 17.5 * w.d.H;
    assert.ok(Math.abs(top - expect) < 0.006 * w.d.k, `${size}: top block ${top} vs ${expect}`);
    assert.strictEqual(w.fell(), null);
  }
});

t('a pinch pulls a block out from under the weight above it, the tower stands, and the block put on top is read as placed', () => {
  const w = tower(), lay = w.lay, i = 3 * 4 + 0;              // level 4 (along x), its first slot
  const b = w.blocks[i].body, p0 = b.p.slice();
  const heading = S.toCommon({ x: 0, y: 0, yaw: w.place.yaw }, [1, 0, 0]);       // the block lies along the tower's x, turned by the place's yaw
  const beyond = w.d.L / 2 + 0.012, out = (d) => [p0[0] + heading[0] * (d + beyond), p0[1] + heading[1] * (d + beyond), p0[2]];       // (the pinch is just outside the block's end: a hand comes from outside the tower)
  assert.strictEqual(w.handled, null);
  // the pinch closes on the block, pulls it 12 cm out in 3 s, and holds it there
  const pull = (s) => [hand('r', out(Math.min(0.12, 0.04 * s)), s > 0.2)];
  run(w, 4, pull);
  assert.strictEqual(w.handled, i, 'the block that is held and out is the pulled one');
  assert.ok(w.away(i).dist > 0.1, `it came out (${w.away(i).dist})`);
  assert.strictEqual(w.fell(), null, 'the tower still stands');
  const others = w.blocks.filter((o) => o.i !== i && o.i % 3 !== 99).map((o) => w.away(o.i).dist);
  assert.ok(Math.max(...others) < 0.02, `the rest hardly moved (${Math.max(...others)} m)`);
  assert.strictEqual(w.placed(), null, 'held: not placed');
  // carried to the top (level 18, over the middle of the tower): up beside the tower, over it, down, and let go
  const sh = (p) => [p[0] + heading[0] * beyond, p[1] + heading[1] * beyond, p[2]];         // (the hand holds the block by its end: the hand is a little beyond the block's middle)
  const topAt = sh(S.toCommon(w.place, [0, 0, w.lay.plinth.top + 18 * w.d.H + 0.012])), from = out(0.12);
  const high = [from[0], from[1], topAt[2] + 0.06], above = [topAt[0], topAt[1], topAt[2] + 0.06];
  const path = (s) => (s < 1.5 ? lerp(from, high, s / 1.5) : s < 3 ? lerp(high, above, (s - 1.5) / 1.5) : lerp(above, topAt, Math.min(1, (s - 3) / 1)));
  run(w, 5, (s) => [hand('r', path(s), s < 4.3)]);
  run(w, 2);
  assert.strictEqual(w.fell(), null, 'still standing after the block went on top');
  const pl = w.placed();
  assert.ok(pl && pl.ok, `placed (${JSON.stringify(pl)}; block at ${w.local(b.p).map((v) => v.toFixed(3))})`);
});

t('a hard push brings the tower down, and the first block on the ground is a block of a level above the first', () => {
  const w = tower({ size: 'normal' });
  const top = w.blocks[52].body;
  run(w, 0.5);
  top.v = [1.5, 0.7, 0]; w.world.wake(top);
  run(w, 0.5, () => [], 60);
  // a finger swept through the middle of the tower at 2 m/s
  const mid = S.toCommon(w.place, [-0.2, 0, w.top() + 0.1]), end = S.toCommon(w.place, [0.2, 0, w.top() + 0.1]);
  run(w, 1.2, (s) => [hand('r', lerp(mid, end, Math.min(1, s / 0.2)), false, [2 * Math.cos(w.place.yaw), 2 * Math.sin(w.place.yaw), 0])]);
  const f = w.fell();
  assert.ok(f, 'something hit the ground');
  assert.ok(w.restLevel[f.i] >= 1, `block ${f.i} from level ${w.restLevel[f.i]}`);
  assert.notStrictEqual(f.i, w.handled);
});

t('the die: read where it lies once it is still, with its colour and how far from flat it is; back on the tray with resetDie', () => {
  const w = tower();
  assert.strictEqual(w.dieRead().onTray, true);
  run(w, 0.5);
  const d = w.die.body;
  d.p = S.toCommon(w.place, [w.lay.tray.c[0], w.lay.tray.c[1], w.lay.console.top + 0.25]); d.q = [0.3, 0.5, 0.2, 0.78]; d.v = [0.3, 0, -1]; d.w = [9, 4, 7]; w.world.wake(d);
  run(w, 4);
  const r = w.dieRead();
  assert.ok(r.moved, 'it was thrown');
  assert.ok(r.rest > 0.5, `still for ${r.rest} s`);
  assert.ok(r.up.tilt < 8, `flat (${r.up.tilt} degrees)`);
  assert.ok(r.up.colour >= 0 && r.up.colour < 6);
  assert.ok(r.onTray, 'on the tray');
  w.resetDie(); run(w, 1);
  assert.ok(w.dieRead().onTray); assert.strictEqual(w.dieRead().moved, false);
});

// a pretend tracked hand with joints (its turn q: the hand's own x from the wrist to the middle knuckle, y across to the index knuckle)
const jhand = (id, at, pinch, q = [0, 0, 0, 1], open = 0.008) => {
  const x = S.qRot(q, [1, 0, 0]), y = S.qRot(q, [0, 1, 0]), o = (a, b) => [at[0] + x[0] * a + y[0] * b, at[1] + x[1] * a + y[1] * b, at[2] + x[2] * a + y[2] * b];
  const joints = Array.from({ length: 25 }, () => o(-0.05, 0)); joints[0] = o(-0.09, 0); joints[11] = o(-0.01, 0); joints[6] = o(-0.02, 0.02); joints[21] = o(-0.02, -0.025);
  const th = o(0, -open / 2), ix = o(0, open / 2); joints[4] = th; joints[9] = ix; joints[14] = o(0.07, 0); joints[19] = o(0.065, -0.02); joints[24] = o(0.05, -0.04);     // (an open hand: the other fingers out)
  const pts = [['thumb', th], ['index', ix], ['middle', joints[14]], ['ring', joints[19]], ['pinky', joints[24]], ['palm', o(-0.04, 0)]];
  return { id, pinch, joints, points: pts.map(([name, p]) => ({ name, x: p[0], y: p[1], z: p[2] })) };
};
const moved = (w, from) => Math.max(...w.blocks.map((b, i) => Math.hypot(...b.body.p.map((v, k) => v - from[i][k]))));
const poses = (w) => w.blocks.map((b) => b.body.p.slice());
const turnDeg = (a, b) => { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI; };

t('in play the tower is kept awake and stands still a while, and a fingertip sliding past it a few millimetres away moves nothing (Marek, 2026-10-28)', () => {
  for (const size of ['normal', 'huge']) {
    const w = tower({ size }); w.awake = true;
    const p0 = poses(w);
    run(w, 15);
    assert.ok(moved(w, p0) < 0.0015 * w.d.k, `${size}: it crept ${(moved(w, p0) * 1000).toFixed(2)} mm in 15 s`);
    assert.ok(w.blocks.every((b) => !b.body.asleep), `${size}: awake`);
    assert.strictEqual(w.moving(), 0, `${size}: nothing counts as moving`);
    const p1 = poses(w), b = w.blocks[27 + 1].body, c = w.local(b.p);            // level 9 lies along y: its face is at x = L/2
    for (const gap of [0.02, 0.006, 0.003]) {
      run(w, 4, (s) => { const p = S.toCommon(w.place, [w.d.L / 2 + gap + w.tun.tip, (s - 2) * 0.15, c[2]]); return [{ id: 'h', pinch: false, points: [{ name: 'index', x: p[0], y: p[1], z: p[2] }] }]; });
      assert.ok(moved(w, p1) < 0.001 * w.d.k, `${size}: a fingertip ${gap * 1000} mm away moved the tower ${(moved(w, p1) * 1000).toFixed(2)} mm`);
    }
    assert.strictEqual(w.fell(), null);
  }
});

t('a fingertip pressing hard on a block that is held by the tower stops at it: it does not drive blocks into each other', () => {
  const w = tower(); w.awake = true; run(w, 0.5);
  const i = 3 * 9 + 1, b = w.blocks[i].body, c = w.local(b.p), p0 = poses(w);      // the middle block of level 9 (along y), pushed at its end, 2 cm deeper than its face
  run(w, 2, (s) => { const p = S.toCommon(w.place, [c[0], w.d.L / 2 + w.tun.tip - Math.min(0.02, s * 0.04), c[2]]); return [{ id: 'h', pinch: false, points: [{ name: 'index', x: p[0], y: p[1], z: p[2] }] }]; });
  // whatever moved, no two blocks overlap by more than a millimetre (the corners of one in the other)
  let worst = 0;
  for (const A of w.blocks) for (const B of w.blocks) {
    if (A === B || Math.hypot(...M.physics.quat.rotate([0, 0, 0, 1], [A.body.p[0] - B.body.p[0], A.body.p[1] - B.body.p[1], A.body.p[2] - B.body.p[2]])) > w.d.L) continue;
    const h = A.body.size.map((v) => v / 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = M.physics.quat.rotate(A.body.q, [sx * h[0], sy * h[1], sz * h[2]]).map((v, k) => v + A.body.p[k]);
      const l = M.physics.quat.rotate(M.physics.quat.conj(B.body.q), corner.map((v, k) => v - B.body.p[k])), e = B.body.size.map((v) => v / 2);
      const inside = Math.min(e[0] - Math.abs(l[0]), e[1] - Math.abs(l[1]), e[2] - Math.abs(l[2]));
      if (inside > 0) worst = Math.max(worst, inside);
    }
  }
  assert.ok(worst < 0.001, `blocks overlap by ${(worst * 1000).toFixed(2)} mm`);
  assert.ok(moved(w, p0) > 0.001, 'the finger did push');
});

t('a block on the top level slid by a finger is not a pulled block; one pushed out of a level that may be taken is', () => {
  const w = tower(); w.awake = true; run(w, 0.5);
  const slide = (i, d) => { const b = w.blocks[i].body, l = w.local(b.p), ax = w.restLevel[i] % 2 === 0 ? [1, 0] : [0, 1]; b.p = S.toCommon(w.place, [l[0] + ax[0] * d, l[1] + ax[1] * d, l[2]]); w.world.wake(b.body || b); };
  slide(52, 0.6 * w.d.L); run(w, 1.5);                    // (as a finger slides it along its length)
  assert.ok(w.away(52).dist > 0.5 * w.d.L, `it moved out (${w.away(52).dist})`);
  assert.strictEqual(w.handled, null, 'a block of the top level, not held, is not a move');
  slide(52, -0.6 * w.d.L); run(w, 1); w.captureRest();
  slide(3 * 6 + 0, 0.6 * w.d.L); run(w, 1.5);            // (level 6 may be taken)
  assert.strictEqual(w.handled, 3 * 6 + 0, 'a block of a level that may be taken, pushed out, is the pulled one');
});

t('a pinch that drops for a moment keeps its block; one that opens lets go', () => {
  const w = tower(); w.awake = true; run(w, 0.5);
  const i = 3 * 4 + 0, b = w.blocks[i].body, p0 = b.p.slice(), hd = S.toCommon({ x: 0, y: 0, yaw: w.place.yaw }, [1, 0, 0]), beyond = w.d.L / 2 + 0.012;
  const out = (d) => [p0[0] + hd[0] * (d + beyond), p0[1] + hd[1] * (d + beyond), p0[2]];
  run(w, 3, (s) => [hand('r', out(Math.min(0.08, 0.04 * s)), s > 0.2 && !(s > 1.5 && s < 1.7))]);
  assert.strictEqual(w.heldBy(i), 'r', 'still held after the pinch dropped for 0.2 s');
  run(w, 0.5, () => [Object.assign(hand('r', out(0.08), false), { points: [{ name: 'thumb', x: out(0.08)[0], y: out(0.08)[1], z: out(0.08)[2] - 0.04 }, { name: 'index', x: out(0.08)[0], y: out(0.08)[1], z: out(0.08)[2] + 0.04 }] })]);
  assert.strictEqual(w.heldBy(i), null, 'the fingers opened: let go');
});

t('a held block keeps its turn while it comes out of the tower and turns with the hand once it is clear; the die always turns with the hand', () => {
  const w = tower(); w.awake = true; run(w, 0.5);
  const i = 3 * 4 + 0, b = w.blocks[i].body, p0 = b.p.slice(), q0 = b.q.slice(), hd = S.toCommon({ x: 0, y: 0, yaw: w.place.yaw }, [1, 0, 0]), beyond = w.d.L / 2 + 0.012;
  const out = (d) => [p0[0] + hd[0] * (d + beyond), p0[1] + hd[1] * (d + beyond), p0[2]];
  const yawQ = (a) => { const y = w.place.yaw + Math.PI + a; return [0, 0, Math.sin(y / 2), Math.cos(y / 2)]; };      // (the hand's fingers point away from the tower)
  // the hand twists by 30 degrees while the block is still in the tower: the block does not
  run(w, 1.5, (s) => [jhand('r', out(Math.min(0.02, 0.02 * s)), s > 0.2, yawQ(s > 0.6 ? 0.5 : 0))]);
  assert.strictEqual(w.heldBy(i), 'r');
  assert.ok(turnDeg(b.q, q0) < 5, `in the tower it kept its turn (${turnDeg(b.q, q0).toFixed(1)} degrees)`);
  // out, clear of the tower, the hand turns another 60 degrees: the block follows
  run(w, 3, (s) => [jhand('r', out(0.02 + Math.min(0.1, 0.05 * s)), true, yawQ(0.5))]);
  assert.ok(w.clear(i), 'clear of the tower');
  const qc = b.q.slice();
  run(w, 1.5, (s) => [jhand('r', out(0.12), true, yawQ(0.5 + Math.min(1, s) * (Math.PI / 3)))]);
  const turned = turnDeg(b.q, qc);
  assert.ok(turned > 45 && turned < 75, `it turned with the hand (${turned.toFixed(1)} degrees)`);
  // the die, taken from the tray and turned: it turns at once
  const d = w.die.body, at = d.p.slice(), dq = d.q.slice();
  run(w, 1.5, (s) => [jhand('l', [at[0], at[1], at[2] + 0.025], s > 0.1, yawQ(s > 0.4 ? 1.0 : 0))]);
  assert.strictEqual(w.heldBy(S.DIE), 'l');
  assert.ok(turnDeg(d.q, dq) > 40, `the die turned (${turnDeg(d.q, dq).toFixed(1)} degrees)`);
});

// the die let go over the dice tower's mouth, turned and spun a little (seed n)
const dropDie = (w, n = 1) => {
  const T = w.lay.dtower, d = w.die.body, r = S.rng(n * 7919 + 13), j = () => (r() - 0.5);
  d.p = S.toCommon(w.place, [T.c[0] + j() * T.A * 0.6, T.c[1] + j() * T.A * 0.6, T.base + T.H + T.D]); d.q = M.physics.quat.normalize([j(), j(), j(), 1]); d.v = [j() * 0.2, j() * 0.2, -0.3]; d.w = [j() * 8, j() * 8, j() * 8];
  w.world.wake(d); w.die.moved = true;
};
t('the dice tower: a die let go over its mouth falls down its planks and comes out onto the tray, every time (Marek, 2026-10-28)', () => {
  for (const size of ['normal', 'huge', 'giant']) {
    const w = tower({ size }); run(w, 0.5);
    const ups = new Set();
    for (let n = 1; n <= 12; n++) {
      w.resetDie(); run(w, 0.3); dropDie(w, n); run(w, 4);
      const r = w.dieRead();
      assert.ok(r.passed, `${size} #${n}: it came down the tower`);
      assert.ok(!r.inTower && r.onTray, `${size} #${n}: it is out, on the tray (${w.local(w.die.body.p).map((v) => v.toFixed(3))})`);
      assert.ok(r.rest > 0.5, `${size} #${n}: still`);
      ups.add(r.up.colour);
    }
    assert.ok(ups.size >= 4, `${size}: the tower mixes it (${ups.size} faces up in 12 drops)`);
    assert.strictEqual(w.fell(), null);
  }
});
