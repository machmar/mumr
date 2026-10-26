// The webcam page's side of moving its camera by hand from a headset (camknobs.js asks, hub.py passes the request on, worldfeed.js hands it over):
// the camera's place is changed and it keeps looking at the point it looked at when its place was worked out from the clicked spots, so its pan and tilt
// follow the move. A new solution (the spots clicked again, a new field of view) replaces the hand's work; so does Reset. No THREE and no DOM.
//
//   const adj = new CamAdjust({ spots: () => [[x, y], ...] })     spots: the floor points of the line-up (spot 1, spot 2, check spot), for a camera that looks level
//   adj.pose(P)        P: the camera as the page has solved it ({ x, y, z, yaw, pitch, hfov, aspect }) or null -> the pose to draw from and to announce (P itself when not moved)
//   adj.ask(req)       req: { x, y, z } (a new place, common frame) or { reset: true } -> true when it was taken
//   adj.moved          false, or how far (m) the camera is from where it was solved        adj.aim   the point it looks at, [x, y, z] or null
//   adj.export() / adj.restore(d)   what to keep between launches: the solved (original) pose, the point looked at and the place the hand gave it (or null). A restored camera is
//                      drawn from that until a live solution comes; the live one then keeps the hand's place when it is near (io.keepNear, m), else it is a new solution.
//   new PoseKeeper(adj, store)     keeps that in the page's store for each camera (and picture size), as long as the clicks, field of view and lens it was made for stay the same
(function (M) {
  const CAMS = () => M.cams;
  const MAX_AWAY = 3;                         // m: farther from the solved place than this is not a move of a hand at a twentieth of its reach
  const TOL = 0.005, TOL_A = 0.002;           // a solution that differs by more than this (m, rad) is a new one

  class CamAdjust {
    constructor(io = {}) { this.io = io; this.solved = null; this.aim = null; this.place = null; this.held = false; }
    _new(P) {
      this.solved = P; this.place = null;
      const C = CAMS(), spots = this.io.spots ? this.io.spots() : [];
      this.aim = C.aimPoint(P, 0) || C.centre(spots, 0);
    }
    // everything forgotten (the camera went away)
    drop() { this.solved = null; this.aim = null; this.place = null; this.held = false; }
    _look(P) {
      if (!this.place) return P;
      const look = CAMS().lookAt(this.place, this.aim, P);
      return Object.assign({}, P, { x: this.place[0], y: this.place[1], z: this.place[2], yaw: look.yaw, pitch: look.pitch });
    }
    pose(P) {
      if (!P) {
        if (this.held && this.solved) return this._look(this.solved);      // (a pose kept from an earlier launch, until the spots give a live one)
        this.drop(); return null;
      }
      const s = this.solved;
      if (!s || Math.hypot(s.x - P.x, s.y - P.y, s.z - P.z) > TOL || Math.abs(s.yaw - P.yaw) > TOL_A || Math.abs(s.pitch - P.pitch) > TOL_A) {
        // a hand-placed camera stays where the hand put it while the solution only moved a little (io.keepNear: the spots a player took again a bit differently)
        if (s && this.place && Math.hypot(s.x - P.x, s.y - P.y, s.z - P.z) <= (this.io.keepNear || 0)) this.solved = P; else this._new(P);
      }
      this.held = false;
      return this._look(P);
    }
    // What is kept between launches (numbers only), or null while there is no camera.
    export() {
      const s = this.solved;
      if (!s) return null;
      const r = (v, k) => +v.toFixed(k), v3 = (a) => (a ? a.map((v) => r(v, 4)) : null);
      return { solved: { x: r(s.x, 4), y: r(s.y, 4), z: r(s.z, 4), yaw: r(s.yaw, 5), pitch: r(s.pitch, 5), hfov: r(s.hfov, 5), aspect: r(s.aspect, 5) }, aim: v3(this.aim), place: v3(this.place) };
    }
    // Take a kept pose back. false (and nothing changed): it is not one.
    restore(d) {
      const num = (o, ks) => !!o && typeof o === 'object' && ks.every((k) => Number.isFinite(o[k]));
      const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
      if (!d || !num(d.solved, ['x', 'y', 'z', 'yaw', 'pitch', 'hfov', 'aspect']) || !(d.solved.aspect > 0) || !(d.solved.hfov > 0 && d.solved.hfov < Math.PI)) return false;
      const moved = d.place !== null && d.place !== undefined;
      if (moved && !(v3(d.place) && v3(d.aim))) return false;      // (a hand's place needs the point it looks at)
      this.solved = Object.assign({}, d.solved); this.place = moved ? d.place.slice() : null;
      this.aim = v3(d.aim) ? d.aim.slice() : (CAMS().aimPoint(this.solved, 0) || null); this.held = true;
      return true;
    }
    ask(req) {
      if (!this.solved || !req) return false;
      if (req.reset === true) { this.place = null; return true; }
      const s = this.solved;
      if (![req.x, req.y, req.z].every(Number.isFinite) || Math.hypot(req.x - s.x, req.y - s.y, req.z - s.z) > MAX_AWAY) return false;
      this.place = [req.x, req.y, req.z];
      return true;
    }
    get moved() { return this.place && this.solved ? Math.hypot(this.place[0] - this.solved.x, this.place[1] - this.solved.y, this.place[2] - this.solved.z) : false; }
  }

  // Keeps a CamAdjust between launches, the way the camera profiles are kept: under the camera's own key in the page's store ({ get(k, d), set(k, v) }).
  // The kept pose is the original (as the clicks solved it) together with the hand's place, so Reset still has somewhere to go back to. It is only used again when
  // `sig` (the clicks, field of view and lens that made it) is the same; clicking the spots again (a different sig) takes the hand's work away, as a new solution always did.
  class PoseKeeper {
    constructor(adj, store, { every = 1000 } = {}) { this.adj = adj; this.store = store; this.every = every; this.key = null; this.sig = ''; this.json = ''; this.at = -Infinity; this.restored = false; }
    // Every frame. running: a picture is coming in from the camera; key: which camera and picture size (null: none); P: the live solved pose or null. -> the pose to use, or null
    pose(running, key, sig, P, now = 0) {
      const adj = this.adj;
      if (!running || !key) { if (this.key !== null) { adj.drop(); this.key = null; this.json = ''; } return null; }
      if (this.key !== key) {
        adj.drop(); this.key = key; this.sig = sig; this.json = ''; this.restored = false;
        const d = this.store.get(`${key}.pose`, null);
        if (d && d.v === 1 && d.sig === sig && adj.restore(d)) { this.restored = true; this.json = JSON.stringify(d); }
      } else if (sig !== this.sig) { this.sig = sig; this.restored = false; adj.drop(); }
      const Q = adj.pose(P);
      const e = adj.export();
      if (e && now - this.at >= this.every) {
        const json = JSON.stringify(Object.assign({ v: 1, sig: this.sig }, e));
        if (json !== this.json) { this.json = json; this.at = now; this.store.set(`${key}.pose`, JSON.parse(json)); }
      }
      return Q;
    }
  }

  M.camadjust = { CamAdjust, PoseKeeper, MAX_AWAY };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
