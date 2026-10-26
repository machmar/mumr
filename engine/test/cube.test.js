// The cube demo's logic (apps/cube/cube.js): pushed by a hand, held between a thumb and a finger, falling, shared by two headsets.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const C = require('../../apps/cube/cube.js');
const { Hub } = require('./hubfake.js');

const pt = (name, x, y, z) => ({ name, x, y, z });
const finger = (id, x, y, z) => ({ id, points: [pt('index', x, y, z)] });

test('a fingertip that moves into the cube pushes it along, and it slides to a stop', () => {
  const c = new C.Cube();
  c.place(0.5, 0);
  let t = 0;
  for (let k = 0; k < 30; k++) { t += 1 / 60; c.step(1 / 60, t, [finger('right', 0.40 + k * 0.004, 0, 0.05)]); }
  assert.ok(c.x > 0.52, `moved: ${c.x}`);
  assert.ok(c.vx > 0, 'with the hand\'s speed');
  for (let k = 0; k < 300; k++) { t += 1 / 60; c.step(1 / 60, t, []); }
  assert.strictEqual(c.moving(), false);
  assert.ok(Math.abs(c.y) < 0.02);
});

test('only a pinch that starts at the cube holds it; it goes up with the hand and falls when the fingers part', () => {
  const c = new C.Cube();
  c.place(0, 0);
  const hand = (x, z, pinch) => ({ id: 'left', pinch, points: [pt('thumb', x - 0.005, 0, z), pt('index', x + 0.005, 0, z)] });
  let t = 0;
  c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF, false)]);
  c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF, true)]);
  assert.ok(c.held && c.held.by === 'left', 'pinched at its side');
  for (let k = 1; k <= 20; k++) c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF + k * 0.01, true)]);
  for (let k = 0; k < 30; k++) c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF + 0.2, true)]);      // (the hold is a spring: it catches up)
  assert.ok(Math.abs(c.z - (C.HALF + 0.2)) < 2e-3, `lifted 20 cm: ${c.z}`);
  c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF + 0.2, false)]);
  assert.strictEqual(c.held, null, 'the fingers parted');
  for (let k = 0; k < 200; k++) c.step(0.016, t += 0.016, []);
  assert.ok(Math.abs(c.z - C.HALF) < 3e-3, 'on the floor again');
  // a pinch that started away from the cube and then came to it does not take it; nor do a thumb and a finger on opposite sides
  c.step(0.016, t += 0.016, [hand(0.3, C.HALF, true)]);
  c.step(0.016, t += 0.016, [hand(C.HALF + 0.01, C.HALF, true)]);
  assert.strictEqual(c.held, null, 'the pinch has to start at the cube');
  c.step(0.016, t += 0.016, [{ id: 'r', pinch: false, points: [pt('thumb', -C.HALF - 0.005, 0, C.HALF), pt('index', C.HALF + 0.005, 0, C.HALF)] }]);
  assert.strictEqual(c.held, null, 'fingers that do not touch each other do not hold it');
  c.place(0, 0);
  c.step(0.016, t += 0.016, [{ id: 'leg', foot: true, points: [pt('ankle', 0.05, 0, 0.05)] }]);
  assert.ok(Math.abs(c.x) < 1e-3, 'a leg does not push it');
});

