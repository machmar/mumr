// Jenga's logic (jenga.js): the tower stands, a block can be pushed out and put on top, the tower falls when it should and the game says
// so, the packet carries it to another page, a pinch carries a block, the host keeps the tower.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const { Hub } = require('../../engine/test/hubfake.js');
const J = require('./jenga.js');

const FR = 1 / 72;
// run the tower for secs from time t (s) with hands(t) -> sources; -> the time after
function run(tw, t, secs, hands, judged = []) {
  for (let f = 0; f < secs * 72; f++, t += FR) { const h = hands ? hands(t) : []; tw.step(FR, t, h); const e = tw.judge(t, h); if (e) judged.push(e); }
  return t;
}
const blk = (tw, l, k) => tw.blocks[l * 3 + k];
// a fingertip (a source with one point, of player `slot`) pushing block b out along its length from its - end at v m/s, for its length + 2 cm
function pusher(b, t0, v, slot) {
  const ax = M.physics.quat.rotate(b.body.q, [1, 0, 0]), c = b.body.p.slice(), dur = (J.L + 0.02) / v;
  return { dur, hands: (t) => { const d = -(J.L / 2 + 0.012) + Math.min(t - t0, dur) * v; return [{ id: 'f', slot, points: [{ name: 'index', x: c[0] + ax[0] * d, y: c[1] + ax[1] * d, z: c[2] }] }]; } };
}
const moved = (tw, skip, from) => Math.max(...tw.blocks.filter((b) => !skip.includes(b)).map((b) => Math.hypot(b.body.p[0] - from[b.i][0], b.body.p[1] - from[b.i][1], b.body.p[2] - from[b.i][2])));

test('a new tower stands still, and rests on the table under it', () => {
  const tw = new J.Tower();
  tw.room = { planes: [{ l: 'table', v: false, p: [[0.2, -0.5, 0.7], [1.0, -0.5, 0.7], [1.0, 0.5, 0.7], [0.2, 0.5, 0.7]] }] };
  tw.build({ x: 0.6, y: 0, yaw: 0.4 });
  assert.ok(Math.abs(tw.base.z - 0.7) < 1e-9, 'on the table');
  const from = tw.blocks.map((b) => b.body.p.slice()), judged = [];
  run(tw, 0, 3, null, judged);
  assert.ok(moved(tw, [], from) < 0.004, `nothing moved (${(moved(tw, [], from) * 1000).toFixed(1)} mm)`);
  assert.ok(!tw.moving(), 'all at rest');
  assert.deepStrictEqual(judged, [], 'and nothing happened in the game');
});

test('a finger pushes the middle block of a level out and the tower stands; a second block of that level brings it down', () => {
  const tw = new J.Tower(), judged = [];
  let t = run(tw, 0, 0.5);
  const from = tw.blocks.map((b) => b.body.p.slice()), a = blk(tw, 6, 1);
  let p = pusher(a, t, 0.05, 1);
  t = run(tw, t, p.dur + 1.5, p.hands, judged);
  assert.ok(Math.hypot(a.body.p[0] - from[a.i][0], a.body.p[1] - from[a.i][1]) > J.L * 0.7, 'the block came out');
  assert.ok(moved(tw, [a], from) < 0.02, `the others stayed (${(moved(tw, [a], from) * 1000).toFixed(1)} mm)`);
  assert.ok(!judged.some((e) => e.what === 'fell'), 'it did not fall');
  const b = blk(tw, 6, 0);
  p = pusher(b, t, 0.05, 2);
  t = run(tw, t, p.dur + 3, p.hands, judged);
  const fell = judged.find((e) => e.what === 'fell');
  assert.ok(fell, 'it fell');
  assert.strictEqual(fell.by, 2, 'and the last hand on it was player 3\'s');
});

test('a block taken from the middle and put on the top is a move by whoever held it', () => {
  const tw = new J.Tower(), judged = [];
  let t = run(tw, 0, 0.5);
  // (as if a hand had carried it there: player 1 held it, and it is put across the top level, on the next level up)
  const a = blk(tw, 8, 1), top = blk(tw, J.LEVELS - 1, 1);
  a.by = 0;
  a.body.p = [top.body.p[0], top.body.p[1], top.body.p[2] + J.T + 0.002];
  a.body.q = M.physics.quat.mul(top.body.q, M.physics.quat.fromAxisAngle([0, 0, 1], Math.PI / 2));
  tw.pw.wake(a.body);
  t = run(tw, t, 2, null, judged);
  assert.deepStrictEqual(judged.map((e) => [e.what, e.by, e.level]), [['move', 0, J.LEVELS]]);
  assert.ok(Math.abs(tw.peak - a.body.p[2]) < 0.002, 'the top is higher now');
});

