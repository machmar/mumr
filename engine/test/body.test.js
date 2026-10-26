// Bodies and presence with two pretend headsets whose own frames differ (a turn of 40 degrees, a shift, a floor 2 cm apart).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const { Hub } = require('./hubfake.js');
const W = M.wire, AL = M.align;

W.register({ type: 16, name: 'puck', token: 'puck',
  pack: (o) => { const b = new Uint8Array(16), d = new DataView(b.buffer); o.forEach((v, i) => d.setFloat32(i * 4, v, true)); return b; },
  unpack: (d) => (d.byteLength === 16 ? [0, 1, 2, 3].map((i) => d.getFloat32(i * 4, true)) : null) });
W.register({ type: 17, name: 'char', token: 'char:0',
  pack: (o) => { const b = new Uint8Array(8), d = new DataView(b.buffer); d.setFloat32(0, o[0], true); d.setFloat32(4, o[1], true); return b; },
  unpack: (d) => [d.getFloat32(0, true), d.getFloat32(4, true)] });

// A puck on the floor, simulated in the page's own floor plan; on the wire in the common frame.
function headset(hub, name, frame) {
  const S = new M.session.Session(hub.link(name), {});
  const space = new AL.Space(frame, 0);
  const puck = { x: 0, y: 0, vx: 0, vy: 0 }, done = [];
  const near = (hands, r) => hands.some((h) => h.points.some((p) => Math.hypot(p.x - puck.x, p.y - puck.y) <= r));
  const body = new M.body.Body(S, { token: 'puck', type: 'puck', adapter: {
    reach: (h) => near(h, 0.06), touching: (h) => near(h, 0.02),
    pack: () => { const c = space.toCommon([puck.x, puck.y]); const v = AL.toCommon({ x: 0, y: 0, yaw: frame.yaw }, puck.vx, puck.vy); return [c[0], c[1], v[0], v[1]]; },
    apply: (d) => { const o = space.fromCommon([d[0], d[1]]); const v = AL.fromCommon({ x: 0, y: 0, yaw: frame.yaw }, d[2], d[3]); Object.assign(puck, { x: o[0], y: o[1], vx: v[0], vy: v[1] }); },
    settle: () => {}, moving: () => Math.hypot(puck.vx, puck.vy) > 1e-3,
    do: (what, args, from) => { done.push([what, args, from]); if (what === 'place') { const o = space.fromCommon([args.x, args.y]); puck.x = o[0]; puck.y = o[1]; } },
  } });
  const presence = new M.presence.Presence(S, space);
  S.link.onBin = (b) => { const p = W.decode(b); if (!p) return; if (p.name === 'presence') presence.receive(p, h.now); else body.receive(p, h.now); };
  const h = { S, space, puck, body, presence, done, now: 0 };
  return h;
}
const hand = (x, y, z = 0.05) => ({ id: 'right', points: [{ name: 'index', x, y, z }] });
// a common-frame point as a headset sees it
const ownOf = (h, x, y) => h.space.fromCommon([x, y]);

function pair() {
  const hub = new Hub({ bodies: ['puck'], owned: { 16: 'puck' } });
  const a = headset(hub, 'A', { x: 0, y: 0, yaw: 0, z: 0 });
  const b = headset(hub, 'B', { x: 1, y: 0.5, yaw: 40 * Math.PI / 180, z: 0.02 });
  hub.flush();
  a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  // the puck at (0.5, 0.2) in the common frame on both
  for (const h of [a, b]) { const o = ownOf(h, 0.5, 0.2); h.puck.x = o[0]; h.puck.y = o[1]; }
  return { hub, a, b };
}

