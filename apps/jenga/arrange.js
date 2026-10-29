// Where the game's furniture stands in the real room: the host works it out when the game is put down (and when the size or the room changes),
// and keeps it in the shared place (`place.arr`, spec.js layout), so that every headset, the PC view and the host's physics have the same
// arrangement (rule 1: worked out once, from the server's room, in the common frame). No THREE and no DOM.
//
//   arrange({ size, head: [x, y], yaw, room })  -> { place: { x, y, yaw, hx, hy, arr }, cost, hard, parts }
//     head, yaw: where the player who put the game down stands and the way they look (common frame); the tower goes in front of them
//     (`place.hx, hy` keep the head, so that the game can be arranged again for another size or another room).
//     room: the real room in the common frame ({ planes }, engine room.js) or null.
//
// What it looks for, in order: nothing stands in a wall, on a sofa, a bed or a table, or outside the room's floor; nothing stands on anything
// else of the game's or where the player stands; the player has room in front of the board; then the arrangement nearest the usual one
// (the console to the left of the tower, the scroll at its far end, the lantern at its near end), the tower where it was asked for, and room
// to walk round the plinth. In a narrow room the console goes to the other side, closer, further along, behind the tower, or turns; the scroll
// and the lantern go wherever is left. When nothing fits, the arrangement that collides least is kept (and says so: `hard` > 0).
(function (J) {
  const node = typeof module !== 'undefined';
  const need = (n) => (node ? require(`./${n}.js`) : J);
  const S = need('spec');
  const M = node ? require('../../engine/client/index.js') : globalThis.MUMR;

  // ---- floor-plan geometry
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  function segDistPt(p, a, b) { const ab = sub(b, a), L2 = dot(ab, ab) || 1e-12, t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t); }
  function segsCross(a, b, c, d) {
    const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a)), d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  const segDist = (a, b, c, d) => (segsCross(a, b, c, d) ? 0 : Math.min(segDistPt(a, c, d), segDistPt(b, c, d), segDistPt(c, a, b), segDistPt(d, a, b)));
  function inside(poly, p) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  }
  const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
  // how far apart two polygons are (0: they overlap)
  function polyDist(A, B) {
    if (A.some((p) => inside(B, p)) || B.some((p) => inside(A, p))) return 0;
    let d = Infinity;
    for (const [a, b] of edges(A)) for (const [c, e] of edges(B)) d = Math.min(d, segDist(a, b, c, e));
    return d;
  }
  function polySegDist(A, a, b) {
    if (inside(A, a) || inside(A, b)) return 0;
    let d = Infinity;
    for (const [c, e] of edges(A)) d = Math.min(d, segDist(a, b, c, e));
    return d;
  }
  const area = (poly) => Math.abs(poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0)) / 2;

  // ---- the real room as obstacles: walls (segments), things standing on the floor (outlines), and the floor (where things may stand)
  const bbox = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
  const apart = (a, b, m) => a[0] > b[2] + m || b[0] > a[2] + m || a[1] > b[3] + m || b[1] > a[3] + m;      // (two boxes further apart than m)
  function obstaclesOf(room) {
    const out = { walls: [], blocks: [], floors: [] };
    if (!room || !room.planes) return out;
    for (const w of M.room.walls(room)) { const seg = [[w.x0, w.y0], [w.x1, w.y1]]; seg.box = bbox(seg); out.walls.push(seg); }
    for (const b of M.room.blocks(room)) if (b.hi > 0.08) { const poly = b.pts.map((q) => [q[0], q[1]]); out.blocks.push({ poly, box: bbox(poly), l: b.l }); }
    for (const t of M.room.surfaces(room)) if (t.k === 'floor' && t.h < 0.05 && t.pts.length >= 3 && area(t.pts) > 1) out.floors.push(t.pts.map((q) => [q[0], q[1]]));
    return out;
  }

  // ---- the game's things, as outlines in the game frame
  const rectPoly = (c, u, hu, hv) => { const v = [-u[1], u[0]]; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * hu * a + v[0] * hv * b, c[1] + u[1] * hu * a + v[1] * hv * b]); };
  const circlePoly = (c, r, n = 10) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((i / n) * Math.PI * 2), c[1] + r * Math.sin((i / n) * Math.PI * 2)]);
  // (m: the scroll's stand to the ends of its top beam and its feet; the lantern with its cap; where a player stands; room in front of the board;
  // the console with the board's stand, whose beam reaches past the table's back when the board is turned)
  // Against the room (walls are full height) the whole width counts; between the game's own things only the feet (the scroll's beam passes over the
  // end of the table)
  const SCROLL = { hu: 0.56, feet: 0.43, hv: 0.19, side: -0.14 },          // (hu: the beam; side: the arm with the how-to sign reaches this much further on one side, -u)
  LANTERN = 0.15, PLAYER = 0.32, ACCESS = 0.42, CONSOLE_BACK = 0.08;

  // cost of one outline (game frame) against the room (common frame): { hard, soft }
  function against(obs, place, poly, clear, opts = {}) {
    const P = poly.map((p) => S.toCommon(place, [p[0], p[1], 0])).map((q) => [q[0], q[1]]), box = bbox(P), m = Math.max(clear, opts.near || 0);
    let hard = 0, soft = 0;
    for (const w of obs.walls) { if (apart(box, w.box, m)) continue; const [a, b] = w, d = polySegDist(P, a, b); if (d < clear) hard += 1 + (clear - d) * 10; else if (opts.near && d < opts.near) soft += (opts.near - d) * (opts.nearCost || 2); }
    for (const b of obs.blocks) { if (apart(box, b.box, m)) continue; const d = polyDist(P, b.poly); if (d < clear) hard += 1 + (clear - d) * 10; else if (opts.near && d < opts.near) soft += (opts.near - d) * (opts.nearCost || 2); }
    if (obs.floors.length) {                          // (every corner on the room's floor: not through a wall into the next room)
      for (const q of P) if (!obs.floors.some((f) => inside(f, q))) hard += 1;
    }
    return { hard, soft };
  }

  // the candidates for the console (game frame), with what they cost against the usual one; half: the plinth's half size.
  // u: along the table, v: across it towards its back (where the board stands; the front is where it is pressed from)
  function consoles(half) {
    const out = [];
    for (const side of [1, -1]) {
      // the usual: along the player's way, to the side of the tower, its back away from the tower
      for (const along of [-0.15, -0.55, 0.25, -0.95]) for (const gap of [0.62, 0.48, 0.8, 0.38]) {
        out.push({ c: [along, side * (half + gap)], u: [1, 0], v: [0, side], pref: (side < 0 ? 0.15 : 0) + 0.25 * Math.abs(along + 0.15) + 0.6 * Math.abs(gap - 0.62) });
      }
      // turned: across the player's way, beside the tower, its back away from the player (for a room that is short in front of the player)
      for (const along of [0, -0.4, 0.35]) out.push({ c: [along, side * (half + 0.9)], u: [0, side], v: [1, 0], pref: 0.9 + 0.3 * Math.abs(along) });
      // behind the tower, across the player's way (for a corridor)
      for (const off of [0, 0.35, 0.7]) out.push({ c: [half + 0.65, side * off], u: [0, side], v: [1, 0], pref: 1.6 + 0.2 * off });
    }
    return out;
  }

  function arrange({ size = 'normal', head = [0, 0], yaw = 0, room = null } = {}) {
    const d = S.dims(size), half = Math.max(0.16, 2 * d.L), obs = obstaclesOf(room), base = half + 0.8;
    // where the tower may go: in front of the player, nearer or further, or turned a little about where they stand (the cheapest first)
    const towers = [];
    // (lat: the tower a little to the side of straight ahead; the player is then at (-p, -lat) in the game frame)
    for (const dist of [base, base - 0.2, base + 0.25, base + 0.5, base - 0.35, base + 0.8, base + 1.2]) for (const dy of [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9, -1.4, 1.4]) for (const lat of [0, 0.35, -0.35, 0.7, -0.7]) {
      const a = yaw + dy, f = [Math.cos(a), Math.sin(a)], l = [-f[1], f[0]];
      towers.push({ place: { x: head[0] + f[0] * dist + l[0] * lat, y: head[1] + f[1] * dist + l[1] * lat, yaw: a }, p: dist, q: -lat, cost: 1.2 * Math.abs(dist - base) + 1.0 * Math.abs(dy) + 0.9 * Math.abs(lat) });
    }
    towers.sort((a, b) => a.cost - b.cost);
    const C = consoles(half), H = S.TABLE.half;
    let best = null;
    for (const tw of towers) {
      if (best && best.hard === 0 && tw.cost >= best.soft) break;                 // (nothing further on can be cheaper)
      const pl = tw.place, P = [-tw.p, tw.q];
      // the plinth (with room to walk round it, which is wanted, not needed); where the player stands (the game's things keep off it)
      const plinth = rectPoly([0, 0], [1, 0], half, half), me = circlePoly(P, PLAYER);
      const a0 = against(obs, pl, plinth, 0.08, { near: 0.5, nearCost: 3 });
      const hard0 = a0.hard, soft0 = tw.cost + a0.soft;
      if (best && hard0 > best.hard) continue;
      // the console: in the room, not on the plinth or the player, with room in front of the board for whoever presses it
      const cons = [];
      for (const c of C) {
        const poly = rectPoly(c.c, c.u, H[0], H[1]), whole = rectPoly([c.c[0] + c.v[0] * CONSOLE_BACK / 2, c.c[1] + c.v[1] * CONSOLE_BACK / 2], c.u, H[0], H[1] + CONSOLE_BACK / 2), front = rectPoly([c.c[0] - c.v[0] * (H[1] + ACCESS / 2), c.c[1] - c.v[1] * (H[1] + ACCESS / 2)], c.u, H[0] * 0.7, ACCESS / 2);
        const own = (polyDist(poly, plinth) < 0.15 ? 2 : 0) + (polyDist(poly, me) < 0.05 ? 2 : 0);
        const a = against(obs, pl, whole, 0.02), f = against(obs, pl, front, 0);
        cons.push({ c, poly, hard: hard0 + a.hard + own + 0.5 * f.hard, soft: soft0 + c.pref + a.soft });
      }
      cons.sort((x, y) => x.hard - y.hard || x.soft - y.soft);
      for (const k of cons.slice(0, 4)) {
        const c = k.c, at = (du, dv) => [c.c[0] + c.u[0] * du + c.v[0] * dv, c.c[1] + c.u[1] * du + c.v[1] * dv];
        const taken = [plinth, me, k.poly];
        const pick = (cands, make, clear) => {
          let b = null;
          for (const q of cands) {
            const m = make(q.at), poly = m.feet || m, own = taken.reduce((s, t) => s + (polyDist(poly, t) < 0.06 ? 1.5 : 0), 0), a = against(obs, pl, m.whole || m, clear);
            const r = { at: q.at, poly, hard: a.hard + own, soft: q.pref + a.soft };
            if (!b || r.hard < b.hard || (r.hard === b.hard && r.soft < b.soft)) b = r;
          }
          return b;
        };
        // the scroll: at the console's far end, its near end, behind it, across the tower, behind the tower; it faces the player
        const scrollAt = (q) => { const f = Math.atan2(P[1] - q[1], P[0] - q[0]), u = [-Math.sin(f), Math.cos(f)]; const sd = SCROLL.side / 2; return { feet: rectPoly(q, u, SCROLL.feet, SCROLL.hv), whole: rectPoly([q[0] + u[0] * sd, q[1] + u[1] * sd], u, SCROLL.hu + Math.abs(sd), SCROLL.hv) }; };
        const sc = pick([{ at: at(0.95, 0.15), pref: 0 }, { at: at(1.05, -0.2), pref: 0.15 }, { at: at(-0.95, 0.15), pref: 0.3 }, { at: at(0.2, 0.75), pref: 0.5 },
          { at: [-0.15, -Math.sign(c.v[1] || 1) * (half + 0.75)], pref: 0.6 }, { at: [half + 0.65, 0], pref: 0.8 }, { at: [half + 0.6, Math.sign(c.v[1] || 1) * (half + 0.5)], pref: 0.7 }], scrollAt, 0.02);
        taken.push(sc.poly);
        // the lantern: at the console's near end, its far end, behind it, beside the player, by the plinth's corners
        const lanternAt = (q) => rectPoly(q, [1, 0], LANTERN, LANTERN);
        const sgn = Math.sign(c.c[1]) || 1;
        const la = pick([{ at: at(-0.8, 0.05), pref: 0 }, { at: at(-0.85, -0.3), pref: 0.1 }, { at: at(0.9, -0.35), pref: 0.15 }, { at: at(-0.4, 0.6), pref: 0.2 },
          { at: [P[0] + 0.15, P[1] - sgn * 0.7], pref: 0.25 }, { at: [half + 0.35, -sgn * (half + 0.35)], pref: 0.3 }, { at: [half + 0.35, sgn * (half + 0.35)], pref: 0.35 }, { at: [P[0] - 0.1, P[1] + sgn * 0.75], pref: 0.3 }], lanternAt, 0.02);
        const hard = k.hard + sc.hard + la.hard, soft = k.soft + sc.soft + la.soft;
        if (!best || hard < best.hard - 1e-9 || (Math.abs(hard - best.hard) < 1e-9 && soft < best.soft)) {
          best = { hard, soft, place: pl, arr: { size: d.size, p: tw.p, q: tw.q, c: c.c, u: c.u, v: c.v, s: sc.at, l: la.at }, parts: { plinth: hard0, console: k.hard - hard0, scroll: sc.hard, lantern: la.hard } };
        }
      }
    }
    const r3 = (v) => Math.round(v * 1000) / 1000 + 0, r4 = (v) => Math.round(v * 1e4) / 1e4 + 0, pt = (q) => q.map(r3);       // (+ 0: no -0)
    const A = best.arr, pl = best.place;
    return { place: { x: r3(pl.x), y: r3(pl.y), yaw: r4(pl.yaw), hx: r3(head[0]), hy: r3(head[1]), arr: { size: A.size, p: r3(A.p), q: r3(A.q), c: pt(A.c), u: A.u.map(r4), v: A.v.map(r4), s: pt(A.s), l: pt(A.l) } }, cost: best.soft, hard: best.hard, parts: best.parts };
  }

  Object.assign(J, { arrange, arrangeGeometry: { polyDist, polySegDist, inside, rectPoly, obstaclesOf } });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
