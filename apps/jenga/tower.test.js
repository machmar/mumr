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
