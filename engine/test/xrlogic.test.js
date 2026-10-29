// The XR logic without XR: hands and the pinch, menus (grid, poke, everyone's panels), the anchor keeper (a put-on as measured on
// 2026-10-22), lining up through the pretend server.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const { Hub } = require('./hubfake.js');
const AL = M.align;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const tick = () => new Promise((r) => setImmediate(r));

// a flat hand in XR space: joint i at (x0 + i mm, y, z0); thumb tip (4) and index tip (9) apart by `gap`
function handJoints(x0, y, z0, gap) {
  const jp = new Float32Array(75);
  for (let i = 0; i < 25; i++) { jp[i * 3] = x0 + i * 0.001; jp[i * 3 + 1] = y; jp[i * 3 + 2] = z0; }
  jp[9 * 3] = jp[4 * 3] + gap;
  return jp;
}

test('a hand becomes a source on the floor plan; the pinch has hysteresis and the select event wins', () => {
  const sp = new AL.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0.1), jp = handJoints(0.5, 1.1, -0.3, 0.05);
  const s = M.hands.source('right', jp, sp);
  assert.strictEqual(s.joints.length, 25);
  near(s.joints[0][0], 0.5, 1e-6); near(s.joints[0][1], 0.3, 1e-6); near(s.joints[0][2], 1.0, 1e-6, 'height above this headset\'s floor');
  assert.deepStrictEqual(s.points.map((p) => p.name), ['thumb', 'index', 'middle', 'ring', 'pinky', 'palm']);
  const P = new M.hands.Pinch();
  assert.deepStrictEqual([0.05, 0.02, 0.03, 0.04, 0.03].map((g) => P.update('r', handJoints(0, 1, 0, g), false)), [false, true, true, false, false]);
  assert.strictEqual(P.update('r', handJoints(0, 1, 0, 0.1), true), true, 'the headset\'s own pinch');
  assert.deepStrictEqual(M.hands.tips([s], { right: true }).map((t) => [t.id, t.pinch]), [['right', true]]);
});

test('a grid: rows, text cells, buttons in the title bar, the hit test', () => {
  const lay = M.menus.grid({ w: 1000, title: 'Cube', top: [{ id: 'lineUp', label: 'Line up', w: 200 }], rows: [[{ id: 'plus', label: '+1' }, { label: 'Count', value: '3', span: 2 }], [{ id: 'exit', label: 'Exit', off: true }]] });
  assert.strictEqual(lay.buttons.length, 4);
  const b = (id) => lay.buttons.find((q) => q.id === id), at = (q) => [(q.x + q.w / 2) / lay.w, (q.y + q.h / 2) / lay.h];
  assert.strictEqual(M.menus.hit(lay, ...at(b('plus'))), 'plus');
  assert.strictEqual(M.menus.hit(lay, ...at(b('lineUp'))), 'lineUp');
  assert.strictEqual(M.menus.hit(lay, ...at(lay.buttons[2])), null, 'a text cell is not a button');
  assert.strictEqual(M.menus.hit(lay, ...at(b('exit'))), null, 'a button that is off');
  assert.ok(lay.buttons[2].w > b('plus').w * 1.9, 'a span of two');
});

