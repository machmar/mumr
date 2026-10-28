// The room: one headset's scan for everybody (the first in supplies it, a button moves it, it stays when its supplier goes), turned into
// each page's floor plan; the physics helpers; the cube on a table and at a wall.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const C = require('../../apps/cube/cube.js');
const { Hub } = require('./hubfake.js');
const AL = M.align;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

// a scan in a page's floor plan: a table top at 0.7 m over (1..2, 0..1) and a wall along y = 2
const scan = () => ({ planes: [
  { l: 'table', v: false, p: [[1, 0, 0.7], [2, 0, 0.7], [2, 1, 0.7], [1, 1, 0.7]] },
  { l: 'wall', v: true, p: [[0, 2, 0], [3, 2, 0], [3, 2, 2.4], [0, 2, 2.4]] },
  { l: 'door frame', v: true, p: [[3, 0, 0], [3, 1, 0], [3, 1, 2], [3, 0, 2]] },
  { l: 'ceiling', v: false, p: [[0, 0, 2.4], [3, 0, 2.4], [3, 2, 2.4], [0, 2, 2.4]] },
] });

test('XR planes become the floor plan: x = X, y = -Z, heights above the floor', () => {
  // a horizontal plane 0.75 m up (floorY 0.05), its own space moved to X 1, Z -2; polygon in its own x, z
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0.8, -2, 1];
  const r = M.room.fromXR([{ matrix: m, polygon: [{ x: 0, z: 0 }, { x: 0.5, z: 0 }, { x: 0.5, z: -0.4 }], label: 'table', orientation: 'horizontal' }], 0.05);
  assert.deepStrictEqual(r.planes[0], { l: 'table', v: false, p: [[1, 2, 0.75], [1.5, 2, 0.75], [1.5, 2.4, 0.75]] });
  assert.strictEqual(M.room.fromXR([], 0), null);
});

test('a scan that is refined (planes move by centimetres) logs its plane count once, a new count logs again', () => {
  const hub = new Hub(), lines = [];
  const S = new M.session.Session(hub.link('A'), {}), R = new M.room.Room(S, new AL.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0), { life: (t) => lines.push(t) });
  R.setScan(scan());
  for (let i = 1; i <= 20; i++) { const s = scan(); s.planes[1].p.forEach((c) => { c[1] += 0.05 * i; }); assert.strictEqual(R.setScan(s), true, 'the new geometry is kept'); }
  assert.strictEqual(lines.filter((t) => /scan has/.test(t)).length, 1);
  R.setScan({ planes: scan().planes.slice(0, 2) });
  assert.strictEqual(lines.filter((t) => /scan has/.test(t)).length, 2);
});

test('support and walls: a table carries what is on it, a door frame and the ceiling do not count', () => {
  const r = scan();
  near(M.room.support(r, 1.5, 0.5, 1), 0.7, 1e-9, 'over the table, above it');
  assert.strictEqual(M.room.support(r, 1.5, 0.5, 0.3), 0, 'under the table: the floor');
  assert.strictEqual(M.room.support(r, 0.5, 0.5, 3), 0, 'beside it (the ceiling is not a floor)');
  const w = M.room.pushOut(r, 1, 1.95, 0, 0.1, 0.07);
  near(w.y, 1.93, 1e-9, 'kept 7 cm off the wall'); near(w.ny, -1, 1e-9);
  assert.strictEqual(M.room.pushOut(r, 2.97, 0.5, 0, 0.1, 0.07), null, 'a doorway is not a wall');
  assert.strictEqual(M.room.pushOut(r, 1, 1.95, 2.5, 2.6, 0.07), null, 'above the wall');
  assert.strictEqual(M.room.walls(r).length, 1);
});

