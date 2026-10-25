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
  function makeBox({ size, density = 1050, restitution = 0.45, friction = { s: 0.45, k: 0.4 }, p, q = [0, 0, 0, 1] } = {}) {
    const [sx, sy, sz] = size, mass = density * sx * sy * sz;
    return { size: [sx, sy, sz], mass, inv: 1 / mass, inertia: [(mass / 12) * (sy * sy + sz * sz), (mass / 12) * (sx * sx + sz * sz), (mass / 12) * (sx * sx + sy * sy)],
      p: (p || [0, 0, sz / 2]).slice(), q: q.slice(), v: [0, 0, 0], w: [0, 0, 0], restitution, friction: Object.assign({}, friction), asleep: false, held: null };
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

  const MAX_DT = 0.05;
  class World {
    constructor(opts = {}) {
      this.gravity = opts.gravity === undefined ? 9.81 : opts.gravity;
      this.substep = opts.substep || 1 / 240;
      this.room = opts.room || null;
      this.floor = opts.floor !== false;           // the floor at z = 0 (always there unless a test turns it off)
      this.bodies = [];
    }
    add(b) { if (!this.bodies.includes(b)) this.bodies.push(b); return b; }
    remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
    setRoom(room) { this.room = room || null; }
    step(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, MAX_DT);
      const n = Math.max(1, Math.ceil(dt / this.substep - 1e-9)), h = dt / n;
      for (let i = 0; i < n; i++) this._sub(h);
    }
    _sub(h) {
      for (const b of this.bodies) {
        if (b.asleep) continue;
        b.v[2] -= this.gravity * h;
        for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * h;
        const sp = Math.hypot(...b.w);
        if (sp > EPS) b.q = quat.normalize(quat.mul(quat.fromAxisAngle(b.w, sp * h), b.q));
      }
    }
  }

  M.physics = { quat, makeBox, corners, World };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
