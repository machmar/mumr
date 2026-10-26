// Moving a real camera of the room (cams.js) by hand, from inside the headset, while lining up. The same method as the knobs of the line-up spots
// (align.js): three knobs, one for each direction, that a pinch takes and holds; the camera moves a twentieth as far as the hand does along that knob's
// direction. The knobs hang half a metre in front of the camera, where it looks (so they can be reached while the camera itself is out of reach):
//   along (red)   on that point: forward and back, the way the camera looks on the floor
//   across (green) 12 cm to its left: sideways
//   up (blue)     12 cm above it: height
// Only the position moves. The camera keeps looking at the point it looked at when the pull began (cams.js aimPoint: where its axis met the floor), so its
// pan and tilt change as it moves (cams.js lookAt). No THREE and no DOM, so that Node can test it. Everything here is in the headset's OWN frame (cams.toOwn):
// x, y on the floor plan, z above this headset's floor (`plane` is where the common floor lies in it), the same space as the fingertips.
//
//   const K = new CamKnobs();
//   K.knobs(cams)                       [{ id, axis, x, y, z, held, pull, from }]: to draw (from: where its stalk starts), and to take    cams: [{ id, x, y, z, yaw, pitch }] (own frame)
//   K.update(tips, cams, plane)         tips: [{ id, x, y, z, pinch }] (the index fingertips). -> { moves: [{ id, x, y, z }], release: { id, x, y, z } | null, grabbed: bool }
//                                       moves: where the camera is asked to stand now (absolute, own frame); release: the last of them when the pinch ended
//   K.pose(c)                           the camera as it should be drawn now (a held one is where the hand has taken it, looking at its point)
//   K.held                              null, or { id, axis, pull }       K.cancel()   let go of everything
(function (M) {
  const CAMS = () => M.cams;
  const DEF = { ahead: 0.5, side: 0.12, up: 0.12, grab: 0.04, fine: 1 / 20 };
  const AXES = ['along', 'across', 'up'];

  class CamKnobs {
    constructor(cfg = {}) { this.cfg = Object.assign({}, DEF, cfg); this.held = null; this._g = null; this._pinch = new Map(); }
    cancel() { this.held = null; this._g = null; this._pinch.clear(); }

    // the camera as drawn: a held one at the place the hand has taken it to
    pose(c) {
      const g = this._g;
      if (!g || g.id !== c.id) return c;
      const look = CAMS().lookAt(g.pos, g.aim, c);
      return Object.assign({}, c, { x: g.pos[0], y: g.pos[1], z: g.pos[2], yaw: look.yaw, pitch: look.pitch });
    }
    // the directions of the three knobs for a camera that looks this way on the floor
    static dirs(yaw) { return { along: [Math.cos(yaw), Math.sin(yaw), 0], across: [-Math.sin(yaw), Math.cos(yaw), 0], up: [0, 0, 1] }; }

    knobs(cams) {
      const C = this.cfg, out = [];
      for (const c0 of cams || []) {
        const c = this.pose(c0), cp = Math.cos(c.pitch);
        const B = [c.x + C.ahead * Math.cos(c.yaw) * cp, c.y + C.ahead * Math.sin(c.yaw) * cp, c.z + C.ahead * Math.sin(c.pitch)];
        const W = CamKnobs.dirs(c.yaw);
        for (const axis of AXES) {
          const held = !!this._g && this._g.id === c.id && this._g.axis === axis, pull = held ? this._g.pull : 0, d = held ? this._g.dirv : W[axis];
          const off = axis === 'across' ? C.side : axis === 'up' ? C.up : 0;
          out.push({ id: c.id, axis, held, pull, from: axis === 'along' ? [c.x, c.y, c.z] : B,         // (the stalk it hangs on: from the camera, or from the point in front of it)
            x: B[0] + W[axis][0] * off + d[0] * pull, y: B[1] + W[axis][1] * off + d[1] * pull, z: B[2] + W[axis][2] * off + d[2] * pull });
        }
      }
      return out;
    }

    update(tips, cams, plane = 0) {
      const C = this.cfg, seen = new Set(), res = { moves: [], release: null, grabbed: false };
      const byId = new Map((cams || []).map((c) => [c.id, c]));
      for (const tip of tips || []) {
        if (!Number.isFinite(tip.x) || !Number.isFinite(tip.y) || !Number.isFinite(tip.z)) continue;
        seen.add(tip.id);
        const was = this._pinch.get(tip.id) || false;
        this._pinch.set(tip.id, !!tip.pinch);
        // a pinch that starts at a knob holds it until the pinch ends
        if (tip.pinch && !was && !this._g) {
          let best = null, bd = C.grab;
          for (const k of this.knobs(cams)) { const d = Math.hypot(tip.x - k.x, tip.y - k.y, tip.z - k.z); if (d < bd) { bd = d; best = k; } }
          const c = best && byId.get(best.id);
          if (c) {
            const dirv = CamKnobs.dirs(c.yaw)[best.axis];
            this._g = { id: c.id, axis: best.axis, pull: 0, dirv, pos: [c.x, c.y, c.z], aim: CAMS().aimPoint(c, plane), tip: tip.id, last: [tip.x, tip.y, tip.z] };
            this.held = { id: c.id, axis: best.axis, pull: 0 }; res.grabbed = true;
          }
        }
        const g = this._g;
        if (g && g.tip === tip.id && byId.has(g.id)) {
          if (!tip.pinch) { res.release = { id: g.id, x: g.pos[0], y: g.pos[1], z: g.pos[2] }; this._g = null; this.held = null; continue; }
          const d = g.dirv, step = (tip.x - g.last[0]) * d[0] + (tip.y - g.last[1]) * d[1] + (tip.z - g.last[2]) * d[2];      // how far the hand went along the knob's direction
          g.last = [tip.x, tip.y, tip.z];
          if (step !== 0) {
            for (let i = 0; i < 3; i++) g.pos[i] += d[i] * step * C.fine;
            g.pull += step; this.held.pull = g.pull;
            res.moves.push({ id: g.id, x: g.pos[0], y: g.pos[1], z: g.pos[2] });
          }
        }
      }
      const g = this._g;
      if (g && (!seen.has(g.tip) || !byId.has(g.id))) { if (byId.has(g.id)) res.release = { id: g.id, x: g.pos[0], y: g.pos[1], z: g.pos[2] }; this._g = null; this.held = null; }      // the hand tracking lost, or the camera is gone
      for (const id of [...this._pinch.keys()]) if (!seen.has(id)) this._pinch.delete(id);
      return res;
    }
  }

  M.camknobs = { CamKnobs, DEF, AXES };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
