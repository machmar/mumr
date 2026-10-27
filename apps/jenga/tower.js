// The tower's physics world and what is read off it, with no THREE and no DOM (the PC host simulates it; the Node tests too).
//   54 blocks and a die, boxes on the engine's physics (Jolt on the host, engine/client/physics-jolt.js; the built-in World where Jolt is not
//   installed), in the COMMON frame, on a virtual plinth, with the console and the die's tray (spec.js furniture) added to the real room.
//   Hands: a pinch holds the block or die nearest to it (a grip with a limited force: a block that is stuck under the weight above it lags
//   behind the hand instead of tearing the tower out), the fingertips push, nothing else.
//   Reading it: which block has been pulled (`handled`), whether it has been put on top (`placed`), the first block that hit the ground
//   (`fell`), the die (`dieRead`), and the tower's rest poses, level counts and top (`captureRest`, `levels`).
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const pt = (s, name) => (s.points || []).find((p) => p.name === name);
  // a hand's own speed (presence.js gives every hand one from its headset's clock): the mean of its thumb and index tips, or null
  const handSpeed = (s) => { const v = ((s && s.points) || []).filter((p) => (p.name === 'thumb' || p.name === 'index') && p.v).map((p) => p.v); return v.length ? [0, 1, 2].map((i) => v.reduce((a, q) => a + q[i], 0) / v.length) : null; };
  const SMOOTH = 0.03;                    // s: the grip's point is low-passed this much (a tracked hand shakes a few millimetres; a block must not)
  const SEEN = 0.06;                      // s of the hand's quiet after letting go (a hand that has just let go pushes nothing)

  class Tower {
    // opts: { Engine (a physics world class: M.physics.JoltWorld on the host), size, seed, place: { x, y, yaw } (common frame), room (real room, common frame), settle (bool, default true) }
    constructor(opts = {}) {
      this.size = S.SIZES[opts.size] ? opts.size : 'normal'; this.seed = (opts.seed === undefined ? 1 : opts.seed) >>> 0;
      this.place = Object.assign({ x: 0, y: 0, yaw: 0 }, opts.place || {});
      this.d = S.dims(this.size); this.tun = S.tuning(this.size); this.lay = S.layout(this.size);
      this.realRoom = opts.room || null;
      this.world = opts.Engine ? new opts.Engine(this.tun.world) : new M.physics.World({ substep: this.tun.world.substep, maxMove: this.tun.world.maxMove, rounds: 24 });
      this.world.setRoom(S.withFurniture(this.realRoom, this.size, this.place));
      this.grips = new M.grab.Grips({ fist: true });
      this.holds = new Map();               // grip id -> { i, off, q, kind, f (filtered point), last }
      this.quiet = new Map();               // hand id -> time (s) until which its fingers push nothing
      this.prev = new Map(); this.t = 0;
      this.frozen = false;
      this.handled = null; this.fellFirst = null; this.rest = null; this.counts = []; this.restLevel = []; this.out = new Set();
      this.build();
      if (opts.settle !== false) this.settle();
    }
    destroy() { if (this.world.destroy) this.world.destroy(); }
    top() { return this.lay.plinth.top; }
    // the 54 blocks in their places and the die on its tray
    build() {
      const W = S.WOOD;
      for (const b of this.blocks || []) this.world.remove(b.body);
      if (this.die) this.world.remove(this.die.body);
      this.blocks = Array.from({ length: S.BLOCKS }, (_, i) => {
        const spec = S.blockSpec(i, this.seed, this.size), home = S.blockHome(i, this.size, this.top());
        const body = M.physics.makeBox({ size: spec.size, density: W.density, restitution: W.restitution, friction: { s: W.friction, k: W.friction }, angularDamping: W.angularDamping,
          p: S.toCommon(this.place, home.p), q: S.qCommon(this.place, home.q), sleep: { v: 0.02, w: 0.2, after: 0.4 } });
        this.world.add(body);
        return { i, spec, body, home: { p: body.p.slice(), q: body.q.slice() } };
      });
      const ds = this.lay.die.size;
      const body = M.physics.makeBox({ size: [ds, ds, ds], density: 700, restitution: 0.3, friction: { s: 0.45, k: 0.45 }, angularDamping: 0.08, p: S.toCommon(this.place, this.lay.die.at), sleep: { v: 0.03, w: 0.3, after: 0.4 } });
      this.world.add(body);
      this.die = { i: S.DIE, body, size: ds, moved: false, still: 0, home: null };
      this.holds.clear(); this.handled = null; this.fellFirst = null; this.out.clear();
    }
    body(i) { return i === S.DIE ? this.die.body : this.blocks[i].body; }
    all() { return this.blocks.map((b) => b.body).concat([this.die.body]); }
    local(p) { return S.fromCommon(this.place, p); }
    setRoom(room) { this.realRoom = room || null; this.world.setRoom(S.withFurniture(this.realRoom, this.size, this.place)); }

    // ---- standing
    // everything asleep (or as good as)?
    calm(without) { return this.blocks.every((b) => b.body.asleep || (len(b.body.v) < this.tun.still && len(b.body.w) < 0.3) || b.i === without); }
    // run the physics with no hands until the tower is still (the first second of a round), and take its rest poses
    settle(maxSecs = 4) {
      for (let t = 0; t < maxSecs * 60 && !(t > 30 && this.calm()); t++) this.world.step(1 / 60);
      this.captureRest();
    }
    // the rest poses, which level each block is on and how full each level is: the reference for "pulled out" and "put on top"
    captureRest() {
      const L = this.d.L, H = this.d.H, top = this.top();
      this.rest = this.blocks.map((b) => ({ p: b.body.p.slice(), q: b.body.q.slice() }));
      this.restLevel = this.blocks.map((b) => this.levelOf(b.body.p));
      this.counts = [];
      this.blocks.forEach((b, i) => { const l = this.restLevel[i]; if (l >= 0) this.counts[l] = (this.counts[l] || 0) + 1; });
      for (let l = 0; l < this.counts.length; l++) this.counts[l] = this.counts[l] || 0;
      this.handled = null; this.out.clear();
      return this.levels();
    }
    // the level a point is on (0 is the bottom), or -1 if it is not in the tower's column
    levelOf(p) {
      const l = this.local(p), L = this.d.L, H = this.d.H;
      if (Math.abs(l[0]) > 0.62 * L || Math.abs(l[1]) > 0.62 * L) return -1;
      const lv = Math.round((l[2] - this.top() - H / 2) / H);
      return lv >= 0 && lv < 60 ? lv : -1;
    }
    // { counts, top (highest level with a block), full (highest level with all three), height (m above the plinth of the top face) }
    levels() {
      const c = this.counts; let top = -1, full = -1;
      c.forEach((n, l) => { if (n > 0) top = l; if (n >= S.PER) full = l; });
      return { counts: c.slice(), top, full, height: (top + 1) * this.d.H, topCount: top >= 0 ? c[top] : 0 };
    }
    // may a block of this rest level be pulled? (any level below the highest complete one)
    legalLevel(level) { return level >= 0 && level < this.levels().full; }
    // the lowest point of a body (m above the floor)
    low(b) {
      const q = b.q, h = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
      let e = 0; for (let j = 0; j < 3; j++) { const ax = [0, 0, 0]; ax[j] = 1; e += Math.abs(Q.rotate(q, ax)[2]) * h[j]; }
      return b.p[2] - e;
    }
    tilt(b) { return Math.acos(Math.max(-1, Math.min(1, Q.rotate(b.q, [0, 0, 1])[2]))) * 180 / Math.PI; }     // degrees between the body's own up and up
    // how far block i is from its rest pose: { dist (horizontal, m), dz, turn (degrees) }
    away(i) {
      const b = this.blocks[i].body, r = this.rest[i];
      let dq = Q.mul(b.q, Q.conj(r.q)); if (dq[3] < 0) dq = dq.map((c) => -c);
      return { dist: Math.hypot(b.p[0] - r.p[0], b.p[1] - r.p[1]), dz: b.p[2] - r.p[2], turn: 2 * Math.acos(Math.min(1, dq[3])) * 180 / Math.PI };
    }

    // ---- one frame: dt seconds at time t (s), sources: everybody's hands in the common frame
    step(dt, t, sources) {
      this.t = t;
      const grips = this.grips.update(sources || []), tun = this.tun, W = this.world;
      const noHold = new Set((sources || []).filter((s) => s.noHold).map((s) => s.id));
      // hands that let go
      for (const [id, h] of [...this.holds]) {
        const g = grips.find((q) => q.id === id);
        if (!g || g.kind !== h.kind) { W.release(this.body(h.i)); this.holds.delete(id); this.quiet.set(id, t + SEEN); }
      }
      // hands that take hold: a pinch takes the nearest block or the die within reach; a fist takes only the die
      for (const g of grips) {
        if (!g.start || !g.at || !g.kind || noHold.has(g.id) || this.holds.has(g.id)) continue;
        const free = (i) => ![...this.holds.values()].some((h) => h.i === i);
        let best = -1, bd = Infinity;
        const near = (i, lim) => { const d = this.dist(this.body(i), g.at); if (free(i) && d <= lim && d < bd) { best = i; bd = d; } };
        if (g.kind === 'pinch') for (let i = 0; i < S.BLOCKS; i++) near(i, tun.grab);
        near(S.DIE, g.kind === 'fist' ? 0.08 : 0.03);
        if (best >= 0) {
          const b = this.body(best);
          this.holds.set(g.id, { i: best, off: sub(b.p, g.at), q: b.q.slice(), kind: g.kind, f: g.at.slice(), last: t });
          W.wake(b);
          if (best === S.DIE) this.die.moved = true;
        }
      }
      // holding: the point the hand holds, steadied, plus where the body was from it; a block is carried by a grip of limited strength
      for (const [id, h] of [...this.holds]) {
        const g = grips.find((q) => q.id === id), src = (sources || []).find((s) => s.id === id), b = this.body(h.i);
        const k = 1 - Math.exp(-Math.max(0, t - h.last) / SMOOTH); h.last = t;
        for (let j = 0; j < 3; j++) h.f[j] += (g.at[j] - h.f[j]) * (h.i === S.DIE ? 1 : k);
        const v = handSpeed(src) || this._vel(`${id}:hold`, g.at, t), target = { p: [h.f[0] + h.off[0], h.f[1] + h.off[1], h.f[2] + h.off[2]], q: h.q, v };
        const opts = h.i === S.DIE ? { spring: 20, speed: 5, breakAway: 0.5 } : { spring: tun.hold.spring, speed: tun.hold.speed, breakAway: tun.hold.breakAway, force: tun.hold.force, omega: tun.hold.omega };
        if (W.hold(b, target, opts) === 'released') { this.holds.delete(id); this.quiet.set(id, t + 0.3); }
      }
      // the fingertips and the palm push; the hand that holds something, or has just let go, pushes nothing
      const hands = [];
      for (const s of sources || []) {
        if (s.foot) continue;
        const quiet = this.holds.has(s.id) || (this.quiet.get(s.id) || 0) > t;
        hands.push({ id: s.id, spheres: quiet ? [] : M.physics.handLite(s, tun.tip, 0.02), plate: null });
      }
      W.setHands(hands, t);
      if (!this.frozen) W.step(dt);
      this._track(dt);
    }
    // how far a point is from a body's surface (0 inside)
    dist(b, p) {
      const l = Q.rotate(Q.conj(b.q), sub(p, b.p));
      return Math.hypot(Math.max(0, Math.abs(l[0]) - b.size[0] / 2), Math.max(0, Math.abs(l[1]) - b.size[1] / 2), Math.max(0, Math.abs(l[2]) - b.size[2] / 2));
    }
    _vel(key, p, t) {
      const q = this.prev.get(key), v = q && t > q[3] ? [(p[0] - q[0]) / (t - q[3]), (p[1] - q[1]) / (t - q[3]), (p[2] - q[2]) / (t - q[3])] : [0, 0, 0];
      this.prev.set(key, [p[0], p[1], p[2], t]);
      const s = len(v); return s > 4 ? v.map((c) => (c * 4) / s) : v;
    }
    heldBy(i) { for (const [id, h] of this.holds) if (h.i === i) return id; return null; }

    // ---- reading it
    // After every step: the pulled block, the first block on the ground, the die. Nothing here changes the physics.
    _track(dt) {
      if (!this.rest) return;
      const L = this.d.L, H = this.d.H, still = this.tun.still;
      // blocks that are out of the tower: far from where they rested (half a block out, lifted, or turned over)
      const outNow = [];
      for (let i = 0; i < S.BLOCKS; i++) { const a = this.away(i); if (a.dist > 0.5 * L || Math.abs(a.dz) > 0.6 * H || a.turn > 50) outNow.push(i); }
      this.outNow = outNow;
      // the pulled block: the one a hand holds that has come out a little, or the only one that is out and not flying
      if (this.handled === null) {
        const held = outNow.find((i) => this.heldBy(i) !== null);
        const heldOut = this.blocks.findIndex((b, i) => this.heldBy(i) !== null && this.away(i).dist > 0.15 * L);
        if (heldOut >= 0) this.handled = heldOut;
        else if (held !== undefined) this.handled = held;
        else if (outNow.length === 1 && len(this.blocks[outNow[0]].body.v) < 6 * still) this.handled = outNow[0];
      }
      if (this.fellFirst === null) {
        const top = this.top();
        for (let i = 0; i < S.BLOCKS; i++) {
          if (i === this.handled) continue;
          const b = this.blocks[i].body, lo = this.low(b);
          if (lo > top + 0.3 * H) continue;
          // (a block of level 0 on the plinth is where it belongs, and one that was already out of the tower when the move began cannot fall from it)
          if (this.restLevel[i] >= 1) { this.fellFirst = { i, t: this.t, at: b.p.slice() }; break; }
        }
      }
      // the die: it has "moved" once a hand has had it or it is no longer where it lay (3 cm, or turned over by more than 30 degrees)
      const d = this.die, db = d.body, moving = len(db.v) > 0.05 || len(db.w) > 0.5 || !db.asleep;
      d.still = moving && !(len(db.v) < 0.03 && len(db.w) < 0.3) ? 0 : d.still + dt;       // (seconds)
      if (!d.home && d.still > 0.3) d.home = { p: db.p.slice(), q: db.q.slice() };
      if (d.home && !d.moved) {
        let dq = Q.mul(db.q, Q.conj(d.home.q)); if (dq[3] < 0) dq = dq.map((c) => -c);
        if (this.heldBy(S.DIE) !== null || Math.hypot(db.p[0] - d.home.p[0], db.p[1] - d.home.p[1]) > 0.03 || 2 * Math.acos(Math.min(1, dq[3])) > 0.52) d.moved = true;
      }
    }
    // the first block on the ground, or null
    fell() { return this.fellFirst; }
    // has the pulled block been put on top and left there? { ok, level } or null
    placed() {
      if (this.handled === null || this.heldBy(this.handled) !== null) return null;
      const b = this.blocks[this.handled].body, H = this.d.H, L = this.d.L;
      if (len(b.v) > this.tun.still * 1.5 || len(b.w) > 0.5) return null;
      // the tower without it: its top level
      const c = []; this.blocks.forEach((o, i) => { if (i === this.handled) return; const l = this.levelOf(o.body.p); if (l >= 0 && this.restLevel[i] >= 0) c[l] = (c[l] || 0) + 1; });
      let top = -1; c.forEach((n, l) => { if (n > 0) top = l; });
      const l = this.local(b.p), z = (l[2] - this.top()) / H;
      if (Math.abs(l[0]) > 0.62 * L || Math.abs(l[1]) > 0.62 * L) return null;
      if (z < top + 0.15 || z > top + 1.85 || this.tilt(b) > 15) return null;
      return { ok: true, level: this.levelOf(b.p) };
    }
    // the colour block i is
    colourOf(i) { return this.blocks[i].spec.colour; }
    // the die as the rules read it: { moved (it has been thrown), rest (seconds it has been still), up: { colour, tilt }, onTray, held }
    dieRead() {
      const d = this.die, b = d.body, l = this.local(b.p), t = this.lay.tray;
      return { moved: d.moved, rest: d.still, up: S.dieUp(b.q), onTray: Math.abs(l[0] - t.c[0]) < t.half && Math.abs(l[1] - t.c[1]) < t.half && l[2] > this.lay.console.top - 0.01, held: this.heldBy(S.DIE) !== null };
    }
    // the die back on its tray, from a little above, flat, with no speed
    resetDie() {
      const d = this.die, b = d.body, a = this.lay.die.at;
      this.holds.forEach((h, id) => { if (h.i === S.DIE) { this.world.release(b); this.holds.delete(id); } });
      b.p = S.toCommon(this.place, [a[0], a[1], a[2] + 0.02]); b.q = S.qCommon(this.place, [0, 0, 0, 1]); b.v = [0, 0, 0]; b.w = [0, 0, 0];
      this.world.wake(b); d.moved = false; d.still = 0; d.home = null;
    }
    // the pulled block back on the plinth beside the tower (it fell off, or was left on the floor)
    bringBack() {
      if (this.handled === null) return;
      const b = this.blocks[this.handled].body, along = this.restLevel[this.handled] % 2 === 0;
      this.holds.forEach((h, id) => { if (h.i === this.handled) { this.world.release(b); this.holds.delete(id); } });
      const at = this.top() + this.d.H;
      b.p = S.toCommon(this.place, [this.lay.plinth.half * 0.7, this.lay.plinth.half * 0.6, at]); b.q = S.qCommon(this.place, along ? [0, 0, 0, 1] : [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
      b.v = [0, 0, 0]; b.w = [0, 0, 0]; this.world.wake(b);
    }
    // is block i lying below the plinth's top (on the floor, after falling off)?
    offPlinth(i) { return this.low(this.blocks[i].body) < this.top() - 0.5 * this.d.H; }
    // how many blocks are moving
    moving() { return this.all().filter((b) => !b.asleep).length; }
  }

  Object.assign(J, { Tower, handSpeed });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
