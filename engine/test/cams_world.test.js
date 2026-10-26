// The real cameras in the session's document (session.js: doc.cameras, kinds cam+ / cam-, owned by the page that made them): alone, between
// two headsets, from a webcam page (a viewer), for a newcomer, and what a bad event does. A request to move a camera reaches its owner only.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const { Hub } = require('./hubfake.js');
const { Session } = M.session, CAMS = M.cams, AL = M.align;

const CAM = { id: 'cam-1', name: 'Laptop webcam', x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27, hfov: 1.0996, aspect: 1.7778 };
const ev = (o) => CAMS.event(Object.assign({}, CAM, o));
function player(hub, name, role = 'player') { const s = new Session(hub.link(name, role), {}); s.cams = 0; s.asks = []; s.on('cam', () => s.cams++); s.on('ask', (key, m, from) => s.asks.push([key, m, from])); return s; }

test('alone: a camera is in the document at once, a newer one with the same id replaces it, cam- takes it away', () => {
  const S = new Session(null, {}), calls = []; S.on('cam', (id) => calls.push(id));
  assert.deepStrictEqual(S.doc.cameras, {});
  S.emit(ev());
  assert.deepStrictEqual(Object.keys(S.doc.cameras), ['cam-1']); assert.strictEqual(S.doc.cameras['cam-1'].name, 'Laptop webcam'); assert.strictEqual(calls.length, 1);
  S.emit(ev({ x: 4, name: 'Moved' }));
  assert.strictEqual(S.doc.cameras['cam-1'].x, 4); assert.strictEqual(S.doc.cameras['cam-1'].name, 'Moved'); assert.strictEqual(Object.keys(S.doc.cameras).length, 1);
  S.emit(ev({ id: 'cam-2' })); assert.strictEqual(Object.keys(S.doc.cameras).length, 2);
  S.emit({ k: 'cam-', id: 'cam-1' }); assert.deepStrictEqual(Object.keys(S.doc.cameras), ['cam-2']);
  S.emit({ k: 'cam-', id: 'nobody' }); assert.strictEqual(calls.length, 4, 'taking away a camera that is not there says nothing');
});

test('events that are not whole cameras change nothing; the ninth camera is refused, a new pose of a known one is not', () => {
  const S = new Session(null, {});
  for (const bad of [{ k: 'cam+' }, { k: 'cam+', id: 'a' }, Object.assign({ k: 'cam+' }, CAM, { x: NaN }), Object.assign({ k: 'cam+' }, CAM, { id: 'bad id' }), { k: 'cam-' }, { k: 'cam-', id: 5 }]) S.emit(bad);
  assert.deepStrictEqual(S.doc.cameras, {});
  for (let i = 0; i < CAMS.MAX; i++) S.emit(ev({ id: `c${i}` }));
  assert.strictEqual(Object.keys(S.doc.cameras).length, CAMS.MAX);
  S.emit(ev({ id: 'one-too-many' })); assert.strictEqual(Object.keys(S.doc.cameras).length, CAMS.MAX); assert.ok(!S.doc.cameras['one-too-many']);
  S.emit(ev({ id: 'c3', x: 9 })); assert.strictEqual(S.doc.cameras.c3.x, 9);
});

test('two headsets: a camera that one player announces is in both documents, in the same order, and each places it in its own frame', () => {
  const hub = new Hub(), A = player(hub, 'A'), B = player(hub, 'B');
  hub.flush(); A.cams = B.cams = 0;
  A.emit(ev()); hub.flush();
  for (const P of [A, B]) assert.deepStrictEqual(Object.keys(P.doc.cameras), ['cam-1']);
  assert.deepStrictEqual([A.cams, B.cams], [1, 1]);
  assert.strictEqual(B.doc.cameras['cam-1'].owner, A.me, 'who made it is known');
  assert.strictEqual(B.ownerOf('cam:cam-1'), A.me);
  const FA = { x: 1, y: 2, yaw: 0.3, z: 0.065 }, FB = { x: -0.5, y: 3, yaw: -2.1, z: 0.03 };
  for (const [P, f] of [[A, FA], [B, FB]]) {
    const o = CAMS.toOwn(f, P.doc.cameras['cam-1']), back = AL.toCommon(f, o.x, o.y);
    assert.ok(Math.abs(back[0] - CAM.x) < 1e-3 && Math.abs(back[1] - CAM.y) < 1e-3);
  }
  B.emit({ k: 'cam-', id: 'cam-1' }); hub.flush();
  for (const P of [A, B]) assert.deepStrictEqual(Object.keys(P.doc.cameras), ['cam-1'], 'somebody else\'s camera is not B\'s to take away');
  A.emit({ k: 'cam-', id: 'cam-1' }); hub.flush();
  for (const P of [A, B]) assert.deepStrictEqual(P.doc.cameras, {});
});