test('the token follows touch: B reaches, takes it at once, keeps it while touching, and A follows B\'s state', () => {
  const { hub, a, b } = pair();
  assert.deepStrictEqual([a.body.mine, b.body.mine], [true, false]);
  const t = ownOf(b, 0.53, 0.2);                           // B's fingertip 3 cm from the puck
  b.now = 1000; b.body.frame(b.now, [hand(t[0], t[1])]); hub.flush();
  assert.deepStrictEqual([a.body.mine, b.body.mine, b.body.stats.claims], [false, true, 1]);
  const on = ownOf(b, 0.51, 0.2);
  b.body.frame(1010, [hand(on[0], on[1])]); hub.flush();
  const at = ownOf(a, 0.5, 0.2);
  a.body.frame(1010, [hand(at[0], at[1])]); hub.flush();
  assert.strictEqual(b.body.mine, true, 'a hand is on it: A\'s claim is refused');
  // B pushes it; its state reaches A in A's own frame
  const o = ownOf(b, 0.7, 0.4); b.puck.x = o[0]; b.puck.y = o[1]; b.puck.vx = 0.3;
  assert.strictEqual(b.body.send(1100), true); hub.flush();
  const seen = a.space.toCommon([a.puck.x, a.puck.y]);
  assert.ok(Math.abs(seen[0] - 0.7) < 1e-5 && Math.abs(seen[1] - 0.4) < 1e-5, `${seen}`);
  assert.strictEqual(a.body.stats.applied, 1);
  assert.strictEqual(a.body.send(1100), false, 'only the holder sends');
  assert.strictEqual(b.body.send(1105), false, 'not more than 45 a second');
});

test('a page that is not lined up does not take the state of the holder (and does not break)', () => {
  const hub = new Hub({ bodies: ['puck'], owned: { 16: 'puck' } });
  const a = headset(hub, 'A', { x: 0, y: 0, yaw: 0, z: 0 }), b = headset(hub, 'B', { x: 1, y: 0.5, yaw: 0.7, z: 0 });
  hub.flush();
  a.S.setLined({ dist: 3 }); hub.flush();
  assert.strictEqual(b.body.receive(M.wire.decode(Object.assign(M.wire.encode('puck', [1, 2, 0, 0], 5), { 1: 0 })), 0), false);
  assert.strictEqual(b.body.stats.applied, 0);
});

test('a still body is sent slowly; nothing is sent when nobody can see it', () => {
  const { hub, a } = pair();
  assert.strictEqual(a.body.send(0), true);
  assert.strictEqual(a.body.send(100), false, 'still: every 250 ms');
  assert.strictEqual(a.body.send(260), true);
  const hub2 = new Hub({ bodies: ['puck'] });
  const lone = headset(hub2, 'L', { x: 0, y: 0, yaw: 0, z: 0 }); hub2.flush();
  lone.S.setLined({ dist: 3 }); hub2.flush();
  assert.strictEqual(lone.body.send(0), false, 'alone and not watched');
  void hub;
});

test('a request from a page that does not hold it is carried out by the holder, in the common frame', () => {
  const { hub, a, b } = pair();
  assert.strictEqual(b.body.ask('place', { x: 1, y: 1 }), 'sent'); hub.flush();
  assert.deepStrictEqual(a.done, [['place', { x: 1, y: 1 }, 1]]);
  assert.deepStrictEqual(b.done, []);
  assert.strictEqual(a.body.ask('kick', {}), 'local');
  assert.deepStrictEqual(a.done[1], ['kick', {}, 0]);
});

test('presence: B\'s hand reaches A in A\'s own coordinates, and counts in A\'s simulation', () => {
  const { hub, a, b } = pair();
  const t = ownOf(b, 0.2, -0.3);
  b.now = 50;
  assert.strictEqual(b.presence.send(50, [0, 0, 0, 1.7, 0], [hand(t[0], t[1], 0.12)]), true); hub.flush();
  a.now = 60;
  const all = a.presence.hands([hand(9, 9)], 60);
  assert.deepStrictEqual(all.map((s) => s.id), ['right', 'p1-right']);
  const p = all[1].points[0], c = a.space.toCommon([p.x, p.y, p.z]);
  assert.ok(Math.abs(c[0] - 0.2) < 0.002 && Math.abs(c[1] + 0.3) < 0.002, `${c}`);
  assert.ok(Math.abs(p.z - 0.10) < 0.002, `B's floor is 2 cm above the common one, A's is the common one: ${p.z}`);
  assert.deepStrictEqual(a.presence.hands([], 700).length, 0, 'too old');
  assert.strictEqual(a.S.peers.get(1).stale, false);
});

