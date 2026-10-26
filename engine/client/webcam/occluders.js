// What of the real room hides the virtual world in the mixed view: the boxes that stand for walls, tables and solid furniture, as the room scan says where
// they are (the same numbers the physics crashes into: room.js walls and blocks). No THREE and no DOM, so that Node can test it. The page (mixed.js) makes a
// depth-only mesh of each box: it draws nothing itself, but everything virtual that is behind it, seen from the camera, is cut off.
//
//   list(room) -> [{ cx, cy, hx, hy, z0, z1, ang, kind }]     in the common floor frame: centre x, y on the floor, half sizes, from z0 to z1 above the common floor
//     room   the room's data (feed.doc.room.data): { planes: [{ l, v, p }] } as room.js has it, or null
//
// What counts: walls (an upright plane: a slab WALL_T thick along its two ends, from its lowest to its highest point), the tops of tables (a thin slab TABLE_T thick:
// the cube under a table is hidden from above and seen from the side), and solid furniture (a bed, a couch, storage: a block from the floor to its top), each as the
// smallest turned rectangle that holds its outline. What does not: floors, ceilings, door and window frames (flat or empty), and, never, people.
(function (M) {
  const WALL_T = 0.1;                                     // m: how thick a wall is taken to be
  const MAX = 3000;                                       // boxes: more than that is not drawn
  const ok = (v) => typeof v === 'number' && Number.isFinite(v);

  // the smallest rectangle (by area) that holds the points, turned to an edge of their outline: { cx, cy, hx, hy, ang }
  function fit(pts) {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (!ok(ang) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      const c = Math.cos(ang), s = Math.sin(ang);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of pts) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) { const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2; best = { area, cx: mu * c - mv * s, cy: mu * s + mv * c, hx: (u1 - u0) / 2, hy: (v1 - v0) / 2, ang }; }
    }
    return best;
  }
  const box = (o, z0, z1, kind) => (o && ok(o.cx) && ok(o.cy) && ok(o.hx) && ok(o.hy) && o.hx > 0 && o.hy > 0 && ok(z0) && ok(z1) && z1 - z0 > 0.001
    ? { cx: o.cx, cy: o.cy, hx: o.hx, hy: o.hy, z0, z1, ang: ok(o.ang) ? o.ang : 0, kind } : null);

  function list(room) {
    const out = [], R = M.room;
    if (!room || typeof room !== 'object' || !Array.isArray(room.planes)) return out;
    const add = (b) => { if (b && out.length < MAX) out.push(b); };
    for (const w of R.walls(room)) {
      const L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
      add(box({ cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, hx: L / 2, hy: WALL_T / 2, ang: Math.atan2(w.y1 - w.y0, w.x1 - w.x0) }, Math.max(0, w.lo), w.hi, 'wall'));
    }
    for (const b of R.blocks(room)) {
      const pts = (b.pts || []).filter((p) => Array.isArray(p) && ok(p[0]) && ok(p[1]));
      if (pts.length < 3) continue;
      add(box(fit(pts), Math.max(0, b.lo), b.hi, b.k === 'table' ? 'top' : 'furniture'));
    }
    return out;
  }

  M.occluders = { list, fit, WALL_T, TABLE_T: 0.04, MAX };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