test('a fingertip through a button from the front presses it once; from behind it presses nothing', () => {
  const pose = { x: 0, y: 0.5, h: 1.2, yaw: -Math.PI / 2, pitch: 0.3 }, A = M.menus.axes(pose);
  near(A.normal[0] * A.right[0] + A.normal[1] * A.right[1] + A.normal[2] * A.right[2], 0, 1e-9);
  near(A.up[0] * A.normal[0] + A.up[1] * A.normal[1] + A.up[2] * A.normal[2], 0, 1e-9);
  near(A.normal[2], Math.cos(0.3), 1e-9, 'it faces the player standing towards +Z (floor -y), leaning back');
  const lay = M.menus.grid({ w: 1000, rows: [[{ id: 'plus', label: '+1' }]] }), b = lay.buttons[0];
  const pn = { key: '0:main', owner: null, id: 'main', pose, w: 0.5, h: 0.5 * lay.h / lay.w, lay };
  const u = (b.x + b.w / 2) / lay.w, v = (b.y + b.h / 2) / lay.h, lx = (u - 0.5) * pn.w, ly = (0.5 - v) * pn.h;
  const at = (z) => [0, 1, 2].map((i) => A.pos[i] + A.right[i] * lx + A.up[i] * ly + A.normal[i] * z);
  const P = new M.menus.Poke();
  const step = (z, t) => P.update([pn], [{ id: 'r', p: at(z) }], t);
  assert.strictEqual(step(0.03, 0).hover.button, 'plus');
  assert.deepStrictEqual(step(0.01, 10).presses, []);
  assert.deepStrictEqual(step(-0.005, 20).presses, [], 'pushing: 0 to 1 cm into the button presses nothing');
  assert.deepStrictEqual(step(-0.011, 30).presses.map((q) => q.button), ['plus'], 'pressed at 1 cm');
  assert.deepStrictEqual(step(-0.02, 40).presses, [], 'once, on the way down only');
  const r = step(0.001, 50);
  assert.deepStrictEqual([r.releases.map((q) => q.button), r.presses], [['plus'], []], 'back up to the surface: it lets go');
  step(0.03, 70);
  assert.deepStrictEqual(step(-0.012, 80).presses.map((q) => q.button), ['plus'], 'again after coming in from the top');
  const Q = new M.menus.Poke();
  Q.update([pn], [{ id: 'r', p: at(-0.03) }], 0);
  assert.deepStrictEqual(Q.update([pn], [{ id: 'r', p: at(-0.001) }], 10).presses, [], 'coming from behind');
  assert.deepStrictEqual(Q.update([pn], [{ id: 'r', p: at(-0.02) }], 20).presses, [], 'and not pushed through either');
  assert.ok(step(0.1, 700).busy.has('0:main'), 'a hand near it keeps it from gliding away');
  assert.ok(!step(0.1, 800).at.has('0:main'), '10 cm away is near, not at it');
  assert.ok(step(0.03, 900).at.has('0:main'), '3 cm over it is at it');
});

test('a held button: depth shapes, one button at a time, and letting go sideways', () => {
  const { shape } = M.menus;
  assert.deepStrictEqual(shape(false, -0.03), { top: 0.004, push: 0 });
  assert.deepStrictEqual(shape(true, 0.011), { top: -0.011, push: 0 });
  assert.deepStrictEqual(shape(true, 0.003), { top: -0.01, push: 0 }, 'held and drawn back a little: stays down 1 cm');
  near(shape(true, 0.04).top, -0.025, 1e-9, 'the button stops at 2.5 cm'); near(shape(true, 0.04).push, 0.0015, 1e-9, 'the menu gives 1 mm per extra cm');
  const lay = M.menus.grid({ w: 1000, rows: [[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]] });
  const pn = { key: 'k', owner: null, id: 'main', pose: { x: 0, y: 0, h: 1, yaw: 0, pitch: 0 }, w: 0.5, h: 0.5 * lay.h / lay.w, lay }, A = M.menus.axes(pn.pose);
  const centre = (id) => { const b = lay.buttons.find((q) => q.id === id); return [(b.x + b.w / 2) / lay.w, (b.y + b.h / 2) / lay.h]; };
  const at = (id, z, side = 0) => { const [u, v] = centre(id); return [0, 1, 2].map((i) => A.pos[i] + A.right[i] * ((u - 0.5) * pn.w + side) + A.up[i] * (0.5 - v) * pn.h + A.normal[i] * z); };
  const P = new M.menus.Poke(), go = (tips, t) => P.update([pn], tips, t);
  go([{ id: 'r', p: at('a', 0.03) }, { id: 'l', p: at('b', 0.03) }], 0);
  assert.strictEqual(go([{ id: 'r', p: at('a', -0.012) }, { id: 'l', p: at('b', 0.03) }], 10).presses.length, 1);
  assert.deepStrictEqual(go([{ id: 'r', p: at('a', -0.012) }, { id: 'l', p: at('b', -0.02) }], 20).presses, [], 'another hand cannot press while one is held');
  const o = go([{ id: 'r', p: at('a', -0.03) }], 30);
  assert.deepStrictEqual(o.touches.map((q) => [q.button, q.held]), [['a', true]]);
  assert.deepStrictEqual(go([{ id: 'r', p: at('a', -0.4) }], 35).touches.map((q) => q.held), [true], 'still held 40 cm in');
  assert.strictEqual(go([{ id: 'r', p: at('a', -0.6) }], 36).releases.length, 1, 'past 50 cm it lets go');
  go([{ id: 'r', p: at('a', 0.03) }], 37); go([{ id: 'r', p: at('a', -0.012) }], 38);
  go([{ id: 'r', p: at('a', -0.03) }], 39);
  const side = go([{ id: 'r', p: at('a', -0.02, 0.5) }], 40);
  assert.deepStrictEqual(side.releases.map((q) => q.button), ['a'], 'far to the side: it lets go');
  assert.deepStrictEqual(go([{ id: 'r', p: at('a', -0.02) }], 50).presses, [], 'coming back sideways presses nothing');
  go([{ id: 'r', p: at('a', -0.02) }], 60);
  const gone = go([], 70);
  assert.deepStrictEqual(gone.releases.length, 0, 'nothing held, nothing to let go');
});