test('the server supplies the room: the first lined-up headset uploads its scan once, then only the Upload button changes it', () => {
  const hub = new Hub();
  const FA = { x: 0, y: 0, yaw: 0, z: 0 }, FB = { x: 1, y: 0.5, yaw: 0.7, z: 0.02 };
  const mk = (name, frame) => {
    const S = new M.session.Session(hub.link(name), {}), sp = new AL.Space(frame, 0), said = [];
    return { S, sp, R: new M.room.Room(S, sp, { say: (t) => said.push(t) }), said };
  };
  const a = mk('A', FA), b = mk('B', FB);
  hub.flush();
  a.S.setLined({ dist: 3 }); b.S.setLined({ dist: 3 }); hub.flush();
  a.R.setScan(scan());
  b.R.setScan({ planes: [{ l: 'floor', v: false, p: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }] });
  a.R.update(0); hub.flush();                                   // A is first: the server has no room, A uploads its scan
  b.R.update(0); hub.flush();                                   // (B does not: the server has one now)
  assert.strictEqual(b.S.doc.room.by, a.S.me);
  assert.deepStrictEqual([b.R.info().kept, b.R.info().n, b.R.info().own], [true, 4, 1]);
  // the table's corner (1, 0) of A's floor plan is the same place in B's: through the common frame
  const corner = b.R.local().planes[0].p[0], c = AL.fromCommon(FB, ...AL.toCommon(FA, 1, 0));
  near(corner[0], c[0], 0.011); near(corner[1], c[1], 0.011); near(corner[2], 0.72, 0.011, 'heights: common floor + B\'s');
  // A's scan changes: nothing goes up by itself (only the button sends a room)
  a.R.setScan({ planes: scan().planes.slice(0, 2) });
  for (let t = 1000; t < 5000; t += 1000) { a.R.update(t); hub.flush(); }
  assert.strictEqual(b.S.doc.room.data.planes.length, 4);
  // A goes: the server keeps the room, for B and for a newcomer
  hub.leave(0); hub.flush();
  assert.strictEqual(b.R.info().n, 4);
  const c2 = mk('C', FA); hub.flush();
  assert.strictEqual(c2.S.doc.room.data.planes.length, 4, 'a newcomer gets the kept room');
  c2.S.setLined({ dist: 3 }); c2.R.setScan(scan()); c2.R.update(0); hub.flush();
  assert.strictEqual(c2.S.doc.room.by, 0, 'C does not upload: the server has a room (from A, slot 0)');
  // B presses Upload (on its own menu, or C presses it on B's): B's scan is the server's room now, once
  assert.strictEqual(b.R.press('supplyRoom'), true); hub.flush();
  assert.strictEqual(c2.S.doc.room.by, b.S.me); assert.strictEqual(c2.S.doc.room.data.planes.length, 1);
  b.R.setScan(scan()); for (let t = 0; t < 3000; t += 500) { b.R.update(t); hub.flush(); }
  assert.strictEqual(c2.S.doc.room.data.planes.length, 1, 'and not again by itself');
  // not lined up: the button says so and sends nothing
  const d = mk('D', null); hub.flush(); d.R.setScan(scan()); d.R.press('supplyRoom'); hub.flush();
  assert.match(d.said.join(' '), /Line up first/); assert.strictEqual(c2.S.doc.room.by, b.S.me);
});

test('a server that restarted with no room takes the first headset\'s scan again, not an old copy', () => {
  let hub = new Hub();
  const S = new M.session.Session(hub.link('A'), {}), sp = new AL.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0), R = new M.room.Room(S, sp);
  hub.flush(); S.setLined({ dist: 3 }); R.setScan(scan()); R.update(0); hub.flush();
  assert.strictEqual(S.doc.room.data.planes.length, 4);
  R.setScan({ planes: scan().planes.slice(0, 1) });
  hub.leave(0);                                                 // the server goes away and comes back empty
  hub = new Hub(); const l = hub.link('A');
  S.link = l; l.onOpen = (h) => S._hello(h); l.onText = (m) => S._text(m); l.onClose = (w) => S._closed(w);
  hub.flush(); R.update(0); hub.flush();
  assert.strictEqual(S.doc.room.data.planes.length, 1);
});