test('two headsets: B pushes the cube, takes the token by touching it, and A sees it where B has it in the room', () => {
  const hub = new Hub({ bodies: ['cube'], owned: { 16: 'cube' } });
  const mk = (name, frame) => {
    const S = new M.session.Session(hub.link(name), { game: C.GAME, player: C.PLAYER, actions: C.ACTIONS, press: C.press });
    const sp = new M.align.Space(frame, 0), cube = new C.Cube(), body = new M.body.Body(S, { token: 'cube', type: 'cube', adapter: C.adapter(cube, sp) });
    S.link.onBin = (b) => body.receive(M.wire.decode(b), 0);
    return { S, sp, cube, body };
  };
  const a = mk('A', { x: 0, y: 0, yaw: 0, z: 0 }), b = mk('B', { x: 2, y: 1, yaw: 1.2, z: 0.02 });
  hub.flush();
  a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  for (const h of [a, b]) { const p = h.sp.fromCommon([0.5, 0]); h.cube.place(p[0], p[1]); }
  // B's finger moves towards +x of the common frame, into the cube
  let t = 0;
  for (let k = 0; k < 40; k++) {
    t += 1 / 60;
    const tip = b.sp.fromCommon([0.36 + k * 0.004, 0, 0.05]), own = [finger('right', tip[0], tip[1], tip[2])];
    b.body.frame(t * 1000, own); hub.flush();
    b.cube.step(1 / 60, t, own); b.body.send(t * 1000); hub.flush();
    a.cube.step(1 / 60, t, []);
  }
  assert.strictEqual(b.body.mine, true, 'the toucher holds the token');
  const ca = a.sp.toCommon([a.cube.x, a.cube.y]), cb = b.sp.toCommon([b.cube.x, b.cube.y]);
  assert.ok(cb[0] > 0.52, `B pushed it: ${cb}`);
  assert.ok(Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 0.02, `A has it where B has it: ${ca} ${cb}`);
  // Cube here from A's menu: a request to B, who holds it
  a.S.press(null, 'colour'); hub.flush();
  assert.strictEqual(b.S.doc.game.colour, 1);
  a.body.ask('place', { x: -1, y: -1 }); hub.flush();
  const nb = b.sp.toCommon([b.cube.x, b.cube.y]);
  assert.ok(Math.hypot(nb[0] + 1, nb[1] + 1) < 1e-6);
});

test('the cube menu has only the cube’s items; the engine items are on the wrist menu', () => {
  const lay = C.menu({ count: 4, colour: 1, ghost: true }, { players: 2 });
  assert.deepStrictEqual(lay.buttons.filter((q) => q.id).map((q) => q.id), ['plus', 'colour', 'cubeHere', 'ghost', 'model', 'handIrl']);
  assert.strictEqual(lay.buttons.find((q) => q.id === 'plus').value, '4');
  const SM = M.sysmenu.SysMenu;
  const ids = (l) => l.buttons.filter((q) => q.id).map((q) => q.id);
  assert.deepStrictEqual(ids(SM.layout({ open: false })), ['sysOpen'], 'folded: one wrist button');
  assert.deepStrictEqual(ids(SM.layout({ open: true, lined: true, dist: 3.34 })), ['sysClose', 'lineUp', 'roomSetup', 'exit']);
  assert.deepStrictEqual(ids(SM.layout({ open: true, lining: true, fields: [{ placed: true }, {}, {}] })), ['sysClose', 'spot1', 'spot2', 'lineUp'], 'a thing that cannot be pressed now (the check spot, a room to upload) is text');
  assert.deepStrictEqual(ids(SM.layout({ open: true, lining: true, lined: true, fields: [{ placed: true }, { placed: true }, {}], room: { own: 14, kept: false } })), ['sysClose', 'spot1', 'spot2', 'spot3', 'supplyRoom', 'lineUp']);
  assert.deepStrictEqual(ids(SM.layout({ open: true, lining: true, spot: 0, fields: [{ placed: true }, {}, {}] })), ['sysClose', 'spotLock', 'spotReplace', 'spotDelete', 'spotBack']);
  assert.deepStrictEqual(ids(SM.layout({ open: true, lining: true, spot: 1, fields: [{ placed: true }, {}, {}] })), ['sysClose', 'spotReplace', 'spotBack'], 'an empty spot: nothing to lock or delete');
  assert.deepStrictEqual(ids(SM.layout({ open: true, asking: true })), ['sysClose', 'exitYes', 'exitNo']);
  assert.ok(SM.width({ open: true }) > SM.width({ open: false }) * 3);
  const lv = (i) => SM.layout(Object.assign({ open: true, fields: [{}, {}, {}] }, i)).level;
  assert.deepStrictEqual([lv({}), lv({ lining: true }), lv({ asking: true }), lv({ lining: true, spot: 1 })], [0, 1, 1, 2], 'how deep a screen is: it slides in from the right, back slides out to the left');
  // the spec's sizes: the card 22 cm wide, buttons at least 4 x 3 cm, 8 mm between them, the fold arrow and the folded button 2 x 2 cm
  const home = SM.layout({ open: true, lined: true }), cm = home.w / 22, btn = home.buttons.filter((q) => q.id && q.id !== 'sysClose');
  assert.ok(btn.every((q) => q.w / cm >= 4 && Math.abs(q.h / cm - 3) < 1e-9), 'buttons are at least 4 x 3 cm');
  const [a, b, c] = [home.buttons.find((q) => q.id === 'lineUp'), home.buttons.find((q) => q.id === 'roomSetup'), home.buttons.find((q) => q.id === 'exit')];
  assert.ok(Math.abs((b.x - a.x - a.w) / cm - 0.8) < 1e-9 && Math.abs((c.y - a.y - a.h) / cm - 1.6 - 3) < 1e-9, '8 mm between buttons and between rows');
  const arrow = home.buttons.find((q) => q.id === 'sysClose');
  assert.ok(Math.abs(arrow.w / cm - 2) < 1e-9 && Math.abs((home.card.y - arrow.y - arrow.h) / cm - 0.8) < 1e-9, 'the arrow is 2 x 2 cm, 8 mm above the card');
  assert.ok(Math.abs(SM.layout({ open: false }).buttons[0].w / cm - 2 * 22 / 22) < 1e-9 && Math.abs(SM.width({ open: false }) - 0.02) < 1e-9, 'the folded button is 2 x 2 cm');
});

