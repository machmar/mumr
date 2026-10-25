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
  function makeBox({ size, density = 1050, restitution = 0.45, friction = { s: 0.45, k: 0.4 }, angularDamping = 0.05, rollingResistance = 0.02, p, q = [0, 0, 0, 1] } = {}) {
    const [sx, sy, sz] = size, mass = density * sx * sy * sz;
    return { size: [sx, sy, sz], mass, inv: 1 / mass, inertia: [(mass / 12) * (sy * sy + sz * sz), (mass / 12) * (sx * sx + sz * sz), (mass / 12) * (sx * sx + sy * sy)],
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

  const MAX_DT = 0.05, MARGIN = 0.02, ITER = 12, MAX_MOVE = 0.005, SLOP = 0.0005, PEN_LIMIT = 0.06, REST_SPEED = 0.5, SLEEP_V = 0.01, SLEEP_W = 0.05, SLEEP_AFTER = 0.5, EDGE_STEP = 0.03, STATIC_SLIP = 0.02;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  // the world-frame inverse inertia applied to a vector
  const invI = (b, v) => { const l = quat.rotate(quat.conj(b.q), v); return quat.rotate(b.q, [l[0] / b.inertia[0], l[1] / b.inertia[1], l[2] / b.inertia[2]]); };
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
    }
    add(b) { if (!this.bodies.includes(b)) this.bodies.push(b); return b; }
    remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
    setRoom(room) { this.room = room || null; for (const b of this.bodies) this.wake(b); }
    wake(b) { b.asleep = false; b.calm = 0; }
    step(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, MAX_DT);
      let fast = 0;
      for (const b of this.bodies) if (!b.asleep) fast = Math.max(fast, Math.hypot(...b.v) + Math.hypot(...b.w) * Math.hypot(...b.size) / 2);
      const n = Math.max(1, Math.ceil(dt / this.substep - 1e-9), Math.ceil((dt * fast) / MAX_MOVE - 1e-9)), h = dt / n;
      for (let i = 0; i < n; i++) this._sub(h);
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
          const xy = k.pts.map((q) => [q[0], q[1]]), ins = pip(xy, c[0], c[1]), e = nearEdge(xy, c[0], c[1]);
          const ux = e[2] > 1e-9 ? (c[0] - e[0]) / e[2] : 0, uy = e[2] > 1e-9 ? (c[1] - e[1]) / e[2] : 0;
          if (ins) {
            const pTop = k.hi - c[2], pBot = k.lo > 0 ? c[2] - k.lo : Infinity, pSide = e[2];
            if (pTop <= pBot && pTop <= pSide) out.push({ r: c, n: [0, 0, 1], gap: -pTop });
            else if (pBot <= pSide) out.push({ r: c, n: [0, 0, -1], gap: -pBot });
            else out.push({ r: c, n: [-ux, -uy, 0], gap: -pSide });
          } else if (e[2] < MARGIN && c[2] > k.lo && c[2] < k.hi) out.push({ r: c, n: [ux, uy, 0], gap: e[2] });
        }
      }
      const R = Math.hypot(...b.size) / 2 + MARGIN, bq = quat.conj(b.q);
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
      return out;
    }
    _sub(h) {
      for (const b of this.bodies) {
        if (b.asleep) continue;
        b.v[2] -= this.gravity * h;
        const cs = this.contacts(b), touching = cs.some((c) => c.gap < 0.005);
        const damp = Math.exp(-b.angularDamping * h);                  // (angularDamping: 1/s)
        b.w = mulv(b.w, damp);
        if (touching) {                                                // rolling resistance: a steady slowing of the spin while it rests on something
          const sp = Math.hypot(...b.w), dec = ((b.rollingResistance * this.gravity) / (Math.min(...b.size) / 2)) * h;
          if (sp > 0) b.w = mulv(b.w, Math.max(0, sp - dec) / sp);
        }
        for (const c of cs) {
          c.ra = sub(c.r, b.p);
          c.Kn = b.inv + dot(cross(invI(b, cross(c.ra, c.n)), c.ra), c.n);
          const vc = add(b.v, cross(b.w, c.ra)), vn = dot(vc, c.n);
          c.target = c.gap > 0 ? -c.gap / h : 0;                                                  // (it may close the gap this step, no more)
          if (vn < -REST_SPEED && -vn * h >= c.gap) c.target = Math.max(c.target, -b.restitution * vn);
          c.J = 0; c.Jt = [0, 0, 0];
        }
        for (let it = 0; it < ITER; it++) {
          for (const c of it % 2 ? cs.slice().reverse() : cs) {
            let vc = add(b.v, cross(b.w, c.ra));
            const lam = (c.target - dot(vc, c.n)) / c.Kn, J = Math.max(0, c.J + lam), d = J - c.J;
            c.J = J; this._apply(b, c.ra, mulv(c.n, d));
            vc = add(b.v, cross(b.w, c.ra));
            const vt = sub(vc, mulv(c.n, dot(vc, c.n))), sp = Math.hypot(...vt);
            if (sp < 1e-9) continue;
            const t = mulv(vt, 1 / sp), Kt = b.inv + dot(cross(invI(b, cross(c.ra, t)), c.ra), t);
            const cand = add(c.Jt, t, -sp / Kt), mu = sp < STATIC_SLIP ? b.friction.s : b.friction.k, lim = mu * c.J, len = Math.hypot(...cand);
            const next = len > lim ? mulv(cand, lim / len) : cand;
            this._apply(b, c.ra, sub(next, c.Jt)); c.Jt = next;
          }
        }
        for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * h;
        const sp = Math.hypot(...b.w);
        if (sp > EPS) b.q = quat.normalize(quat.mul(quat.fromAxisAngle(b.w, sp * h), b.q));
        const fix = [0, 0, 0];                                                    // (out of what it is in: the deepest push along each axis)
        for (const c of this.contacts(b)) if (c.gap < -SLOP) for (let i = 0; i < 3; i++) { const d = c.n[i] * 0.5 * Math.min(PEN_LIMIT, -c.gap - SLOP); if (Math.abs(d) > Math.abs(fix[i])) fix[i] = d; }
        b.p = add(b.p, fix);
        if (touching && Math.hypot(...b.v) < SLEEP_V && Math.hypot(...b.w) < SLEEP_W) { b.calm += h; if (b.calm >= SLEEP_AFTER) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; } } else b.calm = 0;
      }
    }
    _apply(b, ra, J) { b.v = add(b.v, J, b.inv); b.w = add(b.w, invI(b, cross(ra, J))); }
  }

  M.physics = { quat, makeBox, corners, World };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
