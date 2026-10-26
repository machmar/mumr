// The real cameras of the room, as part of the shared world. No THREE and no DOM.
//
// A webcam that has been aligned (its page worked out where it stands from the floor spots) is an object of the world, like a mark or the
// room: a small thing at a place, in the common floor frame, that every headset draws where the real camera is and every viewer shows. It
// lives in the session's document (session.js: doc.cameras, by id) and is made by two events:
//   { k: 'cam+', id, name, x, y, z, yaw, pitch, hfov, aspect }   a camera is here (or has moved); the newest event for an id is the camera
//   { k: 'cam-', id }                                            that camera is gone (its page closed, or it is not aligned any more)
// x, y: on the floor, z: height above the common floor (m); yaw: the way it looks on the floor, pitch: its tilt (negative looks down), both in
// radians; hfov: the horizontal field of view (rad); aspect: the picture's width over its height. Every number is a tenth of a millimetre
// or a ten-thousandth of a radian. A camera is an OWNED thing of the document (engine/server/hub.py `own`): the hub keeps the newest cam+ of
// each id for newcomers, only the connection that made it may change it, and it sends cam- when that connection goes. The hub knows no
// cameras: the checks are `clean` here, made by every page that reads one. Others ask the owner to move it (session.js moveCamera).
(function (M) {
  const MAX = 8;                                           // cameras in one world
  const NAME_MAX = 40;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

  // a camera as the world keeps it, from an event or a camera-like object; null when it does not make sense
  function clean(e) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(e.id)) return null;
    if (!num(e.x, -1000, 1000) || !num(e.y, -1000, 1000) || !num(e.z, -10, 100)) return null;
    if (!(typeof e.yaw === 'number' && Number.isFinite(e.yaw))) return null;
    if (!num(e.pitch, -1.58, 1.58) || !num(e.hfov, 0.1, 3.0) || !num(e.aspect, 0.2, 6)) return null;
    const name = typeof e.name === 'string' ? e.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX).trim() : '';
    return { id: e.id, name: name || 'Webcam', x: r4(e.x), y: r4(e.y), z: r4(e.z), yaw: r4(wrap(e.yaw)), pitch: r4(e.pitch), hfov: r4(e.hfov), aspect: r4(e.aspect) };
  }
  // the event a page sends for a camera, or null
  function event(c) { const k = clean(c); return k ? Object.assign({ k: 'cam+' }, k) : null; }

  // a camera in a headset's own frame (frame: align.js { x, y, yaw, z }: where the common frame lies in the headset's own, and the height of the
  // common floor there); null when the headset has no frame (it is not lined up: it cannot say where the camera is)
  function toOwn(frame, c) {
    if (!frame || !c) return null;
    const AL = M.align, p = AL.fromCommon(frame, c.x, c.y);
    return { id: c.id, name: c.name, x: p[0], y: p[1], z: c.z + (frame.z || 0), yaw: AL.yawFromCommon(frame, c.yaw), pitch: c.pitch, hfov: c.hfov, aspect: c.aspect };
  }
  // every camera of a document but one (a page does not draw the camera it looks through)
  function others(doc, exceptId) { return doc && doc.cameras ? Object.values(doc.cameras).filter((c) => c.id !== exceptId) : []; }
  // is this the camera that is already known, to a millimetre and a few hundredths of a degree?
  function same(a, b) {
    if (!a || !b || a.id !== b.id || a.name !== b.name) return false;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.001 && Math.abs(wrap(a.yaw - b.yaw)) < 0.0005 && Math.abs(a.pitch - b.pitch) < 0.0005 && Math.abs(a.hfov - b.hfov) < 0.0005 && Math.abs(a.aspect - b.aspect) < 0.001;
  }

  // ---- moving a camera by hand (the line-up knobs, camknobs.js): the position moves, and the camera keeps looking at the point it looked at
  // The point a camera looks at: where its axis meets the floor plane (at height `plane`, 0 for the common floor), or null when it does not look down
  // at it (level, upwards, or so shallow that it lands more than 50 m away).
  function aimPoint(c, plane = 0) {
    if (!c || ![c.x, c.y, c.z, c.yaw, c.pitch].every(Number.isFinite)) return null;
    const dz = Math.sin(c.pitch), h = c.z - plane;
    if (!(dz < -0.02) || !(h > 0)) return null;
    const s = h / -dz, cp = Math.cos(c.pitch);
    if (s > 50) return null;
    return [c.x + Math.cos(c.yaw) * cp * s, c.y + Math.sin(c.yaw) * cp * s, plane];
  }
  // The middle of some floor points ([x, y] each, the spots of the line-up), as [x, y, plane]; null when there are none
  function centre(points, plane = 0) {
    const p = (points || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
    if (!p.length) return null;
    return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length, plane];
  }
  // The way ({ yaw, pitch }) a camera at pos = [x, y, z] looks to see aim = [x, y, z]. Without an aim, or with the aim on top of the camera, it keeps its own (c).
  function lookAt(pos, aim, c) {
    const keep = { yaw: c.yaw, pitch: c.pitch };
    if (!aim) return keep;
    const dx = aim[0] - pos[0], dy = aim[1] - pos[1], dz = aim[2] - pos[2], h = Math.hypot(dx, dy);
    if (Math.hypot(h, dz) < 0.05) return keep;
    return { yaw: h < 1e-9 ? c.yaw : Math.atan2(dy, dx), pitch: Math.max(-1.5, Math.min(1.5, Math.atan2(dz, h))) };
  }

  M.cams = { MAX, clean, event, toOwn, others, same, aimPoint, centre, lookAt };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