test('the wrist menu: its buttons act at its owner, Line up opens it, and it shows while the inside of the left wrist looks at you', () => {
  const S = new M.session.Session(null, {}), sp = new M.align.Space(null, 0), L = new M.lineup.LineUp(S, sp), done = [];
  const sys = new M.sysmenu.SysMenu(S, L, { exit: () => done.push('exit'), roomSetup: () => done.push('room') });
  assert.deepStrictEqual([sys.press('sysOpen'), sys.open, sys.press('sysClose'), sys.open], [true, true, true, false]);
  sys.press('lineUp');
  assert.deepStrictEqual([L.active, sys.open, sys.info().lining], [true, true, true], 'lining up opens it, so that the fields are seen');
  sys.press('exit');
  assert.deepStrictEqual([done, sys.info().asking], [[], true], 'Exit asks again first');
  sys.press('exitNo'); sys.press('exit'); sys.press('exitYes'); sys.press('roomSetup');
  assert.deepStrictEqual(done, ['exit', 'room']);
  // poking a spot opens its menu, whose buttons act on that spot; Done closes it with lining up
  sys.press('spot2'); assert.strictEqual(sys.info().spot, 1);
  assert.ok(sys.press('spotReplace') && L.aligner.fields()[1].armed, 'Replace/Create on spot 2 arms spot 2');
  sys.press('spotBack'); assert.strictEqual(sys.info().spot, null);
  sys.press('spot3'); sys.press('lineUp'); assert.deepStrictEqual([L.active, sys.info().spot], [false, null]);
  sys.press('lineUp'); sys.press('sysClose'); assert.deepStrictEqual([sys.open, sys.info().spot, sys.info().asking], [false, null, false]);
  assert.strictEqual(sys.press('plus'), false, 'not one of the engine’s');
  // a left hand held up in front of the eyes (1.6 m), palm side towards them: wrist joints in XR space
  const jp = new Float32Array(75), set = (i, x, y, z) => { jp[i * 3] = x; jp[i * 3 + 1] = y; jp[i * 3 + 2] = z; };
  set(0, 0, 1.3, -0.35); set(6, 0.03, 1.38, -0.35); set(11, 0, 1.39, -0.35); set(21, -0.035, 1.37, -0.35);
  const head = [0, 0, Math.PI / 2, 1.6, -0.5];
  let pose = sys.place(head, jp, 0);
  const flipped = new Float32Array(jp); flipped[6 * 3] = -0.03; flipped[21 * 3] = 0.035;
  const other = sys.place(head, flipped, 0);
  assert.ok((pose === null) !== (other === null), 'one side of the wrist shows it, the other hides it');
  pose = pose || sys.place(head, jp, 0) || sys.place(head, flipped, 0);
  assert.ok(pose && Number.isFinite(pose.yaw) && pose.h > 1, JSON.stringify(pose));
  assert.strictEqual(sys.place(head, null, 0), null, 'no hand: no menu');
  // the open home menu folds once it has been hidden (the hand turned away) for 5 s in a row; lining up, it never folds by itself
  let t = 0;
  const S2 = new M.session.Session(null, {}), L2 = new M.lineup.LineUp(S2, new M.align.Space(null, 0)), folds = [];
  const s2 = new M.sysmenu.SysMenu(S2, L2, { now: () => t, life: (x) => folds.push(x) });
  const showing = s2.place(head, jp, 0) ? jp : flipped, turned = showing === jp ? flipped : jp;
  s2.press('sysOpen');
  t = 0; s2.place(head, turned, 0); t = 4000; s2.place(head, turned, 0);
  assert.strictEqual(s2.open, true, 'hidden 4 s: still open');
  t = 4500; s2.place(head, showing, 0); t = 6000; s2.place(head, turned, 0); t = 10000; s2.place(head, turned, 0);
  assert.strictEqual(s2.open, true, 'shown in between: the count starts again');
  t = 11100; s2.place(head, turned, 0);
  assert.strictEqual(s2.open, false, 'hidden 5 s in a row: folded');
  s2.press('lineUp'); t = 30000; s2.place(head, turned, 0); t = 90000; s2.place(head, turned, 0); s2.place(head, null, 0);
  assert.strictEqual(s2.open, true, 'lining up: it never folds by itself');
  assert.strictEqual(folds.length, 1, folds.join(' | '));
});