test('a webcam page (a viewer) owns its camera: players see it, a late player has it, and when the page goes the camera goes', () => {
  const hub = new Hub(), A = player(hub, 'A'); hub.flush();
  const V = player(hub, 'webcam page', 'viewer'); hub.flush();
  assert.ok(V.isViewer);
  V.emit(ev()); hub.flush();
  assert.deepStrictEqual(Object.keys(A.doc.cameras), ['cam-1']);
  assert.strictEqual(A.doc.cameras['cam-1'].owner, V.me);
  const B = player(hub, 'B'); hub.flush();
  assert.deepStrictEqual(Object.keys(B.doc.cameras), ['cam-1'], 'a player who joins later has it');
  V.emit(ev({ x: 3.25 })); hub.flush();
  assert.strictEqual(B.doc.cameras['cam-1'].x, 3.25);
  hub.leave(V.me); hub.flush();
  for (const P of [A, B]) assert.deepStrictEqual(P.doc.cameras, {}, 'the page went: so did its camera');
  const C = player(hub, 'C'); hub.flush();
  assert.deepStrictEqual(C.doc.cameras, {});
});

test('a viewer withdraws its camera itself (cam- with its own key), and cannot touch a camera that a player owns', () => {
  const hub = new Hub(), A = player(hub, 'A'), V = player(hub, 'page', 'viewer'); hub.flush();
  V.emit(ev({ id: 'v1' })); A.emit(ev({ id: 'p1' })); hub.flush();
  assert.deepStrictEqual(Object.keys(A.doc.cameras).sort(), ['p1', 'v1']);
  V.emit({ k: 'cam-', id: 'p1' }); V.emit(ev({ id: 'p1', x: 99 })); hub.flush();
  assert.strictEqual(A.doc.cameras.p1.x, CAM.x, 'the player\'s camera stays as it was');
  V.emit({ k: 'cam-', id: 'v1' }); hub.flush();
  assert.deepStrictEqual(Object.keys(A.doc.cameras), ['p1']);
});

test('a headset asks for the camera of a webcam page to move: only that page hears it, and its answer (the camera announced again) is what everybody sees', () => {
  const hub = new Hub(), A = player(hub, 'A'), B = player(hub, 'B'), V = player(hub, 'page', 'viewer'), W = player(hub, 'second page', 'viewer'); hub.flush();
  V.emit(ev()); hub.flush();
  assert.ok(A.moveCamera('cam-1', 3.25, -3.9, 1.3)); assert.ok(A.resetCamera('cam-1'));
  hub.flush();
  assert.deepStrictEqual(V.asks, [['cam:cam-1', { x: 3.25, y: -3.9, z: 1.3 }, A.me], ['cam:cam-1', { reset: true }, A.me]]);
  for (const P of [A, B, W]) assert.deepStrictEqual(P.asks, [], 'nobody else hears');
  assert.ok(!A.moveCamera('cam-1', 'a', 1, 1), 'not a place');
  assert.ok(!A.moveCamera(5, 1, 1, 1));
  A.moveCamera('nobody', 1, 1, 1); hub.flush();
  assert.strictEqual(V.asks.length, 2, 'a camera nobody owns goes nowhere');
  V.emit(ev({ x: 3.25, z: 1.3, yaw: 2.2 })); hub.flush();
  assert.strictEqual(B.doc.cameras['cam-1'].x, 3.25);
});

test('the link going down takes the cameras of the other pages out of the document (they may be gone: they say so again when it is back)', () => {
  const hub = new Hub(), A = player(hub, 'A'), B = player(hub, 'B'); hub.flush();
  A.emit(ev()); hub.flush();
  assert.ok(B.doc.cameras['cam-1']);
  hub.leave(B.me); hub.flush();
  assert.deepStrictEqual(B.doc.cameras, {});
});

test('cams.event / clean: an announce from the WorldFeed is the same event', () => {
  const hub = new Hub(), A = player(hub, 'A'); hub.flush();
  const feed = new M.worldfeed.WorldFeed({ link: hub.link('pc', 'viewer') }); hub.flush();
  assert.ok(feed.announceCamera(CAM));
  assert.ok(!feed.announceCamera({ id: 'x' }), 'not a whole camera: not sent');
  hub.flush();
  assert.deepStrictEqual(Object.keys(A.doc.cameras), ['cam-1']);
  assert.deepStrictEqual(Object.keys(feed.doc.cameras), ['cam-1'], 'and the page has its own camera back from the server');
  assert.ok(feed.withdrawCamera('cam-1')); hub.flush();
  assert.deepStrictEqual(A.doc.cameras, {});
  assert.ok(!feed.withdrawCamera('bad id'));
});
