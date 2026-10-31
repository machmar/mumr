// The second way to align a webcam (Marek, 2026-10-31: "for close-up shots and such", where the floor spots are not all in the picture): the camera is
// PLACED BY HAND. The webcam page puts a virtual camera into the room (an owned cam+ with hand: true, cams.js); a player in a headset takes it by its body
// (camknobs.js, the white knob on the camera itself, moved one to one) and stands it where the real camera is; then, on the webcam page, one click on a
// line-up spot that is in the picture turns it the way it looks: the ray through the clicked pixel passes through that spot. It looks level (no roll).
// Its place and the click are kept in the page's store, for the next launch. No THREE and no DOM.
//
//   aimFrom(pos, uv, target, hfov, W, H)   the { yaw, pitch } with which a camera at pos sees target at the ideal pixel uv (webcam.js project), or null
//   const h = new HandCam(store)             store: { get(k, d), set(k, v) } (the page's)
//   h.start(spots) / h.stop()                on, with the camera put a little behind the spots' middle the first time (spots: [[x, y, z] | null] x3)
//   h.ask(m)                                 a headset's move: { x, y, z } (common frame) or { reset: true } (back to the first place) -> true when taken
//   h.setAim(i, uv)                          spot i was clicked at the ideal pixel uv        h.aim   { i, uv } | null
//   h.pose({ hfov, W, H, spots })            { x, y, z, yaw, pitch, hfov, aspect, hand: true, aimed } while on, else null (aimed: the click turned it)
(function (M) {
  const KEY = 'mumr.webcam.hand';
  const WC = () => M.webcam;
  const ok3 = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

  function aimFrom(pos, uv, target, hfov, W, H) {
    if (!ok3(pos) || !ok3(target) || !Array.isArray(uv) || ![hfov, W, H].every((v) => v > 0)) return null;
    const P = [target[0], target[1], target[2] || 0], dx = P[0] - pos[0], dy = P[1] - pos[1], dz = P[2] - pos[2];
    if (Math.hypot(dx, dy, dz) < 0.05) return null;
    // (straight at it, then Gauss-Newton on the pixel the target lands on: two angles, two pixel coordinates)
    let yaw = Math.atan2(dy, dx), pitch = Math.atan2(dz, Math.hypot(dx, dy));
    const err = (y, p) => { const q = WC().project({ x: pos[0], y: pos[1], z: pos[2], yaw: y, pitch: p }, hfov, W, H, P); return q[2] > 0 ? [q[0] - uv[0], q[1] - uv[1]] : null; };
    for (let n = 0; n < 40; n++) {
      const e = err(yaw, pitch), h = 1e-5;
      if (!e) return null;
      if (Math.hypot(e[0], e[1]) < 1e-4) break;
      const ey = err(yaw + h, pitch), ep = err(yaw, pitch + h);
      if (!ey || !ep) return null;
      const a = (ey[0] - e[0]) / h, b = (ep[0] - e[0]) / h, c = (ey[1] - e[1]) / h, d = (ep[1] - e[1]) / h, det = a * d - b * c;
      if (Math.abs(det) < 1e-12) return null;
      yaw -= (d * e[0] - b * e[1]) / det; pitch -= (-c * e[0] + a * e[1]) / det;
      pitch = Math.max(-1.55, Math.min(1.55, pitch));
    }
    const e = err(yaw, pitch);
    return e && Math.hypot(e[0], e[1]) < 0.5 ? { yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch } : null;
  }

  class HandCam {
    constructor(store = null) {
      this.store = store; this.on = false; this.pos = null; this.first = null; this.aim = null;
      const d = store ? store.get(KEY, null) : null;
      if (d && typeof d === 'object') {
        if (ok3(d.pos) && Number.isFinite(d.pos[2])) this.pos = d.pos.slice(0, 3);
        if (d.aim && Number.isInteger(d.aim.i) && Array.isArray(d.aim.uv)) this.aim = { i: d.aim.i, uv: d.aim.uv.slice(0, 2) };
        this.on = !!d.on;
      }
    }
    _save() { if (this.store) this.store.set(KEY, { on: this.on, pos: this.pos, aim: this.aim }); }
    // (the first place: 1.5 m back from the spots' middle along spot 1 -> spot 2, 1.3 m up)
    static firstPlace(spots) {
      const p = (spots || []).filter(ok3), c = M.cams.centre(p, 0) || [0, 0, 0];
      return [c[0] - 1.5, c[1], 1.3];
    }
    start(spots) { this.on = true; this.first = HandCam.firstPlace(spots); if (!this.pos) this.pos = this.first.slice(); this._save(); }
    stop() { this.on = false; this._save(); }
    ask(m) {
      if (!this.on || !m || typeof m !== 'object') return false;
      if (m.reset) { this.pos = (this.first || [0, 0, 1.3]).slice(); this._save(); return true; }
      if (![m.x, m.y, m.z].every(Number.isFinite) || m.z < -1 || m.z > 5) return false;
      this.pos = [m.x, m.y, m.z]; this._save(); return true;
    }
    setAim(i, uv) { if (!Number.isInteger(i) || !Array.isArray(uv)) return false; this.aim = { i, uv: uv.slice(0, 2) }; this._save(); return true; }
    clearAim() { this.aim = null; this._save(); }
    pose({ hfov, W, H, spots }) {
      if (!this.on || !this.pos) return null;
      const pts = (spots && spots.pts) || [], t = this.aim ? pts[this.aim.i] : null;
      let dir = t && this.aimIdeal ? aimFrom(this.pos, this.aimIdeal(this.aim.uv), t, hfov, W, H) : null;
      const aimed = !!dir;
      if (!dir) { const c = M.cams.centre(pts.filter(ok3), 0); dir = M.cams.lookAt(this.pos, c, { yaw: 0, pitch: -0.3 }); }
      return { x: this.pos[0], y: this.pos[1], z: this.pos[2], yaw: dir.yaw, pitch: dir.pitch, hfov, aspect: W / H, hand: true, aimed };
    }
  }

  M.handcam = { aimFrom, HandCam, KEY };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
