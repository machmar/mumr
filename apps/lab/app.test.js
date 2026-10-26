// The lab's logic (boxes.js): box-on-box contact, pushing, a pile coming to rest, the island's numbers, the drift probe, the menu.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const { Hub } = require('../../engine/test/hubfake.js');
const L = require('./boxes.js');

const settle = (w, secs, hands = []) => { for (let t = 0; t < secs; t += 1 / 72) w.step(1 / 72, t, hands); };
// a pretend fingertip: a single point source at (x, y, z)
const tip = (id, x, y, z) => ({ id, points: [{ name: 'index', x, y, z }] });

test('a box dropped on another stands on it', () => {
  const w = new L.World(2);
  w.boxes[0].x = 0; w.boxes[0].y = 0; w.boxes[1].x = 0.01; w.boxes[1].y = 0; w.boxes[1].z = 0.5;
  settle(w, 2);
  assert.ok(Math.abs(w.boxes[0].z - L.HALF) < 0.003, 'the lower one is on the floor');
  assert.ok(Math.abs(w.boxes[1].z - (L.HALF + L.SIZE)) < 0.005, `the upper one is on it (z ${w.boxes[1].z})`);
});

test('a stack stays up, and a push on the bottom box moves it away from under the others', () => {
  const w = new L.World(1);
  w.layout('stack', 3, [0, 0]);
  settle(w, 1);
  assert.ok(w.boxes.every((b, i) => Math.abs(b.z - (L.HALF + i * L.SIZE)) < 0.003), 'it stays as it was built');
  // a fingertip moves into the bottom box from the left at 1 m/s
  for (let i = 0; i < 40; i++) w.step(1 / 72, i / 72, [tip('h', -0.1 + i * 0.0139, 0, 0.06)]);
  assert.ok(w.boxes[0].x > 0.01, 'the bottom box was pushed');
});

test('a box pushed into another pushes it', () => {
  const w = new L.World(2);
  w.boxes[0].x = 0; w.boxes[0].y = 0; w.boxes[1].x = 0.2; w.boxes[1].y = 0;
  w.boxes[0].vx = 1;
  settle(w, 1);
  assert.ok(w.boxes[1].x > 0.2, 'the second box moved');
  assert.ok(Math.abs(w.boxes[1].x - w.boxes[0].x) >= L.SIZE - 0.005, 'and they do not overlap');
});

test('thirty boxes dropped into a heap come to rest, and none is inside another', () => {
  const w = new L.World(30);
  w.pw.budgetMs = 0;                                    // (the page lets a frame run slow when physics takes more than 6 ms; the test wants every step)
  w.layout('pile', 30, [0.5, 0]);
  settle(w, 12);
  assert.strictEqual(w.movingCount(), 0, 'all at rest');
  const B = w.boxes;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const inside = Math.abs(B[i].x - B[j].x) < L.SIZE - 0.02 && Math.abs(B[i].y - B[j].y) < L.SIZE - 0.02 && Math.abs(B[i].z - B[j].z) < L.SIZE - 0.02;
    assert.ok(!inside, `boxes ${i} and ${j} overlap`);
  }
  assert.ok(B.every((b) => b.z >= L.HALF - 0.003));
});

test('a pinch holds a box and carries it', () => {
  const w = new L.World(1);
  w.boxes[0].x = 0; w.boxes[0].y = 0;
  const pinch = (x, z, start) => ({ id: 'r', pinch: true, points: [{ name: 'thumb', x, y: 0, z }, { name: 'index', x, y: 0, z }] });
  for (let i = 0; i < 30; i++) w.step(1 / 72, i / 72, [pinch(0, 0.06)]);
  assert.ok(w.boxes[0].held, 'held');
  for (let i = 30; i < 90; i++) w.step(1 / 72, i / 72, [pinch(0, 0.06 + (i - 30) * 0.004)]);
  assert.ok(w.boxes[0].z > 0.15, `it came up with the hand (z ${w.boxes[0].z})`);
});