test('alone, or not lined up, a page uses its own scan; the wrist menu shows the Room row while lining up', () => {
  const S = new M.session.Session(null, {}), sp = new AL.Space(null, 0), R = new M.room.Room(S, sp);
  R.setScan(scan()); R.update(0);
  assert.strictEqual(R.local().planes.length, 4); assert.strictEqual(S.doc.room, null, 'nothing sent');
  const L = new M.lineup.LineUp(S, sp), sys = new M.sysmenu.SysMenu(S, L, { room: R });
  sys.press('lineUp');
  const lay = M.sysmenu.SysMenu.layout(sys.info());
  assert.ok(lay.buttons.some((q) => q.id === 'supplyRoom'), 'the Room button');
  assert.ok(lay.buttons.some((q) => /own scan 4 planes/.test(q.value || '')), 'how many planes');
});

test('the cube rests on a table, tips off its edge and stops at a wall', () => {
  const cube = new C.Cube();
  cube.room = scan();
  cube.place(1.5, 0.5); cube.z = 1.0;                           // dropped over the table
  for (let i = 0; i < 300; i++) cube.step(0.01, i * 0.01, []);
  near(cube.z, 0.7 + C.HALF, 3e-3, 'on the table');
  assert.strictEqual(cube.moving(), false);
  cube.vx = -3;                                                 // pushed towards the table's edge (x = 1; at 0.4 it slides v2/(2 mu g) = 1.15 m)
  for (let i = 0; i < 400; i++) cube.step(0.01, i * 0.01, []);
  near(cube.z, C.HALF, 3e-3, 'on the floor again'); assert.ok(cube.x < 1);
  cube.place(1, 1.7); cube.vy = 6;                              // thrown hard at the wall (y = 2)
  for (let i = 0; i < 100; i++) { cube.step(0.01, i * 0.01, []); assert.ok(cube.y <= 2 - C.HALF + 2e-3, `never past the wall: ${cube.y}`); }
});

// a hand that pinches at the point `at` (thumb and index together)
const pinching = (id, at, on = true) => ({ id, pinch: on, points: [{ name: 'thumb', x: at[0] - 0.004, y: at[1], z: at[2] }, { name: 'index', x: at[0] + 0.004, y: at[1], z: at[2] }] });

test('held, the cube is on a spring: a hand pulled through a wall cannot take it through; pulled far away, it lets go', () => {
  const cube = new C.Cube(), wallY = 2;
  cube.room = scan(); cube.place(0.5, 1.6);
  let t = 0;
  const at = [0.5, 1.6 - C.HALF - 0.01, C.HALF];
  cube.step(0.016, t += 0.016, [pinching('h', at, false)]);
  cube.step(0.016, t += 0.016, [pinching('h', at)]);
  assert.strictEqual(cube.held.kind, 'pinch');
  for (let k = 1; k <= 30; k++) {                               // the hand goes 1 cm a frame through the wall
    cube.step(0.016, t += 0.016, [pinching('h', [at[0], at[1] + k * 0.01, at[2]])]);
    assert.ok(cube.y <= wallY - C.R + 1e-9, `the cube stays on its side: ${cube.y} at step ${k}`);
  }
  assert.ok(cube.held, 'still held 30 cm in');
  for (let k = 31; k <= 90; k++) cube.step(0.016, t += 0.016, [pinching('h', [at[0], at[1] + k * 0.01, at[2]])]);
  assert.strictEqual(cube.held, null, 'too far: let go'); assert.ok(cube.y < wallY);
});