test('a pinch takes a block off the top and carries it, and it turns with nothing else', () => {
  const tw = new J.Tower();
  let t = run(tw, 0, 0.3);
  const a = blk(tw, J.LEVELS - 1, 0), p0 = a.body.p.slice(), z = p0[2] + J.T / 2;
  const pinch = (dz) => [{ id: 'r', slot: 1, pinch: true, points: [{ name: 'thumb', x: p0[0], y: p0[1], z: z + dz }, { name: 'index', x: p0[0], y: p0[1], z: z + dz }] }];
  t = run(tw, t, 0.3, () => pinch(0));
  assert.ok(a.held, 'held');
  assert.strictEqual(a.holder, 1, 'by player 2');
  t = run(tw, t, 1, (tt) => pinch(Math.min(0.2, (tt - t) * 0.3)));
  assert.ok(a.body.p[2] > p0[2] + 0.15, `it came up with the hand (z ${a.body.p[2].toFixed(3)})`);
  assert.ok(blk(tw, J.LEVELS - 1, 1).body.p[2] < p0[2] + 0.005, 'the one next to it stayed');
});

test('the packet carries the tower to a page that does not simulate it: what moves, then all of it at rest', () => {
  const a = new J.Tower(), b = new J.Tower();
  a.build({ x: 1, y: 0.5, yaw: 1 });
  let t = run(a, 0, 0.3);
  // one block knocked off the top (the others still asleep)
  const k = blk(a, J.LEVELS - 1, 0);
  k.body.p[2] += 0.05; k.body.v = [0.5, 0, 0]; a.pw.wake(k.body);
  const moving = M.wire.decode(M.wire.encode('jenga', a.pack(), 1000));
  assert.ok(moving && moving.data[0] === 7, `only what moves, and six more (${moving && moving.data[0]})`);
  assert.ok(b.apply(moving.data, 1000));
  assert.ok(Math.abs(b.base.x - 1) < 1e-6 && Math.abs(b.base.yaw - 1) < 1e-6, 'the new tower\'s place came with it');
  assert.ok(Math.hypot(...k.body.p.map((v, i) => v - b.blocks[k.i].body.p[i])) < 1e-5, 'the pushed block is where it is there');
  run(a, t, 2);
  const still = M.wire.decode(M.wire.encode('jenga', a.pack(), 2000));
  assert.strictEqual(still.data[0], J.N, 'at rest: every block');
  b.apply(still.data, 2000);
  for (const x of a.blocks) assert.ok(Math.hypot(...x.body.p.map((v, i) => v - b.blocks[x.i].body.p[i])) < 1e-5);
  assert.strictEqual(M.wire.decode(M.wire.encode('jenga', [J.N + 1, 0, 0, 0, 0], 1)), null, 'a packet with too many blocks is not one');
});

test('the host keeps the tower: a player asks for a new one, the host builds it and the game starts with that player\'s turn', () => {
  const hub = new Hub({ bodies: [J.TOKEN], owned: { 23: J.TOKEN } }), la = hub.link('A'), lb = hub.link('B');
  const mk = (link) => new M.session.Session(link, J.SESSION);
  const sa = mk(la), sb = mk(lb);
  hub.flush();
  const lh = hub.link('host', 'host'), sh = mk(lh);
  hub.flush();
  for (const S of [sa, sb, sh]) S.setLined({ dist: 0, how: 'test' });
  hub.flush();
  hub.give(J.TOKEN, 15); hub.flush();
  assert.ok(sh.holds(J.TOKEN) && sa.hostHere, 'the host holds it');
  const tw = { a: new J.Tower(), b: new J.Tower(), h: new J.Tower() }, id = (s) => s;
  const body = { a: new M.body.Body(sa, { token: J.TOKEN, type: 'jenga', adapter: J.adapter(tw.a, sa, id) }), h: new M.body.Body(sh, { token: J.TOKEN, type: 'jenga', adapter: J.adapter(tw.h, sh, id) }) };
  J.wire(tw.h, sh);
  // a hand of A right on the tower does not take it from the host
  const finger = [{ id: 'l', points: [{ name: 'index', x: 0.6, y: 0, z: 0.1 }] }];
  body.a.frame(0, finger); hub.flush();
  assert.ok(sh.holds(J.TOKEN), 'still the host\'s');
  body.a.ask('build', { x: 2, y: 1, yaw: 0, by: sa.me }); hub.flush();
  assert.ok(Math.abs(tw.h.base.x - 2) < 1e-9, 'the host built it');
  assert.deepStrictEqual(J.game(sb), { round: 1, state: 'standing', by: null, moves: 0, turn: sa.me, last: null }, 'everybody has the new game');
  // its packet reaches the players' towers
  const pk = M.wire.decode(M.wire.encode('jenga', tw.h.pack(), 10));
  pk.slot = 15;
  assert.ok(body.a.receive(pk, 10));
  assert.ok(Math.abs(tw.a.base.x - 2) < 1e-6, 'and A draws it there');
  // a move by A gives the turn to B; a fall says who
  sh.emit(J.event(sh, 'move', sa.me)); hub.flush();
  assert.strictEqual(J.game(sa).turn, sb.me);
  sh.emit(J.event(sh, 'fell', sb.me)); hub.flush();
  assert.deepStrictEqual([J.game(sa).state, J.game(sa).by, J.game(sa).moves], ['fell', sb.me, 1]);
  const lay = J.menu(sa.stateOf(null), { game: J.game(sa), me: sa.me });
  assert.ok(lay.buttons.some((x) => x.id === 'build'));
});
