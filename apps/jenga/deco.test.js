// The room's garden (deco.js): what is planned stands on the floor or on a table's top, never under a table, behind a sofa, in a doorway or in
// the game's way; a strip's whole length is free; the plan is the same for the same room (every page grows the same garden, rule 1).
const t = require('node:test'), assert = require('node:assert');
const S = require('./spec.js'), A = require('./arrange.js'), D = require('./deco.js');
const G = A.arrangeGeometry;

const box = (l, x0, y0, x1, y1, h) => ({ l, v: false, p: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] });
const wall = (x0, y0, x1, y1) => ({ l: 'wall', v: true, p: [[x0, y0, 0], [x1, y1, 0], [x1, y1, 2.4], [x0, y0, 2.4]] });
const door = (x0, y0, x1, y1) => ({ l: 'door frame', v: true, p: [[x0, y0, 0], [x1, y1, 0], [x1, y1, 2.0], [x0, y0, 2.0]] });
const roomOf = (w, d, extra = []) => ({ planes: [box('floor', 0, 0, w, d, 0), wall(0, 0, w, 0), wall(w, 0, w, d), wall(w, d, 0, d), wall(0, d, 0, 0), ...extra] });
// a living room: a sofa along the far wall, a table, a side table and a shelf in corners, a door in the near wall
const SOFA = box('couch', 0.3, 3.2, 2.6, 4.1, 0.45), TABLE = box('table', 4.4, 0.2, 5.3, 1.0, 0.75);
const living = () => roomOf(5.5, 4.2, [SOFA, TABLE, box('other', 4.6, 3.6, 5.3, 4.1, 0.55), box('shelf', 0.1, 0.1, 0.6, 0.5, 0.6), door(2.0, 0, 2.9, 0)]);
const planFor = (room, head = [2.6, 1.6], yaw = 1.2, size = 'normal') => {
  const a = A.arrange({ size, head, yaw, room });
  return { place: a.place, plan: D.decoPlan({ room, size, place: a.place }) };
};
const TOPS = ['vase', 'incense', 'candle'];
// where each item stands on the floor plan: its outline (a strip: its whole length)
const outline = (it) => { const n = [Math.cos(it.yaw), Math.sin(it.yaw)], u = [-n[1], n[0]]; return G.rectPoly([it.at[0], it.at[1]], u, (it.len || 0.2) / 2, 0.1); };

t.test('a living room: a garden at the walls, a corner, tops; the kinds it plans', () => {
  const { plan } = planFor(living());
  const kinds = new Set(plan.items.map((i) => i.kind));
  for (const k of ['garden', 'lamp', 'vase', 'incense', 'candle']) assert.ok(kinds.has(k), `a ${k} in ${[...kinds].join(', ')}`);
  assert.ok(plan.items.every((i) => i.p === 0 || i.p === 1), 'every item is shown when full (1) or also when sparse (0)');
  assert.ok(plan.items.some((i) => i.p === 0) && plan.items.some((i) => i.p === 1), 'a sparse garden is a part of the full one');
  assert.strictEqual(new Set(plan.items.map((i) => i.id)).size, plan.items.length, 'ids are unique');
});

t.test('nothing under a table or on a thing, nothing off the floor, nothing in a doorway', () => {
  const room = living(), { plan } = planFor(room), obs = G.obstaclesOf(room);
  for (const it of plan.items.filter((i) => !TOPS.includes(i.kind))) {
    const o = outline(it);
    assert.strictEqual(it.at[2], 0, `${it.id} stands on the floor`);
    for (const b of obs.blocks) assert.ok(G.polyDist(o, b.poly) > 0.02, `${it.id} is clear of the ${b.l}`);
    for (const q of o) assert.ok(G.inside(obs.floors[0], q), `${it.id} is on the floor`);
    assert.ok(G.polySegDist(o, [2.0, 0], [2.9, 0]) > 0.3, `${it.id} is out of the doorway`);
  }
});

t.test('never behind a sofa: nothing between the sofa and the wall it stands against', () => {
  const { plan } = planFor(living());
  for (const it of plan.items) assert.ok(!(it.at[1] > 3.2 && it.at[0] > 0.1 && it.at[0] < 2.8 && it.at[2] < 0.3), `${it.id} at ${it.at} is behind the sofa`);
});

t.test('the tops: on a table, a side table or a shelf, never on the sofa; set in from the edges', () => {
  const room = living(), { plan } = planFor(room);
  const tops = room.planes.filter((p) => !p.v && p.l !== 'floor' && p.l !== 'couch');
  for (const it of plan.items.filter((i) => TOPS.includes(i.kind))) {
    const on = tops.find((p) => G.inside(p.p.map((q) => [q[0], q[1]]), [it.at[0], it.at[1]]));
    assert.ok(on, `${it.id} is on a top`);
    assert.ok(Math.abs(on.p[0][2] - it.at[2]) < 1e-6, `${it.id} stands on the ${on.l}'s top (${it.at[2]} m)`);
    assert.ok(G.polySegDist([[it.at[0], it.at[1]]], [on.p[0][0], on.p[0][1]], [on.p[1][0], on.p[1][1]]) > 0.05 || G.polySegDist([[it.at[0], it.at[1]]], [on.p[1][0], on.p[1][1]], [on.p[2][0], on.p[2][1]]) > 0.05, `${it.id} is set in from the edge`);
    assert.ok(!G.inside(SOFA.p.map((q) => [q[0], q[1]]), [it.at[0], it.at[1]]), `${it.id} is not on the sofa`);
  }
});

