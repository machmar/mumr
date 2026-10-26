// The lab's own logic, with no THREE and no DOM (the headset page and the Node tests both use it):
//   * World: N boxes of 12 cm on the engine's physics (engine/client/physics.js: gravity, bounce, tumbling, friction, boxes that rest on, topple
//     and push each other), that hands push, pinch and fist-grab as the cube's do. No flat-hand platform, no kicking. The room's walls and
//     tables work (`room.js`).
//   * Watch: what the island experiment counts (token hand-overs, jumps of a box, whether the stack stayed together).
//   * Drift: the line-up drift probe (a fingertip resting on a printed cross, once a minute).
//   * Perf: frame time and simulation time for the pile.
//   * the menu and the settings.
(function (L) {
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const SIZE = 0.12, HALF = SIZE / 2, MAX_BOXES = 50, ISLAND = 5, FIRST_TYPE = 17;
  const CFG = { gravity: 9.81, touch: 0.012, palm: 0.025, grab: 0.03, grabFist: 0.08, spring: 20, holdSpeed: 5, breakAway: 0.3, closeNear: 0.05, reach: 0.06, busy: 0.02 };
  // The lab's boxes only touch each other and the room's big things, so its physics is coarser than the cube's (one substep per frame at 72 Hz, at
  // most 2 cm of movement in one, 8 solver rounds, a frame runs slow when its physics has taken 6 ms): a heap of 50 cost 48 ms a frame at the cube's
  // settings and 12 ms at these (Node), with no box inside another. Boxes sleep sooner, too.
  const PHYSICS = { budgetMs: 6, substep: 1 / 72, maxMove: 0.02, rounds: 8 }, SLEEP = { v: 0.03, w: 0.3, after: 0.3 };
  const HAND_MAX = 4;                           // m/s
  const SHOW_DELAY = 50;                        // ms: a page that shows the host's boxes draws them this long ago, between two packets
  // a hand's own speed (presence.js gives the other players' hands one, from their headset's clock): the mean of its thumb and index tips, or null
  const handSpeed = (s) => { const v = ((s && s.points) || []).filter((p) => (p.name === 'thumb' || p.name === 'index') && p.v).map((p) => p.v); return v.length ? [0, 1, 2].map((i) => v.reduce((a, q) => a + q[i], 0) / v.length) : null; };
  const pt = (s, name) => (s.points || []).find((p) => p.name === name);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const heading = (q) => { const r = Q.rotate(q, [1, 0, 0]); return Math.atan2(r[1], r[0]); };

  // packets 17..21, one per island box (a token each, today's rule): the physics module's body packet (engine/client/physics.js, 56 bytes)
  const TYPES = Array.from({ length: ISLAND }, (_, i) => ({ type: FIRST_TYPE + i, name: `lab${i + 1}`, token: `b${i + 1}` }));
  for (const t of TYPES) M.physics.registerPacket(t);
  // packet 22: the whole pile under one token (rule 1: every player sees and touches the same cubes). [n (how many boxes there are), then
  // for each box in this packet its index and 14 numbers (the island packet's)]. Only the boxes that move go out each time; one at rest
  // goes out every REST_EVERY ms (Marek's run, 2026-10-26: all 50 boxes 45 times a second was more than a Quest Pro took in).
  const BOX_N = 14, REST_EVERY = 250, PILE = { type: FIRST_TYPE + ISLAND, name: 'labpile', token: 'pile' };
  M.wire.register(Object.assign({}, PILE, {
    pack: (s) => { const b = new Uint8Array(s.length * 4), d = new DataView(b.buffer); s.forEach((v, i) => d.setFloat32(i * 4, +v || 0, true)); return b; },
    unpack: (d) => {
      if (d.byteLength < 4 || d.byteLength % 4) return null;
      const n = d.getFloat32(0, true), len = d.byteLength / 4;
      if (!Number.isInteger(n) || n < 1 || n > MAX_BOXES || (len - 1) % (BOX_N + 1) || (len - 1) / (BOX_N + 1) > n) return null;
      const s = []; for (let i = 0; i < len; i++) s.push(d.getFloat32(i * 4, true));
      for (let o = 1; o < len; o += BOX_N + 1) if (!Number.isInteger(s[o]) || s[o] < 0 || s[o] >= n) return null;
      return s.every(Number.isFinite) ? s : null;
    },
  }));

  // One box: a body of the physics world with the fields the lab and its tests use as plain numbers.
  class Box {
    constructor(world, x, y, z) {
      this.pw = world; this.body = M.physics.makeBox({ size: [SIZE, SIZE, SIZE], p: [x, y, z], sleep: SLEEP }); world.add(this.body);
      this.held = null;                    // { by: source id, kind, hold, fix, off } while a grip holds it
      this.steer = null;                   // [x, y, z]: where a hand in the room model wants it
      this.other = false;                  // held by another page (what the packet says)
      this.off = { x: 0, y: 0, z: 0 };     // drawn = simulated + this (a correction from the holder, fading)
    }
    _set(i, v) { this.body.p[i] = v; this.pw.wake(this.body); }
    get x() { return this.body.p[0]; } set x(v) { this._set(0, v); }
    get y() { return this.body.p[1]; } set y(v) { this._set(1, v); }
    get z() { return this.body.p[2]; } set z(v) { this._set(2, v); }
    get vx() { return this.body.v[0]; } set vx(v) { this.body.v[0] = v; this.pw.wake(this.body); }
    get vy() { return this.body.v[1]; } set vy(v) { this.body.v[1] = v; this.pw.wake(this.body); }
    get vz() { return this.body.v[2]; } set vz(v) { this.body.v[2] = v; this.pw.wake(this.body); }
  }

  class World {
    constructor(n) {
      this.grips = new M.grab.Grips();
      this.prev = new Map();               // source id + point -> [x, y, z, t]: the hands' speed
      this.pw = new M.physics.World(PHYSICS);
      this.free = new Map();               // source id -> time (s) until which its hand pushes nothing: it has just let go
      this.cfg = Object.assign({}, CFG);
      this.room = null;                    // room.js local(), or null: the floor only
      this.boxes = [];
      this.smooth = false;                 // a page that only shows the host's boxes: feed() and show() instead of step() (see below)
      this.clk = { cur: null, prev: null, at: 0 };
      this.layout('grid', n);
    }
    // 'grid': n boxes in rows on the floor (from `at`); 'stack': a tower; 'pile': a heap of boxes dropped around `at`
    layout(kind, n, at = [0.5, 0]) {
      const N = Math.max(1, Math.min(MAX_BOXES, n | 0)), cols = Math.ceil(Math.sqrt(N));
      for (const b of this.pw.bodies.slice()) this.pw.remove(b);
      this.pw._warm = null;
      this.boxes = Array.from({ length: N }, (_, i) => {
        let x = at[0], y = at[1], z = HALF;
        if (kind === 'grid') { x += (i % cols) * 0.2 - ((cols - 1) * 0.2) / 2; y += Math.floor(i / cols) * 0.2 - ((cols - 1) * 0.2) / 2; }
        else if (kind === 'stack') z = HALF + i * SIZE;
        else { const a = i * 2.4, r = 0.05 + 0.045 * (i % 7); x += Math.cos(a) * r; y += Math.sin(a) * r; z = HALF + 0.05 + i * 0.07; }
        return new Box(this.pw, x, y, z);
      });
      this.prev.clear(); this.free.clear();
      for (const b of this.boxes) b.buf = [];
    }
    // how far a point is from a box's surface (0 inside)
    dist(b, x, y, z) {
      const l = Q.rotate(Q.conj(b.body.q), [x - b.x, y - b.y, z - b.z]);
      return Math.hypot(Math.max(0, Math.abs(l[0]) - HALF), Math.max(0, Math.abs(l[1]) - HALF), Math.max(0, Math.abs(l[2]) - HALF));
    }
    nearest(b, sources) {
      let best = Infinity;
      for (const s of sources || []) {
        for (const p of s.points || []) best = Math.min(best, this.dist(b, p.x, p.y, p.z));
        for (const j of s.joints || []) best = Math.min(best, this.dist(b, j[0], j[1], j[2]));
      }
      return best;
    }
    _vel(key, p, t) {
      const q = this.prev.get(key), v = q && t > q[3] ? [(p[0] - q[0]) / (t - q[3]), (p[1] - q[1]) / (t - q[3]), (p[2] - q[2]) / (t - q[3])] : [0, 0, 0];
      this.prev.set(key, [p[0], p[1], p[2], t]);
      const s = Math.hypot(...v);
      return s > HAND_MAX ? v.map((c) => (c * HAND_MAX) / s) : v;
    }
    // a hand that is closing on a box (about to grip it): the thumb and index coming together, or the fingers curling, near it
    _closing(b, s) {
      if (this.nearest(b, [s]) > this.cfg.closeNear || this.grips.of(s.id).gesture === 'point') return false;
      const th = pt(s, 'thumb'), ix = pt(s, 'index');
      return (th && ix && Math.hypot(th.x - ix.x, th.y - ix.y, th.z - ix.z) < 0.05) || M.grab.closing(s) > 0.6;
    }
    // one frame of dt seconds at time t (s) with every hand there is (floor plan)
    step(dt, t, sources) {
      const C = this.cfg, B = this.boxes, pw = this.pw, grips = this.grips.update(sources), noHold = new Set((sources || []).filter((s) => s.noHold).map((s) => s.id));
      if (pw.room !== this.room) pw.setRoom(this.room);
      pw.gravity = C.gravity;
      // holding: a pinch starting within C.grab of a box, or a fist within C.grabFist; it lasts while the grip does, at the angle the hand had
      for (const b of B) if (b.held && !grips.some((g) => g.id === b.held.by && g.kind === b.held.kind)) { this.free.set(b.held.by, t + 0.3); b.held = null; }
      for (const g of grips) {
        if (!g.start || !g.at || !g.kind || noHold.has(g.id) || B.some((b) => b.held && b.held.by === g.id)) continue;
        const lim = g.kind === 'fist' ? C.grabFist : C.grab;
        let best = null, bd = Infinity;
        for (const b of B) { const d = this.dist(b, g.at[0], g.at[1], g.at[2]); if (!b.held && d <= lim && d < bd) { best = b; bd = d; } }
        if (best) {
          const hq = M.physics.handQuat((sources || []).find((s) => s.id === g.id)), off = sub(best.body.p, g.at);
          best.held = { by: g.id, kind: g.kind, off, hold: hq ? { loff: Q.rotate(Q.conj(hq), off), qoff: Q.mul(Q.conj(hq), best.body.q) } : null, fix: best.body.q.slice() };
          pw.wake(best.body);
        }
      }
      // what is held, or steered from the room model (b.steer: [x, y, z]), follows its target as a motor; the rest is let go (and keeps its speed).
      // (a steer that came from another page, b.steerAt, ends when no word on it has come for half a second: its drop was lost)
      for (const b of B) if (b.steerAt && Date.now() - b.steerAt > 500) { b.steer = null; b.steerAt = 0; }
      const holding = new Set();
      for (const b of B) {
        if (!b.held && !b.steer) { if (b.body.held) pw.release(b.body); continue; }
        let target;
        if (b.held) {
          const g = grips.find((q) => q.id === b.held.by), H = b.held, hq = H.hold ? M.physics.handQuat((sources || []).find((s) => s.id === g.id)) : null;
          const o = hq ? Q.rotate(hq, H.hold.loff) : H.off;
          const own = handSpeed((sources || []).find((s) => s.id === g.id)), v = this._vel(`${g.id}:hold`, g.at, t);
          target = { p: [g.at[0] + o[0], g.at[1] + o[1], g.at[2] + o[2]], q: hq ? Q.mul(hq, H.hold.qoff) : H.fix, v: own || v };
          holding.add(H.by);
        } else target = { p: b.steer.slice(), q: b.body.q.slice() };
        if (pw.hold(b.body, target, { spring: C.spring, speed: C.holdSpeed, breakAway: b.held ? C.breakAway : Infinity }) === 'released' && b.held) { this.free.set(b.held.by, t + 0.3); b.held = null; }
      }
      // the hands: every point and joint of a hand is a small sphere that pushes; not a hand that holds a box, has just let go, or is closing on one
      const hands = [];
      for (const s of sources || []) {
        if (s.foot) continue;
        const quiet = holding.has(s.id) || (this.free.get(s.id) || 0) > t || B.some((b) => this._closing(b, s));
        hands.push({ id: s.id, spheres: quiet ? [] : M.physics.handLite(s, C.touch, C.palm), plate: null });
      }
      pw.setHands(hands, t);
      pw.step(dt);
      const f = Math.exp(-12 * dt);
      for (const b of B) {
        b.off.x *= f; b.off.y *= f; b.off.z *= f;
        if (Math.hypot(b.x, b.y) > 8) { b.x = 0.5; b.y = 0; b.z = HALF; b.body.v = [0, 0, 0]; b.body.w = [0, 0, 0]; b.body.q = [0, 0, 0, 1]; b.held = null; }
      }
    }
    // A page that only shows what the host simulates (this.smooth): each box's states are kept with the time they were taken (the host's
    // clock, turned into ours), and show() draws every box as it was SHOW_DELAY ms ago, between the two states around then (position and
    // speed blended, the turn slerped); past the newest one it goes on along that one's speed (for at most 100 ms).
    // The host's clock in ours: the smallest (arrival - its clock) of the last 2 to 4 s (the packet that came quickest).
    hostTime(clock, nowMs) {
      const c = this.clk, d = nowMs - clock;
      if (nowMs - c.at > 2000) { c.prev = c.cur; c.cur = null; c.at = nowMs; }
      if (c.cur === null || d < c.cur) c.cur = d;
      return clock + Math.min(c.cur, c.prev === null ? Infinity : c.prev);
    }
    // a state of box i (s[o .. o + 13]) taken at t (ms, our clock)
    feed(i, t, s, o) {
      const b = this.boxes[i];
      if (!b) return;
      const buf = b.buf || (b.buf = []);
      if (buf.length && t <= buf[buf.length - 1].t) return;
      buf.push({ t, s: s.slice(o, o + BOX_N) });
      if (buf.length > 12) buf.shift();
    }
    show(nowMs) {
      const T = nowMs - SHOW_DELAY;
      for (const b of this.boxes) {
        const buf = b.buf || [], y = b.body;
        if (!buf.length) continue;
        let i = buf.length - 1;
        while (i > 0 && buf[i - 1].t >= T) i--;
        const a = buf[Math.max(0, i - 1)], c = buf[i];
        let s;
        if (T >= c.t) {                                                  // (past the newest: on along its speed and spin)
          const k = Math.min(0.1, (T - c.t) / 1000), w = c.s.slice(10, 13), wn = Math.hypot(...w);
          s = c.s.slice(); for (let j = 0; j < 3; j++) s[j] += s[7 + j] * k;
          s.splice(3, 4, ...(wn > 1e-6 ? Q.normalize(Q.mul(Q.fromAxisAngle(w, wn * k), c.s.slice(3, 7))) : c.s.slice(3, 7)));
        } else if (a === c || T <= a.t) s = a.s;
        else { const f = (T - a.t) / (c.t - a.t); s = a.s.map((v, j) => v + (c.s[j] - v) * f); s.splice(3, 4, ...Q.slerp(a.s.slice(3, 7), c.s.slice(3, 7), f)); s[13] = c.s[13]; }
        y.p = [s[0], s[1], Math.max(HALF * 0.5, s[2])]; y.q = s.slice(3, 7); y.v = s.slice(7, 10); y.w = s.slice(10, 13); y.held = null;
        y.asleep = Math.hypot(...y.v) < SLEEP.v && Math.hypot(...y.w) < SLEEP.w; b.held = null; b.other = s[13] > 0.5; b.off = { x: 0, y: 0, z: 0 };
      }
    }
    isMoving(b) { return !!b.held || !!b.steer || !!b.other || !b.body.asleep; }
    movingCount() { return this.boxes.filter((b) => this.isMoving(b)).length; }
    drawn(b) { return { x: b.x + b.off.x, y: b.y + b.off.y, z: b.z + b.off.z, yaw: heading(b.body.q), q: b.body.q.slice(), held: !!b.held || !!b.steer || b.other }; }
  }

  // The island box as a Body adapter (the same shape as the cube's). A World simulates in the COMMON frame (every page's boxes are then
  // turned the same way, whatever its line-up), so the state goes out as it is; `common(sources)` turns this page's hands (floor plan)
  // into it. `active()` says whether the island experiment is on (the boxes are not touched, or claimed, in the other modes).
  const packBox = (q) => { const y = q.body; return [q.x, q.y, q.z, y.q[0], y.q[1], y.q[2], y.q[3], q.vx, q.vy, q.vz, y.w[0], y.w[1], y.w[2], q.held || q.steer ? 1 : 0]; };
  // the holder's state of one box (s from index o): taken over, with what was drawn gliding to it unless it is far or the first
  function applyBox(world, q, s, o, first) {
    const y = q.body, was = world.drawn(q);
    y.p = [s[o], s[o + 1], s[o + 2]]; y.q = [s[o + 3], s[o + 4], s[o + 5], s[o + 6]]; y.v = [s[o + 7], s[o + 8], s[o + 9]]; y.w = [s[o + 10], s[o + 11], s[o + 12]]; q.held = null; y.held = null;
    y.asleep = Math.hypot(...y.v) < SLEEP.v && Math.hypot(...y.w) < SLEEP.w; y.calm = 0;          // (still at the holder: still here, until a hand wakes it)
    const far = first || Math.hypot(was.x - q.x, was.y - q.y, was.z - q.z) > 0.25;
    q.off = far ? { x: 0, y: 0, z: 0 } : { x: was.x - q.x, y: was.y - q.y, z: was.z - q.z };
    q.other = s[o + 13] > 0.5;
  }
  function adapter(world, i, common, active) {
    const b = () => world.boxes[i], C = world.cfg;
    return {
      reach: (own) => active() && (!!b().steer || world.nearest(b(), common(own)) <= C.reach),            // (steered from this page's room model: it takes it)
      touching: (own) => active() && (!!b().steer || world.nearest(b(), common(own)) <= C.busy || (!!b().held && (own || []).some((s) => s.id === b().held.by))),
      pack: () => packBox(b()),
      apply: (s, info) => {
        if (!active()) return false;
        if (world.smooth) { if (info.first) b().buf = []; world.feed(i, world.hostTime(info.clock, info.now), s, 0); } else applyBox(world, b(), s, 0, info.first);
        return true;
      },
      do: (what, args) => request(world, what, Object.assign({}, args, what === 'steer' ? { i } : {})),
      settle: (mine) => { if (mine) b().other = false; },
      moving: () => world.isMoving(b()),
    };
  }
  // What another page asks of the holder (body.ask): 'steer' { i, at: [x, y, z] common, or null: let go } (a box moved in a room model),
  // 'layout' { kind, n, at } (Reset, Drop the pile)
  function request(world, what, a) {
    a = a || {};
    if (what === 'steer') {
      const b = world.boxes[a.i | 0];
      if (!b) return false;
      const ok = Array.isArray(a.at) && a.at.length === 3 && a.at.every(Number.isFinite);
      b.steer = ok ? a.at.slice() : null; b.steerAt = ok ? Date.now() : 0;
      if (ok) world.pw.wake(b.body);
      return true;
    }
    if (what === 'layout' && ['grid', 'stack', 'pile'].includes(a.kind) && Number.isFinite(a.n)) {
      world.layout(a.kind, a.n, Array.isArray(a.at) && a.at.length === 2 && a.at.every(Number.isFinite) ? a.at : undefined);
      return true;
    }
    return false;
  }
  // The whole pile as one Body adapter: a hand of this page near any box (or a box steered from its room model) takes the token
  function pileAdapter(world, common, active) {
    const C = world.cfg, near = (own, lim) => { const h = common(own); return world.boxes.some((b) => !!b.steer || world.nearest(b, h) <= lim); };
    return {
      reach: (own) => active() && near(own, C.reach),
      touching: (own) => active() && (near(own, C.busy) || world.boxes.some((b) => !!b.held && (own || []).some((s) => s.id === b.held.by))),
      // the boxes that move, and those at rest that have not gone out for REST_EVERY ms
      pack: () => {
        const now = Date.now(), out = [world.boxes.length];
        world.boxes.forEach((b, i) => { if (world.isMoving(b) || !(now - (b.sentAt || 0) < REST_EVERY)) { b.sentAt = now; out.push(i, ...packBox(b)); } });
        return out;
      },
      apply: (s, info) => {
        if (!active()) return false;
        const n = s[0], t = world.smooth ? world.hostTime(info.clock, info.now) : 0;
        if (world.boxes.length !== n) world.layout('grid', n);
        if (info.first) for (const q of world.boxes) q.buf = [];
        for (let o = 1; o < s.length; o += BOX_N + 1) { const i = s[o]; if (world.smooth) world.feed(i, t, s, o + 1); else applyBox(world, world.boxes[i], s, o + 1, info.first); }
        return true;
      },
      settle: (mine) => { if (mine) for (const b of world.boxes) b.other = false; },
      do: (what, args) => request(world, what, args),
      moving: () => world.movingCount() > 0,
    };
  }

  // A hand source (floor plan) in the common frame: what a World simulates with. toCommon([x, y, z]) -> [x, y, z].
  function commonSource(s, toCommon) {
    const out = Object.assign({}, s);
    if (s.points) out.points = s.points.map((p) => { const c = toCommon([p.x, p.y, p.z]); return Object.assign({}, p, { x: c[0], y: c[1], z: c[2] }); });
    if (s.joints) out.joints = s.joints.map((j) => toCommon(j));
    return out;
  }
  // the document's kind for a drift touch: the latest of each player, so that the others can compare theirs with it
  const KINDS = { drift: {
    keep: (e) => ({ key: `drift:${e.slot}` }),
    apply(S, e) { if ([e.x, e.y, e.round, e.slot].every(Number.isFinite)) { S.doc.drift = S.doc.drift || {}; S.doc.drift[e.slot] = { x: e.x, y: e.y, round: e.round }; S.notify('drift', e); } },
  } };

  // ---- the island's numbers, once a second: token hand-overs, jumps of a box (> 2 cm from where its speed said it would be), and whether
  // the stack stayed together (every box within one box's width of the bottom one, in a column)
  class Watch {
    constructor() { this.last = null; this.jumps = 0; this.handovers = 0; this.at = null; this.worstJump = 0; }
    // call every drawn frame; dt: seconds since the last one
    frame(world, dt) {
      const now = world.boxes.map((b) => world.drawn(b));
      if (this.last && this.last.length === now.length && dt > 0) {
        now.forEach((d, i) => {
          const b = world.boxes[i], p = this.last[i], e = Math.hypot(d.x - (p.x + b.vx * dt), d.y - (p.y + b.vy * dt), d.z - (p.z + b.vz * dt));
          if (e > 0.02) { this.jumps++; this.worstJump = Math.max(this.worstJump, e); }
        });
      }
      this.last = now;
    }
    together(world) {
      const B = world.boxes, base = B[0];
      return B.every((b, i) => Math.abs(b.x - base.x) < SIZE && Math.abs(b.y - base.y) < SIZE && b.z > base.z - 0.01 && (i === 0 || b.z - B[i - 1].z < SIZE * 1.5));
    }
    // handovers: the sum of the bodies' stats.handovers; -> a line when a second has passed, else null
    report(world, handovers, nowMs) {
      if (this.at === null) { this.at = nowMs; this.handovers = handovers; return null; }
      if (nowMs - this.at < 1000) return null;
      const line = { handovers: handovers - this.handovers, jumps: this.jumps, worst: Math.round(this.worstJump * 1000), together: this.together(world), moving: world.movingCount() };
      this.at = nowMs; this.handovers = handovers; this.jumps = 0; this.worstJump = 0;
      return line;
    }
  }

  // ---- the drift probe. Every `every` seconds after Start the page asks for a touch; the touch is a fingertip of the index resting on the
  // floor (lower than `low`, moving slower than `slow`) for `hold` seconds. The first touch is the cross; each later one is measured against
  // it in the common frame (mm), and against the other player's touch of the same round when there is one.
  const DRIFT = { every: 60, low: 0.06, slow: 0.03, hold: 1.5, window: 25, rounds: 10 };       // (low is 6 cm: the desktop rehearsal's pretend fingertip is 5 cm up)
  class Drift {
    constructor(cfg = {}) { this.cfg = Object.assign({}, DRIFT, cfg); this.reset(); }
    reset() { this.on = false; this.ref = null; this.round = 0; this.nextAt = null; this.askedAt = null; this.still = null; this.rows = []; this.largest = 0; }
    start(t) { this.reset(); this.on = true; this.round = 0; this.nextAt = t; }
    stop() { this.on = false; }
    get asking() { return this.on && this.askedAt !== null; }
    // every frame: t (s); tips: this page's index fingertips [{ id, x, y, z }] (floor plan); toCommon([x, y]) -> [x, y]
    // -> a row when a touch was taken, else null: { round, first, dx, dy, mm, common: [x, y] }
    update(t, tips, toCommon) {
      const c = this.cfg;
      if (!this.on) return null;
      if (this.askedAt === null && t >= this.nextAt) { this.askedAt = t; this.round++; this.nextAt += c.every; this.still = null; }
      if (this.askedAt === null) return null;
      if (t - this.askedAt > c.window) { this.askedAt = null; return this._done({ round: this.round, missed: true }); }
      const tip = tips.find((q) => q.z < c.low);
      if (!tip) { this.still = null; return null; }
      if (!this.still || Math.hypot(tip.x - this.still.x, tip.y - this.still.y) > c.slow * (t - this.still.t) + 0.004) { this.still = { x: tip.x, y: tip.y, t, t0: t }; return null; }
      if (t - this.still.t0 < c.hold) return null;
      const p = toCommon([tip.x, tip.y]), row = { round: this.round, first: !this.ref, common: p };
      if (!this.ref) this.ref = p;
      row.dx = Math.round((p[0] - this.ref[0]) * 1000); row.dy = Math.round((p[1] - this.ref[1]) * 1000); row.mm = Math.round(Math.hypot(row.dx, row.dy));
      this.largest = Math.max(this.largest, row.mm);
      this.askedAt = null;
      return this._done(row);
    }
    _done(row) { this.rows.push(row); if (this.round >= this.cfg.rounds) this.on = false; return row; }
  }

  // ---- how fast the page runs: p50 and p95 of the frame time and the mean simulation time over a window
  class Perf {
    constructor(every = 5000) { this.every = every; this.frames = []; this.sims = []; this.at = null; }
    // frameMs: time since the last frame; simMs: this frame's simulation. -> a report every `every` ms, else null
    add(nowMs, frameMs, simMs) {
      if (this.at === null) this.at = nowMs;
      this.frames.push(frameMs); this.sims.push(simMs);
      if (nowMs - this.at < this.every) return null;
      const f = this.frames.slice().sort((a, b) => a - b), q = (p) => f[Math.min(f.length - 1, Math.floor(p * f.length))];
      const r = { fps: Math.round(f.length / ((nowMs - this.at) / 1000)), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), sim: +(this.sims.reduce((a, v) => a + v, 0) / this.sims.length).toFixed(2) };
      this.frames = []; this.sims = []; this.at = nowMs;
      return r;
    }
  }

  // ---- settings and the menu
  const MODES = ['pile', 'island', 'drift'], COUNTS = [10, 20, 30, 50];
  const GAME = { mode: 'pile', n: 10 };
  const PLAYER = { ghost: true, model: false, handIrl: false };
  const ACTIONS = ['reset', 'dropPile', 'driftStart'];
  function press(id, st) {
    if (id === 'model') return Object.assign({}, st, { model: !st.model });
    if (id === 'handIrl') return Object.assign({}, st, { handIrl: !st.handIrl });
    if (id === 'mode') return Object.assign({}, st, { mode: MODES[(MODES.indexOf(st.mode) + 1) % MODES.length] });
    if (id === 'n') return Object.assign({}, st, { n: COUNTS[(COUNTS.indexOf(st.n) + 1) % COUNTS.length] });
    if (id === 'ghost') return Object.assign({}, st, { ghost: !st.ghost });
    return null;
  }
  const HELP = { pile: 'drop the cubes into a heap, poke it: the numbers go to the log', island: 'two players: one pushes the bottom, one lifts the top', drift: 'Start, then touch the cross when asked, each minute' };
  function menu(st, info) {
    info = info || {};
    const mode = st.mode || 'pile';
    return M.menus.grid({ w: 1024, title: 'MUMR lab', note: info.note || HELP[mode],
      rows: [
        [{ id: 'mode', label: 'Experiment', value: mode, active: true }, mode === 'pile' ? { id: 'n', label: 'Cubes', value: String(st.n || 10) } : { label: 'Players', value: String(info.players || 1) }, { id: 'ghost', label: 'Ghost fingers', value: st.ghost ? 'shown' : 'hidden', active: !!st.ghost }],
        [{ id: 'reset', label: 'Reset', value: mode === 'island' ? 'build the stack' : 'cubes on the floor' }].concat(mode === 'pile' ? [{ id: 'dropPile', label: 'Drop the pile', value: 'into one heap', span: 2 }] : mode === 'drift' ? [{ id: 'driftStart', label: 'Start drift', value: 'ten rounds', span: 2 }] : []),
        [{ id: 'model', label: 'Room model', value: st.model ? 'shown: move the windows and cubes' : 'rearrange the windows', active: !!st.model, span: 2 }, { id: 'handIrl', label: 'Show hand IRL', value: st.handIrl ? 'on' : 'off', active: !!st.handIrl }],
      ] });
  }

  // ---- the two text windows: a layout of lines (long ones are wrapped), '## ' starts a heading
  function wrap(text, width) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (line && (line + ' ' + word).length > width) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
      }
      out.push(line);
    }
    return out;
  }
  function textLayout(title, lines, note, width = 70) {
    const rows = [];
    for (const l of lines) for (const w of wrap(l.replace(/^## /, ''), width)) rows.push([{ label: w, left: true, flat: true, head: /^## /.test(l), size: 24 }]);
    return M.menus.grid({ w: 1024, title, note: note || '', rowH: 30, rows });
  }
  // what each experiment is for, what to try and what passes (the same as README.md)
  const DESCRIPTION = {
    pile: ['## What it is for', 'How many boxes one headset can simulate before the frame time suffers. The answer says whether sleeping bodies (phase 5) are needed or only nice.',
      '## What to try', 'Pick 10, 20, 30 and 50 cubes with the Cubes button. Press Drop the pile. Poke the heap with a finger, pinch a cube, throw one at it. Leave it alone and see that it comes to rest.',
      '## What passes', 'Frame time p95 under 13.9 ms (72 Hz) at 30 cubes, and the pile comes to rest. The numbers are on the data window and in the log every 5 s.',
      '## Note', 'The cubes are shared: every player sees the same pile and can touch it. The page whose hand is on it simulates it for everybody.'],
    island: ['## What it is for', 'What happens to a stack when two players touch it at once. Today each cube has a token of its own and changes hands on touch. This run is the baseline: it shows today\'s failure so that phase 5 (one token for a touching group) has something to beat.',
      '## What to try', 'Two headsets, both lined up. Press Reset (builds a stack of 5). One player pushes the bottom cube while the other lifts the top one. A cube\'s colour is the player who simulates it.',
      '## What passes', 'Today: it will probably tear apart, which is the point. Phase 5 passes when the stack moves as one with no jumps. The data window counts hand-overs, jumps over 2 cm and whether the stack stayed together.'],
    drift: ['## What it is for', 'How far the line-up drifts over 10 minutes: one headset against the room, two headsets against each other.',
      '## What to try', 'Mark a cross on the floor. Line up, press Start drift, and walk about. When the page says so (once a minute, ten times) rest your index finger on the cross for 1.5 s. Two players: both touch the same cross.',
      '## What passes', 'Under 2 cm after 10 minutes. If not, the anchor keeper needs a re-check timer (anchor.js). The first touch defines the cross; the data window lists every round in mm.'],
  };
  const description = (mode) => textLayout(`About: ${mode}`, (DESCRIPTION[mode] || DESCRIPTION.pile).concat(['## The windows', 'Every window can be carried by its bar (pinch) or by a fist on it. The hand wall and the room model are on the menu.']), '', 62);
  // the data window's lines: info = { mode, perf (last report), pile (n, moving), island (together, moving, last, totals), drift (Drift), me, players, lined, room, rtt }
  function dataLines(info) {
    const out = [`## ${info.mode}`];
    if (info.mode === 'pile') {
      const p = info.perf;
      out.push(`cubes: ${info.pile.n}   moving: ${info.pile.moving}`);
      out.push(p ? `frames per second: ${p.fps}` : 'frames per second: (first report in 5 s)');
      if (p) { out.push(`frame time p50 / p95: ${p.p50} / ${p.p95} ms   ${p.p95 < 13.9 ? 'under' : 'OVER'} 13.9 ms (72 Hz)`); out.push(`simulation per frame: ${p.sim} ms`); }
    } else if (info.mode === 'island') {
      const i = info.island, t = i.totals;
      out.push(`stack: ${i.together ? 'together' : 'BROKEN'}   moving: ${i.moving}`);
      out.push(`last second: ${i.last ? `${i.last.handovers} hand-overs, ${i.last.jumps} jumps (worst ${i.last.worst} mm)` : '-'}`);
      out.push(`since reset: ${t.handovers} hand-overs, ${t.jumps} jumps (worst ${t.worst} mm), broken ${t.broken} s`);
      out.push(`simulated by: ${i.holders.join(', ')}`);
    } else {
      const d = info.drift;
      out.push(d.on ? (d.asking ? `round ${d.round} of ${d.cfg.rounds}: TOUCH THE CROSS` : `round ${d.round} of ${d.cfg.rounds} done, next in ${Math.max(0, Math.round(info.nextIn))} s`) : d.rows.length ? 'finished (or stopped)' : 'not started: press Start drift');
      out.push(`largest: ${d.largest} mm   ${d.largest ? (d.largest < 20 ? 'under' : 'OVER') + ' 2 cm' : ''}`);
      for (const r of d.rows.slice(-8)) out.push(r.missed ? `round ${r.round}: missed` : r.first ? `round ${r.round}: the cross` : `round ${r.round}: ${r.mm} mm (dx ${r.dx}, dy ${r.dy})${r.other !== undefined ? `, ${r.other} mm from the other player` : ''}`);
    }
    out.push('## the page');
    out.push(`${info.players > 1 ? `player ${info.me + 1} of ${info.players}` : 'alone'}   ${info.lined ? 'lined up' : 'not lined up'}   round trip ${info.rtt === undefined || info.rtt === null ? '-' : info.rtt} ms`);
    return out;
  }
  const dataLayout = (info) => textLayout('Data', dataLines(info), '', 62);

  Object.assign(L, { SIZE, HALF, MAX_BOXES, ISLAND, TYPES, PILE, KINDS, World, adapter, pileAdapter, commonSource, Watch, Drift, Perf, MODES, COUNTS, GAME, PLAYER, ACTIONS, press, menu, wrap, textLayout, description, dataLines, dataLayout, DESCRIPTION });
})(typeof module !== 'undefined' ? module.exports : (globalThis.LAB = {}));