test('the island: three players-worth of packets, and the numbers it counts', () => {
  const hub = new Hub(), a = hub.link('A'), b = hub.link('B');
  const mk = (link) => new M.session.Session(link, { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS });
  mk(a); mk(b); hub.flush();
  const w = new L.World(1);
  w.layout('stack', L.ISLAND, [0.5, 0]);
  const watch = new L.Watch();
  assert.ok(watch.together(w));
  watch.frame(w, 1 / 72);
  w.boxes[2].x += 0.1;                                   // a box jumps 10 cm between two frames
  watch.frame(w, 1 / 72);
  assert.strictEqual(watch.report(w, 0, 0), null);
  const r = watch.report(w, 3, 1500);
  assert.strictEqual(r.jumps, 1);
  assert.strictEqual(r.handovers, 3);
  assert.strictEqual(r.together, true, '10 cm sideways is still a column');
  w.boxes[4].x += 0.3;
  assert.strictEqual(watch.together(w), false);
});

test('the island box: a packet round trip through the adapter', () => {
  const w1 = new L.World(1), w2 = new L.World(1);
  w1.layout('stack', L.ISLAND, [0.5, 0]); w2.layout('stack', L.ISLAND, [0.5, 0]);
  const a1 = L.adapter(w1, 3, (s) => s, () => true), a2 = L.adapter(w2, 3, (s) => s, () => true);
  w1.boxes[3].x = 0.9; w1.boxes[3].vz = 0.5; w1.boxes[3].z = 0.8;
  const spec = M.wire.spec('lab4'), data = spec.unpack(new DataView(spec.pack(a1.pack()).buffer));
  assert.ok(a2.apply(data, { first: true }));
  assert.ok(Math.abs(w2.boxes[3].x - 0.9) < 1e-5 && Math.abs(w2.boxes[3].vz - 0.5) < 1e-5);
  assert.strictEqual(a2.reach([tip('h', 0.9, 0, 0.8)]), true);
  assert.strictEqual(a2.reach([tip('h', 3, 3, 0.8)]), false);
  assert.strictEqual(L.adapter(w2, 3, (s) => s, () => false).reach([tip('h', 0.9, 0, 0.8)]), false, 'not touched outside the island');
});

test('drift: the first touch is the cross, later ones are measured against it', () => {
  const d = new L.Drift({ every: 60, hold: 1, window: 20, rounds: 3 }), id = (xy) => xy;
  d.start(0);
  const touch = (t0, x, y) => { let row = null; for (let t = t0; t < t0 + 3 && !row; t += 0.1) row = d.update(t, [{ id: 'r', x, y, z: 0.01 }], id); return row; };
  const r1 = touch(0, 1, 2);
  assert.ok(r1.first); assert.deepStrictEqual(r1.common, [1, 2]);
  assert.strictEqual(d.update(30, [], id), null, 'nothing is asked for between rounds');
  const r2 = touch(60, 1.03, 2.04);
  assert.strictEqual(r2.round, 2); assert.strictEqual(r2.mm, 50); assert.strictEqual(r2.dx, 30);
  assert.strictEqual(d.largest, 50);
  // a hand that keeps moving over the cross does not count; a missed round is recorded
  let moving = null;
  for (let t = 120; t < 150 && !moving; t += 0.1) moving = d.update(t, [{ id: 'r', x: 1 + t * 0.2, y: 2, z: 0.01 }], id);
  assert.ok(moving && moving.missed, 'missed');
  assert.strictEqual(d.on, false, 'three rounds are over');
});

test('drift: the other player\'s touch arrives as a document kind', () => {
  const hub = new Hub(), a = hub.link('A'), b = hub.link('B');
  const mk = (link) => new M.session.Session(link, { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS });
  const sa = mk(a), sb = mk(b);
  hub.flush();
  sa.emit({ k: 'drift', slot: sa.me, round: 2, x: 1.5, y: 2 }); hub.flush();
  assert.deepStrictEqual(sb.doc.drift[sa.me], { x: 1.5, y: 2, round: 2 });
});

