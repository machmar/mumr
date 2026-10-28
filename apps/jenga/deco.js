// The room's garden: where small calm things are put in the real room round the game (Marek, 2026-10-28: "automatic room decorations for more
// immersion and calmness ... placed on objects or at the bottoms of walls (never under tables)"). The host plans it from the server's room and the
// game's arrangement and keeps the plan in the document (`jdeco`), so every headset and the PC view grow the same things in the same places (rule 1);
// the pages draw them (decor.js). No THREE and no DOM.
//
//   plan({ room, size, place, seed }) -> { items: [{ id, kind, at: [x, y, h], yaw, len, seed, p }] }   (common frame; yaw: the way it faces into
//     the room; len: a strip's length; p: 0 shown when the garden is sparse, 1 only when full)
//
// Where things may go, and where never:
//   the foot of a wall   2 cm out from it, along the stretches that are free: never under or behind a table or a desk, never behind a sofa, a bed or
//                        a cabinet (anything standing between the wall and the middle of the room: the headset could not hide a thing there behind it,
//                        it would show through), never in a doorway, never in the game's way (the plinth and where its blocks fall, the console and
//                        the room in front of the board, the scroll, the lantern, where the players stand)
//   a corner             where two walls meet: something tall (bamboo)
//   a top                a table's or a piece of furniture's, 0.3 to 1.5 m high: near its back corner, never in the middle
// Kinds: garden (a strip of raked sand with stones and moss along a wall), stones (a few stones and a moss mound), lamp (a small paper lantern on the
// floor: it lights the wall, engine relight), bamboo (a corner), vase (a branch in blossom), incense (a thin curl of smoke), candle (a small flame).
(function (J) {
  const node = typeof module !== 'undefined';
  const need = (n) => (node ? require(`./${n}.js`) : J);
  const S = need('spec'), A = need('arrange');
  const M = node ? require('../../engine/client/index.js') : globalThis.MUMR;
  const G = () => A.arrangeGeometry;

  const STEP = 0.2, FOOT = 0.16;                   // m: the step along a wall; how far a thing at a wall's foot stands from it (its middle)
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len2 = (a) => Math.hypot(a[0], a[1]);
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

  // the room as the garden needs it: walls (with the way into the room), doorways, what stands on the floor, the floor, the tops
  function readRoom(room) {
    const o = G().obstaclesOf(room), R = M.room, out = { walls: [], doors: [], blocks: o.blocks, floors: o.floors, tops: [] };
    for (const pl of room.planes) {
      if (!pl.v || R.kind(pl) !== 'opening') continue;
      let best = -1, a = pl.p[0], b = pl.p[0];
      for (const p of pl.p) for (const q of pl.p) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d > best) { best = d; a = p; b = q; } }
      out.doors.push([[a[0], a[1]], [b[0], b[1]]]);
    }
    const mids = o.walls.map(([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), centre = mids.length ? [mids.reduce((s, m) => s + m[0], 0) / mids.length, mids.reduce((s, m) => s + m[1], 0) / mids.length] : [0, 0];
    const onFloor = (p) => !out.floors.length || out.floors.some((f) => G().inside(f, p));
    for (const [a, b] of o.walls) {
      const d = sub(b, a), L = len2(d);
      if (L < 0.5) continue;
      const u = [d[0] / L, d[1] / L], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let n = [-u[1], u[0]];
      const test = [m[0] + n[0] * 0.3, m[1] + n[1] * 0.3];
      const inward = out.floors.length ? onFloor(test) : (centre[0] - m[0]) * n[0] + (centre[1] - m[1]) * n[1] > 0;
      if (!inward) n = [-n[0], -n[1]];
      out.walls.push({ a, b, u, n, L });
    }
    for (const t of R.surfaces(room)) {
      if (t.k === 'floor' || t.h < 0.3 || t.h > 1.5 || t.pts.length < 3 || /bed|couch|sofa|chair|seat|screen|tv/i.test(t.l || '')) continue;      // (not on a bed or a sofa: a table's, a desk's, a shelf's, a cabinet's)
      const poly = t.pts.map((q) => [q[0], q[1]]), area = Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2;
      if (area >= 0.1) out.tops.push({ poly, h: t.h, area, l: t.l });
    }
    out.onFloor = onFloor;
    return out;
  }

  // the game's way (common frame): outlines nothing of the garden may stand on
  function gameZones(size, place) {
    const L = S.layout(size, place), d = L.d, c = L.console, toC = (p) => { const q = S.toCommon(place, [p[0], p[1], 0]); return [q[0], q[1]]; }, geo = G();
    const zones = [
      geo.rectPoly([0, 0], [1, 0], L.plinth.half + d.height + 0.35, L.plinth.half + d.height + 0.35).map(toC),           // the plinth and where its blocks fall, and room to walk round
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.at(a * (c.half[0] + 0.15), b * (c.half[1] + 0.15) - (b < 0 ? 0.55 : 0))).map(toC),   // the console and the room in front of the board
      geo.rectPoly(L.score.c, [-Math.sin(L.score.yaw), Math.cos(L.score.yaw)], 0.65, 0.35).map(toC),
      geo.rectPoly(L.lantern, [1, 0], 0.3, 0.3).map(toC),
      geo.rectPoly(L.P, [1, 0], 0.7, 0.7).map(toC),                                                                         // where the player stands
    ];
    return zones;
  }

  // is a round spot of radius r at p (on the floor, by a wall whose way into the room is n) free?
  function freeAt(R, zones, p, r, n) {
    const geo = G(), ring = Array.from({ length: 8 }, (_, i) => [p[0] + r * Math.cos(i * Math.PI / 4), p[1] + r * Math.sin(i * Math.PI / 4)]);
    if (!R.onFloor(p)) return false;
    for (const b of R.blocks) if (geo.inside(b.poly, p) || geo.polyDist(ring, b.poly) < 0.08) return false;     // (never under a table, never on a thing)
    for (const [a, b] of R.doors) if (geo.polySegDist(ring, a, b) < 0.45) return false;                            // (a doorway is a way through)
    for (const z of zones) if (geo.polyDist(ring, z) < 0.02) return false;
    if (n) for (let s = 0.15; s <= 1.3; s += 0.1) {                                                                 // (nothing tall between it and the room: it would show through)
      const q = [p[0] + n[0] * s, p[1] + n[1] * s];
      for (const b of R.blocks) if (b.hi === undefined || b.hi > 0.25) { if (geo.inside(b.poly, q)) return false; }
    }
    return true;
  }

  function plan({ room = null, size = 'normal', place = null, seed = null } = {}) {
    if (!room || !room.planes || !room.planes.length || !place) return { items: [] };
    const R = readRoom(room), zones = gameZones(size, place), items = [];
    const base = seed === null ? hashStr(JSON.stringify(room.planes.map((p) => p.p.map((q) => q.map((v) => Math.round(v * 10)))))) : seed >>> 0;
    const seedOf = (k) => (Math.imul(base ^ hashStr(k), 2654435761) >>> 0);
    const placed = [];                                 // the outlines of what is placed already (nothing is put on another)
    const add = (kind, at, yaw, p, extra = {}) => {
      const id = `${kind}${items.length}`, n = [Math.cos(yaw), Math.sin(yaw)], u = [-n[1], n[0]];
      items.push(Object.assign({ id, kind, at: at.map(r3), yaw: r3(yaw), seed: seedOf(id + at.map((v) => v.toFixed(1)).join()), p }, extra));
      placed.push(G().rectPoly([at[0], at[1]], u, (extra.len || 0.24) / 2, 0.14));
    };
    const clearOfPlaced = (p, r) => { const ring = Array.from({ length: 8 }, (_, i) => [p[0] + r * Math.cos(i * Math.PI / 4), p[1] + r * Math.sin(i * Math.PI / 4)]); return placed.every((q) => G().polyDist(ring, q) > 0.05); };
    // ---- the free stretches at the walls' feet
    const runs = [];
    R.walls.forEach((w, wi) => {
      let start = null, last = null;
      const close = () => { if (start !== null && last - start >= 0.3) runs.push({ w, wi, s0: start, s1: last }); start = null; };
      for (let s = 0.2; s <= w.L - 0.2 + 1e-9; s += STEP) {
        const p = [w.a[0] + w.u[0] * s + w.n[0] * FOOT, w.a[1] + w.u[1] * s + w.n[1] * FOOT];
        if (freeAt(R, zones, p, 0.12, w.n)) { if (start === null) start = s; last = s; } else close();
      }
      close();
    });
    runs.sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0));
    const used = [];                                   // [wall index, s0, s1] taken along a wall
    const take = (wi, s0, s1) => { if (used.some((u) => u[0] === wi && s0 < u[2] + 0.25 && s1 > u[1] - 0.25)) return false; used.push([wi, s0, s1]); return true; };
    const footAt = (w, s, out = FOOT) => [w.a[0] + w.u[0] * s + w.n[0] * out, w.a[1] + w.u[1] * s + w.n[1] * out, 0];
    const into = (w) => Math.atan2(w.n[1], w.n[0]);
    let gardens = 0, lamps = 0, stones = 0;
    for (const r of runs) {
      const L = r.s1 - r.s0;
      if (L >= 0.9 && gardens < 3) {
        // a strip of garden, and a lamp at its end when there is room for one (it lights the wall above the garden)
        const withLamp = lamps < 3 && L >= 1.4, len = Math.min(L - (withLamp ? 0.5 : 0.1), 2.1), s0 = r.s0 + 0.05, mid = s0 + len / 2;
        if (take(r.wi, s0, s0 + len)) {
          add('garden', footAt(r.w, mid, FOOT), into(r.w), gardens ? 1 : 0, { len: r3(len) });
          const ls = s0 + len + 0.24;
          if (withLamp) { used.push([r.wi, ls - 0.1, ls + 0.1]); add('lamp', footAt(r.w, ls, 0.14), into(r.w), lamps ? 1 : 0); lamps++; }      // (its own garden's neighbour)
          gardens++;
          continue;
        }
      }
      if (stones < 4) {
        const mid = (r.s0 + r.s1) / 2;
        if (take(r.wi, mid - 0.2, mid + 0.2)) { add('stones', footAt(r.w, mid, 0.15), into(r.w), stones || !gardens ? 1 : 0); stones++; continue; }
      }
      if (lamps < 3) { const mid = (r.s0 + r.s1) / 2; if (take(r.wi, mid - 0.12, mid + 0.12)) { add('lamp', footAt(r.w, mid, 0.14), into(r.w), lamps ? 1 : 0); lamps++; } }
    }
    // ---- corners: two walls meeting, the way into the room between them
    let corners = 0;
    for (let i = 0; i < R.walls.length && corners < 2; i++) for (let j = i + 1; j < R.walls.length && corners < 2; j++) {
      const a = R.walls[i], b = R.walls[j];
      for (const pa of [a.a, a.b]) for (const pb of [b.a, b.b]) {
        if (corners >= 2 || len2(sub(pa, pb)) > 0.2) continue;
        const cos = a.u[0] * b.u[0] + a.u[1] * b.u[1];
        if (Math.abs(cos) > 0.5) continue;                                   // (not a corner: nearly in line)
        const bis = [a.n[0] + b.n[0], a.n[1] + b.n[1]], bl = len2(bis) || 1, c = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const p = [c[0] + bis[0] / bl * 0.3, c[1] + bis[1] / bl * 0.3];
        if (!freeAt(R, zones, p, 0.16, [bis[0] / bl, bis[1] / bl]) || !clearOfPlaced(p, 0.16)) continue;
        add('bamboo', [p[0], p[1], 0], Math.atan2(bis[1], bis[0]), corners ? 1 : 0); corners++;
      }
    }
    // ---- tops: near the back corner (the one nearest a wall), set in from both edges
    const tops = R.tops.slice().sort((a, b) => b.area - a.area).slice(0, 3), kinds = ['vase', 'incense', 'candle'];
    tops.forEach((t, k) => {
      const geo = G(), cen = [t.poly.reduce((s, p) => s + p[0], 0) / t.poly.length, t.poly.reduce((s, p) => s + p[1], 0) / t.poly.length];
      if (zones.some((z) => geo.inside(z, cen))) return;
      let best = t.poly[0], bd = Infinity;
      for (const v of t.poly) for (const w of R.walls) { const d = geo.polySegDist([v, v, v], w.a, w.b); if (d < bd) { bd = d; best = v; } }
      const toC = sub(cen, best), tl = len2(toC) || 1, inset = Math.min(0.16, tl * 0.4), p = [best[0] + toC[0] / tl * inset, best[1] + toC[1] / tl * inset];
      if (!geo.inside(t.poly, p)) return;
      add(kinds[k], [p[0], p[1], t.h], Math.atan2(toC[1], toC[0]), k ? 1 : 0);
    });
    return { items };
  }

  Object.assign(J, { decoPlan: plan });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