test('an owner\'s body: only its owner claims and keeps it', () => {
  const hub = new Hub({ owned: { 17: 'char:0' } });
  const sa = new M.session.Session(hub.link('A'), {}), sb = new M.session.Session(hub.link('B'), {});
  hub.flush();
  const ad = { reach: () => true, touching: () => true, pack: () => [1, 2], apply: () => true, do: () => true };
  const ca = new M.body.Body(sa, { token: 'char:0', type: 'char', adapter: ad, policy: 'owner', owner: 0 });
  const cb = new M.body.Body(sb, { token: 'char:0', type: 'char', adapter: ad, policy: 'owner', owner: 0 });
  ca.frame(0, []); cb.frame(0, []); hub.flush();
  ca.frame(20, []); hub.flush();                         // (busy from the frame after the grant)
  assert.deepStrictEqual([ca.mine, cb.mine, hub.busy['char:0']], [true, false, true]);
  cb.frame(500, []); hub.flush();
  assert.strictEqual(ca.mine, true);
});

test('policy host: while the host is here it holds the body and a page\'s touch does not take it; with no host the touch rules hold', () => {
  const hub = new Hub({ bodies: ['puck'], owned: { 16: 'puck' } });
  const mk = (S) => new M.body.Body(S, { token: 'puck', type: 'puck', policy: 'host', adapter: { reach: () => true, touching: () => true, pack: () => [0, 0, 0, 0], apply: () => true, settle: () => {}, do: () => true } });
  const SA = new M.session.Session(hub.link('A'), {}), a = mk(SA);
  hub.flush(); SA.setLined({ dist: 3 }); hub.flush();
  const SH = new M.session.Session(hub.link('host', 'host'), {}), h = mk(SH);
  hub.flush(); SH.setLined({ dist: 0, how: 'host' }); hub.flush();
  for (let i = 0; i < 3; i++) { a.frame(1000 + i * 10, []); h.frame(1000 + i * 10, []); hub.flush(); }
  assert.strictEqual(SA.holder('puck'), 15, 'the host holds it');
  assert.strictEqual(a.hosted(), true, 'the page only shows it');
  assert.strictEqual(h.hosted(), false, 'the host simulates it');
  a.frame(1100, [hand(0, 0)]); hub.flush();
  assert.strictEqual(SA.holder('puck'), 15, 'a touch on the page does not take it');
  hub.leave(15); hub.flush();
  assert.strictEqual(a.hosted(), false, 'no host: the page simulates');
  a.frame(1200, [hand(0, 0)]); hub.flush();
  assert.strictEqual(SA.holder('puck'), SA.me, 'and a touch takes it again');
});

test('presence: another player\'s hand speed comes from its own clock, smoothed, whenever its packets arrive; hands() carries it on', () => {
  const { hub, a, b } = pair();
  const send = (clock, x) => { b.S.link.sendBin(W.encode('presence', { head: [0, 0, 0, 1.6, 0], sources: [{ id: 'right', points: [{ name: 'index', x, y: 0, z: 0.1 }] }] }, clock)); };
  // 0.5 m/s by B's clock, a packet every 22 ms; they arrive at A all at once (a late bunch) or not at all (one dropped)
  for (let k = 0; k < 12; k++) { if (k !== 6) send(1000 + k * 22, k * 0.011); }
  hub.flush();
  const v = a.presence.players.get(b.S.me).sources[0].points[0].v;
  assert.ok(Math.abs(v[0] - 0.5) < 0.05, `0.5 m/s whatever the arrival (${v[0].toFixed(3)})`);
  const at = a.presence.players.get(b.S.me).at, h = a.presence.hands([], at + 20).find((s) => s.slot === b.S.me);
  assert.ok(Math.abs(h.points[0].x - (11 * 0.011 + 0.5 * 0.02)) < 0.002, 'carried on 20 ms along its speed');
  const late = a.presence.hands([], at + 400).find((s) => s.slot === b.S.me);
  assert.ok(Math.abs(late.points[0].x - (11 * 0.011 + 0.5 * M.presence.PREDICT)) < 0.002, 'for at most PREDICT');
  const r = a.presence.report(at), r2 = a.presence.report(at + 1000);
  assert.ok(r.length === 1 && r[0].gap >= 43, `the gap of the dropped one is seen (${r[0].gap} ms)`);
  assert.deepStrictEqual(r2, [], 'and it starts again');
});