test('perf: p50 and p95 of the frames in a window', () => {
  const p = new L.Perf(990);
  let r = null;
  for (let i = 0; i < 100; i++) r = p.add(i * 10 + 10, i < 95 ? 10 : 30, 2) || r;
  assert.ok(r && r.p50 === 10 && r.p95 === 30 && r.sim === 2);
});

test('the menu: the mode button cycles, the count only shows in the pile', () => {
  assert.strictEqual(L.press('mode', { mode: 'pile', n: 10 }).mode, 'island');
  assert.strictEqual(L.press('mode', { mode: 'drift', n: 10 }).mode, 'pile');
  assert.strictEqual(L.press('n', { mode: 'pile', n: 50 }).n, 10);
  assert.strictEqual(L.press('other', {}), null);
  const ids = (st) => L.menu(st, {}).buttons.map((x) => x.id);
  assert.ok(ids({ mode: 'pile', n: 10 }).includes('dropPile') && ids({ mode: 'pile', n: 10 }).includes('n'));
  assert.ok(ids({ mode: 'drift', n: 10 }).includes('driftStart') && !ids({ mode: 'drift', n: 10 }).includes('n'));
});

test('a box steered from the room model follows its target, and takes the others with it', () => {
  const w = new L.World(2);
  w.boxes[0].x = 0; w.boxes[0].y = 0; w.boxes[1].x = 0.3; w.boxes[1].y = 0;
  w.boxes[0].steer = [0.6, 0, 0.06];
  settle(w, 2);
  assert.ok(w.boxes[0].x > 0.4, `it went towards the target (x ${w.boxes[0].x})`);
  assert.ok(w.boxes[1].x > 0.3, 'and pushed the other one');
  w.boxes[0].steer = null;
  assert.ok(!w.boxes[0].held);
});

test('the windows: wrapped text, and a data line for each experiment', () => {
  assert.ok(L.wrap('a '.repeat(100).trim(), 20).every((l) => l.length <= 20));
  for (const mode of L.MODES) {
    const lay = L.description(mode);
    assert.ok(lay.buttons.length > 8 && lay.buttons.every((b) => b.left), mode);
    assert.ok(lay.buttons.some((b) => /passes/.test(b.label)), `${mode} says what passes`);
  }
  const drift = new L.Drift();
  const base = { perf: null, pile: { n: 10, moving: 0 }, island: { together: true, moving: 0, last: null, totals: { handovers: 0, jumps: 0, worst: 0, broken: 0 }, holders: ['nobody'] }, drift, nextIn: 0, me: 0, players: 1, lined: true, rtt: 1 };
  assert.ok(L.dataLines(Object.assign({ mode: 'pile' }, base, { perf: { fps: 72, p50: 13, p95: 15.2, sim: 0.5 } })).some((l) => /OVER/.test(l)));
  assert.ok(L.dataLines(Object.assign({ mode: 'island' }, base)).some((l) => /together/.test(l)));
  assert.ok(L.dataLines(Object.assign({ mode: 'drift' }, base)).some((l) => /not started/.test(l)));
  assert.ok(L.dataLayout(Object.assign({ mode: 'pile' }, base)).buttons.length > 3);
});

test('boxes turn: one dropped from a height tumbles, one thrown at a stack topples it, and a packet carries the turn', () => {
  const w = new L.World(1);
  w.pw.budgetMs = 0;
  w.layout('stack', 5, [0.5, 0]);
  settle(w, 1);
  assert.ok(L.World && w.boxes.every((b, i) => Math.abs(b.z - (L.HALF + i * L.SIZE)) < 0.004), 'the stack of five stands');
  const hit = w.boxes[0]; hit.x = -0.8; hit.z = L.HALF + 0.001; hit.vx = 3;                          // (the bottom box is shot at the stack's foot from the side; the one above it is lifted and dropped 2 cm off)
  w.boxes[1].z = 0.5; w.boxes[1].x = 0.5 + 0.02;
  settle(w, 4);
  const turned = w.boxes.filter((b) => Math.abs(w.drawn(b).q[3]) < 0.999).length;
  assert.ok(turned > 0 || w.boxes.some((b) => Math.hypot(b.x - 0.5, b.y) > 0.15), 'something was knocked about');
  const a1 = L.adapter(w, 2, (s) => s, () => true), w2 = new L.World(1);
  w2.layout('stack', 5, [0.5, 0]);
  w.boxes[2].body.q = M.physics.quat.fromAxisAngle([0, 0, 1], 0.7); w.boxes[2].body.w = [1, 2, 3];
  const spec = M.wire.spec('lab3'), data = spec.unpack(new DataView(spec.pack(a1.pack()).buffer));
  assert.strictEqual(spec.pack(a1.pack()).length, 56);
  assert.ok(L.adapter(w2, 2, (s) => s, () => true).apply(data, { first: true }));
  assert.ok(Math.abs(w2.boxes[2].body.q[2] - Math.sin(0.35)) < 1e-4 && Math.abs(w2.boxes[2].body.w[1] - 2) < 1e-5, 'orientation and spin arrive');
});