test('a bed is solid to the floor: the cube rests on it, does not slide under it, and does not fall into a gap narrower than itself', () => {
  const room = { planes: [
    { l: 'bed', v: false, p: [[0, 0, 0.5], [2, 0, 0.5], [2, 1, 0.5], [0, 1, 0.5]] },
    { l: 'storage', v: false, p: [[0, 1.08, 0.5], [2, 1.08, 0.5], [2, 2, 0.5], [0, 2, 0.5]] },     // 8 cm from the bed: narrower than the cube
    { l: 'table', v: false, p: [[3, 0, 0.7], [4, 0, 0.7], [4, 1, 0.7], [3, 1, 0.7]] },
  ] };
  const cube = new C.Cube();
  cube.room = room;
  cube.place(-0.5, 0.5); cube.vx = 3;                           // slid at the bed's side on the floor
  for (let i = 0; i < 200; i++) { cube.step(0.01, i * 0.01, []); assert.ok(cube.x <= -C.HALF + 2e-3, `not under the bed: ${cube.x}`); }
  cube.place(1, 1.04); cube.z = 1;                              // dropped onto the gap between the bed and the storage
  for (let i = 0; i < 200; i++) cube.step(0.01, i * 0.01, []);
  near(cube.z, 0.5 + C.HALF, 3e-3, 'it rests across the gap');
  cube.place(2.5, 0.5); cube.vx = 2.5;                          // slid under the table: there is space under it (0.8 m)
  for (let i = 0; i < 100; i++) cube.step(0.01, i * 0.01, []);
  assert.ok(cube.x > 3.1, `under the table: ${cube.x}`); near(cube.z, C.HALF, 3e-3);
  // and lifted into it from below, it stops at the underside
  let t = 0;
  const at = [cube.x + C.HALF + 0.01, cube.y, cube.z];
  cube.step(0.016, t += 0.016, [pinching('h', at, false)]); cube.step(0.016, t += 0.016, [pinching('h', at)]);
  for (let k = 1; k <= 30; k++) cube.step(0.016, t += 0.016, [pinching('h', [at[0], at[1], at[2] + k * 0.02])]);
  near(cube.z + C.HALF, 0.7 - M.room.TABLE_T, 4e-3, 'held against the underside');
});

test('the grips: a fist holds the cube as well as a pinch; a hand closing on it does not push it away', () => {
  // a hand: palm at `p`; the four fingertips `d` from the palm (curled: small d), thumb tip beside the index
  const hand = (id, p, d) => {
    const pts = [['palm', 0, 0], ['index', d, 0.02], ['middle', d, 0.005], ['ring', d, -0.01], ['pinky', d, -0.025], ['thumb', d * 0.5, 0.05]]
      .map(([name, dx, dy]) => ({ name, x: p[0] + dx, y: p[1] + dy, z: p[2] }));
    return { id, pinch: false, points: pts };
  };
  const cube = new C.Cube();
  cube.place(0, 0);
  let t = 0;
  const palm = [C.HALF + 0.05, 0, C.HALF];
  cube.step(0.016, t += 0.016, [hand('r', palm, 0.09)]);
  cube.step(0.016, t += 0.016, [hand('r', palm, 0.03)]);
  assert.strictEqual(cube.held && cube.held.kind, 'fist', 'a fist closed at it');
  for (let k = 1; k <= 40; k++) cube.step(0.016, t += 0.016, [hand('r', [palm[0] + k * 0.005, 0, C.HALF + k * 0.005], 0.03)]);
  for (let k = 0; k < 20; k++) cube.step(0.016, t += 0.016, [hand('r', [palm[0] + 0.2, 0, C.HALF + 0.2], 0.03)]);
  near(cube.x, 0.2, 0.01, 'carried'); near(cube.z, C.HALF + 0.2, 0.01);
  cube.step(0.016, t += 0.016, [hand('r', [palm[0] + 0.2, 0, C.HALF + 0.2], 0.09)]);
  assert.strictEqual(cube.held, null, 'opened: let go');
  // the thumb and index coming together right at its face (2 cm apart, inside its skin) do not push it away
  cube.place(0, 0); for (let i = 0; i < 5; i++) cube.step(0.016, t += 0.016, []);
  const x = C.HALF - 0.005;
  cube.step(0.016, t += 0.016, [{ id: 'l', pinch: false, points: [{ name: 'thumb', x, y: -0.01, z: C.HALF }, { name: 'index', x, y: 0.01, z: C.HALF }] }]);
  near(cube.x, 0, 1e-3, 'not pushed while closing');
});