test('everyone\'s menus: a panel of A floats at the same real place for B, whose frame is turned and shifted', () => {
  const hub = new Hub();
  const mk = (name, frame, fy) => { const S = new M.session.Session(hub.link(name), {}); const sp = new AL.Space(frame, fy); const mn = new M.menus.Menus(S, sp); S.link.onBin = (b) => mn.receive(M.wire.decode(b), 0); return { S, sp, mn }; };
  const a = mk('A', { x: 0, y: 0, yaw: 0, z: 0 }, 0), b = mk('B', { x: 1, y: 0.5, yaw: 0.7, z: 0.03 }, 0.2);
  hub.flush();
  a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  assert.strictEqual(a.mn.send(0, [{ id: 'main', pose: { x: 0.4, y: 0.2, h: 1.3, yaw: 1, pitch: 0.2 } }], { lining: true }), true);
  hub.flush();
  const [o] = b.mn.others(10);
  assert.deepStrictEqual([o.slot, o.info, o.panels[0].id], [0, { lining: true }, 'main']);
  const p = o.panels[0].pose, c = b.sp.toCommon([p.x, p.y, p.h - b.sp.floorY]);
  near(c[0], 0.4, 0.002); near(c[1], 0.2, 0.002); near(c[2], 1.3, 0.002, 'the same height above the common floor');
  near(AL.wrap(b.sp.yawToCommon(p.yaw) - 1), 0, 0.001); near(p.pitch, 0.2, 1e-4);
  hub.leave(0); hub.flush();
  assert.deepStrictEqual(b.mn.others(20), []);
});

// ---- a put-on, as measured on the Quest Pro on 2026-10-22
// The room has a real anchor at a fixed place; the headset's own origin O (its pose in the room) jumps when it is taken off and on.
function rig() {
  const room = { anchor: { x: 1.2, y: -0.4, yaw: 0.5 } };
  const own = (O, p) => AL.poseIn(O, p);                     // a room pose as the headset's coordinates see it
  const S = { O: { x: 0, y: 0, yaw: 0 }, t: 0, visible: true, stored: 'uuid-1', logs: [], restores: 0 };
  const fresh = () => ({ stale: null });
  const io = {
    supported: true, stored: () => S.stored, store: (u) => { S.stored = u; }, now: () => S.t, visible: () => S.visible, life: (t) => S.logs.push(t),
    restore: () => { S.restores++; return Promise.resolve(fresh()); },
    create: () => Promise.resolve(fresh()), persist: () => Promise.resolve('uuid-2'),
    pose: (a) => a.stale || own(S.O, room.anchor),
  };
  return { S, io, room, own };
}