t.test('nothing in the game\'s way: the plinth and where it falls, the console, the scroll, the lantern, the player', () => {
  for (const [head, yaw] of [[[2.6, 1.6], 1.2], [[1.5, 2.0], 0], [[3.5, 2.2], -2.4]]) {
    const room = living(), { place, plan } = planFor(room, head, yaw), L = S.layout('normal', place);
    const toC = (p) => { const q = S.toCommon(place, [p[0], p[1], 0]); return [q[0], q[1]]; };
    const plinth = G.rectPoly([0, 0], [1, 0], L.plinth.half + L.d.height, L.plinth.half + L.d.height).map(toC);
    const c = L.console, consolePoly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.at(a * c.half[0], b * c.half[1])).map(toC);
    const player = G.rectPoly(L.P, [1, 0], 0.5, 0.5).map(toC);
    for (const it of plan.items.filter((i) => !TOPS.includes(i.kind))) {
      const o = outline(it);
      assert.ok(G.polyDist(o, plinth) > 0.1, `${it.id} is clear of the tower and where it falls`);
      assert.ok(G.polyDist(o, consolePoly) > 0.1, `${it.id} is clear of the console`);
      assert.ok(G.polyDist(o, player) > 0.1, `${it.id} is clear of the player`);
    }
  }
});

t.test('a garden strip: free along its whole length', () => {
  const room = living(), { plan } = planFor(room), obs = G.obstaclesOf(room);
  const strips = plan.items.filter((i) => i.kind === 'garden');
  assert.ok(strips.length >= 1);
  for (const it of strips) {
    assert.ok(it.len >= 0.8 && it.len <= 2.1 + 1e-9, `${it.id} is ${it.len} m long`);
    const n = [Math.cos(it.yaw), Math.sin(it.yaw)], u = [-n[1], n[0]];
    for (let s = -it.len / 2; s <= it.len / 2 + 1e-9; s += 0.1) {
      const q = [it.at[0] + u[0] * s, it.at[1] + u[1] * s];
      assert.ok(G.inside(obs.floors[0], q), `${it.id} on the floor at ${s.toFixed(1)}`);
      for (const b of obs.blocks) assert.ok(!G.inside(b.poly, q), `${it.id} not under the ${b.l} at ${s.toFixed(1)}`);
      // (at a wall's foot, facing into the room)
      const back = [q[0] - n[0] * 0.3, q[1] - n[1] * 0.3];
      assert.ok(obs.walls.some(([a, b]) => G.polySegDist([back, q], a, b) < 0.01), `${it.id} has a wall behind it at ${s.toFixed(1)}`);
    }
  }
});

t.test('the same room, the same garden; another room, another; a small room or no room, little or nothing', () => {
  const a = planFor(living()).plan, b = planFor(living()).plan;
  assert.deepStrictEqual(a, b, 'the same plan on every page and every time the host plans it');
  const moved = planFor(roomOf(5.5, 4.2, [SOFA, TABLE])).plan;
  assert.notDeepStrictEqual(moved.items.map((i) => i.seed), a.items.map((i) => i.seed));
  assert.deepStrictEqual(D.decoPlan({ room: null, size: 'normal', place: planFor(living()).place }), { items: [] });
  assert.deepStrictEqual(D.decoPlan({ room: living(), size: 'normal', place: null }), { items: [] });
  // (a box room barely bigger than the game: the game takes the floor; whatever fits is still on the floor and clear of it)
  const small = roomOf(2.6, 2.4), sp = planFor(small, [1.3, 0.5], Math.PI / 2);
  for (const it of sp.plan.items) for (const q of outline(it)) assert.ok(G.inside(G.obstaclesOf(small).floors[0], q), `${it.id} on the floor of the small room`);
  assert.ok(sp.plan.items.length <= 4, `a small room is not crowded (${sp.plan.items.length})`);
});

t.test('the referee keeps the plan in the document: a jdeco event, only when it changes', () => {
  const L = require('./logic.js');
  assert.ok(L.KINDS && L.KINDS.jdeco, 'jdeco is a kept kind');
});

t.test('a huge or a giant tower leaves a garden at the walls (it took the whole room: Marek, 2026-10-28)', () => {
  for (const [size, room, head] of [['giant', roomOf(4, 4), [2, 1]], ['giant', roomOf(5.5, 4.2), [2.6, 1.6]], ['huge', roomOf(3.5, 5, [box('couch', 0.2, 4.1, 2.4, 4.9, 0.45)]), [1.7, 1.2]]]) {
    const a = A.arrange({ size, head, yaw: Math.PI / 2, room }), plan = D.decoPlan({ room, size, place: a.place });
    assert.ok(plan.items.filter((i) => i.kind === 'garden').length >= 2, `${size}: ${plan.items.map((i) => i.kind).join(', ')}`);
  }
});