test('a scan that only shifts by a centimetre is the same scan (no new log line); a real change is new', () => {
  const S = new M.session.Session(null, {}), lines = [], R = new M.room.Room(S, new AL.Space(null, 0), { life: (t) => lines.push(t) });
  const jitter = (d) => ({ planes: scan().planes.map((p) => ({ l: p.l, v: p.v, p: p.p.map((c) => [c[0] + d, c[1] - d, c[2] + d]) })) });
  assert.strictEqual(R.setScan(scan()), true);
  for (let i = 0; i < 50; i++) assert.strictEqual(R.setScan(jitter(((i % 3) - 1) * 0.01)), false);
  assert.strictEqual(lines.length, 1, lines.join(' | '));
  assert.strictEqual(R.setScan(jitter(0.2)), true, 'moved 20 cm: new');
  assert.strictEqual(R.setScan({ planes: scan().planes.slice(1) }), true, 'a plane fewer: new');
});

// ---- the room's lights: the ceiling's height, the lamps of the scan, the marked ones, marking with a hand
test('the ceiling: its plane, else the tops of the walls, else 2.5 m', () => {
  assert.strictEqual(M.room.ceilingHeight(scan()), 2.4);
  assert.strictEqual(M.room.ceilingHeight({ planes: [{ l: 'wall', v: true, p: [[0, 0, 0], [3, 0, 0], [3, 0, 2.6], [0, 0, 2.6]] }] }), 2.6);
  assert.strictEqual(M.room.ceilingHeight(null), 2.5);
});

test('the room\'s lights: a long lamp of the scan is a strip, a square one round; marked ones; one taken away', () => {
  const room = { planes: scan().planes.concat([
    { l: 'lamp', v: false, p: [[1, 1, 2.38], [2.2, 1, 2.38], [2.2, 1.15, 2.38], [1, 1.15, 2.38]] },
    { l: 'light', v: false, p: [[0.3, 0.3, 2.38], [0.7, 0.3, 2.38], [0.7, 0.7, 2.38], [0.3, 0.7, 2.38]] },
    { l: 'lamp', v: false, p: [[2.5, 1.5, 1.2], [2.8, 1.5, 1.2], [2.8, 1.8, 1.2], [2.5, 1.8, 1.2]] },          // (a lamp on a sideboard: not the ceiling's)
  ]) };
  let L = M.room.lights(room, {});
  assert.strictEqual(L.length, 2);
  const tube = L.find((l) => !l.round), disc = L.find((l) => l.round);
  near(tube.len, 1.2, 0.01, 'the tube\'s length'); near(tube.w, 0.15, 0.01, 'its width'); near((tube.a[1] + tube.b[1]) / 2, 1.075, 0.01, 'along its middle');
  near(disc.w, 0.4, 0.01, 'the round one across'); assert.deepStrictEqual(disc.a, [0.5, 0.5]);
  L = M.room.lights(room, { [tube.id]: { del: true }, m1: { a: [1, 1], b: [1, 1], h: 2.4, w: 0.4 } });
  assert.deepStrictEqual(L.map((l) => `${l.id} ${l.from}`).sort(), ['m1 mark', `${disc.id} scan`]);
});

