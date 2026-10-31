// REAL PEOPLE HIDE THE WORLD on the webcam page (Marek, 2026-10-31): a fat, conservative stand-in body for one player, built from what the presence
// stream already carries (the head, the hands, the feet when the app sends them). The webcam page draws it depth-only (peoplecut.js), so the virtual
// world is not painted over a real person standing in front of it. No THREE and no DOM, so that Node can test it.
//
//   build(head, sources, opts) -> [{ kind: 'sphere' | 'capsule', a: [x, y, z], b: [x, y, z], r }]     (a sphere has b equal to a)
//   buildInto(pool, head, sources, opts) -> n   the same into a pool kept from frame to frame ({ items: [], n: 0 }; nothing is made per frame once it is big enough)
//     head     [x, y, heading, height, pitch]: the presence head, in the common floor frame (x, y on the floor, height above the common floor)
//     sources  the presence sources: hands { id, points: [{ name, x, y, z }], joints: [[x, y, z] x 25] (optional) }, feet { foot: true, points: [toe, heel] }
//     opts     { grow }: a margin (m) added to every radius (crude mode errs fat: GROW_CRUDE; with the ML mask fat is free: GROW_ML)
// Everything is in the floor plan, z up. Nothing here throws: input that makes no sense (no head, NaN, a head under the floor) gives [].
(function (M) {
  // ---- the numbers (metres), each a guess on the fat side, to be tuned on a real run (docs/NOTES.md)
  const HEAD_R = 0.16;          // the head sphere: covers the headset (it sticks out 8 to 10 cm in front of the eyes) and the hair
  const HEAD_BACK = 0.05;       // the tracked point is the eyes; the middle of the skull is this much behind them
  const HEAD_MIN = 0.3;         // a head lower than this above the floor is not a person (lost tracking, a headset on the floor): nothing
  const NECK_DROP = 0.20;       // the top of the chest is this much below the eyes
  const CHEST_R = 0.22;         // the chest and the shoulders: half a person's shoulder width, a little more
  const HIP_DROP = 0.80;        // the hips are this much below the eyes (a standing adult: eyes 1.6 m, hips 0.8 m)
  const LEGS_R = 0.17;          // the legs, together, down to the floor
  const SHOULDER_DROP = 0.25;   // the shoulders are this much below the eyes,
  const SHOULDER_SIDE = 0.19;   // this far to either side of the line the head looks along,
  const SHOULDER_BACK = 0.04;   // and this far behind the eyes
  const ARM_R = 0.07;           // an arm (a sleeve)
  const ARM_STRAIGHT = 0.75;    // an arm from the shoulder to the wrist longer than this gets an elbow (a straight capsule would cut the corner)
  const ELBOW_DOWN = 0.12;      // and the elbow hangs this much below the middle of the arm
  const HAND_R = 0.035;         // a finger or a palm
  const GROW_CRUDE = 0.06;      // crude mode: the outline is blocky, so it errs fat
  const GROW_ML = 0.10;         // ML mode: fatter still, the person's mask trims the outline to the real one
  // the WebXR hand's 25 joints, chained from the wrist (0) to each fingertip: thumb 1-4, index 5-9, middle 10-14, ring 15-19, little 20-24
  const CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8, 9], [0, 10, 11, 12, 13, 14], [0, 15, 16, 17, 18, 19], [0, 20, 21, 22, 23, 24]];

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const ok3 = (p) => Array.isArray(p) && p.length >= 3 && fin(p[0]) && fin(p[1]) && fin(p[2]);
  const okq = (q) => !!q && fin(q.x) && fin(q.y) && fin(q.z);

  // the stand-in as a list of new objects (for tests and anything that is not drawn every frame)
  function build(head, sources, opts = {}) {
    const out = [];
    const emit = (kind, ax, ay, az, bx, by, bz, r) => { const a = [ax, ay, az]; out.push({ kind, a, b: kind === 'sphere' ? a : [bx, by, bz], r }); };
    try { make(head, sources, opts, emit); } catch (e) { return []; }
    return out;
  }
  // the same into a pool that is kept from frame to frame (nothing is made per frame): pool.items[k] = { kind, a: [3], b: [3], r }, grown when it is
  // short; returns how many items this player has, from pool.n on (pool.n is moved past them)
  function buildInto(pool, head, sources, opts = {}) {
    const n0 = pool.n;
    if (!pool.emit) pool.emit = (kind, ax, ay, az, bx, by, bz, r) => {         // (made once for the pool)
      if (pool.items.length <= pool.n) pool.items.push({ kind: 'sphere', a: [0, 0, 0], b: [0, 0, 0], r: 0 });
      const it = pool.items[pool.n++]; it.kind = kind; it.a[0] = ax; it.a[1] = ay; it.a[2] = az; it.b[0] = bx; it.b[1] = by; it.b[2] = bz; it.r = r;
    };
    try { make(head, sources, opts, pool.emit); } catch (e) { pool.n = n0; }
    return pool.n - n0;
  }

  function make(head, sources, opts, emit) {
    if (!Array.isArray(head) || !fin(head[0]) || !fin(head[1]) || !fin(head[3]) || !(head[3] >= HEAD_MIN)) return;
    const g = opts && fin(opts.grow) && opts.grow > 0 ? opts.grow : 0, list = Array.isArray(sources) ? sources : [];
    const yaw = fin(head[2]) ? head[2] : 0, fx = Math.cos(yaw), fy = Math.sin(yaw), rx = Math.sin(yaw), ry = -Math.cos(yaw);       // forward, and right of it
    const ex = head[0], ey = head[1], ez = head[3], cx = ex - fx * HEAD_BACK, cy = ey - fy * HEAD_BACK;
    // the head
    emit('sphere', cx, cy, ez, cx, cy, ez, HEAD_R + g);
    // the chest from under the neck to the hips, the legs from there to the floor (under the feet when they are sent, else straight down)
    let fxs = 0, fys = 0, nf = 0;
    for (const s of list) if (s && s.foot && Array.isArray(s.points)) for (const q of s.points) if (okq(q)) { fxs += q.x; fys += q.y; nf++; }
    const bx = nf ? fxs / nf : cx, by = nf ? fys / nf : cy, nz = Math.max(0, ez - NECK_DROP), hx = (cx + bx) / 2, hy = (cy + by) / 2, hz = Math.max(0, ez - HIP_DROP);
    emit('capsule', cx, cy, nz, hx, hy, hz, CHEST_R + g);
    emit('capsule', hx, hy, hz, bx, by, 0, LEGS_R + g);
    // the hands, and an arm to each from the shoulder on its side (the side it is on, whatever its id says)
    const sz = Math.max(0, ez - SHOULDER_DROP);
    for (const s of list) {
      if (!s || s.foot) continue;
      const J = Array.isArray(s.joints) && s.joints.length >= 25 && s.joints.every(ok3) ? s.joints : null, P = Array.isArray(s.points) ? s.points : [];
      let wx, wy, wz;
      if (J) { wx = J[0][0]; wy = J[0][1]; wz = J[0][2]; } else { const q = P.find(okq); if (!q) continue; wx = q.x; wy = q.y; wz = q.z; }
      const side = (wx - ex) * rx + (wy - ey) * ry >= 0 ? 1 : -1;
      const sx = ex + rx * SHOULDER_SIDE * side - fx * SHOULDER_BACK, sy = ey + ry * SHOULDER_SIDE * side - fy * SHOULDER_BACK;
      if (Math.hypot(wx - sx, wy - sy, wz - sz) > ARM_STRAIGHT) {
        const lx = (sx + wx) / 2, ly = (sy + wy) / 2, lz = (sz + wz) / 2 - ELBOW_DOWN;
        emit('capsule', sx, sy, sz, lx, ly, lz, ARM_R + g); emit('capsule', lx, ly, lz, wx, wy, wz, ARM_R + g);
      } else emit('capsule', sx, sy, sz, wx, wy, wz, ARM_R + g);
      if (J) { for (const ch of CHAINS) for (let k = 1; k < ch.length; k++) { const a = J[ch[k - 1]], b = J[ch[k]]; emit('capsule', a[0], a[1], a[2], b[0], b[1], b[2], HAND_R + g); } }
      else {
        let more = 0, first = true;
        for (const q of P) { if (!okq(q)) continue; if (first) { first = false; continue; } emit('capsule', wx, wy, wz, q.x, q.y, q.z, HAND_R + g); more++; }
        if (!more) emit('sphere', wx, wy, wz, wx, wy, wz, HAND_R + g);
      }
    }
  }

  M.bodyproxy = { build, buildInto, HEAD_R, HEAD_BACK, HEAD_MIN, NECK_DROP, CHEST_R, HIP_DROP, LEGS_R, SHOULDER_DROP, SHOULDER_SIDE, SHOULDER_BACK, ARM_R, ARM_STRAIGHT, ELBOW_DOWN, HAND_R, GROW_CRUDE, GROW_ML, CHAINS };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
