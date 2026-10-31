// The same World as physics.js, on Jolt Physics (jrouwe/JoltPhysics, MIT; the `jolt-physics` npm package: its C++ built to WebAssembly). Node only: the
// host process on the PC runs it, pages never load it (it is not in index.js's FILES). Bodies stay the plain objects of physics.js makeBox
// ({ p, q, v, w, asleep, held, ... }); a caller that writes one of those fields between two steps (a packet, a reset) is seen and the state is
// pushed into Jolt. Floor plan: x, y on the floor, z up (Jolt takes any up).
//   await M.physics.jolt.load();                       once, before the first world (the WebAssembly is built asynchronously)
//   new M.physics.JoltWorld({ gravity, substep, room, floor, sleepAfter, sleepV })   add, remove, setRoom, wake, setHands, hold, release, step
// What differs from the hand-made World: Jolt has one friction number per body (the kinetic one is used) and none for rolling, so a cube comes
// to rest by its angular damping only; the room's walls are thick (20 cm) two-sided slabs; a table or solid object is the convex hull of its
// outline (a hollow outline is filled); `contacts(b)` does not exist. Hands are kinematic bodies that Jolt moves (at most 4 m/s) and resolves.
// `hold(b, target, { force: N, omega })` is a grip with a limited strength: the body is pulled towards the target by a critically damped
// spring (natural frequency omega, 80 rad/s) whose force is at most N newtons, applied inside every substep. It stays an
// ordinary dynamic body, so it takes its share of a load like its neighbours, and a hold that is jammed gives instead of tearing what it
// touches. The default velocity motor is cancelled by friction inside the same solver step when the body carries a load (a block under a
// tower stays put while the motor says it moves): apps/jenga uses `force`.
// World options for things that must stand still under a load: velocitySteps, positionSteps, speculative, baumgarte, minBounceV (Jolt's own).
// softHands: { force (N), omega (rad/s), mass (kg) }: the hands are not kinematic but light bodies pulled to the tracked hand by a spring of limited
// force, so a fingertip pressing a block against another one stops at it instead of driving one into the other (Marek's run, 2026-10-28: "it
// squishes things"). A hand shape left more than GHOST behind the real hand (the real hand went through the blocks) stops colliding until the
// place where the real hand is is free again. Hands never touch each other or the room (their own layer).
const M = require('./index.js');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let J = null;
// the WebAssembly Jolt, built once; rejects (and the caller falls back to the hand-made World) when the package is not installed
async function load() {
  if (J) return J;
  let file;
  try { file = require.resolve('jolt-physics'); } catch (e) { throw new Error('jolt-physics is not installed (npm install)'); }
  J = await (await import(pathToFileURL(path.resolve(file)).href)).default();
  return J;
}

