// The referee (referee.js) on real physics with a pretend clock, pretend hands and a pretend server: a whole turn (roll, pull, put on top, the
// score), a fall (freeze, rewind, slow motion, the collapse finishing in real time), rounds and the end of the match.
const { test, before } = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const jolt = require('../../engine/client/physics-jolt.js');
const S = require('./spec.js');
const N = require('./net.js');
const { Referee } = require('./referee.js');
let ok = true;
before(async () => { try { await jolt.load(); } catch (e) { ok = false; } });
let made = [];
const t = (name, fn) => test(name, (c) => { if (!ok) return c.skip('jolt-physics is not installed'); try { return fn(); } finally { made.forEach((x) => x.tower && x.tower.destroy()); made = []; } });

function session(slots = [0, 1]) { return { peers: new Map(slots.map((s) => [s, {}])), events: [], doc: {}, emit(e) { this.events.push(e); } }; }
function referee(o = {}) {
  const sess = o.session || session(), ref = new Referee({ Engine: M.physics.JoltWorld, session: sess, seed: 11, size: o.size || 'normal', room: o.room || null });
  made.push(ref); ref.sess = sess; ref.clock = 0; return ref;
}
const DT = 1 / 90;
const drive = (ref, secs, hands = () => []) => { for (let i = 0; i < secs / DT; i++) { ref.clock += DT * 1000; ref.step(DT, ref.clock, hands(i * DT)); } };
const hand = (id, at, pinch, v) => ({ id, pinch, points: [{ name: 'thumb', x: at[0] - 0.004, y: at[1], z: at[2], v }, { name: 'index', x: at[0] + 0.004, y: at[1], z: at[2], v }, { name: 'palm', x: at[0], y: at[1], z: at[2] + 0.05 }] });
const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);

// pull an outer block i out sideways (it may be taken by its outer side: spec.js grabRule), carry it over the tower and put it on top
function pullAndPlace(ref, i) {
  const tw = ref.tower, b = tw.blocks[i].body, p0 = b.p.slice(), ac = S.qRot(b.q, [0, 1, 0]), c = S.toCommon(tw.place, [0, 0, 0]), sg = (p0[0] - c[0]) * ac[0] + (p0[1] - c[1]) * ac[1] < 0 ? -1 : 1;
  const h = ac.map((v) => v * sg), beyond = tw.d.W / 2 + 0.008, k = tw.d.k;
  const at = (d) => [p0[0] + h[0] * (d + beyond), p0[1] + h[1] * (d + beyond), p0[2]], sh = (p) => [p[0] + h[0] * beyond, p[1] + h[1] * beyond, p[2]];
  const level = tw.levels().top + 1, top = sh(S.toCommon(tw.place, [0, 0, tw.top() + (level + 0.5) * tw.d.H + 0.006 * k])), out = at(0.12 * k);
  const hi = [out[0], out[1], top[2] + 0.06 * k], over = [top[0], top[1], top[2] + 0.06 * k];
  const T = [4, 5.5, 7, 8]; const path = (s) => (s < T[0] ? at(Math.min(0.12 * k, 0.04 * k * s)) : s < T[1] ? lerp(out, hi, (s - T[0]) / 1.5) : s < T[2] ? lerp(hi, over, (s - T[1]) / 1.5) : lerp(over, top, Math.min(1, (s - T[2]) / 1)));
  drive(ref, 9.5, (s) => [hand('r', path(s), s > 0.2 && s < T[3] + 0.3)]);
}

t('the host boots in the lobby with the tower standing and its state in the document; Start game builds the match', () => {
  const ref = referee();
  assert.strictEqual(ref.rules.phase, 'lobby');
  assert.strictEqual(ref.sess.events.at(-1).k, 'jstate'); assert.strictEqual(ref.sess.events.at(-1).s.phase, 'lobby');
  assert.strictEqual(ref.pack().items.length, 55);
  assert.deepStrictEqual(ref.rules.s.tower, { full: 17, top: 17, topCount: 3 });
  assert.strictEqual(ref.command('round'), false, 'only from the end of a round');
  assert.strictEqual(ref.command('start'), true);
  assert.strictEqual(ref.rules.phase, 'roll'); assert.strictEqual(ref.rules.s.players.length, 2); assert.strictEqual(ref.sess.events.at(-1).s.phase, 'roll');
  assert.strictEqual(ref.command('size', { size: 'giant' }), false, 'the size is chosen in the lobby');
});