// ---- the cube on the physics module (docs/superpowers/specs/2026-10-26-physics-design.md)
const handAt = (id, x, y, z, yaw, pinch) => {                      // a hand with 25 joints (wrist, knuckles) turned `yaw`, thumb and index at (x, y, z)
  const f = [Math.cos(yaw), Math.sin(yaw), 0], s = [-Math.sin(yaw), Math.cos(yaw), 0], j = Array.from({ length: 25 }, () => [x, y, z]);
  const at = (a, b) => [x + f[0] * a + s[0] * b, y + f[1] * a + s[1] * b, z];
  j[0] = at(-0.08, 0); j[6] = at(0, 0.04); j[11] = at(0.01, 0); j[21] = at(0, -0.04); j[9] = at(0.08, 0.03); j[14] = at(0.09, 0);
  return { id, pinch, joints: j, points: [pt('thumb', x - 0.005, y, z), pt('index', x + 0.005, y, z)] };
};

test('a cube dropped from 1 m bounces, tumbles and comes to rest on a face', () => {
  const c = new C.Cube();
  c.put(0.5, 0, 1.06);
  let t = 0, apex = 0, bounced = false;
  for (let k = 0; k < 60 * 6; k++) { t += 1 / 60; c.step(1 / 60, t, []); if (c.vz > 0.5) bounced = true; if (bounced) apex = Math.max(apex, c.z); }
  assert.ok(bounced && apex > 0.12, `bounced to ${apex}`);
  assert.ok(Math.abs(c.z - C.HALF) < 0.003, `rests at ${c.z}`);
  assert.strictEqual(c.moving(), false);
  const q = c.drawn().q, up = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((a) => Math.abs(M.physics.quat.rotate(q, a)[2]));
  assert.ok(Math.max(...up) > 0.999, 'on a face');
});