test('the anchor keeper: wrong reset transforms and a stale anchor, and the line-up comes back where it was in the room', async () => {
  const { S, io, room, own } = rig();
  const K = new M.anchor.Keeper(io), store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const sess = new M.session.Session(null, {}), sp = new AL.Space(null, 0);
  const L = new M.lineup.LineUp(sess, sp, { keeper: K, store: storage });
  K.update(); await tick();
  K.update();
  assert.strictEqual(K.posed, true);
  // a line-up in the room: spots at room (2, 0) and (2, 3); taken as the headset sees them
  const spotsRoom = [{ x: 2, y: 0, yaw: 0 }, { x: 2, y: 3, yaw: 0 }];
  L.aligner.points = spotsRoom.map((p) => { const o = own(S.O, p); return [o.x, o.y, 0.03]; });
  L.aligner._refit(); L.aligner.rev++;
  S.t = 2000; L.update(S.t, 0.016, []);
  assert.ok(store.get('mumr.lineup'), 'saved against the anchor');
  // take it off and on: the origin really moves by -54 degrees and (-0.32, 0.29); the resets claim 7.4 m and the anchor goes stale
  const before = Object.assign({}, K.frame);
  const anchorObj = K.anchor; anchorObj.stale = Object.assign({}, before);
  S.O = { x: -0.32, y: 0.29, yaw: -54 * Math.PI / 180 };
  S.t = 3000; K.reset({ x: 7.36, y: 7.37, yaw: 0.017 });
  S.t = 3300; K.reset({ x: -6.0, y: -7.2, yaw: 0.2 });
  for (let t = 3400; t < 9000; t += 100) { S.t = t; K.update(); await tick(); L.update(t, 0.1, []); }
  assert.ok(S.logs.some((l) => /anchor after the resets: stale/.test(l)), S.logs.join(' | '));
  assert.ok(S.logs.some((l) => /anchor found again/.test(l)), S.logs.join(' | '));
  assert.strictEqual(S.restores, 2, 'asked for again by its handle');
  // the spots, seen from the room again, are where they were
  L.aligner.points.forEach((p, i) => {
    const inRoom = AL.fromCommon(S.O, p[0], p[1]);
    near(inRoom[0], spotsRoom[i].x, 0.005, `spot ${i + 1} x`); near(inRoom[1], spotsRoom[i].y, 0.005, `spot ${i + 1} y`);
  });
  assert.ok(sp.ok && Math.abs(sp.frame.dist - 3) < 1e-6);
});

test('a new anchor: the old saved line-up means nothing; no anchor support: nothing is saved', async () => {
  const { S, io } = rig();
  S.stored = null;
  const K = new M.anchor.Keeper(io), store = new Map([['mumr.lineup', '{"v":1}']]);
  const L = new M.lineup.LineUp(new M.session.Session(null, {}), new AL.Space(null, 0), { keeper: K, store: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } });
  K.update(); await tick(); await tick();
  assert.strictEqual(S.stored, 'uuid-2');
  assert.strictEqual(store.get('mumr.lineup'), 'null');
  void L;
  const K2 = new M.anchor.Keeper(Object.assign({}, io, { supported: false }));
  K2.update();
  assert.strictEqual(K2.canSave, false);
});

test('a reset right after an anchor was made new does not send the keeper looking for it', async () => {
  const { S, io } = rig();
  S.stored = null;
  const K = new M.anchor.Keeper(io);
  K.update(); await tick(); await tick(); K.update();
  assert.strictEqual(K.posed, true);
  K.anchor.stale = Object.assign({}, K.frame);
  S.O = { x: 0.05, y: 0.6, yaw: -134 * Math.PI / 180 };
  S.t = 100; K.reset({ x: 0.05, y: 0.61, yaw: -2.3 });
  for (let t = 200; t < 4000; t += 100) { S.t = t; K.update(); await tick(); }
  assert.strictEqual(S.restores, 0, S.logs.join(' | '));
  assert.ok(S.logs.some((l) => /made a moment ago/.test(l)), S.logs.join(' | '));
});