t('size and place are set in the lobby and the tower is built there: three sizes, three heights', () => {
  const ref = referee();
  for (const [size, h] of [['huge', 0.75], ['giant', 1.5], ['normal', 0.27]]) {
    assert.strictEqual(ref.command('size', { size }), true);
    assert.ok(Math.abs(ref.tower.d.height - h) < 1e-9); assert.strictEqual(ref.rules.s.size, size);
  }
  assert.strictEqual(ref.command('place', { x: 2, y: -1, yaw: 1 }), true);
  const pl = ref.rules.s.place;
  assert.deepStrictEqual([pl.x, pl.y, pl.yaw], [2, -1, 1], 'with no room in the way the tower goes where it was asked');
  assert.strictEqual(pl.arr.size, 'normal'); assert.deepStrictEqual(pl.arr.c, [-0.15, 0.78], 'and the furniture stands as usual');
  assert.ok(Math.abs(ref.tower.blocks[0].body.p[0] - 2) < 0.15, 'the tower stands where it was put');
  assert.strictEqual(ref.command('place', { x: NaN, y: 0, yaw: 0 }), false);
});

t('a turn: the die is rolled and read, a block of that colour is pulled and put on top, it is scored, and the next player rolls', () => {
  const ref = referee(); ref.command('start');
  drive(ref, 1);
  const tw = ref.tower, d = tw.die.body;
  // thrown on the tray, not down the dice tower: it does not count, the die is put back
  d.p = S.toCommon(tw.place, [tw.lay.die.at[0], tw.lay.die.at[1], tw.lay.console.top + 0.15]); d.q = [0.2, 0.4, 0.1, 0.89]; d.v = [0, 0, -1]; d.w = [8, 3, 6]; tw.world.wake(d);
  drive(ref, 3);
  assert.strictEqual(ref.rules.phase, 'roll', 'a die that did not come down the tower is not read');
  assert.ok(ref.rules.s.ticker.some((x) => /into the tower/.test(x)), 'the board says so');
  // let go over the dice tower's mouth: it comes down and out onto the tray, and is read
  const T = tw.lay.dtower;
  d.p = S.toCommon(tw.place, [T.c[0], T.c[1], T.base + T.H + T.D]); d.q = [0.2, 0.4, 0.1, 0.89]; d.v = [0, 0, -0.3]; d.w = [8, 3, 6]; tw.world.wake(d);
  drive(ref, 5);
  assert.strictEqual(ref.rules.phase, 'pull', `the die was read (${ref.rules.phase})`);
  const colour = ref.rules.s.roll;
  assert.strictEqual(colour, tw.dieRead().up.colour);
  // a block of that colour from a side slot of a level in the middle of the tower
  const i = tw.blocks.findIndex((b) => b.spec.colour === colour && b.spec.slot !== 1 && b.spec.level >= 5 && b.spec.level <= 12);
  assert.ok(i >= 0);
  const level = tw.restLevel[i];
  pullAndPlace(ref, i);
  assert.strictEqual(ref.rules.s.moves, 1, `the move was scored (${ref.rules.phase}, handled ${tw.handled})`);
  assert.strictEqual(ref.rules.phase, 'roll'); assert.strictEqual(ref.rules.player.slot, 1, 'the next player');
  assert.strictEqual(ref.rules.s.scores[0][0], level < 6 ? 2 : 1);
  assert.strictEqual(ref.rules.s.last.note, level < 6 ? 'from the bottom third' : 'clean');
  assert.strictEqual(ref.rules.s.tower.top, 18, 'a new level was started');
  assert.strictEqual(ref.rules.s.tower.topCount, 1);
  assert.strictEqual(ref.tower.fell(), null);
  assert.ok(tw.dieRead().onTray && !tw.dieRead().moved, 'the die is back on its tray');
});

t('a block of the wrong colour scores nothing; the move still counts', () => {
  const ref = referee(); ref.command('start'); drive(ref, 1);
  const tw = ref.tower; ref.rules.rolled(2);
  const i = tw.blocks.findIndex((b) => b.spec.colour !== 2 && b.spec.slot === 0 && b.spec.level >= 6 && b.spec.level <= 12);
  pullAndPlace(ref, i);
  assert.strictEqual(ref.rules.s.last.pts, 0); assert.strictEqual(ref.rules.s.last.note, 'the wrong colour'); assert.strictEqual(ref.rules.s.moves, 1);
});

