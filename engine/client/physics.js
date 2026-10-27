// Physics for MUMR (docs/superpowers/specs/2026-10-26-physics-design.md): boxes with a position, a quaternion, a velocity and a spin, stepped in
// fixed substeps. No THREE and no DOM: a page, the host process and the Node tests all use it. Floor plan: x, y on the floor, z up.
//   M.physics.makeBox({ size, density, restitution, friction: { s, k }, p, q })   a body
//   new M.physics.World({ gravity, substep, room, floor })                        add(body), remove(body), setRoom(room), step(dt)
//   M.physics.quat, M.physics.corners(body)
(function (M) {
  const EPS = 1e-12;
  // quaternions are [x, y, z, w]
  const quat = {
    mul: (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
    conj: (q) => [-q[0], -q[1], -q[2], q[3]],
    normalize(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; },
    fromAxisAngle(axis, angle) { const n = Math.hypot(...axis) || 1, s = Math.sin(angle / 2) / n; return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; },
    rotate(q, v) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
      return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
    },
    slerp(a, b, f) {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
      if (d < 0) { d = -d; s = -1; }
      if (d > 0.9995) return quat.normalize(a.map((v, i) => v + (s * b[i] - v) * f));
      const th = Math.acos(Math.min(1, d)), sn = Math.sin(th), ka = Math.sin((1 - f) * th) / sn, kb = (s * Math.sin(f * th)) / sn;
      return a.map((v, i) => v * ka + b[i] * kb);
    },
  };

  // size: full edge lengths. Inertia is the box's, in its own axes.
  let nextId = 0;
  function makeBox({ size, density = 1050, restitution = 0.45, friction = { s: 0.45, k: 0.4 }, angularDamping = 0.05, rollingResistance = 0.02, sleep = {}, p, q = [0, 0, 0, 1] } = {}) {
    const [sx, sy, sz] = size, mass = density * sx * sy * sz;
    return { id: ++nextId, size: [sx, sy, sz], mass, inv: 1 / mass, inertia: [(mass / 12) * (sy * sy + sz * sz), (mass / 12) * (sx * sx + sz * sz), (mass / 12) * (sx * sx + sy * sy)],
      p: (p || [0, 0, sz / 2]).slice(), q: q.slice(), v: [0, 0, 0], w: [0, 0, 0], restitution, friction: Object.assign({}, friction), angularDamping, rollingResistance, sleep: Object.assign({ v: SLEEP_V, w: SLEEP_W, after: SLEEP_AFTER }, sleep), calm: 0, asleep: false, held: null };
  }
  // the 8 corners in the world
  function corners(b) {
    const out = [];
    for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) {
      const r = quat.rotate(b.q, [i * b.size[0] / 2, j * b.size[1] / 2, k * b.size[2] / 2]);
      out.push([b.p[0] + r[0], b.p[1] + r[1], b.p[2] + r[2]]);
    }
    return out;
  }

  const MAX_DT = 0.05, MARGIN = 0.02, ITER = 12, ITER_PAIRS = 30, ROUND_BUDGET = 7000, MAX_MOVE = 0.005, SLOP = 0.0005, PEN_LIMIT = 0.06, REST_SPEED = 0.5, WARM_NEAR = 0.02, WAKE_V = 0.15, WAKE_W = 1.5, V_MAX = 30, W_MAX = 100, MAX_SUB = 64, HAND_MAX = 4, PLATE_DEPTH = 0.03, HOLD_W = 10, SLEEP_V = 0.01, SLEEP_W = 0.05, SLEEP_AFTER = 0.5, EDGE_STEP = 0.03, STATIC_SLIP = 0.02;
  const ZERO = [0, 0, 0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const len = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const dist = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };
  // two bodies near enough to touch (b._d: the diagonal, set by World._grid each substep)
  const reach = (a, b) => dist(a.p, b.p) < (a._d + b._d) / 2 + MARGIN;
  // A box-box contact with its first body asleep and the other awake is turned round, so that the sleeping one is the other: the solver treats an
  // other body that sleeps as a fixed surface (a box resting on a sleeping box is carried by it, and the sleeping box is not pushed while it sleeps).
  function awakeFirst(c) {
    if (!c.b.asleep || c.o.asleep) return c;
    const b = c.b; c.b = c.o; c.o = b; c.n = [-c.n[0], -c.n[1], -c.n[2]];
    return c;
  }
  // the solver's flat array (World._sub): a contact is three rows (its normal and two directions along the surface, ROW numbers each, World._row),
  // then its target speed along the normal and its two frictions
  const ROW = 18, CS = 3 * ROW + 3;
  // the speed of a contact's point on body b relative to body o (-1: none) and to the surface's own speed vs -> RV (no array made)
  const RV = new Float64Array(3);
  function relVel(V, b, o, rax, ray, raz, rbx, rby, rbz, vs) {
    const B = b * 6;
    let x = V[B] + V[B + 4] * raz - V[B + 5] * ray, y = V[B + 1] + V[B + 5] * rax - V[B + 3] * raz, z = V[B + 2] + V[B + 3] * ray - V[B + 4] * rax;
    if (o >= 0) { const O = o * 6; x -= V[O] + V[O + 4] * rbz - V[O + 5] * rby; y -= V[O + 1] + V[O + 5] * rbx - V[O + 3] * rbz; z -= V[O + 2] + V[O + 3] * rby - V[O + 4] * rbx; }
    if (vs) { x -= vs[0]; y -= vs[1]; z -= vs[2]; }
    RV[0] = x; RV[1] = y; RV[2] = z;
  }
  function pip(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function nearEdge(pts, x, y) {
    let best = [x, y, Infinity];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), px = a[0] + dx * t, py = a[1] + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best[2]) best = [px, py, d];
    }
    return best;
  }

  class World {
    constructor(opts = {}) {
      this.gravity = opts.gravity === undefined ? 9.81 : opts.gravity;
      this.substep = opts.substep || 1 / 240;
      this.maxMove = opts.maxMove || MAX_MOVE;     // m, the most a body moves in one substep (5 mm: a throw cannot pass a table top; a heap of boxes can have more)
      this.rounds = opts.rounds || ITER;           // solver rounds per substep for one body on the room (boxes on boxes use more, up to ITER_PAIRS)
      this.wakeV = opts.wakeV || WAKE_V;           // m/s, rad/s: a sleeping body near an awake one that moves faster than this wakes up (a jenga
      this.wakeW = opts.wakeW || WAKE_W;           // tower wants it low: a block pulled out slowly must wake the blocks that rest on it)
      this.room = opts.room || null;
      this.floor = opts.floor !== false;           // the floor at z = 0 (always there unless a test turns it off)
      this.planes = opts.planes || [];             // more half-spaces { n, d }: n . x + d >= 0 is free space (for tests of slopes)
      this.bodies = [];
      this.budgetMs = opts.budgetMs || 0;          // > 0: a frame that takes longer than this (ms) stops stepping and the world runs slow for that frame (this.lagged)
      this.lagged = false;
      this.kin = { spheres: [], plates: [] };      // the hands this step: spheres { p, r, v } and plates { centre, normal, axes, half, v }
      this.handPrev = new Map();                   // id + part -> { p, t }: for the hands' speed
    }
    add(b) { if (!this.bodies.includes(b)) this.bodies.push(b); return b; }
    remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
    setRoom(room) { this.room = room || null; for (const b of this.bodies) this.wake(b); }
    wake(b) { b.asleep = false; b.calm = 0; }
    // The hands of this frame (floor plan) at time t (s): [{ id, spheres: [{ p, r }], plate: null | { centre, normal, axes: [u, v], half: [hu, hv] } }].
    // Their speed comes from the last call (clamped to HAND_MAX; a hand that jumps further than that in a frame is slow, not a launch);
    // anything not finite is ignored. They are kinematic: a body is pushed by them, they are not pushed back.
    setHands(list, t, solid = true) {
      const fin = (a) => a.every(Number.isFinite), next = new Map(), kin = { spheres: [], plates: [] };
      const speed = (key, p) => {
        const q = this.handPrev.get(key); next.set(key, { p, t });
        if (!q || !(t > q.t)) return [0, 0, 0];
        const v = mulv(sub(p, q.p), 1 / (t - q.t)), s = Math.hypot(...v);
        return s > HAND_MAX ? mulv(v, HAND_MAX / s) : v;
      };
      for (const hd of list || []) {
        (hd.spheres || []).forEach((s, i) => { if (s && s.p && fin(s.p) && Number.isFinite(s.r)) kin.spheres.push({ p: s.p.slice(), r: s.r, v: speed(hd.id + ':s' + i, s.p) }); });
        const pl = hd.plate;
        if (pl && fin(pl.centre) && fin(pl.normal) && fin(pl.axes[0]) && fin(pl.axes[1]) && fin(pl.half)) kin.plates.push({ id: hd.id, centre: pl.centre.slice(), normal: pl.normal, axes: pl.axes, half: pl.half, v: speed(hd.id + ':plate', pl.centre) });
      }
      this.kin = solid ? kin : { spheres: [], plates: [] }; this.handPrev = next;                // (not solid: only their speed is kept up, for when they are)
      for (const b of this.bodies) {
        if (!b.asleep) continue;
        const R = Math.hypot(...b.size) / 2 + 0.05;
        if (kin.spheres.some((s) => Math.hypot(...sub(s.p, b.p)) < R + s.r) || kin.plates.some((q) => Math.hypot(...sub(q.centre, b.p)) < R + Math.hypot(...q.half))) this.wake(b);
      }
    }
    // Hold b towards target { p, q, v?, w? } (a motor: it goes towards the pose at most speed m/s faster than the target's own speed, and
    // contacts still stop it). -> 'holding', or 'released' when it is further than breakAway from the target.
    hold(b, target, opts = {}) {
      const o = Object.assign({ spring: 20, speed: 5, breakAway: 0.3 }, opts);
      if (!target || !target.p.every(Number.isFinite) || !target.q || !target.q.every(Number.isFinite) || !(Math.hypot(...target.q) > 1e-6) || Math.hypot(...sub(target.p, b.p)) > o.breakAway) { b.held = null; return 'released'; }
      b.held = { p: target.p, q: target.q, v: target.v || [0, 0, 0], w: target.w || [0, 0, 0], spring: o.spring, speed: o.speed, age: 0 };
      this.wake(b); return 'holding';
    }
    // let go: it keeps the velocity and the spin it has (a throw)
    release(b) { b.held = null; }
    step(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, MAX_DT);
      let fast = 0;
      for (const b of this.bodies) if (!b.asleep) { this._clean(b); fast = Math.max(fast, len(b.v) + len(b.w) * len(b.size) / 2); }
      const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / this.substep - 1e-9), Math.ceil((dt * fast) / this.maxMove - 1e-9))), h = dt / n;
      const t0 = this.budgetMs ? Date.now() : 0;
      this.lagged = false;
      for (let i = 0; i < n; i++) { this._sub(h); if (this.budgetMs && Date.now() - t0 > this.budgetMs && i < n - 1) { this.lagged = true; break; } }
    }
    // Anything a packet or a caller put into a body that is not a state it can be in is put right: a position that is not finite goes back to the
    // last good one, a velocity or spin that is not finite stops and a huge one is cut to V_MAX / W_MAX, an orientation that is not finite or has no
    // length is the identity.
    _clean(b) {
      if (b.p.every(Number.isFinite)) b.good = b.p.slice(); else b.p = (b.good || [0, 0, b.size[2] / 2]).slice();
      for (const [k, max] of [['v', V_MAX], ['w', W_MAX]]) {
        if (!b[k].every(Number.isFinite)) b[k] = [0, 0, 0];
        const s = Math.hypot(...b[k]); if (s > max) b[k] = mulv(b[k], max / s);
      }
      const l = Math.hypot(...b.q);
      if (!b.q.every(Number.isFinite) || !(l > 1e-6) || !Number.isFinite(l)) b.q = [0, 0, 0, 1]; else if (Math.abs(l - 1) > 1e-6) b.q = quat.normalize(b.q);
    }
    // every place b touches, or is within MARGIN of, something solid -> [{ r (the point), n (out of the solid, towards b), gap (negative: inside) }].
    // Two halves: b's corners against the floor, planes, walls and blocks (tables, solid objects); and the edges of the blocks against b's faces
    // (a table's 4 cm edge can hit a face between the cube's corners).
    contacts(b) {
      const out = [], cs = corners(b), room = this.room;
      // only the walls and blocks near enough for a corner to touch (a corner is at most half the diagonal from the middle, and one counts down
      // to PEN_LIMIT behind a wall): the rest cannot give a contact, and a scanned room has many
      const near = b.size[0] * b.size[0] + b.size[1] * b.size[1] + b.size[2] * b.size[2], R0 = Math.sqrt(near) / 2, Rw = R0 + PEN_LIMIT + MARGIN, Rk = R0 + MARGIN, px = b.p[0], py = b.p[1], pz = b.p[2];
      const walls = [], blocks = [];
      if (room && M.room) {
        for (const w of M.room.walls(room)) {
          if (pz < w.lo - Rk || pz > w.hi + Rk) continue;
          const dx = w.x1 - w.x0, dy = w.y1 - w.y0, t = Math.max(0, Math.min(1, ((px - w.x0) * dx + (py - w.y0) * dy) / (dx * dx + dy * dy))), ex = px - w.x0 - dx * t, ey = py - w.y0 - dy * t;
          if (ex * ex + ey * ey <= Rw * Rw) walls.push(w);
        }
        for (const k of M.room.blocks(room)) if (!(pz < k.lo - Rk - PEN_LIMIT || pz > k.hi + Rk + PEN_LIMIT || px < k.x0 - Rk || px > k.x1 + Rk || py < k.y0 - Rk || py > k.y1 + Rk)) blocks.push(k);
      }
      for (const c of cs) {
        if (this.floor && c[2] < MARGIN) out.push({ r: c, n: [0, 0, 1], gap: c[2] });
        for (const pl of this.planes) { const gap = dot(pl.n, c) + pl.d; if (gap < MARGIN) out.push({ r: c, n: pl.n, gap }); }
        for (const w of walls) {
          if (c[2] < w.lo - MARGIN || c[2] > w.hi + MARGIN) continue;
          const dx = w.x1 - w.x0, dy = w.y1 - w.y0, L = Math.hypot(dx, dy), t = ((c[0] - w.x0) * dx + (c[1] - w.y0) * dy) / (L * L);
          if (t < -MARGIN / L || t > 1 + MARGIN / L) continue;
          let nx = -dy / L, ny = dx / L;
          if ((b.p[0] - w.x0) * nx + (b.p[1] - w.y0) * ny < 0) { nx = -nx; ny = -ny; }             // (the side its middle is on)
          const gap = (c[0] - w.x0) * nx + (c[1] - w.y0) * ny;
          if (gap < MARGIN && gap > -PEN_LIMIT) out.push({ r: c, n: [nx, ny, 0], gap });
        }
        for (const k of blocks) {
          if (c[2] < k.lo - MARGIN || c[2] > k.hi + MARGIN || c[0] < k.x0 - MARGIN || c[0] > k.x1 + MARGIN || c[1] < k.y0 - MARGIN || c[1] > k.y1 + MARGIN) continue;
          const xy = k.xy || (k.xy = k.pts.map((q) => [q[0], q[1]])), ins = pip(xy, c[0], c[1]), e = nearEdge(xy, c[0], c[1]);
          const ux = e[2] > 1e-9 ? (c[0] - e[0]) / e[2] : 0, uy = e[2] > 1e-9 ? (c[1] - e[1]) / e[2] : 0;
          if (ins) {
            // out of a block by the side its middle is on: above its top, below its underside, or (its middle inside the slab) sideways
            if (b.p[2] >= k.hi) out.push({ r: c, n: [0, 0, 1], gap: c[2] - k.hi });
            else if (k.lo > 0 && b.p[2] <= k.lo) out.push({ r: c, n: [0, 0, -1], gap: k.lo - c[2] });
            else out.push({ r: c, n: [-ux, -uy, 0], gap: -e[2] });
          } else if (e[2] < MARGIN && c[2] > k.lo && c[2] < k.hi) out.push({ r: c, n: [ux, uy, 0], gap: e[2] });
        }
      }
      const R = Math.hypot(...b.size) / 2 + MARGIN, bq = quat.conj(b.q);
      for (const k of blocks) {                                       // (its middle inside a slab, its corners above and below it: out by the nearer face)
        if (b.p[2] > k.lo && b.p[2] < k.hi && b.p[0] >= k.x0 && b.p[0] <= k.x1 && b.p[1] >= k.y0 && b.p[1] <= k.y1 && pip(k.xy || (k.xy = k.pts.map((q) => [q[0], q[1]])), b.p[0], b.p[1])) {
          const half = b.size[2] / 2;
          if (k.lo <= 0 || b.p[2] >= (k.lo + k.hi) / 2) out.push({ r: b.p.slice(), n: [0, 0, 1], gap: b.p[2] - half - k.hi });
          else out.push({ r: b.p.slice(), n: [0, 0, -1], gap: k.lo - b.p[2] - half });
        }
      }
      for (const k of blocks) {
        if (b.p[0] < k.x0 - R || b.p[0] > k.x1 + R || b.p[1] < k.y0 - R || b.p[1] > k.y1 + R || b.p[2] < k.lo - R || b.p[2] > k.hi + R) continue;
        const zlo = Math.max(k.lo, 0), levels = [zlo, (zlo + k.hi) / 2, k.hi], pts = k.pts;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[j], e = pts[i], dx = e[0] - a[0], dy = e[1] - a[1], len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          for (const z of levels) {
            const rr2 = R * R - (z - b.p[2]) ** 2;
            if (rr2 <= 0) continue;
            // the part of the edge inside the circle of radius rr around b's middle (solve |a + t d - p|^2 = rr^2)
            const fx = a[0] - b.p[0], fy = a[1] - b.p[1], A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), Cc = fx * fx + fy * fy - rr2, D = B * B - 4 * A * Cc;
            if (D < 0) continue;
            const t0 = Math.max(0, (-B - Math.sqrt(D)) / (2 * A)), t1 = Math.min(1, (-B + Math.sqrt(D)) / (2 * A));
            if (t1 < t0) continue;
            const steps = Math.max(1, Math.ceil(((t1 - t0) * len) / EDGE_STEP));
            for (let s = 0; s <= steps; s++) {
              const t = t0 + ((t1 - t0) * s) / steps, pt = [a[0] + dx * t, a[1] + dy * t, z], l = quat.rotate(bq, sub(pt, b.p));
              let ax = 0, dm = Infinity, all = true;
              for (let q = 0; q < 3; q++) { const d = b.size[q] / 2 - Math.abs(l[q]); if (d <= -MARGIN) { all = false; break; } if (d < dm) { dm = d; ax = q; } }
              if (!all) continue;
              const m = [0, 0, 0]; m[ax] = l[ax] >= 0 ? 1 : -1;
              out.push({ r: pt, n: mulv(quat.rotate(b.q, m), -1), gap: -dm });
            }
          }
        }
      }
      const bq2 = quat.conj(b.q), Rb0 = Math.hypot(...b.size) / 2 + MARGIN;
      for (const s of this.kin.spheres) {
        const rr = Rb0 + s.r;
        if (Math.abs(s.p[0] - b.p[0]) > rr || Math.abs(s.p[1] - b.p[1]) > rr || Math.abs(s.p[2] - b.p[2]) > rr) continue;                     // (far away: no need to turn it into the cube's frame)
        const l = quat.rotate(bq2, sub(s.p, b.p)), half = b.size.map((v) => v / 2), cl = l.map((v, i) => Math.max(-half[i], Math.min(half[i], v)));
        const diff = sub(l, cl), dist = Math.hypot(...diff);
        if (dist > s.r + MARGIN) continue;
        if (dist > 1e-9) out.push({ r: add(b.p, quat.rotate(b.q, cl)), n: mulv(quat.rotate(b.q, diff), -1 / dist), gap: dist - s.r, vs: s.v, e: 0 });
        else {                                                                           // (its middle is inside: out through the nearest face)
          let ax = 0, dm = Infinity; for (let i = 0; i < 3; i++) { const d = half[i] - Math.abs(l[i]); if (d < dm) { dm = d; ax = i; } }
          const m = [0, 0, 0]; m[ax] = l[ax] >= 0 ? 1 : -1;
          out.push({ r: s.p, n: mulv(quat.rotate(b.q, m), -1), gap: -(dm + s.r), vs: s.v, e: 0 });
        }
      }
      for (const q of this.kin.plates) {
        // the plate's own points against the cube's faces (a hand is narrower than the cube it carries: no corner of the cube is over it)
        const nu = Math.max(1, Math.ceil((2 * q.half[0]) / EDGE_STEP)), nv = Math.max(1, Math.ceil((2 * q.half[1]) / EDGE_STEP)), Rb = Math.hypot(...b.size) / 2 + MARGIN;
        if (Math.hypot(...sub(q.centre, b.p)) < Rb + Math.hypot(...q.half)) {
          for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
            const u = -q.half[0] + (2 * q.half[0] * i) / nu, v = -q.half[1] + (2 * q.half[1] * j) / nv;
            const pt = [q.centre[0] + q.axes[0][0] * u + q.axes[1][0] * v, q.centre[1] + q.axes[0][1] * u + q.axes[1][1] * v, q.centre[2] + q.axes[0][2] * u + q.axes[1][2] * v];
            const l = quat.rotate(bq2, sub(pt, b.p));
            let ax = 0, dm = Infinity, all = true;
            for (let k = 0; k < 3; k++) { const d = b.size[k] / 2 - Math.abs(l[k]); if (d <= -MARGIN) { all = false; break; } if (d < dm) { dm = d; ax = k; } }
            if (!all) continue;
            const m = [0, 0, 0]; m[ax] = l[ax] >= 0 ? 1 : -1;
            out.push({ r: pt, n: mulv(quat.rotate(b.q, m), -1), gap: -dm, vs: q.v, e: 0 });
          }
        }
        for (const c of cs) {
          const rel = sub(c, q.centre), lu = dot(rel, q.axes[0]), lv = dot(rel, q.axes[1]), ln = dot(rel, q.normal);
          if (Math.abs(lu) <= q.half[0] + 0.005 && Math.abs(lv) <= q.half[1] + 0.005 && ln > -PLATE_DEPTH && ln < MARGIN) out.push({ r: c, n: q.normal, gap: ln, vs: q.v, e: 0 });
        }
      }
      return out;
    }
    // Contacts between two boxes (the axis of least overlap among the six face axes; the other box's face that faces it is clipped to the
    // reference face): [{ b: the body that receives +n, o: the other, r, n (out of the other, towards b), gap }], or []
    _boxBox(A, B) {
      const E = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ax = [E.map((e) => quat.rotate(A.q, e)), E.map((e) => quat.rotate(B.q, e))], hs = [A.size.map((v) => v / 2), B.size.map((v) => v / 2)];
      const d = sub(B.p, A.p);
      let best = null;
      for (let s = 0; s < 2; s++) for (let k = 0; k < 3; k++) {
        const u = ax[s][k];
        let rA = 0, rB = 0;
        for (let i = 0; i < 3; i++) { rA += hs[0][i] * Math.abs(dot(u, ax[0][i])); rB += hs[1][i] * Math.abs(dot(u, ax[1][i])); }
        const depth = rA + rB - Math.abs(dot(d, u));
        if (depth < -MARGIN) return [];
        if (!best || depth < best.depth - 0.001) best = { depth, s, k };                    // (the first box's axes win a tie: no flipping between two)
      }
      const R = best.s === 0 ? A : B, I = best.s === 0 ? B : A, aR = ax[best.s], aI = ax[1 - best.s], hR = hs[best.s], hI = hs[1 - best.s];
      const cR = R.p, cI = I.p;
      const sgn = dot(sub(cI, cR), aR[best.k]) >= 0 ? 1 : -1, nR = mulv(aR[best.k], sgn);
      let j = 0, jd = -1;
      for (let i = 0; i < 3; i++) { const v = Math.abs(dot(aI[i], nR)); if (v > jd) { jd = v; j = i; } }
      const sI = dot(aI[j], nR) > 0 ? -1 : 1, fc = add(cI, aI[j], sI * hI[j]), m = (j + 1) % 3, p = (j + 2) % 3;
      let poly = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => add(add(fc, aI[m], a * hI[m]), aI[p], c * hI[p]));
      const clip = (poly, normal, off) => {                                     // keeps the part with normal . (x - cR) <= off
        const out = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length], da = dot(normal, sub(a, cR)) - off, dc = dot(normal, sub(c, cR)) - off;
          if (da <= 0) out.push(a);
          if ((da < 0 && dc > 0) || (da > 0 && dc < 0)) out.push(add(a, sub(c, a), da / (da - dc)));
        }
        return out;
      };
      for (let i = 0; i < 3 && poly.length; i++) if (i !== best.k) { poly = clip(poly, aR[i], hR[i]); poly = poly.length ? clip(poly, mulv(aR[i], -1), hR[i]) : poly; }
      const fcR = add(cR, nR, hR[best.k]), out = [];
      for (const v of poly) { const gap = dot(sub(v, fcR), nR); if (gap < MARGIN) out.push({ b: I, o: R, r: v, n: nR, gap }); }
      return out;
    }
    // Which bodies are near which: a grid of cells as wide as the widest reach, so that a body only looks at the 27 cells around its own.
    // -> this._nb[i]: the indices of the bodies that may be within reach of body i (ascending, without i). Every pair loop goes through it, in the
    // same order as a loop over every pair would (the solver's result depends on the order).
    _grid() {
      const B = this.bodies, N = B.length, nb = this._nb = new Array(N);
      let cell = 0;
      for (let i = 0; i < N; i++) { const b = B[i], s = b.size; b._d = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]); b._i = i; if (b._d > cell) cell = b._d; }
      if (N < 12) { for (let i = 0; i < N; i++) { const l = []; for (let j = 0; j < N; j++) if (j !== i) l.push(j); nb[i] = l; } return; }      // (a few bodies: every one)
      cell += MARGIN;
      const map = new Map(), cx = new Float64Array(N * 3), seen = new Int32Array(N).fill(-1);
      const key = (x, y, z) => (x * 4096 + y) * 4096 + z;                   // (two cells with one key only add candidates, which reach() then drops)
      for (let i = 0; i < N; i++) {
        const p = B[i].p, x = Math.floor(p[0] / cell), y = Math.floor(p[1] / cell), z = Math.floor(p[2] / cell), k = key(x, y, z);
        cx[i * 3] = x; cx[i * 3 + 1] = y; cx[i * 3 + 2] = z;
        const l = map.get(k); if (l) l.push(i); else map.set(k, [i]);
      }
      for (let i = 0; i < N; i++) {
        const l = [], x = cx[i * 3], y = cx[i * 3 + 1], z = cx[i * 3 + 2];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const c = map.get(key(x + dx, y + dy, z + dz));
          if (c) for (const j of c) if (j !== i && seen[j] !== i) { seen[j] = i; l.push(j); }
        }
        nb[i] = l.sort((a, b) => a - b);
      }
    }
    // every pair of bodies within reach of each other, i < j, in index order -> fn(a, b)
    _pairs(fn) {
      const B = this.bodies, nb = this._nb;
      for (let i = 0; i < B.length; i++) {
        const a = B[i];
        for (const j of nb[i]) {
          if (j <= i) continue;
          const b = B[j];
          if ((a.asleep && b.asleep) || !reach(a, b)) continue;
          fn(a, b);
        }
      }
    }
    // the contacts' numbers for this substep, in flat arrays (CS numbers a contact): grown, never shrunk
    _room(nc, nb) {
      if (!this._C || this._C.length < nc * CS) this._C = new Float64Array(Math.max(nc, 64) * 2 * CS);
      if (!this._cb || this._cb.length < nc) { this._cb = new Int32Array(Math.max(nc, 64) * 2); this._co = new Int32Array(Math.max(nc, 64) * 2); }
      if (!this._V || this._V.length < nb * 6) { this._V = new Float64Array(Math.max(nb, 16) * 2 * 6); this._IM = new Float64Array(Math.max(nb, 16) * 2 * 9); this._inv = new Float64Array(Math.max(nb, 16) * 2); }
    }
    _sub(h) {
      this._h = h;
      const bodies = this.bodies, N = bodies.length;
      this._grid();
      // what a moving body is about to hit wakes up
      for (let i = 0; i < N; i++) {
        const s = bodies[i];
        if (!s.asleep) continue;
        for (const j of this._nb[i]) { const b = bodies[j]; if (!b.asleep && (len(b.v) > this.wakeV || len(b.w) > this.wakeW) && reach(s, b)) { this.wake(s); break; } }
      }
      const live = bodies.filter((b) => !b.asleep), all = [];
      let pairs = false;                                                // (boxes on boxes need more rounds to share a load than one box on the room)
      for (const b of live) {
        b.v[2] -= this.gravity * h;
        if (b.held) this._motor(b);
        b._touch = false;
        for (const c of this.contacts(b)) { c.b = b; c.o = null; all.push(c); }
      }
      this._pairs((a, b) => { for (const c of this._boxBox(a, b)) { all.push(awakeFirst(c)); pairs = true; } });
      for (const c of all) if (c.gap < 0.005) { c.b._touch = true; if (c.o) c.o._touch = true; }
      for (const b of live) {
        b.w = mulv(b.w, Math.exp(-b.angularDamping * h));              // (angularDamping: 1/s)
        if (b._touch) {                                                // rolling resistance: a steady slowing of the spin while it rests on something
          const sp = len(b.w), dec = ((b.rollingResistance * this.gravity) / (Math.min(...b.size) / 2)) * h;
          if (sp > 0) b.w = mulv(b.w, Math.max(0, sp - dec) / sp);
        }
      }
      // Every body's velocity and spin (V: 6 a body), 1/mass and world-frame inverse inertia (IM: 9 a body, symmetric) into flat arrays, and every
      // contact's three directions (the normal and two along the surface) with what a push along each does to both bodies, worked out once here,
      // so that a round below is a few products of numbers and makes no arrays. A body asleep is a wall to the bodies on it (o = -1) but, as the
      // first body of a contact, takes its impulses (as it always has).
      const NC = all.length;
      this._room(NC, N);
      const V = this._V, IM = this._IM, INV = this._inv, C = this._C, CB = this._cb, CO = this._co;
      for (let i = 0; i < N; i++) {
        const b = bodies[i], v = b.v, w = b.w, q = b.q, o = i * 6, m = i * 9;
        V[o] = v[0]; V[o + 1] = v[1]; V[o + 2] = v[2]; V[o + 3] = w[0]; V[o + 4] = w[1]; V[o + 5] = w[2]; INV[i] = b.inv;
        const x = q[0], y = q[1], z = q[2], ww = q[3];
        // the body's axes in the world (the columns of its turn) and IM = sum over the axes of a a^T / I
        const a0 = [1 - 2 * (y * y + z * z), 2 * (x * y + ww * z), 2 * (x * z - ww * y)], a1 = [2 * (x * y - ww * z), 1 - 2 * (x * x + z * z), 2 * (y * z + ww * x)], a2 = [2 * (x * z + ww * y), 2 * (y * z - ww * x), 1 - 2 * (x * x + y * y)];
        const i0 = 1 / b.inertia[0], i1 = 1 / b.inertia[1], i2 = 1 / b.inertia[2];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) IM[m + r * 3 + c] = a0[r] * a0[c] * i0 + a1[r] * a1[c] * i1 + a2[r] * a2[c] * i2;
      }
      for (let k = 0; k < NC; k++) {
        const c = all[k], b = c.b, bi = b._i, ob = c.o && !c.o.asleep ? c.o : null, o = ob ? ob._i : -1, K = k * CS, n = c.n, r = c.r, vs = c.vs;
        CB[k] = bi; CO[k] = o;
        const nx = n[0], ny = n[1], nz = n[2], rax = r[0] - b.p[0], ray = r[1] - b.p[1], raz = r[2] - b.p[2];
        const rbx = ob ? r[0] - ob.p[0] : 0, rby = ob ? r[1] - ob.p[1] : 0, rbz = ob ? r[2] - ob.p[2] : 0;
        this._row(K, nx, ny, nz, bi, o, rax, ray, raz, rbx, rby, rbz, vs);
        relVel(V, bi, o, rax, ray, raz, rbx, rby, rbz, vs);
        const vn = RV[0] * nx + RV[1] * ny + RV[2] * nz;
        // along the surface: the first direction the way it slips now (friction then mostly works along one), else any two across n
        let ux = RV[0] - nx * vn, uy = RV[1] - ny * vn, uz = RV[2] - nz * vn, ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (ul < 1e-6) { if (Math.abs(nx) > 0.57) { ux = ny; uy = -nx; uz = 0; } else { ux = 0; uy = nz; uz = -ny; } ul = Math.sqrt(ux * ux + uy * uy + uz * uz); }
        ux /= ul; uy /= ul; uz /= ul;
        this._row(K + ROW, ux, uy, uz, bi, o, rax, ray, raz, rbx, rby, rbz, vs);
        this._row(K + 2 * ROW, ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux, bi, o, rax, ray, raz, rbx, rby, rbz, vs);
        let target = c.gap > 0 ? -c.gap / h : 0;                                                     // (it may close the gap this step, no more)
        if (vn < -REST_SPEED && -vn * h >= c.gap) target = Math.max(target, -(c.e !== undefined ? c.e : b.held ? 0 : b.restitution) * vn);
        C[K + 3 * ROW] = target; C[K + 3 * ROW + 1] = b.friction.s; C[K + 3 * ROW + 2] = b.friction.k;
      }
      // warm start: a contact that was there a moment ago (the same two bodies, the same place and normal) begins with the force it had, so that the
      // rounds below only have to correct it (a stack of five cubes does not settle in 12 rounds from nothing)
      const prev = this._warm || new Map(), next = new Map();
      for (let k = 0; k < NC; k++) {
        const c = all[k], key = c.b.id + ':' + (c.o ? c.o.id : 'e');
        let l = next.get(key); if (!l) next.set(key, l = []);
        l.push(c);
        const list = prev.get(key);
        if (!list) continue;
        let best = null, bd = WARM_NEAR;
        for (const q of list) if (!q.used && q.n[0] * c.n[0] + q.n[1] * c.n[1] + q.n[2] * c.n[2] > 0.9) { const d = dist(q.r, c.r); if (d < bd) { bd = d; best = q; } }
        if (!best) continue;
        best.used = true;
        const f = h / best.h, K = k * CS, T1 = K + ROW, T2 = K + 2 * ROW, jt = best.Jt;
        const J = best.J * f, j1 = (jt[0] * C[T1] + jt[1] * C[T1 + 1] + jt[2] * C[T1 + 2]) * f, j2 = (jt[0] * C[T2] + jt[1] * C[T2 + 1] + jt[2] * C[T2 + 2]) * f;
        C[K + 16] = J; C[T1 + 16] = j1; C[T2 + 16] = j2;
        this._rowPush(K, J); this._rowPush(T1, j1); this._rowPush(T2, j2);
      }
      const rounds = pairs ? Math.max(this.rounds, Math.min(ITER_PAIRS, Math.round(ROUND_BUDGET / NC))) : this.rounds;          // (a big heap gets fewer rounds each: its cost grows with both)
      for (let it = 0; it < rounds; it++) {
        for (let ci = 0; ci < NC; ci++) {
          const k = it % 2 ? NC - 1 - ci : ci, K = k * CS, bi = CB[k], o = CO[k], T1 = K + ROW, T2 = K + 2 * ROW, X = K + 3 * ROW;
          // the normal: an impulse J >= 0 that brings the speed along n to the target
          const J0 = C[K + 16], J = Math.max(0, J0 + (C[X] - this._rowVel(K, bi, o)) / C[K + 15]);
          C[K + 16] = J;
          if (J !== J0) this._rowPush(K, J - J0);
          // friction: against the slip, at most mu J (static below STATIC_SLIP, kinetic above)
          const v1 = this._rowVel(T1, bi, o), v2 = this._rowVel(T2, bi, o), o1 = C[T1 + 16], o2 = C[T2 + 16];
          let j1 = o1 - v1 / C[T1 + 15], j2 = o2 - v2 / C[T2 + 15];
          const lim = (v1 * v1 + v2 * v2 < STATIC_SLIP * STATIC_SLIP ? C[X + 1] : C[X + 2]) * J, l = Math.sqrt(j1 * j1 + j2 * j2);
          if (l > lim) { const f = l > 0 ? lim / l : 0; j1 *= f; j2 *= f; }
          C[T1 + 16] = j1; C[T2 + 16] = j2;
          if (j1 !== o1) this._rowPush(T1, j1 - o1);
          if (j2 !== o2) this._rowPush(T2, j2 - o2);
        }
      }
      for (let k = 0; k < NC; k++) {
        const c = all[k], K = k * CS, T1 = K + ROW, T2 = K + 2 * ROW, j1 = C[T1 + 16], j2 = C[T2 + 16];
        c.J = C[K + 16]; c.Jt = [C[T1] * j1 + C[T2] * j2, C[T1 + 1] * j1 + C[T2 + 1] * j2, C[T1 + 2] * j1 + C[T2 + 2] * j2]; c.h = h;
      }
      this._warm = next;
      for (let i = 0; i < N; i++) {                                     // (back into the bodies, in place)
        const b = bodies[i], o = i * 6;
        if (b.asleep && V[o] === b.v[0] && V[o + 1] === b.v[1] && V[o + 2] === b.v[2] && V[o + 3] === b.w[0] && V[o + 4] === b.w[1] && V[o + 5] === b.w[2]) continue;
        b.v[0] = V[o]; b.v[1] = V[o + 1]; b.v[2] = V[o + 2]; b.w[0] = V[o + 3]; b.w[1] = V[o + 4]; b.w[2] = V[o + 5];
      }
      for (const b of live) {
        for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * h;
        const sp = len(b.w);
        if (sp > EPS) b.q = quat.normalize(quat.mul(quat.fromAxisAngle(b.w, sp * h), b.q));
      }
      // out of what they are in: along each axis the deepest push, for each body (a pair shares the push)
      const fix = new Map(live.map((b) => [b, [0, 0, 0]])), push = (b, n, d) => { const f = fix.get(b); if (!f) return; for (let i = 0; i < 3; i++) { const v = n[i] * d; if (Math.abs(v) > Math.abs(f[i])) f[i] = v; } };
      if (all.some((c) => c.gap < 0.002)) {
        for (const b of live) for (const c of this.contacts(b)) if (c.gap < -SLOP) push(b, c.n, 0.5 * Math.min(PEN_LIMIT, -c.gap - SLOP));
        this._grid();
        this._pairs((a, b) => { for (const c of this._boxBox(a, b).map(awakeFirst)) if (c.gap < -SLOP) { const d = Math.min(PEN_LIMIT, -c.gap - SLOP); push(c.b, c.n, c.o.asleep ? 0.5 * d : 0.25 * d); push(c.o, c.n, -0.25 * d); } });
      }
      for (const b of live) {
        const f = fix.get(b); b.p[0] += f[0]; b.p[1] += f[1]; b.p[2] += f[2];
        if (!b.held && b._touch && len(b.v) < b.sleep.v && len(b.w) < b.sleep.w) { b.calm += h; if (b.calm >= b.sleep.after) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; } } else b.calm = 0;
      }
    }
    // One direction u of a contact (ROW numbers from R): u; A = ra x u and IM_b A (what a push along u does to b's spin); B = rb x u and IM_o B
    // (the same for the other body); K = 1 / (the mass the contact moves along u); the impulse along u so far; the surface's own speed along u.
    _row(R, ux, uy, uz, b, o, rax, ray, raz, rbx, rby, rbz, vs) {
      const C = this._C, IM = this._IM;
      C[R] = ux; C[R + 1] = uy; C[R + 2] = uz;
      let ax = ray * uz - raz * uy, ay = raz * ux - rax * uz, az = rax * uy - ray * ux, m = b * 9;
      let ix = IM[m] * ax + IM[m + 1] * ay + IM[m + 2] * az, iy = IM[m + 3] * ax + IM[m + 4] * ay + IM[m + 5] * az, iz = IM[m + 6] * ax + IM[m + 7] * ay + IM[m + 8] * az;
      C[R + 3] = ax; C[R + 4] = ay; C[R + 5] = az; C[R + 6] = ix; C[R + 7] = iy; C[R + 8] = iz;
      let k = this._inv[b] + ix * ax + iy * ay + iz * az;
      if (o >= 0) {
        ax = rby * uz - rbz * uy; ay = rbz * ux - rbx * uz; az = rbx * uy - rby * ux; m = o * 9;
        ix = IM[m] * ax + IM[m + 1] * ay + IM[m + 2] * az; iy = IM[m + 3] * ax + IM[m + 4] * ay + IM[m + 5] * az; iz = IM[m + 6] * ax + IM[m + 7] * ay + IM[m + 8] * az;
        C[R + 9] = ax; C[R + 10] = ay; C[R + 11] = az; C[R + 12] = ix; C[R + 13] = iy; C[R + 14] = iz;
        k += this._inv[o] + ix * ax + iy * ay + iz * az;
      }
      C[R + 15] = k; C[R + 16] = 0; C[R + 17] = vs ? vs[0] * ux + vs[1] * uy + vs[2] * uz : 0;
    }
    // the speed of the contact's point on its first body relative to the other (or to the surface), along row R's direction
    _rowVel(R, b, o) {
      const C = this._C, V = this._V, B = b * 6;
      let v = V[B] * C[R] + V[B + 1] * C[R + 1] + V[B + 2] * C[R + 2] + V[B + 3] * C[R + 3] + V[B + 4] * C[R + 4] + V[B + 5] * C[R + 5] - C[R + 17];
      if (o >= 0) { const O = o * 6; v -= V[O] * C[R] + V[O + 1] * C[R + 1] + V[O + 2] * C[R + 2] + V[O + 3] * C[R + 9] + V[O + 4] * C[R + 10] + V[O + 5] * C[R + 11]; }
      return v;
    }
    // an impulse d along row R: + on the first body, - on the other
    _rowPush(R, d) {
      const C = this._C, V = this._V, k = (R / CS) | 0, b = this._cb[k], o = this._co[k], B = b * 6, ib = this._inv[b] * d;
      V[B] += C[R] * ib; V[B + 1] += C[R + 1] * ib; V[B + 2] += C[R + 2] * ib; V[B + 3] += C[R + 6] * d; V[B + 4] += C[R + 7] * d; V[B + 5] += C[R + 8] * d;
      if (o >= 0) { const O = o * 6, io = this._inv[o] * d; V[O] -= C[R] * io; V[O + 1] -= C[R + 1] * io; V[O + 2] -= C[R + 2] * io; V[O + 3] -= C[R + 12] * d; V[O + 4] -= C[R + 13] * d; V[O + 5] -= C[R + 14] * d; }
    }
    _motor(b) {
      const H = b.held, e = sub(add(H.p, H.v, H.age), b.p), cap = H.speed + Math.hypot(...H.v);
      let v = add(H.v, e, H.spring); const s = Math.hypot(...v); if (s > cap) v = mulv(v, cap / s);
      let qe = quat.mul(H.q, quat.conj(b.q)); if (qe[3] < 0) qe = qe.map((c) => -c);
      let w = add(H.w, [qe[0], qe[1], qe[2]], 2 * H.spring); const ws = Math.hypot(...w); if (ws > HOLD_W) w = mulv(w, HOLD_W / ws);
      b.v = v; b.w = w; H.age += this._h;                                   // (the target moves on at its own speed while the frame goes on)
    }
  }

  // spheres for a hand source of the engine ({ points: [{ x, y, z }], joints: [[x, y, z]] }, floor plan)
  function handSpheres(source, margin = 0.012) {
    const out = [];
    // (a point that is not finite keeps its place in the list, as NaN, which the world ignores: every other point keeps the same index and so its speed)
    for (const p of (source && source.points) || []) out.push({ p: [p.x, p.y, p.z], r: margin });
    for (const j of (source && source.joints) || []) out.push({ p: [j[0], j[1], j[2]], r: margin });
    return out;
  }
  // the flat hand of a grab.js grip (grip.palm: centre cx, cy and its top z there, normal nx ny nz, heading ang, half sizes hx hy) as a plate
  function plate(grip) {
    const q = grip && grip.palm;
    if (!q) return null;
    const s = q.nz < 0 ? -1 : 1, nl = Math.hypot(q.nx, q.ny, q.nz) || 1, n = [s * q.nx / nl, s * q.ny / nl, s * q.nz / nl];
    const c = Math.cos(q.ang), sn = Math.sin(q.ang);
    let u = [c, sn, -(n[0] * c + n[1] * sn) / n[2]]; u = mulv(u, 1 / Math.hypot(...u));
    return { centre: [q.cx, q.cy, q.z], normal: n, axes: [u, cross(n, u)], half: [q.hx, q.hy] };
  }

  // The turn of a hand (a quaternion), from its 25 joints: the wrist to the middle knuckle is forward, the index knuckle to the little finger's is
  // across; null when the source has no joints (the desktop's mouse) or they are in a heap.
  function handQuat(s) {
    const j = s && s.joints;
    if (!j || j.length < 25) return null;
    const unit = (a) => { const l = Math.hypot(...a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
    const f = unit(sub(j[11], j[0])), side = sub(j[6], j[21]), n = f && unit(cross(f, side));
    return n ? M.align.quatFromBasis(f, cross(n, f), n) : null;
  }

  // The wire packet of a body of this module (14 float32 = 56 bytes, common frame): x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, flags
  // (1: held). lend turns the orientation the short way. The cube is type 16, the lab's boxes 17-21.
  const PACKET = 14;
  function registerPacket({ type, name, token }) {
    return M.wire.register({ type, name, token,
      pack: (s) => { const b = new Uint8Array(PACKET * 4), d = new DataView(b.buffer); s.forEach((v, i) => { if (i < PACKET) d.setFloat32(i * 4, +v || 0, true); }); return b; },
      unpack: (d) => { if (d.byteLength !== PACKET * 4) return null; const s = []; for (let i = 0; i < PACKET; i++) s.push(d.getFloat32(i * 4, true)); return s.every(Number.isFinite) ? s : null; },
      blend: (a, b, f) => { const q = quat.slerp(a.slice(3, 7), b.slice(3, 7), f); return a.map((v, i) => (i >= 3 && i <= 6 ? q[i - 3] : i === 13 ? a[13] : v + (b[i] - v) * f)); } });
  }

  M.physics = { quat, makeBox, corners, World, handSpheres, plate, handQuat, registerPacket };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