test('lining up through the server: two spots by resting a fingertip, the check mark, and everybody hears it', () => {
  const hub = new Hub();
  const said = [], acts = [];
  const mk = (name) => {
    const S = new M.session.Session(hub.link(name), { actions: M.lineup.ACTIONS });
    const sp = new AL.Space(null, 0), L = new M.lineup.LineUp(S, sp, { aligner: { dwell: 0.3, still: 0.01 }, say: (t) => said.push(t) });
    S.on('action', (id) => { acts.push(id); L.press(id); });
    return { S, sp, L };
  };
  const a = mk('A'), b = mk('B');
  hub.flush();
  b.S.press(0, 'lineUp'); hub.flush();                       // B presses Line up on A's menu: it happens at A
  assert.deepStrictEqual([a.L.active, b.L.active, acts], [true, false, ['lineUp']]);
  const rest = (x, y, secs) => { for (let t = 0; t <= secs; t += 0.05) a.L.update(t * 1000, 0.05, [{ id: 'r', x, y, z: 0.02, pinch: false }]); a.L.update(0, 0.05, [{ id: 'r', x, y, z: 0.5 }]); };
  rest(1, 1, 0.4); rest(1, 4, 0.4);
  hub.flush();
  assert.ok(a.L.lined && a.sp.ok);
  near(b.S.lined(0).dist, 3, 1e-3);
  assert.ok(said.some((t) => /lined up, the spots are 300 cm apart/.test(t)), said.join(' | '));
  a.L.press('p3create'); rest(2, 2, 0.4); a.L.update(1e6, 0.01, []); hub.flush();
  const own = a.L.aligner.checkOwn(), chk = b.S.doc.checks[0];
  near(own[0], 2, 0.002); near(own[1], 2, 0.002, 'the check mark rests where the fingertip did');
  near(chk[0], a.L.aligner.lastCheck[0], 1e-4); near(chk[1], a.L.aligner.lastCheck[1], 1e-4, 'and B has it, in the common frame');
  const rows = a.L.rows();
  assert.deepStrictEqual(rows.map((r) => r[1].label), ['Replace', 'Replace', 'Replace']);
  assert.match(rows[0][0].value, /placed/);
  a.L.press('lineUp');
  assert.strictEqual(a.L.note(), 'lined up, 300 cm');
  const m = a.L.marks();
  assert.deepStrictEqual([m.show, m.checks.length], [false, 0], 'out of the line-up the check mark goes with the spots');
});

test('a given frame (a PC rehearsal) lines up without spots', () => {
  const S = new M.session.Session(null, {}), sp = new AL.Space(null, 0), L = new M.lineup.LineUp(S, sp);
  L.given({ x: 1, y: 0.5, yaw: 0.7 });
  L.update(0, 0.016, []);
  assert.deepStrictEqual([sp.ok, S.myLine.how], [true, 'given']);
});

test('a card with an orientation: the quaternion from its axes, the poke test on those axes, and the other headset gets the same real turn', () => {
  const AL = M.align, n = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  const X = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const r = n([1, 0.3, -0.2]), up = n(X([0.2, 0.4, 1], r)), nrm = X(r, up);
  const q = AL.quatFromBasis(r, up, nrm);
  AL.quatApply(q, [1, 0, 0]).forEach((v, i) => near(v, r[i], 1e-6));
  AL.quatApply(q, [0, 0, 1]).forEach((v, i) => near(v, nrm[i], 1e-6));
  const A = M.menus.axes({ x: 0, y: 0, h: 1, q });
  A.normal.forEach((v, i) => near(v, nrm[i], 1e-6));
  // through the M packet to a headset turned 0.7 rad: its own XR turn of the card is the same real turn
  const hub = new Hub();
  const mk = (name, frame) => { const S = new M.session.Session(hub.link(name), {}); const sp = new AL.Space(frame, 0); const mn = new M.menus.Menus(S, sp); S.link.onBin = (b) => mn.receive(M.wire.decode(b), 0); return { S, sp, mn }; };
  const a = mk('A', { x: 0, y: 0, yaw: 0, z: 0 }), b = mk('B', { x: 1, y: 0.5, yaw: 0.7, z: 0 });
  hub.flush(); a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  a.mn.send(0, [{ id: 'wrist', pose: { x: 0.2, y: 0.1, h: 1.1, q } }], {}); hub.flush();
  const got = b.mn.others(0)[0].panels[0].pose;
  assert.ok(got.q, 'it came with an orientation');
  const backToCommon = b.sp.quatToCommon(got.q), sent = a.sp.quatToCommon(q);
  AL.quatApply(backToCommon, [0, 0, 1]).forEach((v, i) => near(v, AL.quatApply(sent, [0, 0, 1])[i], 1e-3, 'the same real turn'));
});
