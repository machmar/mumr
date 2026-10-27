// The whole app with pretend headsets on the pretend server: the host (host.js) plays the game, two players press its shared board and see the
// same state, the bodies reach them as packets, a newcomer has the game at once, and a PC view watches.
const { test, before } = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const jolt = require('../../engine/client/physics-jolt.js');
const { Hub } = require('../../engine/test/hubfake.js');
const L = require('./logic.js');
const S = require('./spec.js');
const N = require('./net.js');
const HOST = require('./host.js');
let ok = true;
before(async () => { try { await jolt.load(); } catch (e) { ok = false; } });
let refs = [];
const t = (name, fn) => test(name, async (c) => { if (!ok) return c.skip('jolt-physics is not installed'); try { return await fn(); } finally { refs.forEach((r) => r.tower && r.tower.destroy()); refs = []; } });

const OPTS = { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS };
function player(hub, name, frame = { x: 0, y: 0, yaw: 0, z: 0 }) {
  const sess = new M.session.Session(hub.link(name), OPTS), stream = new N.Stream(), sp = new M.align.Space(frame, 0);
  const body = new M.body.Body(sess, { token: 'jenga', type: 'jenga', policy: 'host', slowEvery: 0, adapter: N.pageAdapter(stream) });
  sess.link.onBin = (b) => { const p = M.wire.decode(b); if (p && p.name === 'jenga') body.receive(p, performance.now()); };
  sess.setLined({ dist: 3 });
  return { sess, stream, body, sp };
}
async function host(hub) {
  const sess = new M.session.Session(hub.link('host', 'host'), HOST.session), space = new M.align.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0);
  sess.setLined({ dist: 0, how: 'host' });
  const presence = new M.presence.Presence(sess, space), logs = [];
  const w = await HOST.setup({ M, session: sess, space, presence, room: null, life: (x) => logs.push(x) });
  sess.link.onBin = (b) => { const p = M.wire.decode(b); if (p && p.name === 'presence') presence.receive(p, 0); else w.bodies[0].receive(p, 0); };
  return { sess, w, logs };
}
const tick = (h, hub, n = 30, dt = 1 / 90) => { for (let i = 0; i < n; i++) { const now = performance.now(); h.w.bodies[0].frame(now, []); h.w.step(dt, now / 1000 + i * dt, []); h.w.bodies[0].send(now + 30 * i); hub.flush(); } };

t('a player presses Start on the shared board; the host starts the match; both players, a newcomer and the PC view have the same state', async () => {
  const hub = new Hub({ bodies: ['jenga'], owned: { 23: 'jenga' } });
  const h = await host(hub); hub.flush();
  h.sess.notify('first'); hub.flush();
  const a = player(hub, 'A'), b = player(hub, 'B'); hub.flush();
  tick(h, hub, 5);
  assert.strictEqual(a.sess.doc.jenga.phase, 'lobby'); assert.strictEqual(b.sess.doc.jenga.phase, 'lobby');
  assert.strictEqual(a.sess.holder('jenga'), 15, 'the host holds the bodies');
  const bd = L.board(a.sess.doc.jenga, { here: 2, game: a.sess.stateOf(null), mine: a.sess.stateOf(null) });
  assert.ok(bd.buttons.some((x) => x.id === 'start' && !x.off), 'Start is on the board');
  assert.ok(bd.buttons.some((x) => x.id === 'size' && !x.off) && bd.buttons.some((x) => x.id === 'place' && !x.off));
  a.body.ask('start', {}); hub.flush(); tick(h, hub, 10);
  for (const p of [a, b]) { assert.strictEqual(p.sess.doc.jenga.phase, 'roll'); assert.strictEqual(p.sess.doc.jenga.players.length, 2); assert.strictEqual(p.sess.doc.jenga.round, 1); }
  assert.strictEqual(JSON.stringify(a.sess.doc.jenga), JSON.stringify(b.sess.doc.jenga), 'the same for both');
  const late = player(hub, 'C'); hub.flush();
  assert.strictEqual(late.sess.doc.jenga.phase, 'roll', 'a newcomer has the game at once');
  const feed = new M.worldfeed.WorldFeed({ link: hub.link('view', 'viewer'), session: OPTS }); hub.flush();
  assert.strictEqual(feed.session.doc.jenga.round, 1, 'the PC view has it too');
});

t('the bodies reach the pages as packets and are drawn from the buffer; the packet has all 55', async () => {
  const hub = new Hub({ bodies: ['jenga'], owned: { 23: 'jenga' } });
  const h = await host(hub); hub.flush(); h.sess.notify('first');
  const a = player(hub, 'A'); hub.flush();
  tick(h, hub, 12);
  assert.ok(a.stream.count > 0, 'packets arrived');
  const d = a.stream.at(performance.now() + 1000);
  assert.strictEqual(d.items.length, 55);
  assert.ok(d.items.every((it) => it.p.every(Number.isFinite)));
});

t('the settings buttons: the music is one setting for everybody, the ghost fingers are each player\'s own', async () => {
  const hub = new Hub({ bodies: ['jenga'], owned: { 23: 'jenga' } });
  const a = player(hub, 'A'), b = player(hub, 'B'); hub.flush();
  a.sess.press(null, 'musicUp'); hub.flush();
  assert.strictEqual(a.sess.game('music'), 3); assert.strictEqual(b.sess.game('music'), 3, 'the room\'s music');
  a.sess.press(null, 'ghost'); hub.flush();
  assert.strictEqual(a.sess.stateOf(null).ghost, false); assert.strictEqual(b.sess.stateOf(null).ghost, true, 'a player\'s own');
  for (let k = 0; k < 6; k++) b.sess.press(null, 'musicDown'); hub.flush();
  assert.strictEqual(a.sess.game('music'), 0);
});

t('the board follows the phase: what can be pressed in the lobby, in a round, after a fall, at the end', () => {
  const base = { v: 1, size: 'normal', players: [{ slot: 0, name: 'Player 1' }, { slot: 1, name: 'Player 2' }], turn: 0, roll: null, round: 1, rounds: 3, moves: 0, scores: {}, ticker: [], handled: null, tower: { full: 17, top: 17, topCount: 3 } };
  const at = (phase, o = {}) => L.board(Object.assign({}, base, { phase }, o), { here: 2 });
  const ids = (lay) => lay.buttons.filter((b) => b.id && !b.off).map((b) => b.id);
  assert.ok(ids(at('lobby')).includes('start'));
  assert.ok(!ids(at('roll')).includes('start') && ids(at('roll')).includes('reroll') && !ids(at('roll')).includes('size') && !ids(at('roll')).includes('place'));
  assert.ok(!ids(at('pull', { handled: { i: 1 } })).includes('reroll'));
  assert.ok(ids(at('place')).includes('back'));
  assert.ok(ids(at('replay')).includes('skip'));
  assert.ok(ids(at('round_end')).includes('round') && ids(at('round_end')).includes('place'));
  assert.ok(ids(at('match_end')).includes('lobby'));
  assert.ok(at('roll').buttons.some((b) => /below level 18/.test(at('roll').title.note) || true));
  assert.strictEqual(at('roll').title.note, 'take from below level 18');
});
