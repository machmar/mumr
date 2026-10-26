const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const SH = M.mixedshow;

// stand-ins for the objects of an app's PC view (the real ones are THREE objects; only `visible` is read here)
const o = () => ({ visible: true });
function makeView() {
  const v = { hands: [o(), o(), o()], head: [o(), o()], floor: [o()], grid: o(), marks: [o(), o()], cameras: o(), walls: [o(), o()], boxes: [o()], menus: new Map([['0:main', o()], ['1:wrist', o()]]), other: o() };
  v.parts = { hands: () => v.hands, head: () => v.head, floor: () => v.floor, grid: () => v.grid, marks: () => v.marks, cameras: () => v.cameras, walls: () => v.walls, boxes: () => v.boxes, menus: () => v.menus };
  return v;
}
const vis = (xs) => [].concat(xs instanceof Map ? [...xs.values()] : xs).map((x) => x.visible);

test('the defaults: everything on except the grid floor', () => {
  assert.deepStrictEqual(SH.DEFAULTS, { hands: true, head: true, floor: true, grid: false, marks: true, cameras: true, walls: true, boxes: true, menus: true, occlude: true });
  assert.deepStrictEqual(SH.ITEMS.map((i) => i.id), ['hands', 'head', 'floor', 'grid', 'marks', 'cameras', 'walls', 'boxes', 'menus', 'occlude']);
  assert.strictEqual(SH.ITEMS.find((i) => i.id === 'grid').label, 'Grid floor');
});

test('the grid floor is its own switch, off at the start, and is not the floor outline or the rugs', () => {
  const v = makeView(), r = SH.apply(v, SH.DEFAULTS);
  assert.ok(r.ok); assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(v.grid.visible, false, 'the grid is hidden by default');
  assert.deepStrictEqual(vis(v.floor), [true]);
  SH.apply(v, Object.assign({}, SH.DEFAULTS, { grid: true }));
  assert.strictEqual(v.grid.visible, false, 'a part that is on is left alone: the view shows it again (here it stayed hidden)');
  const w = makeView(); SH.apply(w, Object.assign({}, SH.DEFAULTS, { grid: true, floor: false }));
  assert.strictEqual(w.grid.visible, true, 'the grid does not follow the floor switch');
  assert.deepStrictEqual(vis(w.floor), [false]);
});

test('each switch hides its own part when it is off, and leaves it to the view when it is on', () => {
  const v = makeView(), s = Object.assign({}, SH.DEFAULTS, { grid: true });
  Object.assign(s, { floor: false, walls: false }); SH.apply(v, s);
  assert.deepStrictEqual(vis(v.floor), [false]); assert.deepStrictEqual(vis(v.walls), [false, false]); assert.deepStrictEqual(vis(v.boxes), [true]); assert.deepStrictEqual(vis(v.marks), [true, true]);
  v.floor.forEach((x) => { x.visible = true; }); v.walls.forEach((x) => { x.visible = true; });        // (the view draws its frame)
  Object.assign(s, { floor: true, walls: true, boxes: false }); SH.apply(v, s);
  assert.deepStrictEqual(vis(v.floor), [true]); assert.deepStrictEqual(vis(v.walls), [true, true]); assert.deepStrictEqual(vis(v.boxes), [false]);
  Object.assign(s, { marks: false }); SH.apply(v, s); assert.deepStrictEqual(vis(v.marks), [false, false]);
});

test('hands, head cones, menus and cameras: hidden when off, and left alone (the view decides) when on', () => {
  const v = makeView();
  SH.apply(v, Object.assign({}, SH.DEFAULTS, { hands: false }));
  assert.deepStrictEqual(vis(v.hands), [false, false, false]); assert.deepStrictEqual(vis(v.head), [true, true]);
  const w = makeView(); w.head[1].visible = false;                                              // (a player that is not there: the view had hidden its head)
  SH.apply(w, SH.DEFAULTS); assert.strictEqual(w.head[1].visible, false, 'not turned on by us');
  const h = makeView(); SH.apply(h, Object.assign({}, SH.DEFAULTS, { head: false, menus: false, cameras: false }));
  assert.deepStrictEqual(vis(h.head), [false, false]); assert.deepStrictEqual(vis(h.menus), [false, false]); assert.strictEqual(h.cameras.visible, false); assert.deepStrictEqual(vis(h.hands), [true, true, true]);
});

test('anything the view did not hand over is not touched', () => {
  const v = makeView(); SH.apply(v, { hands: false, head: false, floor: false, grid: false, marks: false, cameras: false, walls: false, boxes: false, menus: false });
  assert.strictEqual(v.other.visible, true);
});

test('a part the view does not give is named, and breaks nothing', () => {
  const v = makeView(); delete v.parts.walls; delete v.parts.boxes;
  const r = SH.apply(v, Object.assign({}, SH.DEFAULTS, { hands: false }));
  assert.strictEqual(r.ok, false); assert.deepStrictEqual(r.missing, ['walls', 'boxes']);
  assert.deepStrictEqual(vis(v.hands), [false, false, false], 'the rest still works');
  assert.deepStrictEqual(SH.apply({}, SH.DEFAULTS).missing, SH.PARTS);
  assert.deepStrictEqual(SH.apply(null, SH.DEFAULTS).missing, SH.PARTS);
});

test('a static part (the view never shows or hides it) comes back when its switch is turned on again', () => {
  const v = makeView(), s = Object.assign({}, SH.DEFAULTS, { grid: true });
  v.parts.grid = { objects: () => v.grid, static: true }; v.parts.cameras = { objects: () => [v.cameras], static: true };
  Object.assign(s, { grid: false, cameras: false }); SH.apply(v, s);
  assert.strictEqual(v.grid.visible, false); assert.strictEqual(v.cameras.visible, false);
  Object.assign(s, { grid: true, cameras: true }); SH.apply(v, s);
  assert.strictEqual(v.grid.visible, true); assert.strictEqual(v.cameras.visible, true);
  const w = makeView(); w.head.forEach((x) => { x.visible = false; }); SH.apply(w, SH.DEFAULTS);
  assert.deepStrictEqual(vis(w.head), [false, false], 'a part the view drives is never turned on by us');
});

test('objects: a function, a Map, nested arrays; things that cannot be hidden are skipped', () => {
  const a = o(), b = o();
  assert.deepStrictEqual(SH.objects(() => [a, [b, null, 5, {}]]), [a, b]);
  assert.deepStrictEqual(SH.objects(new Map([['x', a]])), [a]);
  assert.deepStrictEqual(SH.objects(a), [a]);
  assert.deepStrictEqual(SH.objects(undefined), []);
});

test('clean: saved settings are merged into the defaults; unknown keys and wrong types are dropped', () => {
  assert.deepStrictEqual(SH.clean(null), SH.DEFAULTS);
  assert.deepStrictEqual(SH.clean({ floor: false, grid: true, hands: false }), Object.assign({}, SH.DEFAULTS, { floor: false, grid: true, hands: false }));
  assert.deepStrictEqual(SH.clean({ floor: 'yes', bogus: true, head: 0 }), SH.DEFAULTS);
  assert.deepStrictEqual(SH.clean('rubbish'), SH.DEFAULTS);
});
