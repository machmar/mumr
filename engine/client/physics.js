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
  function makeBox({ size, density = 1050, restitution = 0.45, friction = { s: 0.45, k: 0.4 }, angularDamping = 0.05, rollingResistance = 0.02, p, q = [0, 0, 0, 1] } = {}) {
    const [sx, sy, sz] = size, mass = density * sx * sy * sz;
    return { id: ++nextId, size: [sx, sy, sz], mass, inv: 1 / mass, inertia: [(mass / 12) * (sy * sy + sz * sz), (mass / 12) * (sx * sx + sz * sz), (mass / 12) * (sx * sx + sy * sy)],
      p: (p || [0, 0, sz / 2]).slice(), q: q.slice(), v: [0, 0, 0], w: [0, 0, 0], restitution, friction: Object.assign({}, friction), angularDamping, rollingResistance, calm: 0, asleep: false, held: null };
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

  const MAX_DT = 0.05, MARGIN = 0.02, ITER = 12, ITER_PAIRS = 30, ROUND_BUDGET = 7000, MAX_MOVE = 0.005, SLOP = 0.0005, PEN_LIMIT = 0.06, REST_SPEED = 0.5, WARM_NEAR = 0.02, WAKE_V = 0.05, WAKE_W = 0.5, V_MAX = 30, W_MAX = 100, MAX_SUB = 64, HAND_MAX = 4, PLATE_DEPTH = 0.03, HOLD_W = 10, SLEEP_V = 0.01, SLEEP_W = 0.05, SLEEP_AFTER = 0.5, EDGE_STEP = 0.03, STATIC_SLIP = 0.02;
  const ZERO = [0, 0, 0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // the world-frame inverse inertia applied to a vector
  // (b.ax: its three axes in the world, set once per substep by the world: the same turn without two quaternion products per call)
  const invI = (b, v) => {
    const a = b.ax;
    if (!a) { const l = quat.rotate(quat.conj(b.q), v); return quat.rotate(b.q, [l[0] / b.inertia[0], l[1] / b.inertia[1], l[2] / b.inertia[2]]); }
    const s0 = (a[0][0] * v[0] + a[0][1] * v[1] + a[0][2] * v[2]) / b.inertia[0], s1 = (a[1][0] * v[0] + a[1][1] * v[1] + a[1][2] * v[2]) / b.inertia[1], s2 = (a[2][0] * v[0] + a[2][1] * v[1] + a[2][2] * v[2]) / b.inertia[2];
    return [a[0][0] * s0 + a[1][0] * s1 + a[2][0] * s2, a[0][1] * s0 + a[1][1] * s1 + a[2][1] * s2, a[0][2] * s0 + a[1][2] * s1 + a[2][2] * s2];
  };
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
      for (const b of this.bodies) if (!b.asleep) { this._clean(b); fast = Math.max(fast, Math.hypot(...b.v) + Math.hypot(...b.w) * Math.hypot(...b.size) / 2); }
      const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / this.substep - 1e-9), Math.ceil((dt * fast) / MAX_MOVE - 1e-9))), h = dt / n;
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
      const walls = room && M.room ? M.room.walls(room) : [], blocks = room && M.room ? M.room.blocks(room) : [];
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
    // the speed of the point of a contact on its first body, relative to the other body (or to the surface it is on)
    _rel(c) {
      const b = c.b, o = c.o;
      let v = add(b.v, cross(b.w, c.ra));
      if (o && !o.asleep) v = sub(v, add(o.v, cross(o.w, c.rb)));
      return c.vs ? sub(v, c.vs) : v;
    }
    _applyC(c, J) { this._apply(c.b, c.ra, J); if (c.o && !c.o.asleep) this._apply(c.o, c.rb, mulv(J, -1)); }
    _eff(c, dir) {                                                    // 1 / (the mass the contact moves when pushed along dir)
      let k = c.b.inv + dot(cross(invI(c.b, cross(c.ra, dir)), c.ra), dir);
      if (c.o && !c.o.asleep) k += c.o.inv + dot(cross(invI(c.o, cross(c.rb, dir)), c.rb), dir);
      return k;
    }
    _sub(h) {
      this._h = h;
      const bodies = this.bodies, reach = (a, b) => Math.hypot(...sub(a.p, b.p)) < (Math.hypot(...a.size) + Math.hypot(...b.size)) / 2 + MARGIN;
      // what a moving body is about to hit wakes up
      for (const s of bodies) if (s.asleep) for (const b of bodies) if (!b.asleep && (Math.hypot(...b.v) > WAKE_V || Math.hypot(...b.w) > WAKE_W) && reach(s, b)) { this.wake(s); break; }
      const live = bodies.filter((b) => !b.asleep), all = [];
      for (const b of live) b.ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => quat.rotate(b.q, e));
      let pairs = false;                                                // (boxes on boxes need more rounds to share a load than one box on the room)
      for (const b of live) {
        b.v[2] -= this.gravity * h;
        if (b.held) this._motor(b);
        b._touch = false;
        for (const c of this.contacts(b)) { c.b = b; c.o = null; all.push(c); }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        if ((a.asleep && b.asleep) || !reach(a, b)) continue;
        for (const c of this._boxBox(a, b)) { all.push(c); pairs = true; }
      }
      for (const c of all) if (c.gap < 0.005) { c.b._touch = true; if (c.o) c.o._touch = true; }
      for (const b of live) {
        b.w = mulv(b.w, Math.exp(-b.angularDamping * h));              // (angularDamping: 1/s)
        if (b._touch) {                                                // rolling resistance: a steady slowing of the spin while it rests on something
          const sp = Math.hypot(...b.w), dec = ((b.rollingResistance * this.gravity) / (Math.min(...b.size) / 2)) * h;
          if (sp > 0) b.w = mulv(b.w, Math.max(0, sp - dec) / sp);
        }
      }
      for (const c of all) {
        const b = c.b;
        c.ra = sub(c.r, b.p); if (c.o) c.rb = sub(c.r, c.o.p);
        c.Kn = this._eff(c, c.n);
        const vn = dot(this._rel(c), c.n);
        c.target = c.gap > 0 ? -c.gap / h : 0;                                                  // (it may close the gap this step, no more)
        if (vn < -REST_SPEED && -vn * h >= c.gap) c.target = Math.max(c.target, -(c.e !== undefined ? c.e : b.held ? 0 : b.restitution) * vn);
        c.J = 0; c.Jt = [0, 0, 0];
      }
      // warm start: a contact that was there a moment ago (the same two bodies, the same place and normal) begins with the force it had, so that the
      // rounds below only have to correct it (a stack of five cubes does not settle in 12 rounds from nothing)
      const prev = this._warm || new Map(), next = new Map();
      for (const c of all) {
        const key = c.b.id + ':' + (c.o ? c.o.id : 'e');
        if (!next.has(key)) next.set(key, []);
        next.get(key).push(c);
        const list = prev.get(key);
        if (!list) continue;
        let best = null, bd = WARM_NEAR;
        for (const q of list) if (!q.used && dot(q.n, c.n) > 0.9) { const d = Math.hypot(...sub(q.r, c.r)); if (d < bd) { bd = d; best = q; } }
        if (!best) continue;
        best.used = true; c.J = best.J * (h / best.h); c.Jt = mulv(best.Jt, h / best.h);
        this._applyC(c, add(mulv(c.n, c.J), c.Jt));
      }
      const rounds = pairs ? Math.max(ITER, Math.min(ITER_PAIRS, Math.round(ROUND_BUDGET / all.length))) : ITER;          // (a big heap gets fewer rounds each: its cost grows with both)
      for (let it = 0; it < rounds; it++) {
        for (let ci = 0; ci < all.length; ci++) {
          const c = all[it % 2 ? all.length - 1 - ci : ci], b = c.b;
          let vc = this._rel(c);
          const lam = (c.target - dot(vc, c.n)) / c.Kn, J = Math.max(0, c.J + lam), d = J - c.J;
          c.J = J; this._applyC(c, mulv(c.n, d));
          vc = this._rel(c);
          const vt = sub(vc, mulv(c.n, dot(vc, c.n))), sp = Math.hypot(...vt);
          if (sp < 1e-9) continue;
          const t = mulv(vt, 1 / sp), Kt = this._eff(c, t);
          const cand = add(c.Jt, t, -sp / Kt), mu = sp < STATIC_SLIP ? b.friction.s : b.friction.k, lim = mu * c.J, len = Math.hypot(...cand);
          const next = len > lim ? mulv(cand, lim / len) : cand;
          this._applyC(c, sub(next, c.Jt)); c.Jt = next;
        }
      }
      for (const list of next.values()) for (const c of list) c.h = h;
      this._warm = next;
      for (const b of live) {
        for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * h;
        const sp = Math.hypot(...b.w);
        if (sp > EPS) b.q = quat.normalize(quat.mul(quat.fromAxisAngle(b.w, sp * h), b.q));
      }
      // out of what they are in: along each axis the deepest push, for each body (a pair shares the push)
      const fix = new Map(live.map((b) => [b, [0, 0, 0]])), push = (b, n, d) => { const f = fix.get(b); if (!f) return; for (let i = 0; i < 3; i++) { const v = n[i] * d; if (Math.abs(v) > Math.abs(f[i])) f[i] = v; } };
      if (all.some((c) => c.gap < 0.002)) {
        for (const b of live) for (const c of this.contacts(b)) if (c.gap < -SLOP) push(b, c.n, 0.5 * Math.min(PEN_LIMIT, -c.gap - SLOP));
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          if ((a.asleep && b.asleep) || !reach(a, b)) continue;
          for (const c of this._boxBox(a, b)) if (c.gap < -SLOP) { const d = Math.min(PEN_LIMIT, -c.gap - SLOP); push(c.b, c.n, c.o.asleep ? 0.5 * d : 0.25 * d); push(c.o, c.n, -0.25 * d); }
        }
      }
      for (const b of live) {
        b.p = add(b.p, fix.get(b));
        if (!b.held && b._touch && Math.hypot(...b.v) < SLEEP_V && Math.hypot(...b.w) < SLEEP_W) { b.calm += h; if (b.calm >= SLEEP_AFTER) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; } } else b.calm = 0;
      }
    }
    _motor(b) {
      const H = b.held, e = sub(add(H.p, H.v, H.age), b.p), cap = H.speed + Math.hypot(...H.v);
      let v = add(H.v, e, H.spring); const s = Math.hypot(...v); if (s > cap) v = mulv(v, cap / s);
      let qe = quat.mul(H.q, quat.conj(b.q)); if (qe[3] < 0) qe = qe.map((c) => -c);
      let w = add(H.w, [qe[0], qe[1], qe[2]], 2 * H.spring); const ws = Math.hypot(...w); if (ws > HOLD_W) w = mulv(w, HOLD_W / ws);
      b.v = v; b.w = w; H.age += this._h;                                   // (the target moves on at its own speed while the frame goes on)
    }
    _apply(b, ra, J) { b.v = add(b.v, J, b.inv); b.w = add(b.w, invI(b, cross(ra, J))); }
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

  M.physics = { quat, makeBox, corners, World, handSpheres, plate };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