test('the pile is shared: one packet carries every box, another page takes it in, and anybody\'s hand near any box asks for it', () => {
  const w1 = new L.World(1), w2 = new L.World(10);
  w1.layout('pile', 20, [0.5, 0]);
  settle(w1, 0.5);
  w1.boxes[7].body.q = M.physics.quat.fromAxisAngle([0, 0, 1], 0.4); w1.boxes[7].vx = 0.3;
  const a1 = L.pileAdapter(w1, (s) => s, () => true), a2 = L.pileAdapter(w2, (s) => s, () => true);
  const spec = M.wire.spec('labpile'), bytes = M.wire.encode('labpile', a1.pack(), 1), p = M.wire.decode(bytes);
  assert.strictEqual(spec.token, 'pile');
  assert.strictEqual(bytes.length, 6 + (1 + 20 * 15) * 4, 'the first packet has every box (none has gone out yet)');
  const again = a1.pack();
  assert.strictEqual((again.length - 1) / 15, w1.boxes.filter((q) => w1.isMoving(q)).length, 'the next one only the boxes that move');
  assert.ok(p && a2.apply(p.data, { first: true }));
  assert.strictEqual(w2.boxes.length, 20, 'the other page has as many boxes as the holder');
  w1.boxes.forEach((b, i) => assert.ok(Math.hypot(b.x - w2.boxes[i].x, b.y - w2.boxes[i].y, b.z - w2.boxes[i].z) < 1e-5, `box ${i} is where the holder has it`));
  assert.ok(Math.abs(w2.boxes[7].body.q[2] - Math.sin(0.2)) < 1e-4 && Math.abs(w2.boxes[7].vx - 0.3) < 1e-5);
  const b = w2.boxes[12];
  assert.strictEqual(a2.reach([tip('h', b.x, b.y, b.z + L.HALF + 0.01)]), true, 'a hand at a box of the pile asks for it');
  assert.strictEqual(a2.reach([tip('h', 5, 5, 1)]), false);
  assert.strictEqual(L.pileAdapter(w2, (s) => s, () => false).reach([tip('h', b.x, b.y, b.z)]), false, 'not in another experiment');
  assert.strictEqual(spec.unpack(new DataView(new Uint8Array(12).buffer)), null, 'a short packet is refused');
});

