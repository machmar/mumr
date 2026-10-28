// Where the furniture stands in a real room (arrange.js): nothing on a wall, a sofa or a table, nothing outside the floor, the usual arrangement
// when there is room, the console on the other side or turned when there is not, and the same arrangement in the layout (spec.js) the host's
// physics and every page use.
const t = require('node:test'), assert = require('node:assert');
const S = require('./spec.js'), J = require('./arrange.js');
const G = J.arrangeGeometry;

const box = (l, x0, y0, x1, y1, h) => ({ l, v: false, p: [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]] });
const wall = (x0, y0, x1, y1) => ({ l: 'wall', v: true, p: [[x0, y0, 0], [x1, y1, 0], [x1, y1, 2.4], [x0, y0, 2.4]] });
const roomOf = (w, d, extra = []) => ({ planes: [box('floor', 0, 0, w, d, 0), wall(0, 0, w, 0), wall(w, 0, w, d), wall(w, d, 0, d), wall(0, d, 0, 0), ...extra] });
// every footprint of an arrangement (common frame): the plinth, the console, the scroll's stand, the lantern
function footprints(size, place) {
  const L = S.layout(size, place), c = L.console, toC = (p) => { const q = S.toCommon(place, [p[0], p[1], 0]); return [q[0], q[1]]; };
  const sc = L.score;
  return {
    plinth: G.rectPoly([0, 0], [1, 0], L.plinth.half, L.plinth.half).map(toC),
    console: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.at(a * c.half[0], b * c.half[1])).map(toC),
    scroll: G.rectPoly(sc.c, [-Math.sin(sc.yaw), Math.cos(sc.yaw)], 0.4, 0.15).map(toC),
    lantern: G.rectPoly(L.lantern, [1, 0], 0.12, 0.12).map(toC),
  };
}
function clearOf(room, size, place) {
  const obs = G.obstaclesOf(room), f = footprints(size, place), bad = [];
  for (const [k, poly] of Object.entries(f)) {
    for (const [a, b] of obs.walls) if (G.polySegDist(poly, a, b) < 0.01) bad.push(`${k} on a wall`);
    for (const o of obs.blocks) if (G.polyDist(poly, o.poly) < 0.01) bad.push(`${k} on the ${o.l}`);
    for (const q of poly) if (obs.floors.length && !obs.floors.some((fl) => G.inside(fl, q))) bad.push(`${k} off the floor`);
  }
  const names = Object.keys(f);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (G.polyDist(f[names[i]], f[names[j]]) < 0.01) bad.push(`${names[i]} on the ${names[j]}`);
  return bad;
}

t('with no room, or a big one, the usual arrangement: the tower in front of the player, the console on their left', () => {
  for (const room of [null, roomOf(6, 5)]) {
    const r = J.arrange({ head: [1, 2.5], yaw: 0, room });
    assert.strictEqual(r.hard, 0);
    assert.deepStrictEqual([r.place.x, r.place.y, r.place.yaw], [1.96, 2.5, 0]);
    assert.deepStrictEqual(r.place.arr.c, S.defaultArr('normal').c);
    const L = S.layout('normal', r.place), L0 = S.layout('normal');
    for (const k of ['board', 'score', 'tray']) assert.deepStrictEqual(L[k].c.map((v) => +v.toFixed(3)), L0[k].c.map((v) => +v.toFixed(3)), `${k} as usual`);
  }
});

t('a wall close on the left: the console goes to the right; nothing stands on a wall', () => {
  const room = roomOf(5, 1.9), r = J.arrange({ head: [0.5, 1.1], yaw: 0, room });
  assert.strictEqual(r.hard, 0);
  assert.ok(r.place.arr.v[1] < 0, 'the console is on the right');
  assert.deepStrictEqual(clearOf(room, 'normal', r.place), []);
});

t('narrow rooms, short rooms, a sofa and a table in the way, and the giant tower: everything fits and nothing overlaps', () => {
  const cases = [
    [roomOf(5, 1.7), [0.5, 0.85], 0, 'normal'],
    [roomOf(1.9, 4), [0.3, 2], 0, 'normal'],
    [roomOf(4, 3.1, [box('table', 1.9, 1.5, 2.7, 2.1, 0.72), box('couch', 0.1, 0.1, 1.1, 1.0, 0.5)]), [1, 1.8], 0, 'normal'],
    [roomOf(4, 3), [0.5, 1.5], 0, 'giant'],
    [roomOf(3, 3), [1.5, 0.5], Math.PI / 2, 'huge'],
  ];
  for (const [room, head, yaw, size] of cases) {
    const r = J.arrange({ head, yaw, room, size });
    assert.strictEqual(r.hard, 0, `${size} in a room ${JSON.stringify(head)}: ${JSON.stringify(r.parts)}`);
    assert.deepStrictEqual(clearOf(room, size, r.place), [], `${size} at ${JSON.stringify(head)}`);
    const P = S.toCommon(r.place, [...S.layout(size, r.place).P, 0]);
    assert.ok(Math.hypot(P[0] - head[0], P[1] - head[1]) < 0.01, 'the layout\'s player is where the player stands');
  }
});

t('the host\'s physics stands the console and the tray where the arrangement says', () => {
  const r = J.arrange({ head: [0.5, 1.1], yaw: 0, room: roomOf(5, 1.9) });
  const planes = S.furniture('normal', r.place), table = planes.find((p) => p.l === 'table'), f = footprints('normal', r.place).console;
  for (const q of table.p) assert.ok(f.some((c) => Math.hypot(c[0] - q[0], c[1] - q[1]) < 1e-6), 'the table plane is the console');
  const L = S.layout('normal', r.place), tray = S.toCommon(r.place, [L.tray.c[0], L.tray.c[1], 0]), die = S.toCommon(r.place, L.die.at);
  assert.ok(Math.abs(S.fromCommon(r.place, die)[0] - L.tray.c[0]) < L.tray.half && Math.abs(S.fromCommon(r.place, die)[1] - L.tray.c[1]) < L.tray.half, 'the die starts on the tray');
  assert.ok(!S.inDtower(L, L.die.at), 'beside the dice tower, not in it');
});

t('an arrangement made for another size is not used', () => {
  const r = J.arrange({ head: [0, 0], yaw: 0, size: 'giant', room: null });
  assert.deepStrictEqual(S.layout('normal', r.place).console.c, S.layout('normal').console.c);
});