t('the tower falls: frozen at the first block on the ground, rewound, slow motion, then it finishes falling in real time; -3 and the round is over', () => {
  const ref = referee(); ref.command('start'); drive(ref, 1);
  const tw = ref.tower, top = tw.blocks[52].body;
  top.v = [2, 1, 0]; tw.world.wake(top);
  const mid = S.toCommon(tw.place, [-0.2, 0, tw.top() + 0.1]), end = S.toCommon(tw.place, [0.2, 0, tw.top() + 0.1]);
  const modes = new Set(); let frozenPose = null, phases = new Set();
  for (let k = 0; k < 90 * 25 && ref.rules.phase !== 'round_end'; k++) {
    ref.clock += DT * 1000; const s = k * DT;
    ref.step(DT, ref.clock, s > 0.3 && s < 0.6 ? [hand('r', lerp(mid, end, (s - 0.3) / 0.15 > 1 ? 1 : (s - 0.3) / 0.15), false, [3 * Math.cos(tw.place.yaw), 3 * Math.sin(tw.place.yaw), 0])] : []);
    const p = ref.pack(); modes.add(p.mode); phases.add(ref.rules.phase);
    if (p.mode === N.MODE.frozen && !frozenPose) frozenPose = p.items.map((x) => x.p.slice());
    if (p.mode === N.MODE.frozen) assert.deepStrictEqual(p.items.map((x) => x.p), frozenPose, 'nothing moves while it is frozen');
  }
  assert.strictEqual(ref.rules.phase, 'round_end', [...phases].join(','));
  assert.ok([...modes].includes(N.MODE.frozen) && modes.has(N.MODE.rewind) && modes.has(N.MODE.slow) && modes.has(N.MODE.after), `modes ${[...modes]}`);
  assert.ok(['fall', 'replay', 'aftermath'].every((p) => phases.has(p)));
  assert.strictEqual(ref.rules.s.fall.by, 0); assert.strictEqual(ref.rules.s.scores[0][0], -3);
  assert.ok(ref.rules.s.fall.trail.length > 5, 'the trail of the block that toppled it');
  const down = tw.blocks.filter((b, i) => tw.restLevel[i] >= 1 && tw.low(b.body) < tw.top() + 0.01).length;
  assert.ok(down >= 1, `a block of the upper levels lies on the plinth (${down})`);
  assert.ok(ref.sess.events.filter((e) => e.k === 'jstate').length >= 6, 'every change went to the document');
});

t('skip ends the replay at once; the next round builds the tower again; three rounds end the match; New match goes back to the lobby', () => {
  const ref = referee(); ref.command('start');
  for (let round = 1; round <= 3; round++) {
    drive(ref, 0.5);
    const tw = ref.tower; tw.blocks[40].body.v = [1.5, 0, 0]; tw.world.wake(tw.blocks[40].body); tw.blocks[41].body.v = [1.5, 0.5, 0]; tw.world.wake(tw.blocks[41].body);
    const mid = S.toCommon(tw.place, [-0.2, 0, tw.top() + 0.1]), end = S.toCommon(tw.place, [0.2, 0, tw.top() + 0.1]);
    let k = 0;
    while (!['replay', 'fall'].includes(ref.rules.phase) && k < 90 * 10) { ref.clock += DT * 1000; ref.step(DT, ref.clock, k * DT < 0.3 ? [hand('r', lerp(mid, end, Math.min(1, k * DT / 0.15)), false, [3 * Math.cos(tw.place.yaw), 3 * Math.sin(tw.place.yaw), 0])] : []); k++; }
    assert.ok(['fall', 'replay'].includes(ref.rules.phase), `round ${round} fell`);
    assert.strictEqual(ref.command('skip'), true);
    drive(ref, 6);
    assert.strictEqual(ref.rules.phase, round < 3 ? 'round_end' : 'match_end', `end of round ${round}: ${ref.rules.phase}`);
    if (round < 3) { assert.strictEqual(ref.command('round'), true); assert.strictEqual(ref.rules.s.round, round + 1); assert.strictEqual(ref.rules.phase, 'roll'); }
  }
  assert.ok(ref.rules.s.winner.length >= 1);
  assert.strictEqual(ref.command('lobby'), true); assert.strictEqual(ref.rules.phase, 'lobby');
});