test('a page the host feeds draws the boxes 50 ms behind, between two packets, and the requests reach the holder\'s world', () => {
  const host = new L.World(10), page = new L.World(10), hp = L.pileAdapter(host, (q) => q, () => true), a = L.pileAdapter(page, (q) => q, () => true);
  page.smooth = true;
  // the host's clock is 1000 ms behind ours; packets take 20 ms, one of them 60 ms (late)
  const send = (hostMs, transit, first) => a.apply(hp.pack(), { clock: hostMs, now: hostMs + 1000 + transit, first: !!first });
  host.boxes[3].x = 0; host.boxes[3].vx = 0; send(0, 20, true);
  host.boxes[3].x = 0.1; host.boxes[3].vx = 1; send(100, 20);
  host.boxes[3].x = 0.2; send(200, 60);
  page.show(1000 + 20 + 150 + 50);                                // (the host's 150 ms in ours (the quickest packet took 20 ms), drawn 50 ms behind)
  assert.ok(Math.abs(page.boxes[3].x - 0.15) < 1e-6, `between the packets: x ${page.boxes[3].x}`);
  assert.strictEqual(page.boxes[0].body.asleep, true, 'a box at rest at the host is at rest here');
  page.show(1000 + 20 + 230 + 50);
  assert.ok(Math.abs(page.boxes[3].x - 0.23) < 1e-6, `past the newest packet it goes on along its speed: x ${page.boxes[3].x}`);
  assert.strictEqual(page.movingCount(), 1, 'only the moving one counts as moving');
  // requests (body.ask) to the holder: steer a box, lay them out again
  const h = L.pileAdapter(host, (q) => q, () => true);
  assert.ok(h.do('steer', { i: 2, at: [1, 1, 0.3] }));
  assert.deepStrictEqual(host.boxes[2].steer, [1, 1, 0.3]);
  for (let i = 0; i < 72; i++) host.step(1 / 72, i / 72, []);
  assert.ok(Math.hypot(host.boxes[2].x - 1, host.boxes[2].y - 1) < 0.05, 'the steered box went there');
  h.do('steer', { i: 2, at: null });
  assert.strictEqual(host.boxes[2].steer, null, 'and let go');
  h.do('steer', { i: 2, at: [0, 0, 0.3] }); host.boxes[2].steerAt = Date.now() - 1000; host.step(1 / 72, 2, []);
  assert.strictEqual(host.boxes[2].steer, null, 'a steer with no word for half a second ends (its drop was lost)');
  assert.ok(h.do('layout', { kind: 'pile', n: 20, at: [0.4, 0.1] }));
  assert.strictEqual(host.boxes.length, 20);
  assert.strictEqual(h.do('layout', { kind: 'nonsense', n: 5 }), false);
});

test('the lab\'s hands are light: six shapes a tracked hand', () => {
  const w = new L.World(1), j = Array.from({ length: 25 }, () => [5, 5, 1]);
  w.step(1 / 72, 0, [{ id: 'h', joints: j, points: [] }]);
  assert.strictEqual(w.pw.kin.spheres.length, 6);
});

test('a box at rest is still sent now and then: the newest state of every box reaches a page within REST_EVERY', () => {
  const w = new L.World(5), a = L.pileAdapter(w, (q) => q, () => true);
  for (const b of w.boxes) b.body.asleep = true;
  a.pack();
  for (const b of w.boxes) b.sentAt = Date.now() - 1000;
  assert.strictEqual((a.pack().length - 1) / 15, 5);
  assert.strictEqual(a.pack().length, 1, 'right after, nothing at rest goes again');
});

// ---- the host module on Jolt (apps/lab/host.js): its setup loads the physics, the boxes are Jolt bodies, a hand pushes one
test('the lab host loads Jolt in its async setup and steps the pile with and without a hand', async () => {
  const HOST = require('./host.js'), hub = new Hub({ bodies: ['b1', 'b2', 'b3', 'b4', 'b5', 'pile'], owned: { 17: 'b1', 18: 'b2', 19: 'b3', 20: 'b4', 21: 'b5', 22: 'pile' } });
  const S = new M.session.Session(hub.link('host', 'host'), HOST.session), space = new M.align.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0);
  S.setLined({ dist: 0, how: 'host' });
  const lines = [], world = await HOST.setup({ M, session: S, space, presence: new M.presence.Presence(S, space), room: { local: () => null }, life: (s) => lines.push(s) });
  assert.strictEqual(world.bodies.length, 6);
  if (!lines.some((s) => /physics on Jolt/.test(s))) return;            // (jolt-physics is not installed: the built-in physics ran, which the other tests cover)
  const dt = 1 / 72;
  for (let k = 0; k < 72 * 3; k++) world.step(dt, k * dt, k > 72 ? [{ id: 'h', points: [{ name: 'index', x: 0.3 + (k - 72) * 0.002, y: 0, z: 0.05 }] }] : []);
  assert.ok(lines.every((s) => !/error|undefined|NaN/i.test(s)), lines.join(' | '));
});
