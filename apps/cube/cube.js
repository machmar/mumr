// The cube demo's own logic, with no THREE and no DOM (the headset page, the PC view and the Node tests all use it):
//   * the CUBE: a 12 cm cube of hard plastic (engine/client/physics.js: gravity, a bounce, tumbling, friction, rest; its mass comes from its size).
//     Every hand pushes it (each fingertip, the palm and every joint), except a hand that is closing on it (about to grip it, or on two sides
//     of it). It is HELD by either grip of the engine (engine/client/grab.js): a pinch (index and thumb touching) that starts within 3 cm of it, or a
//     fist that closes with its middle within 8 cm of it. The hold is a spring-like motor: the cube follows the hand and turns with it
//     (as the hand was turned when the grip began), but is stopped by whatever is in the way, and a hand that pulls more than 30 cm away (through
//     a wall) lets go. When the grip opens it keeps the hand's speed and spin: a throw. With a room (cube.room: room.js, this page's floor plan) it
//     lands on tables and solid objects, passes under tables, stops at walls and objects, and never goes through anything. A flat hand (palm
//     up or back of the hand up, grab.js platform) is a plate it can be carried on, until the hand tilts so far that it slides off. A pointing
//     finger pushes it like any other (Marek, 2026-10-23: one finger stopped pushing it). Feet push it only with cfg.kick (off here);
//   * its BODY adapter (MUMR body.js): the token 'cube' follows touch, the holder sends packet 16;
//   * the MENU: the app's own (the engine's menu, with Line up, Room setup and Exit, is on the wrist: engine/client/sysmenu.js); the same layout
//     for this player's menu, another player's menu, and the PC view.
// The cube is simulated on this page's floor plan (x, y on the floor, z = height of its middle above this headset's floor).
(function (C) {
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const SIZE = 0.12, HALF = SIZE / 2;
  const COLOURS = ['#e8a33d', '#4ea1ff', '#7bd88f', '#ff6b81', '#c792ea'];
  const DEF = { gravity: 9.81, touch: 0.012, grab: 0.03, grabFist: 0.08, spring: 20, holdSpeed: 5, breakAway: 0.3,
    smooth: 12, snap: 0.25, reach: 0.06, busy: 0.02, closeNear: 0.05, kick: false, footTouch: 0.045 };
  const R = HALF * 1.3;          // the cube put against walls and objects (`put`): a round thing a little wider than its half
  const HAND_MAX = 4;            // m/s, the most a hand's speed counts for

  // packet 16: x, y, z, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz (common frame), flags (1: held) -- 14 float32 (engine/client/physics.js)
  M.physics.registerPacket({ type: 16, name: 'cube', token: 'cube' });

  const pt = (s, name) => (s.points || []).find((p) => p.name === name);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const heading = (q) => { const r = Q.rotate(q, [1, 0, 0]); return Math.atan2(r[1], r[0]); };
  const handQuat = M.physics.handQuat;
  // a hand that is closing on the cube: the thumb and index coming together, or the fingers curling, near it (it is about to grip).
  // Not a pointing hand: its other fingers are curled too, but it pushes with its index (that stopped one-finger pushing, 2026-10-23).
  function closingOn(cube, s, C) {
    if (cube.nearest([s]) > C.closeNear || cube.grips.of(s.id).gesture === 'point') return false;
    const th = pt(s, 'thumb'), ix = pt(s, 'index');
    return (th && ix && Math.hypot(th.x - ix.x, th.y - ix.y, th.z - ix.z) < 0.05) || M.grab.closing(s) > 0.6;
  }

  class Cube {
    constructor(cfg = {}) {
      this.cfg = Object.assign({}, DEF, cfg);
      this.body = M.physics.makeBox({ size: [SIZE, SIZE, SIZE], p: [0.5, 0, HALF] });
      this.world = new M.physics.World({ gravity: this.cfg.gravity });
      this.world.add(this.body);
      this.held = null;                     // { by: source id, kind: 'pinch' | 'fist', ... } while a grip holds it
      this.off = { x: 0, y: 0, z: 0 };      // drawn = simulated + this (a correction from the holder, fading)
      this.qShow = this.body.q.slice(); this.qFade = 0;       // the orientation drawn while a correction from the holder fades
      this.prev = new Map();                // source id + point -> [x, y, z, t]: for the hands' speed
      this.grips = new M.grab.Grips();      // everybody's pinches and fists
      this.touched = false;
      this.room = null;                     // the room (room.js local(), this page's floor plan), or null: the floor only
      this.onHand = null;                   // { id } while it rests on a flat hand
      this.steer = null;                    // [x, y, z]: where a hand in the room model wants it (it follows like a held cube)
      this.free = new Map();                // source id -> time (s) until which its hand pushes nothing: it has just let go
    }
    get x() { return this.body.p[0]; } set x(v) { this.body.p[0] = v; }
    get y() { return this.body.p[1]; } set y(v) { this.body.p[1] = v; }
    get z() { return this.body.p[2]; } set z(v) { this.body.p[2] = v; }
    get vx() { return this.body.v[0]; } set vx(v) { this.body.v[0] = v; this.world.wake(this.body); }
    get vy() { return this.body.v[1]; } set vy(v) { this.body.v[1] = v; this.world.wake(this.body); }
    get vz() { return this.body.v[2]; } set vz(v) { this.body.v[2] = v; this.world.wake(this.body); }
    get yaw() { return heading(this.body.q); }
    get q() { return this.body.q; }
    // a point in the cube's own frame (its middle, turned with it)
    local(x, y, z) { const p = this.body.p; return Q.rotate(Q.conj(this.body.q), [x - p[0], y - p[1], z - p[2]]); }
    // how far a point is from the cube's surface (0 inside)
    dist(x, y, z) { const l = this.local(x, y, z); return Math.hypot(Math.max(0, Math.abs(l[0]) - HALF), Math.max(0, Math.abs(l[1]) - HALF), Math.max(0, Math.abs(l[2]) - HALF)); }
    nearest(sources) {
      let best = Infinity;
      for (const s of sources || []) {
        for (const p of s.points || []) best = Math.min(best, this.dist(p.x, p.y, p.z));
        for (const j of s.joints || []) best = Math.min(best, this.dist(j[0], j[1], j[2]));
      }
      return best;
    }
    _vel(key, p, t) {
      const q = this.prev.get(key), v = q && t > q[3] ? [(p[0] - q[0]) / (t - q[3]), (p[1] - q[1]) / (t - q[3]), (p[2] - q[2]) / (t - q[3])] : [0, 0, 0];
      this.prev.set(key, [p[0], p[1], p[2], t]);
      const s = Math.hypot(...v);
      return s > HAND_MAX ? v.map((c) => (c * HAND_MAX) / s) : v;
    }
    // the hands: every point and joint of a hand is a small sphere that pushes; a flat hand is a plate it can lie on; not a hand that is
    // closing on it (about to grip), has just let go of it, or a foot
    _hands(grips, sources, t) {
      const C = this.cfg, hands = [];
      for (const s of sources || []) {
        if (s.foot && !C.kick) continue;
        const g = grips.find((q) => q.id === s.id), quiet = (this.free.get(s.id) || 0) > t, flat = !quiet && !!g && !!g.palm && !g.kind && (g.gesture === 'flat' || (!!this.onHand && this.onHand.id === s.id));
        hands.push({ id: s.id, spheres: flat || quiet || closingOn(this, s, C) ? [] : M.physics.handSpheres(s, s.foot ? C.footTouch : C.touch), plate: flat ? M.physics.plate(g) : null });
      }
      return hands;
    }
    // one step of dt seconds at time t (s) with every hand there is (this page's and the others', floor plan)
    step(dt, t, sources) {
      const C = this.cfg, b = this.body, grips = this.grips.update(sources), noHold = new Set((sources || []).filter((s) => s.noHold).map((s) => s.id));
      this.touched = false; this.world.gravity = C.gravity;
      const heldBy = this.held && this.held.by;
      if (this.world.room !== this.room) this.world.setRoom(this.room);
      // holding: a grip of the engine (engine/client/grab.js) that starts at the cube: a pinch within C.grab of it, a fist within C.grabFist.
      // It holds while that grip lasts (Marek: "nothing clever"), at the angle it had in the hand when it began.
      for (const g of grips) {
        if (this.held && this.held.by === g.id && g.kind !== this.held.kind) this.held = null;
        if (!this.held && g.start && g.at && !noHold.has(g.id) && this.dist(g.at[0], g.at[1], g.at[2]) <= (g.kind === 'fist' ? C.grabFist : C.grab)) {      // (noHold: that fist moves a menu or the model)
          const hq = handQuat((sources || []).find((s) => s.id === g.id)), off = sub(b.p, g.at);
          this.held = { by: g.id, kind: g.kind, off, hold: hq ? { loff: Q.rotate(Q.conj(hq), off), qoff: Q.mul(Q.conj(hq), b.q) } : null, fix: b.q.slice() };
          this.world.wake(b);
        }
      }
      if (this.held && !grips.some((g) => g.id === this.held.by)) this.held = null;            // the hand was lost: it falls
      if (heldBy && !this.held) this.free.set(heldBy, t + 0.3);
      if (this.held || this.steer) {
        let target;
        if (this.held) {
          const g = grips.find((q) => q.id === this.held.by), H = this.held, hq = H.hold ? handQuat((sources || []).find((s) => s.id === g.id)) : null;
          const o = hq ? Q.rotate(hq, H.hold.loff) : H.off;
          target = { p: [g.at[0] + o[0], g.at[1] + o[1], g.at[2] + o[2]], q: hq ? Q.mul(hq, H.hold.qoff) : H.fix };
          target.v = this._vel(`${g.id}:hold`, g.at, t);
        } else target = { p: this.steer.slice(), q: b.q.slice() };
        const status = this.world.hold(b, target, { spring: C.spring, speed: C.holdSpeed, breakAway: this.held ? C.breakAway : Infinity });
        if (status === 'released') { this.free.set(this.held.by, t + 0.3); this.held = null; }
        this.onHand = null; this.touched = true;
        this.world.setHands(this._hands(grips, sources, t), t, false);
      } else {
        if (b.held) this.world.release(b);                     // (let go: it keeps the speed and the spin the hold gave it)
        this.world.setHands(this._hands(grips, sources, t), t);
      }
      this.world.step(dt);
      // which flat hand it lies on (for the hand to keep it up while it tilts a little further than it takes it)
      this.onHand = null;
      for (const h of this.world.kin.plates) if (!this.held) {
        const rel = sub(b.p, h.centre), ln = rel[0] * h.normal[0] + rel[1] * h.normal[1] + rel[2] * h.normal[2];
        if (ln > HALF * 0.8 && ln < HALF * 1.6 && Math.abs(rel[0] * h.axes[0][0] + rel[1] * h.axes[0][1] + rel[2] * h.axes[0][2]) < h.half[0] + 0.03 && Math.abs(rel[0] * h.axes[1][0] + rel[1] * h.axes[1][1] + rel[2] * h.axes[1][2]) < h.half[1] + 0.03) {
          this.onHand = { id: h.id }; this.touched = true;
        }
      }
      if (Math.hypot(b.p[0], b.p[1]) > 8) this.place(0.5, 0);             // (it went too far: back near the middle)
      const k = Math.exp(-C.smooth * dt);
      this.off.x *= k; this.off.y *= k; this.off.z *= k;
      if (this.qFade > 0.01) { this.qFade *= k; this.qShow = Q.slerp(b.q, this.qShow, this.qFade); } else this.qFade = 0;
    }
    place(x, y) {
      const b = this.body;
      b.p = [x, y, HALF]; b.q = [0, 0, 0, 1]; b.v = [0, 0, 0]; b.w = [0, 0, 0]; this.world.wake(b); b.held = null;
      this.held = null; this.onHand = null; this.qShow = b.q.slice(); this.qFade = 0;
    }
    // put somewhere in the room (the room model): at (x, y), its middle at least at z, out of any wall or object; it then falls onto
    // whatever is under it
    put(x, y, z) {
      this.place(x, y);
      this.body.p[2] = Math.max(HALF, z);
      const w = M.room.pushOut(this.room, this.x, this.y, this.z - HALF + 0.005, this.z + HALF - 0.005, R);
      if (w) { this.x = w.x; this.y = w.y; }
    }
    moving() { return !!this.held || !!this.steer || !!this.onHand || !this.body.asleep; }
    drawn() {
      const b = this.body, q = this.qFade > 0 ? this.qShow : b.q;
      return { x: b.p[0] + this.off.x, y: b.p[1] + this.off.y, z: b.p[2] + this.off.z, yaw: heading(q), q: q.slice(), held: !!this.held || !!this.steer || !!this.heldByOther };
    }
  }

  // The state of a packet, for whoever draws it (the PC view): { x, y, z, q, yaw, held }
  const unpacked = (s) => ({ x: s[0], y: s[1], z: s[2], q: s.slice(3, 7), yaw: heading(s.slice(3, 7)), held: s[13] > 0.5 });

  // The Body adapter: this page's hands (`own`, floor plan) decide whether it reaches; the state goes out in the common frame.
  function adapter(cube, space) {
    const C = cube.cfg, rot = (yaw, x, y) => M.align.toCommon({ x: 0, y: 0, yaw }, x, y);
    // the turn about z that the frame's rotation makes of a heading: what turns a quaternion into the common frame (and back with -yaw)
    const zq = (yaw) => { const r = rot(yaw, 1, 0); return Q.fromAxisAngle([0, 0, 1], Math.atan2(r[1], r[0])); };
    return {
      reach: (own) => !!cube.steer || cube.nearest(own) <= C.reach,             // (moved in the room model from here: this page takes it)
      touching: (own) => !!cube.steer || cube.nearest(own) <= C.busy || (!!cube.held && (own || []).some((s) => s.id === cube.held.by)),
      pack: () => {
        const b = cube.body, f = space.frame.yaw, p = space.toCommon([b.p[0], b.p[1], b.p[2]]), v = rot(f, b.v[0], b.v[1]), w = rot(f, b.w[0], b.w[1]), q = Q.mul(zq(f), b.q);
        return [p[0], p[1], p[2], q[0], q[1], q[2], q[3], v[0], v[1], b.v[2], w[0], w[1], b.w[2], cube.held || cube.steer ? 1 : 0];
      },
      apply: (s, info) => {
        if (!space.ok) return false;
        const b = cube.body, f = space.frame.yaw, p = space.fromCommon([s[0], s[1], s[2]]), v = rot(-f, s[7], s[8]), w = rot(-f, s[10], s[11]), was = cube.drawn(), qwas = was.q;
        b.p = [p[0], p[1], p[2]]; b.q = Q.normalize(Q.mul(zq(-f), [s[3], s[4], s[5], s[6]])); b.v = [v[0], v[1], s[9]]; b.w = [w[0], w[1], s[12]]; b.held = null; cube.held = null;
        cube.world.wake(b);
        const far = info.first || Math.hypot(was.x - b.p[0], was.y - b.p[1], was.z - b.p[2]) > C.snap;
        cube.off = far ? { x: 0, y: 0, z: 0 } : { x: was.x - b.p[0], y: was.y - b.p[1], z: was.z - b.p[2] };
        if (far) { cube.qFade = 0; cube.qShow = b.q.slice(); } else { cube.qShow = qwas; cube.qFade = 1; }
        cube.heldByOther = s[13] > 0.5;
        return true;
      },
      settle: (mine) => { if (mine) cube.heldByOther = false; },
      do: (what, args) => {
        if (what === 'place' && M.util.num(args.x) && M.util.num(args.y)) { const p = space.ok ? space.fromCommon([args.x, args.y]) : [args.x, args.y]; cube.place(p[0], p[1]); return true; }
        if (what === 'put' && [args.x, args.y, args.z].every((v) => M.util.num(v))) { const p = space.ok ? space.fromCommon([args.x, args.y, args.z]) : [args.x, args.y, args.z]; cube.put(p[0], p[1], p[2]); return true; }
        return false;
      },
      moving: () => cube.moving(),
    };
  }

  // ---- the menu, for whoever draws it: state = that player's (session.stateOf), info = what its owner says about it (lining up ...)
  const GAME = { count: 0, colour: 0 };
  const PLAYER = { ghost: true, model: false, handIrl: false };
  const ACTIONS = ['cubeHere'];                    // (the app's own; the engine's are engine/client/sysmenu.js SysMenu.ACTIONS)
  function press(id, st) {
    if (id === 'plus') return Object.assign({}, st, { count: st.count + 1 });
    if (id === 'colour') return Object.assign({}, st, { colour: (st.colour + 1) % COLOURS.length });
    if (id === 'ghost') return Object.assign({}, st, { ghost: !st.ghost });
    if (id === 'model') return Object.assign({}, st, { model: !st.model });
    if (id === 'handIrl') return Object.assign({}, st, { handIrl: !st.handIrl });
    return null;
  }
  function menu(st, info) {
    info = info || {};
    return M.menus.grid({ w: 1024, title: 'MUMR cube', note: info.note || '',
      rows: [
        [{ id: 'plus', label: 'Count', value: String(st.count) }, { id: 'colour', label: 'Cube colour', value: COLOURS[st.colour % COLOURS.length].slice(1), active: true }, { id: 'cubeHere', label: 'Cube here', value: 'in front of me' }],
        [{ id: 'ghost', label: 'Ghost fingers', value: st.ghost ? 'shown' : 'hidden', active: !!st.ghost }, { label: 'Players', value: String(info.players || 1) }],
        [{ id: 'model', label: 'Room model', value: st.model ? 'shown: move the cube or the viewer' : 'hidden', active: !!st.model, span: 2 }, { id: 'handIrl', label: 'Show hand IRL', value: st.handIrl ? 'on' : 'off', active: !!st.handIrl }],
      ] });
  }

  Object.assign(C, { SIZE, HALF, R, COLOURS, Cube, adapter, unpacked, heading, GAME, PLAYER, ACTIONS, press, menu });
})(typeof module !== 'undefined' ? module.exports : (globalThis.CUBE = {}));