(function () {
  const Q = M.physics.quat;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const mulv = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fin = (a) => a.every(Number.isFinite);
  const differs = (a, b) => a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || (a.length > 3 && a[3] !== b[3]);
  const MAX_DT = 0.05, HAND_MAX = 4, HOLD_W = 10, V_MAX = 30, W_MAX = 100, WALL_T = 0.2, PLATE_T = 0.01, FAR = 0.5, NEAR_WAKE = 0.05, GROUND = 100, MAX_SUB = 32, CATCH_TAU = 0.05, CATCH_UP = 2;
  const STATIC = 0, MOVING = 1, HAND = 2, GHOST = 0.05, SOFT_W = 40, JUMP = 0.04, SOFT_V = 2;
  const nearOn = (s, x) => { if (!s.q) return s.p; const d = sub(s.q, s.p), L = dot(d, d), t = L > 1e-12 ? Math.max(0, Math.min(1, dot(sub(x, s.p), d) / L)) : 0; return add(s.p, d, t); };
  // the turn that takes the y axis to direction d (unit)
  const fromY = (d) => { const c = cross([0, 1, 0], d), w = 1 + d[1]; return w < 1e-6 ? [1, 0, 0, 0] : Q.normalize([c[0], c[1], c[2], w]); };

  class JoltWorld {
    constructor(opts = {}) {
      if (!J) throw new Error('JoltWorld: await M.physics.jolt.load() first');
      this.gravity = opts.gravity === undefined ? 9.81 : opts.gravity;
      this.substep = opts.substep || 1 / 120;
      this.maxMove = opts.maxMove || 0.02;         // m, the most a body moves in one substep
      this.room = opts.room || null;
      this.floor = opts.floor !== false;
      this.bodies = [];
      this.budgetMs = opts.budgetMs || 0;          // (not used: Jolt is fast enough that a frame is never cut short)
      this.lagged = false;
      this.kin = { spheres: [], plates: [] };
      this.handPrev = new Map();
      this._roomSig = null; this._statics = []; this._shapes = new Map(); this._hands = new Map(); this._g = null;
      this.opts = opts; this.cap = opts.maxBodies || 1024;
      this._open();
      this.rv = new J.RVec3(0, 0, 0); this.v1 = new J.Vec3(0, 0, 0); this.v2 = new J.Vec3(0, 0, 0);
      this._applyGravity();
      this._buildRoom(this.room, true);
    }
    // the Jolt system itself (its limits are fixed when it is made: _grow makes a bigger one when the bodies come near them)
    _open() {
      const s = new J.JoltSettings(), ol = new J.ObjectLayerPairFilterTable(3);
      ol.EnableCollision(STATIC, MOVING); ol.EnableCollision(MOVING, MOVING); ol.EnableCollision(HAND, MOVING);
      const bp = new J.BroadPhaseLayerInterfaceTable(3, 2);
      bp.MapObjectToBroadPhaseLayer(STATIC, new J.BroadPhaseLayer(0)); bp.MapObjectToBroadPhaseLayer(MOVING, new J.BroadPhaseLayer(1)); bp.MapObjectToBroadPhaseLayer(HAND, new J.BroadPhaseLayer(1));
      s.mObjectLayerPairFilter = ol; s.mBroadPhaseLayerInterface = bp; s.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bp, 2, ol, 3);
      s.mMaxBodies = this.cap; s.mMaxBodyPairs = this.cap * 16; s.mMaxContactConstraints = this.cap * 8;      // (a heap has about 5 contacts a cube; the room for them grows with the cap)
      this.jolt = new J.JoltInterface(s); J.destroy(s);
      this.sys = this.jolt.GetPhysicsSystem(); this.bi = this.sys.GetBodyInterface();
      const ps = this.sys.GetPhysicsSettings();
      ps.mTimeBeforeSleep = this.opts.sleepAfter || 0.5; ps.mPointVelocitySleepThreshold = this.opts.sleepV || 0.02;
      ps.mPenetrationSlop = this.opts.slop || 0.004;      // (the default 2 cm is a sixth of a cube)
      // (solver knobs for things that must stand still under a load, a tower of small blocks: more rounds make a stack stiffer)
      if (this.opts.velocitySteps) ps.mNumVelocitySteps = this.opts.velocitySteps;
      if (this.opts.positionSteps) ps.mNumPositionSteps = this.opts.positionSteps;
      if (this.opts.speculative !== undefined) ps.mSpeculativeContactDistance = this.opts.speculative;
      if (this.opts.baumgarte !== undefined) ps.mBaumgarte = this.opts.baumgarte;
      if (this.opts.minBounceV !== undefined) ps.mMinVelocityForRestitution = this.opts.minBounceV;
      this.sys.SetPhysicsSettings(ps);
      // a hand is flesh, not hard plastic: a contact with a kinematic body (a hand) does not bounce (Jolt combines the two bodies' restitution by their maximum)
      this.listener = new J.ContactListenerJS();
      const soft = (a, b, st) => { if (J.wrapPointer(a, J.Body).IsKinematic() || J.wrapPointer(b, J.Body).IsKinematic()) J.wrapPointer(st, J.ContactSettings).mCombinedRestitution = 0; };
      this.listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
      this.listener.OnContactAdded = (a, b, m, st) => soft(a, b, st);
      this.listener.OnContactPersisted = (a, b, m, st) => soft(a, b, st);
      this.listener.OnContactRemoved = () => {};
      this.sys.SetContactListener(this.listener);
    }
    // free everything of this world (each one holds a few MB of the WebAssembly's memory: a test or a reset makes many)
    destroy() {
      if (!this.jolt) return;
      for (const b of this.bodies.slice()) this.remove(b);
      for (const id of this._statics) this._kill(id, true);
      for (const e of this._hands.values()) this._kill(e.id, e.on);
      this._statics = []; this._hands.clear();
      for (const sh of this._shapes.values()) sh.Release();
      this._shapes.clear();
      for (const o of [this.rv, this.v1, this.v2, this.jolt, this.listener]) J.destroy(o);
      this.jolt = null;
    }
    // More bodies than the system was made for: the same world in a system twice as big. The bodies' state is in their plain objects, so
    // they are made again from it (the hands again on their next call, the room now).
    _grow() {
      for (const b of this.bodies) if (b._j) { this._kill(b._j.id, true); b._j = null; }
      for (const id of this._statics) this._kill(id, true);
      for (const e of this._hands.values()) this._kill(e.id, e.on);
      this._statics = []; this._hands.clear();
      J.destroy(this.jolt); J.destroy(this.listener);
      this.cap *= 2; this._open(); this._applyGravity(); this._buildRoom(this.room, true);
      for (const b of this.bodies) this._create(b);
    }
    // Jolt hands back a BodyID that lives in one scratch slot the next call overwrites: a body's id is copied (and freed with the body)
    _mk(cs, act) { const raw = this.bi.CreateAndAddBody(cs, act); return new J.BodyID(raw.GetIndexAndSequenceNumber()); }
    _kill(id, added) { if (added) this.bi.RemoveBody(id); this.bi.DestroyBody(id); J.destroy(id); }
    _applyGravity() { this.v1.Set(0, 0, -this.gravity); this.sys.SetGravity(this.v1); this._g = this.gravity; }
    _quat(q) { return new J.Quat(q[0], q[1], q[2], q[3]); }
    // ---- shapes, cached by size (to the millimetre); the cache holds a reference (a shape no body uses any more would be freed under it)
    _box(hx, hy, hz) {
      const key = `b${Math.round(hx * 1000)}:${Math.round(hy * 1000)}:${Math.round(hz * 1000)}`;
      let s = this._shapes.get(key);
      if (!s) { this.v1.Set(hx, hy, hz); s = new J.BoxShape(this.v1, 0.0, null); s.AddRef(); this._shapes.set(key, s); }
      return s;
    }
    _ball(r) { const key = `s${Math.round(r * 1000)}`; let s = this._shapes.get(key); if (!s) { s = new J.SphereShape(r, null); s.AddRef(); this._shapes.set(key, s); } return s; }
    _pill(len, r) { const key = `c${Math.round(len * 1000)}:${Math.round(r * 1000)}`; let s = this._shapes.get(key); if (!s) { s = new J.CapsuleShape(len / 2, r, null); s.AddRef(); this._shapes.set(key, s); } return s; }
    // ---- the room: the floor, and the walls, tables and solid objects of room.js as static bodies (rebuilt when the room's numbers change)
    _static(shape, p, q) {
      this.rv.Set(p[0], p[1], p[2]); const rot = this._quat(q);
      const cs = new J.BodyCreationSettings(shape, this.rv, rot, J.EMotionType_Static, STATIC);
      cs.mFriction = 0.4; cs.mRestitution = 0;
      const id = this._mk(cs, J.EActivation_DontActivate);
      J.destroy(cs); J.destroy(rot);
      this._statics.push(id);
    }
    _buildRoom(room, force) {
      const walls = room ? M.room.walls(room) : [], blocks = room ? M.room.blocks(room) : [], mm = (v) => Math.round(v * 1000), fx = this.fixtures || [];
      const sig = JSON.stringify([this.floor, walls.map((w) => [w.x0, w.y0, w.x1, w.y1, w.lo, w.hi].map(mm)), blocks.map((k) => [k.lo, k.hi, k.pts.map((q) => [mm(q[0]), mm(q[1])])]), fx.map((f) => f.size.concat(f.p).map(mm).concat(f.q.map((v) => Math.round(v * 1e4))))]);
      if (!force && sig === this._roomSig) return false;
      this._roomSig = sig;
      for (const id of this._statics) this._kill(id, true);
      this._statics = [];
      if (this.floor) this._static(this._box(GROUND, GROUND, 0.5), [0, 0, -0.5], [0, 0, 0, 1]);
      for (const w of walls) {
        const dx = w.x1 - w.x0, dy = w.y1 - w.y0, L = Math.hypot(dx, dy), h = Math.max(0.1, w.hi - w.lo);
        this._static(this._box(L / 2, WALL_T / 2, h / 2), [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, (w.lo + w.hi) / 2], Q.fromAxisAngle([0, 0, 1], Math.atan2(dy, dx)));
      }
      for (const k of blocks) {
        const hs = new J.ConvexHullShapeSettings(); hs.mMaxConvexRadius = 0.002;
        for (const z of [Math.max(k.lo, -1), k.hi]) for (const q of k.pts) { this.v1.Set(q[0], q[1], z); hs.mPoints.push_back(this.v1); }
        const r = hs.Create();
        if (r.HasError()) { J.destroy(hs); continue; }
        const shape = r.Get(); shape.AddRef(); J.destroy(hs);
        this._static(shape, [0, 0, 0], [0, 0, 0, 1]);
        shape.Release();
      }
      for (const f of fx) this._static(this._box(f.size[0] / 2, f.size[1] / 2, f.size[2] / 2), f.p, f.q);
      return true;
    }
    // static boxes of the app's own (turned any way; the room planes are only level tops and upright walls): [{ size, p, q }]
    setFixtures(list) { this.fixtures = (list || []).filter((f) => f && fin(f.size) && fin(f.p) && fin(f.q)); if (this._buildRoom(this.room, false)) for (const b of this.bodies) this.wake(b); }
    setRoom(room) {
      this.room = room || null;
      if (this._buildRoom(this.room, false)) for (const b of this.bodies) this.wake(b);
    }
    // ---- bodies
    add(b) {
      if (this.bodies.includes(b)) return b;
      if (this.bodies.length + this._statics.length + 64 > this.cap) this._grow();          // (64 for the hands)
      this.bodies.push(b); this._create(b); return b;
    }
    _create(b) {
      this._clean(b);
      const shape = this._box(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2);
      this.rv.Set(b.p[0], b.p[1], b.p[2]); const rot = this._quat(b.q);
      const cs = new J.BodyCreationSettings(shape, this.rv, rot, J.EMotionType_Dynamic, MOVING);
      cs.mFriction = b.friction.k; cs.mRestitution = b.restitution; cs.mAngularDamping = b.angularDamping; cs.mLinearDamping = 0;
      cs.mMotionQuality = J.EMotionQuality_LinearCast; cs.mMaxLinearVelocity = V_MAX; cs.mMaxAngularVelocity = W_MAX;
      cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia; cs.mMassPropertiesOverride.mMass = b.mass;
      const id = this._mk(cs, b.asleep ? J.EActivation_DontActivate : J.EActivation_Activate);
      J.destroy(cs); J.destroy(rot);
      this.v1.Set(b.v[0], b.v[1], b.v[2]); this.v2.Set(b.w[0], b.w[1], b.w[2]);
      this.bi.SetLinearAndAngularVelocity(id, this.v1, this.v2);
      if (b.asleep) this.bi.DeactivateBody(id);
      b._j = { id, p: b.p.slice(), q: b.q.slice(), v: b.v.slice(), w: b.w.slice(), asleep: !!b.asleep, gf: 1 };
      if (b.noSleep) { b.noSleep = false; this.keepAwake(b, true); }
    }
    remove(b) {
      const i = this.bodies.indexOf(b);
      if (i < 0) return;
      this.bodies.splice(i, 1);
      if (b._j) { this._kill(b._j.id, true); b._j = null; }
    }
    wake(b) { b.asleep = false; b.calm = 0; if (b._j) { this.bi.ActivateBody(b._j.id); b._j.asleep = false; } }
    // a body that may not sleep (on) or may again: a stack woken from sleep settles a little each time (Jolt starts its contacts afresh), so one
    // that is woken often (a tower that hands come near) is better kept awake
    keepAwake(b, on) {
      b.noSleep = !!on;
      if (!b._j) return;
      const body = this.sys.GetBodyLockInterfaceNoLock().TryGetBody(b._j.id);
      if (body && body.GetAllowSleeping() === !!on) { body.SetAllowSleeping(!on); if (on) this.wake(b); }
    }
    // a state a packet or a caller put into a body that it cannot be in is put right (as physics.js does)
    _clean(b) {
      if (fin(b.p)) b.good = b.p.slice(); else { const g = (b.good || [0, 0, b.size[2] / 2]); for (let i = 0; i < 3; i++) b.p[i] = g[i]; }
      for (const [k, max] of [['v', V_MAX], ['w', W_MAX]]) {
        if (!fin(b[k])) { b[k][0] = b[k][1] = b[k][2] = 0; }
        const s = Math.hypot(...b[k]); if (s > max) for (let i = 0; i < 3; i++) b[k][i] *= max / s;
      }
      const l = Math.hypot(...b.q);
      if (!fin(b.q) || !(l > 1e-6) || !Number.isFinite(l)) { b.q[0] = b.q[1] = b.q[2] = 0; b.q[3] = 1; } else if (Math.abs(l - 1) > 1e-6) { for (let i = 0; i < 4; i++) b.q[i] /= l; }
    }
    // what the caller changed in b since the last step goes into Jolt
    _push(b) {
      const c = b._j, id = c.id;
      this._clean(b);
      const moved = differs(b.p, c.p) || differs(b.q, c.q), fast = differs(b.v, c.v) || differs(b.w, c.w);
      if (moved) { this.rv.Set(b.p[0], b.p[1], b.p[2]); const r = this._quat(b.q); this.bi.SetPositionAndRotation(id, this.rv, r, J.EActivation_DontActivate); J.destroy(r); }
      if (fast) { this.v1.Set(b.v[0], b.v[1], b.v[2]); this.v2.Set(b.w[0], b.w[1], b.w[2]); this.bi.SetLinearAndAngularVelocity(id, this.v1, this.v2); }
      if (!b.asleep && c.asleep) this.bi.ActivateBody(id);
      else if (b.asleep && !c.asleep) this.bi.DeactivateBody(id);
      else if (!b.asleep && (moved || fast)) this.bi.ActivateBody(id);
      c.asleep = !!b.asleep;
      const gf = b.held ? 0 : 1;
      if (gf !== c.gf) { this.bi.SetGravityFactor(id, gf); c.gf = gf; }
      if (b.held) this.bi.ActivateBody(id);
    }
    // Jolt's state back into b (in place: callers keep their arrays)
    _pull(b) {
      const c = b._j, id = c.id, bi = this.bi;
      const awake = bi.IsActive(id) || !!b.held;
      b.asleep = !awake; c.asleep = !awake;
      if (!awake) { for (let i = 0; i < 3; i++) b.v[i] = b.w[i] = 0; this._copy(b); return; }
      const p = bi.GetPosition(id); b.p[0] = p.GetX(); b.p[1] = p.GetY(); b.p[2] = p.GetZ();
      const r = bi.GetRotation(id); b.q[0] = r.GetX(); b.q[1] = r.GetY(); b.q[2] = r.GetZ(); b.q[3] = r.GetW();
      const v = bi.GetLinearVelocity(id); b.v[0] = v.GetX(); b.v[1] = v.GetY(); b.v[2] = v.GetZ();
      const w = bi.GetAngularVelocity(id); b.w[0] = w.GetX(); b.w[1] = w.GetY(); b.w[2] = w.GetZ();
      b.calm = 0; this._copy(b);
    }
    _copy(b) { const c = b._j; for (let i = 0; i < 3; i++) { c.p[i] = b.p[i]; c.v[i] = b.v[i]; c.w[i] = b.w[i]; } for (let i = 0; i < 4; i++) c.q[i] = b.q[i]; }
    // ---- hands (the same inputs as physics.js World.setHands)
    setHands(list, t, solid = true) {
      const next = new Map(), kin = { spheres: [], plates: [] };
      const speed = (key, p) => {
        const q = this.handPrev.get(key); next.set(key, { p, t });
        if (!q || !(t > q.t)) return [0, 0, 0];
        const v = mulv(sub(p, q.p), 1 / (t - q.t)), s = Math.hypot(...v);
        return s > HAND_MAX ? mulv(v, HAND_MAX / s) : v;
      };
      for (const hd of list || []) {
        (hd.spheres || []).forEach((s, i) => {
          if (!s || !s.p || !fin(s.p) || !Number.isFinite(s.r) || (s.q && !fin(s.q))) return;
          const own = speed(hd.id + ':s' + i, s.q ? mulv(add(s.p, s.q), 0.5) : s.p), sv = s.v && fin(s.v) ? s.v : null, n = sv ? Math.hypot(...sv) : 0;
          const k = { key: hd.id + ':s' + i, p: s.p.slice(), r: s.r, v: sv ? (n > HAND_MAX ? mulv(sv, HAND_MAX / n) : sv.slice()) : own };
          if (s.q) k.q = s.q.slice();
          kin.spheres.push(k);
        });
        const pl = hd.plate;
        if (pl && fin(pl.centre) && fin(pl.normal) && fin(pl.axes[0]) && fin(pl.axes[1]) && fin(pl.half)) kin.plates.push({ key: hd.id + ':plate', id: hd.id, centre: pl.centre.slice(), normal: pl.normal, axes: pl.axes, half: pl.half, v: speed(hd.id + ':plate', pl.centre) });
      }
      this.kin = solid ? kin : { spheres: [], plates: [] }; this.handPrev = next;
      for (const b of this.bodies) {
        if (!b.asleep) continue;
        const R = Math.hypot(...b.size) / 2 + NEAR_WAKE;
        if (this.kin.spheres.some((s) => Math.hypot(...sub(nearOn(s, b.p), b.p)) < R + s.r) || this.kin.plates.some((q) => Math.hypot(...sub(q.centre, b.p)) < R + Math.hypot(...q.half))) this.wake(b);
      }
    }
    // the kinematic body of a hand shape, made on first use; `want` = its shape, p/q its pose now
    _hand(key, shape, p, q) {
      let e = this._hands.get(key);
      if (!e) {
        this.rv.Set(p[0], p[1], p[2]); const rot = this._quat(q);
        const soft = this.opts.softHands, cs = new J.BodyCreationSettings(shape, this.rv, rot, soft ? J.EMotionType_Dynamic : J.EMotionType_Kinematic, HAND);
        cs.mFriction = 0.6; cs.mRestitution = 0;
        if (soft) {
          cs.mGravityFactor = 0; cs.mLinearDamping = 0; cs.mAngularDamping = 0; cs.mAllowSleeping = false; cs.mMotionQuality = J.EMotionQuality_LinearCast; cs.mMaxLinearVelocity = SOFT_V;
          cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia; cs.mMassPropertiesOverride.mMass = soft.mass || 0.05;
        }
        e = { id: this._mk(cs, J.EActivation_Activate), shape, p: p.slice(), q: q.slice(), on: true, seen: true, fresh: true, ghost: false };
        J.destroy(cs); J.destroy(rot); this._hands.set(key, e); return e;
      }
      if (e.shape !== shape) { this.bi.SetShape(e.id, shape, false, J.EActivation_Activate); e.shape = shape; }
      if (!e.on && !e.ghost) { this.bi.AddBody(e.id, J.EActivation_Activate); e.on = true; e.fresh = true; }
      e.seen = true; return e;
    }
    // every hand shape of this frame: [{ key, shape, p, q }] (the pose it is to have at the end of the step)
    _handTargets() {
      const out = [];
      for (const s of this.kin.spheres) {
        if (s.q) {
          const d = sub(s.q, s.p), len = Math.hypot(...d);
          if (len > 1e-4) out.push({ key: s.key, shape: this._pill(len, s.r), p: mulv(add(s.p, s.q), 0.5), q: fromY(mulv(d, 1 / len)), v: s.v, r: s.r, half: len / 2 });
          else out.push({ key: s.key, shape: this._ball(s.r), p: s.p, q: [0, 0, 0, 1], v: s.v, r: s.r });
        } else out.push({ key: s.key, shape: this._ball(s.r), p: s.p, q: [0, 0, 0, 1], v: s.v, r: s.r });
      }
      for (const pl of this.kin.plates) {
        const n = pl.normal, q = M.align.quatFromBasis(pl.axes[0], pl.axes[1], n);
        out.push({ key: pl.key, shape: this._box(pl.half[0], pl.half[1], PLATE_T), p: add(pl.centre, n, -PLATE_T), q, v: pl.v });
      }
      return out;
    }
    // ---- holding (the motor of physics.js)
    hold(b, target, opts = {}) {
      const o = Object.assign({ spring: 20, speed: 5, breakAway: 0.3 }, opts);
      if (!target || !fin(target.p) || !target.q || !fin(target.q) || !(Math.hypot(...target.q) > 1e-6) || Math.hypot(...sub(target.p, b.p)) > o.breakAway) { b.held = null; return 'released'; }
      b.held = { p: target.p, q: target.q, v: target.v || [0, 0, 0], w: target.w || [0, 0, 0], spring: o.spring, speed: o.speed, age: 0, force: o.force > 0 ? o.force : 0, omega: o.omega > 0 ? o.omega : 80, maxErr: o.maxErr > 0 ? o.maxErr : Infinity };
      this.wake(b); return 'holding';
    }
    release(b) { b.held = null; }
    _motor(b, h) {
      const H = b.held, e = sub(add(H.p, H.v, H.age), b.p), cap = H.speed + Math.hypot(...H.v);
      let v = add(H.v, e, H.spring); const s = Math.hypot(...v); if (s > cap) v = mulv(v, cap / s);
      let qe = Q.mul(H.q, Q.conj(b.q)); if (qe[3] < 0) qe = qe.map((c) => -c);
      let w = add(H.w, [qe[0], qe[1], qe[2]], 2 * H.spring); const ws = Math.hypot(...w); if (ws > HOLD_W) w = mulv(w, HOLD_W / ws);
      this.v1.Set(v[0], v[1], v[2]); this.v2.Set(w[0], w[1], w[2]); this.bi.SetLinearAndAngularVelocity(b._j.id, this.v1, this.v2);
      H.age += h;
    }
    // A hold with a limited force: a critically damped spring to the target (natural frequency H.omega, rad/s), as a force of at most H.force
    // newtons applied inside the substep. Free, it tracks the target smoothly; jammed under a load it lags until the spring has the force to
    // free it (at H.force it lags m w^2 metres less than the force: tune omega so that this is a few centimetres) and it gives instead of
    // tearing what it touches. It turns by the motor's spin (a body held by a hand does not roll over in it).
    _force(b, h) {
      const H = b.held, id = b._j.id, bi = this.bi, w0 = H.omega;
      this._pullPose(b);
      let e = sub(add(H.p, H.v, H.age), b.p); const el = Math.hypot(...e); if (el > H.maxErr) e = mulv(e, H.maxErr / el);          // (maxErr: a hand that jumped does not throw the body)
      const cur = bi.GetLinearVelocity(id), ev = sub(H.v, [cur.GetX(), cur.GetY(), cur.GetZ()]);
      let f = mulv(add(mulv(e, w0 * w0), ev, 2 * w0), b.mass); const fl = Math.hypot(...f); if (fl > H.force) f = mulv(f, H.force / fl);
      this.v1.Set(f[0], f[1], f[2]); bi.AddForce(id, this.v1);
      let qe = Q.mul(H.q, Q.conj(b.q)); if (qe[3] < 0) qe = qe.map((x) => -x);
      let w = add(H.w, [qe[0], qe[1], qe[2]], 2 * H.spring); const ws = Math.hypot(...w); if (ws > HOLD_W) w = mulv(w, HOLD_W / ws);
      this.v2.Set(w[0], w[1], w[2]); bi.SetAngularVelocity(id, this.v2);
      H.age += h;
    }
    // ---- one frame
    step(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, MAX_DT);
      if (this.gravity !== this._g) this._applyGravity();
      for (const b of this.bodies) this._push(b);
      let fast = 0;
      for (const b of this.bodies) if (!b.asleep) fast = Math.max(fast, Math.hypot(...b.v) + Math.hypot(...b.w) * Math.hypot(...b.size) / 2);
      // (a fast body moves at most maxMove in a substep: a throw at 10 m/s cannot go deep into a table's edge before it is stopped)
      const targets = this._handTargets(), n = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / this.substep - 1e-9), Math.ceil((dt * fast) / this.maxMove - 1e-9))), h = dt / n;
      for (const e of this._hands.values()) e.seen = false;
      if (this.opts.softHands) return this._stepSoft(n, h, targets);
      const hands = targets.map((t) => {
        const e = this._hand(t.key, t.shape, t.p, t.q), err = sub(t.p, e.p), jump = Math.hypot(...err);
        if (e.fresh || jump > FAR) {                                                // (new, or far: it is put there, with no speed)
          this.rv.Set(t.p[0], t.p[1], t.p[2]); const r = this._quat(t.q); this.bi.SetPositionAndRotation(e.id, this.rv, r, J.EActivation_DontActivate); J.destroy(r);
          e.p = t.p.slice(); e.q = t.q.slice(); e.fresh = false; return null;
        }
        // The body has the hand's own speed (the headset's clock, smoothed: presence.js) whatever its position does: hand packets come in bunches
        // with gaps of 100-170 ms, and a body whose speed was the jump of its position hit a cube at that speed (Marek's run, 2026-10-26: a
        // quick hand sent the cubes flying). What is left of the distance to the hand it closes by moving the body, with no speed in it,
        // at most CATCH_UP m/s worth a call.
        const v = t.v && fin(t.v) ? t.v : [0, 0, 0], fix = mulv(err, Math.min(1, dt / CATCH_TAU)), fl = Math.hypot(...fix), corr = fl > CATCH_UP * dt ? mulv(fix, (CATCH_UP * dt) / fl) : fix;
        return { e, v, p0: e.p.slice(), q0: e.q.slice(), p1: add(add(e.p, v, dt), corr), q1: t.q };
      }).filter(Boolean);
      for (const e of this._hands.values()) if (!e.seen && e.on) { this.bi.RemoveBody(e.id); e.on = false; }
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        for (const b of this.bodies) if (b.held) { if (b.held.force) this._force(b, h); else { this._pullPose(b); this._motor(b, h); } }
        for (const a of hands) {
          const p = add(a.p0, sub(a.p1, a.p0), f), q = Q.slerp(a.q0, a.q1, f);
          // (Jolt moves a kinematic body by its speed in the step: it is put one step behind where it is to end, with the hand's speed)
          this.rv.Set(p[0] - a.v[0] * h, p[1] - a.v[1] * h, p[2] - a.v[2] * h); const r = this._quat(q);
          this.bi.SetPositionAndRotation(a.e.id, this.rv, r, J.EActivation_Activate); J.destroy(r);
          this.v1.Set(a.v[0], a.v[1], a.v[2]); this.v2.Set(0, 0, 0); this.bi.SetLinearAndAngularVelocity(a.e.id, this.v1, this.v2);
          a.e.p = p; a.e.q = q;
        }
        this.jolt.Step(h, 1);
      }
      for (const b of this.bodies) this._pull(b);
    }
    // ---- one frame with soft hands: each hand shape is pulled to where the hand is by a spring of limited force, inside every substep
    _stepSoft(n, h, targets) {
      const S = this.opts.softHands, w0 = S.omega || 120, fmax = S.force || 2, mass = S.mass || 0.05, bi = this.bi;
      for (const e of this._hands.values()) e.seen = false;
      const hands = [];
      for (const t of targets) {
        const e = this._hand(t.key, t.shape, t.p, t.q), v = t.v && fin(t.v) ? t.v : [0, 0, 0];
        if (e.ghost) {                                                  // (left behind: back when the place where the hand is is free of bodies)
          if (this._occupied(t)) { e.p = t.p.slice(); e.q = t.q.slice(); continue; }
          e.ghost = false; bi.AddBody(e.id, J.EActivation_Activate); e.on = true; e.fresh = true;
        }
        // (a hand that jumps further than JUMP in one frame came in late, after a gap in its packets: the finger does not chase it through the blocks,
        //  it lets go of them until the place where the hand now is is free: Marek's run on bad Wi-Fi, 2026-10-29, a block flew off at a touch)
        if (!e.fresh && Math.hypot(...sub(t.p, e.p)) > JUMP && Math.hypot(...sub(t.p, e.p)) <= FAR) { bi.RemoveBody(e.id); e.on = false; e.ghost = true; e.p = t.p.slice(); e.q = t.q.slice(); continue; }
        if (e.fresh || Math.hypot(...sub(t.p, e.p)) > FAR) {
          this.rv.Set(t.p[0], t.p[1], t.p[2]); const r = this._quat(t.q); bi.SetPositionAndRotation(e.id, this.rv, r, J.EActivation_Activate); J.destroy(r);
          this.v1.Set(v[0], v[1], v[2]); this.v2.Set(0, 0, 0); bi.SetLinearAndAngularVelocity(e.id, this.v1, this.v2);
          e.fresh = false; e.p = t.p.slice(); e.q = t.q.slice();
        }
        hands.push({ e, v, p0: e.p.slice(), q0: e.q.slice(), p1: t.p.slice(), q1: t.q });
      }
      for (const e of this._hands.values()) if (!e.seen && e.on) { bi.RemoveBody(e.id); e.on = false; }
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        for (const b of this.bodies) if (b.held) { if (b.held.force) this._force(b, h); else { this._pullPose(b); this._motor(b, h); } }
        for (const a of hands) {
          if (a.e.ghost) continue;
          const id = a.e.id, tp = add(a.p0, sub(a.p1, a.p0), f), P = bi.GetPosition(id), V = bi.GetLinearVelocity(id), cur = [P.GetX(), P.GetY(), P.GetZ()], cv = [V.GetX(), V.GetY(), V.GetZ()];
          const err = sub(tp, cur);
          if (Math.hypot(...err) > GHOST) { bi.RemoveBody(id); a.e.on = false; a.e.ghost = true; continue; }
          let force = mulv(add(mulv(err, w0 * w0), sub(a.v, cv), 2 * w0), mass); const fl = Math.hypot(...force); if (fl > fmax) force = mulv(force, fmax / fl);
          this.v1.Set(force[0], force[1], force[2]); bi.AddForce(id, this.v1);
          const R = bi.GetRotation(id), tq = Q.slerp(a.q0, a.q1, f); let qe = Q.mul(tq, Q.conj([R.GetX(), R.GetY(), R.GetZ(), R.GetW()])); if (qe[3] < 0) qe = qe.map((c) => -c);
          let w = mulv([qe[0], qe[1], qe[2]], 1 / Math.max(h, 1e-4)); const ws = Math.hypot(...w); if (ws > SOFT_W) w = mulv(w, SOFT_W / ws);
          this.v2.Set(w[0], w[1], w[2]); bi.SetAngularVelocity(id, this.v2);
        }
        this.jolt.Step(h, 1);
      }
      for (const a of hands) { a.e.p = a.p1.slice(); a.e.q = a.q1.slice(); }
      for (const b of this.bodies) this._pull(b);
    }
    // is a hand shape's place (t: { p, q, shape }) inside or touching one of the bodies? (boxes; a pill is tried at its ends and middle)
    _occupied(t) {
      const r = t.r || 0.01, pts = [t.p];
      if (t.half) { const d = Q.rotate(t.q, [0, t.half, 0]); pts.push(add(t.p, d), sub(t.p, d)); }
      for (const b of this.bodies) {
        for (const p of pts) {
          const l = Q.rotate(Q.conj(b.q), sub(p, b.p));
          if (Math.hypot(Math.max(0, Math.abs(l[0]) - b.size[0] / 2), Math.max(0, Math.abs(l[1]) - b.size[1] / 2), Math.max(0, Math.abs(l[2]) - b.size[2] / 2)) < r + 0.002) return true;
        }
      }
      return false;
    }
    // where each hand shape is now: [{ key, p, ghost }] (soft hands lag behind the real hand where they press on something)
    handPoses() { const out = []; for (const [key, e] of this._hands) if (e.on || e.ghost) { const P = e.on ? this.bi.GetPosition(e.id) : null; out.push({ key, p: P ? [P.GetX(), P.GetY(), P.GetZ()] : e.p.slice(), ghost: e.ghost }); } return out; }
    // (the pose of a held body, read before its motor)
    _pullPose(b) {
      const id = b._j.id, p = this.bi.GetPosition(id), r = this.bi.GetRotation(id);
      b.p[0] = p.GetX(); b.p[1] = p.GetY(); b.p[2] = p.GetZ(); b.q[0] = r.GetX(); b.q[1] = r.GetY(); b.q[2] = r.GetZ(); b.q[3] = r.GetW();
    }
  }

  M.physics.JoltWorld = JoltWorld;
  M.physics.jolt = { load, get ready() { return !!J; } };
})();

module.exports = { load };