t('a staged game (the scene videos: JENGA_DEBUG) has blocks moved to the top and a tower that stands', () => {
  process.env.JENGA_DEBUG = '1';
  try {
    const ref = referee(); ref.command('start'); drive(ref, 0.5);
    assert.strictEqual(ref.command('stage', { moves: 8 }), true);
    drive(ref, 3);
    assert.strictEqual(ref.rules.phase, 'roll', 'it did not fall'); assert.strictEqual(ref.tower.fell(), null);
    const lv = ref.tower.levels(); assert.strictEqual(lv.top, 20, `eight blocks on top: levels 18 to 20 (${lv.top})`); assert.strictEqual(lv.topCount, 2);
    assert.strictEqual(ref.rules.s.moves, 8);
    assert.ok(ref.tower.blocks.every((b, i) => ref.tower.restLevel[i] >= 0), 'every block is in the tower');
  } finally { delete process.env.JENGA_DEBUG; }
});

t('a nudge (JENGA_DEBUG) moves the top levels of a standing tower', () => {
  process.env.JENGA_DEBUG = '1';
  try {
    const ref = referee(); ref.command('start'); drive(ref, 0.5);
    ref.command('stage', { moves: 4 }); drive(ref, 2);
    assert.strictEqual(ref.command('nudge', { v: 0.1 }), true);
    const top = ref.tower.levels().top, moved = ref.tower.blocks.filter((b) => ref.tower.restLevel[b.i] >= top - 2 && Math.hypot(b.body.v[0], b.body.v[1]) > 0.05);
    assert.ok(moved.length >= 3, `the top levels took the push (${moved.length})`);
  } finally { delete process.env.JENGA_DEBUG; }
});

t('the debug commands do nothing without JENGA_DEBUG', () => {
  const ref = referee(); ref.command('start'); delete process.env.JENGA_DEBUG;
  assert.strictEqual(ref.command('stage', { moves: 3 }), false); assert.strictEqual(ref.command('shove'), false); assert.strictEqual(ref.command('nudge'), false); assert.strictEqual(ref.command('setroll', { colour: 1 }), false);
});

// ---- the focus: the room's dim follows the game
function dimSession(settings = {}) { const s = session(); s.settings = settings; s.dims = []; s.dim = function (want) { this.dims.push(want); }; s.game = function (k) { return this.settings[k]; }; return s; }

t('the room dims with the game: as it is in the lobby, receding for a round, out at the fall and back after (the host asks the engine)', () => {
  process.env.JENGA_DEBUG = '1';
  try {
    const sess = dimSession(), ref = referee({ session: sess });
    drive(ref, 0.5);
    assert.deepStrictEqual([sess.dims[0].dark, sess.dims[0].mute], [0, 0], 'the first thing the host says: the room as it is (a host that came back must not leave a dark one)');
    ref.command('start'); drive(ref, 1);
    const roll = sess.dims.at(-1); assert.deepStrictEqual([roll.dark, roll.mute, roll.fade, roll.over], [0.4, 0.25, 2500, true], 'the room recedes for the die');
    ref.command('shove', { vx: 3 });
    for (let k = 0; k < 90 * 8 && !['fall', 'replay'].includes(ref.rules.phase); k++) drive(ref, DT);
    assert.ok(['fall', 'replay'].includes(ref.rules.phase)); drive(ref, 0.3);
    const fall = sess.dims.find((d) => d.fade === 150 && d.mute === 1); assert.ok(fall, 'the freeze: out in 150 ms');
    assert.ok(fall.dark >= 0.85 && sess.dims.indexOf(fall) > sess.dims.indexOf(roll));
    ref.command('skip'); drive(ref, 1);
    const after = sess.dims.at(-1); assert.strictEqual(ref.rules.phase, 'aftermath'); assert.ok(after.dark < fall.dark && after.dark > 0 && after.fade >= 3000, 'it comes back slowly');
    drive(ref, 6); assert.strictEqual(ref.rules.phase, 'round_end'); assert.ok(sess.dims.at(-1).dark <= 0.25);
    assert.ok(sess.dims.length < 14, `a few asks, not a stream (${sess.dims.length})`);
  } finally { delete process.env.JENGA_DEBUG; }
});