test('the document keeps the marked lights: a strip, a round one, one taken away; nonsense is not kept', () => {
  const S = { doc: {}, notify() {} }, K = M.room.LIGHT_KIND;
  assert.deepStrictEqual(K.keep({ id: 'm1' }), { key: 'rlight:m1' });
  K.apply(S, { k: 'rlight', id: 'm1', a: [1, 1], b: [2, 1], h: 2.4, w: 0.12 });
  K.apply(S, { k: 'rlight', id: 'm2', a: [0, 0], b: [0, 0], h: 2.4, w: 0.4 });
  K.apply(S, { k: 'rlight', id: 'm3', a: [0, 0], h: 2.4, w: 0.4 });
  K.apply(S, { k: 'rlight', id: 'm2', del: true });
  assert.deepStrictEqual(S.doc.rlights, { m1: { a: [1, 1], b: [2, 1], h: 2.4, w: 0.12 }, m2: { del: true } });
});

test('marking a light with a hand: the line from the eye through the pinch; a tap marks a round one or takes one away, a drag a strip', () => {
  const R = M.room, eye = [0, 0, 1.6];
  assert.deepStrictEqual(R.aimUp(eye, [0.1, 0, 1.8], 2.4).map((v) => +v.toFixed(3)), [0.4, 0], 'up through the fingers to the ceiling');
  assert.strictEqual(R.aimUp(eye, [0.5, 0, 1.6], 2.4), null, 'a hand held level points at no ceiling');
  const hand = (x, y, z, pinch) => ({ id: 'right', pinch, points: [{ name: 'thumb', x: x - 0.01, y, z }, { name: 'index', x: x + 0.01, y, z }] });
  const at = (p) => hand(eye[0] + (p[0] - eye[0]) * 0.25, eye[1] + (p[1] - eye[1]) * 0.25, eye[2] + (2.4 - eye[2]) * 0.25, false);
  const pinchAt = (p) => Object.assign(at(p), { pinch: true });
  let mk = new R.LightMarker(), out, t = 0;
  const run = (h, list = []) => { let d = null; for (let i = 0; i < 12; i++) { out = mk.update(eye, [h], 2.4, list, (t += 16)); d = d || out.done; } out.done = d; return out; };
  run(at([1, 1])); assert.ok(Math.abs(out.aim[0] - 1) < 0.01 && Math.abs(out.aim[1] - 1) < 0.01, 'aims where the line meets the ceiling');
  run(pinchAt([1, 1])); assert.strictEqual(out.done, null, 'nothing until it is let go');
  run(at([1, 1])); assert.ok(out.done && out.done.a[0] === 1 && out.done.a[1] === 1 && out.done.w === R.ROUND_W && out.done.h === 2.4, 'a tap: a round fitting');
  const tapId = out.done.id;
  run(at([1, 1])); assert.strictEqual(out.done, null, 'once');
  // a drag along a tube
  mk = new R.LightMarker(); run(at([0, 2])); run(pinchAt([0, 2]));
  for (let x = 0; x <= 1.2; x += 0.1) out = mk.update(eye, [pinchAt([x, 2])], 2.4, [], (t += 16));
  run(pinchAt([1.2, 2])); assert.ok(out.drag && Math.abs(out.drag.b[0] - 1.2) < 0.02, 'while drawn: the strip so far');
  run(at([1.2, 2])); assert.ok(out.done && out.done.w === R.STRIP_W && Math.abs(out.done.b[0] - 1.2) < 0.02 && out.done.a[0] === 0, 'let go: a strip');
  assert.notStrictEqual(out.done.id, tapId);
  // a tap on a light takes it away
  mk = new R.LightMarker(); const list = [{ id: 'm9', a: [1, 1], b: [2, 1], h: 2.4, w: 0.12 }];
  run(at([1.5, 1.04]), list); assert.strictEqual(out.over.id, 'm9', 'aimed at it');
  run(pinchAt([1.5, 1.04]), list); run(at([1.5, 1.04]), list); assert.deepStrictEqual(out.done, { k: 'rlight', id: 'm9', del: true });
});