test('a pinch holds the cube at the angle of the hand, and parting the fingers throws it with the hand\'s speed', () => {
  const c = new C.Cube();
  c.place(0, 0); let t = 0;
  c.step(0.016, t += 0.016, [handAt('left', C.HALF + 0.01, 0, C.HALF, 0, false)]);
  c.step(0.016, t += 0.016, [handAt('left', C.HALF + 0.01, 0, C.HALF, 0, true)]);
  assert.ok(c.held, 'pinched');
  for (let k = 1; k <= 60; k++) { const a = (k / 60) * (Math.PI / 2); c.step(0.016, t += 0.016, [handAt('left', C.HALF + 0.01 + k * 0.01, 0, C.HALF + k * 0.0075, a, true)]); }
  const heading = Math.atan2(M.physics.quat.rotate(c.drawn().q, [1, 0, 0])[1], M.physics.quat.rotate(c.drawn().q, [1, 0, 0])[0]);
  assert.ok(Math.abs(heading - Math.PI / 2) < 0.2, `turned with the hand: ${heading}`);
  assert.ok(c.z > 0.4, `lifted ${c.z}`);
  c.step(0.016, t += 0.016, [handAt('left', C.HALF + 0.01 + 0.61, 0, 0.5, Math.PI / 2, false)]);
  assert.strictEqual(c.held, null);
  assert.ok(c.vx > 0.4, `thrown: ${c.vx}`);
});

test('packet 16 is 56 bytes: position, orientation, velocity, spin, flags; the blend turns the short way', () => {
  const s = [1, 2, 3, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 0.1, 0.2, 0.3, 1, 2, 3, 1], buf = M.wire.encode('cube', s, 1000), back = M.wire.decode(buf);
  assert.strictEqual(buf.length - M.wire.HEADER, 56);
  s.forEach((v, i) => assert.ok(Math.abs(back.data[i] - v) < 1e-6, `field ${i}`));
  const half = M.wire.spec('cube').blend([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], s, 0.5);
  assert.ok(Math.abs(Math.hypot(half[3], half[4], half[5], half[6]) - 1) < 1e-6 && Math.abs(half[5] - Math.sin(Math.PI / 8)) < 1e-6, `slerp ${half.slice(3, 7)}`);
  assert.strictEqual(half[13], 0, 'the flags stay the first packet\'s');
});

test('two headsets: the other page draws the orientation the holder reached', () => {
  const hub = new Hub({ bodies: ['cube'], owned: { 16: 'cube' } });
  const mk = (name, frame) => {
    const S = new M.session.Session(hub.link(name), { game: C.GAME, player: C.PLAYER, actions: C.ACTIONS, press: C.press });
    const sp = new M.align.Space(frame, 0), cube = new C.Cube(), body = new M.body.Body(S, { token: 'cube', type: 'cube', adapter: C.adapter(cube, sp) });
    S.link.onBin = (b) => body.receive(M.wire.decode(b), 0);
    return { S, sp, cube, body };
  };
  const a = mk('A', { x: 0, y: 0, yaw: 0, z: 0 }), b = mk('B', { x: 2, y: 1, yaw: 1.2, z: 0.02 });
  hub.flush(); a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  const pb = b.sp.fromCommon([0.5, 0, 0.8]); b.cube.put(pb[0], pb[1], pb[2]); b.cube.body.w = [3, 2, 1]; b.cube.world.wake(b.cube.body);
  let t = 0;
  for (let k = 0; k < 90; k++) { t += 1 / 60; b.body.frame(t * 1000, [finger('right', pb[0], pb[1], pb[2])]); hub.flush(); b.cube.step(1 / 60, t, []); b.body.send(t * 1000); hub.flush(); a.cube.step(1 / 60, t, []); }
  const heading = (cube, sp) => { const r = M.physics.quat.rotate(cube.drawn().q, [1, 0, 0]); return sp.yawToCommon(Math.atan2(r[1], r[0])); };
  const d = Math.abs(M.align.wrap(heading(a.cube, a.sp) - heading(b.cube, b.sp)));
  assert.ok(d < 0.3, `A and B draw it the same way up to ${d} rad`);
});