t('the Room dim setting is read from the shared settings: off keeps the room as it is, a change is answered at once', () => {
  const sess = dimSession({ dim: 0 }), ref = referee({ session: sess });
  ref.command('start'); drive(ref, 1.5);
  assert.ok(sess.dims.length >= 1 && sess.dims.every((d) => d.dark === 0 && d.mute === 0), 'off: the room stays as it is');
  sess.settings.dim = 2; drive(ref, 0.3);
  assert.deepStrictEqual([sess.dims.at(-1).dark, sess.dims.at(-1).mute], [0.4, 0.25]);
  sess.settings.dim = 1; drive(ref, 0.3);
  assert.deepStrictEqual([sess.dims.at(-1).dark, sess.dims.at(-1).mute], [0.2, 0.15], 'gentle: half');
});

t('a session with no dim (the other tests\' pretend one) is left alone', () => {
  const ref = referee(); ref.command('start'); drive(ref, 1); assert.strictEqual(ref.rules.phase, 'roll');
});

t('the furniture is arranged for the real room: put down by a wall, the console goes to the free side; a room that comes later re-arranges it between rounds', () => {
  const box = (l, x0, y0, x1, y1, h) => ({ l, v: false, p: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] });
  const wall = (x0, y0, x1, y1) => ({ l: 'wall', v: true, p: [[x0, y0, 0], [x1, y1, 0], [x1, y1, 2.4], [x0, y0, 2.4]] });
  const corridor = { planes: [box('floor', 0, 0, 5, 1.9, 0), wall(0, 0, 5, 0), wall(5, 0, 5, 1.9), wall(5, 1.9, 0, 1.9), wall(0, 1.9, 0, 0)] };
  let room = null;
  const ref = referee({ room: { local: () => room } });
  assert.strictEqual(ref.command('place', { x: 1.46, y: 1.1, yaw: 0, hx: 0.5, hy: 1.1 }), true);
  assert.ok(ref.rules.s.place.arr.v[1] > 0, 'no room: the console on the left');
  room = corridor; drive(ref, 0.05);
  assert.ok(ref.rules.s.place.arr.v[1] < 0, 'the room came: the wall on the left sends the console to the right');
  assert.strictEqual(ref.tower.realRoom, corridor, 'the tower\'s physics has the room');
  const table = S.furniture('normal', ref.rules.s.place).find((p) => p.l === 'table');
  assert.ok(table.p.every((q) => q[1] > 0.01 && q[1] < 1.89), 'the console\'s plane is inside the corridor');
  assert.strictEqual(ref.command('size', { size: 'huge' }), true);
  assert.strictEqual(ref.rules.s.place.arr.size, 'huge', 'a new size: arranged again');
  assert.ok(Math.abs(ref.rules.s.place.hx - 0.5) < 1e-9, 'for the same player');
});

t('the room\'s garden is planned by the host for the room round the game, kept in the document, and sent again only when it changes', () => {
  const box = (l, x0, y0, x1, y1, h) => ({ l, v: false, p: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] });
  const wall = (x0, y0, x1, y1) => ({ l: 'wall', v: true, p: [[x0, y0, 0], [x1, y1, 0], [x1, y1, 2.4], [x0, y0, 2.4]] });
  const room = { planes: [box('floor', 0, 0, 5.5, 4.2, 0), wall(0, 0, 5.5, 0), wall(5.5, 0, 5.5, 4.2), wall(5.5, 4.2, 0, 4.2), wall(0, 4.2, 0, 0), box('table', 4.4, 0.2, 5.3, 1.0, 0.75)] };
  const sess = session(), ref = referee({ session: sess, room: { local: () => room } });
  assert.strictEqual(ref.command('place', { x: 2.6, y: 2.4, yaw: 1.2, hx: 2.6, hy: 1.6 }), true);
  const sent = sess.events.filter((e) => e.k === 'jdeco');
  assert.ok(sent.length >= 1 && sent.at(-1).d.items.length > 0, 'a plan for the room went to the document');
  assert.ok(sent.at(-1).d.items.some((i) => i.kind === 'garden') && sent.at(-1).d.items.some((i) => i.kind === 'vase'), 'a garden at a wall, a vase on the table');
  sess.doc.jdeco = sent.at(-1).d;
  assert.strictEqual(ref.planDeco(), false, 'the same plan is not sent again (the garden would grow in again for nothing)');
  assert.strictEqual(ref.command('size', { size: 'huge' }), true);
  assert.ok(sess.events.filter((e) => e.k === 'jdeco').length > sent.length, 'another size, another arrangement: planned again');
});
