// Jenga's fixed facts, with no THREE and no DOM (the host, the headset page, the PC view and the Node tests all load it as JENGA):
// the three sizes, the six colours, which block is which (from a seed, the same on every page), where everything stands (the tower on a
// plinth, the console with the board and the die's tray) and that furniture as the room planes the physics takes (engine room.js).
//
// Frames. The GAME frame has its origin on the floor under the middle of the tower, x pointing from the console towards the tower, z up.
// `place` ({ x, y, yaw }) puts it in the COMMON frame (rule 1: every position that is sent or stored is common). Block positions are kept
// in the game frame by this file and turned by `toCommon`.
(function (J) {
  const LEVELS = 18, PER = 3, BLOCKS = LEVELS * PER, DIE = BLOCKS;          // the die is body 54
  // a real Jenga block is 15 x 25 x 75 mm: a tower of 18 levels is 27 cm. Huge is 75 cm, giant 1.5 m (the same 54 blocks).
  const BASE = { L: 0.075, W: 0.025, H: 0.015 };
  const SIZES = {
    normal: { key: 'normal', name: 'Normal', k: 1, plinth: 0.72, note: '27 cm tower' },
    huge: { key: 'huge', name: 'Huge', k: 0.75 / (LEVELS * BASE.H), plinth: 0.4, note: '75 cm tower' },
    giant: { key: 'giant', name: 'Giant', k: 1.5 / (LEVELS * BASE.H), plinth: 0.06, note: '1.5 m tower' },
  };
  const SIZE_KEYS = ['normal', 'huge', 'giant'];
  // six colours, each with a shape (stamped on the block ends and the die's faces, so that colour is not the only sign)
  const COLOURS = [
    { id: 0, name: 'Shu', label: 'vermilion', hex: 0xd2452c, shape: 'circle' },
    { id: 1, name: 'Ai', label: 'indigo', hex: 0x2f55a0, shape: 'triangle' },
    { id: 2, name: 'Moegi', label: 'green', hex: 0x6fa13a, shape: 'square' },
    { id: 3, name: 'Kihada', label: 'gold', hex: 0xe0a82c, shape: 'wave' },
    { id: 4, name: 'Sakura', label: 'pink', hex: 0xe58aa6, shape: 'flower' },
    { id: 5, name: 'Sumi', label: 'ink', hex: 0x3b3a40, shape: 'diamond' },
  ];
  const WOOD = { density: 520, friction: 0.4, restitution: 0.08, angularDamping: 0.15 };           // pine

  const dims = (size) => {
    const z = SIZES[size] || SIZES.normal, k = z.k;
    return { size: z.key, k, L: BASE.L * k, W: BASE.W * k, H: BASE.H * k, height: LEVELS * BASE.H * k, plinth: z.plinth };
  };
  // what the physics is tuned to at this size (apps/jenga/README.md: found with a pretend hand pulling blocks out of a tower)
  const tuning = (size) => {
    const d = dims(size), k = d.k, r = Math.sqrt(k);
    return {
      world: { substep: 1 / 240, slop: 0.0005 * k, maxMove: 0.004 * k, sleepAfter: 0.4, sleepV: 0.02 * r, velocitySteps: 20, positionSteps: 6 },
      hold: { force: 4 * k * k * k, omega: 80 / r, spring: 20, speed: 5, breakAway: 1.5 * d.L },      // a grip's strength (N), how stiff its spring is (rad/s), when it lets go (m behind the hand)
      grab: 0.02 + 0.01 * Math.min(k, 3), tip: Math.max(0.005, Math.min(0.01, 0.35 * d.H)),
      still: 0.04 * r,                                                                                  // m/s: slower than this is at rest
    };
  };

  // ---- randomness: the same seed gives every page and the host the same tower
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // which colour each of the 54 blocks is: nine of each, shuffled
  function colourOrder(seed) {
    const r = rng(seed ^ 0x51ed), a = Array.from({ length: BLOCKS }, (_, i) => i % COLOURS.length);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // block i (level * 3 + slot): even levels lie along x, odd levels along y (the block itself is the same, turned). `jitter` is the tiny difference in thickness of real blocks
  // (a tenth of a millimetre, scaled): some blocks carry more of the load than their neighbours, which is why one block in a level pulls out easily.
  function blockSpec(i, seed, size) {
    const d = dims(size), level = Math.floor(i / PER), slot = i % PER, along = level % 2 === 0, r = rng((seed * 7919 + i * 104729) >>> 0);
    const dh = (r() - 0.5) * 2 * 0.0001 * d.k;
    return { i, level, slot, along, colour: colourOrder(seed)[i], size: [d.L, d.W, d.H + dh], dh };      // (always long along its own x: an odd level turns it by 90 degrees, blockHome)
  }
  // where block i starts (game frame, z above the plinth's top) and its turn about z (0 or 90 degrees), as a quaternion
  function blockHome(i, size, plinthTop) {
    const d = dims(size), level = Math.floor(i / PER), slot = i % PER, along = level % 2 === 0, off = (slot - 1) * (d.W + 0.00005 * d.k);
    return { p: [along ? 0 : off, along ? off : 0, plinthTop + d.H / 2 + level * d.H + 0.0002 * d.k], q: along ? [0, 0, 0, 1] : [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  }

  // ---- where things stand (game frame)
  function layout(size) {
    const d = dims(size), half = Math.max(0.16, 2 * d.L), top = d.plinth;
    const cx = -(half + 0.55), tableH = 0.78, tray = 0.34;
    return {
      d, plinth: { half, top },
      console: { c: [cx, 0], half: [0.28, 0.5], top: tableH },                                      // a low table: 0.56 m deep along x, 1 m wide along y
      tray: { c: [cx + 0.1, 0.22], half: tray / 2, rim: 0.045, wall: 0.02 },                        // the die rolls here
      board: { c: [cx - 0.12, -0.12], w: 0.64, bottom: tableH + 0.06, pitch: 0.2 },                // the shared menu stands at the back of the table
      score: { c: [cx - 0.12, 0.7], w: 0.62, h: 0.86, bottom: tableH + 0.02 },                      // the scoreboard hangs beside it
      die: { size: Math.max(0.04, Math.min(0.06, 0.04 * Math.sqrt(d.k))), at: [cx + 0.1, 0.22, tableH + 0.025] },
    };
  }
  // game frame <-> common frame
  const rot = (yaw, x, y) => [x * Math.cos(yaw) - y * Math.sin(yaw), x * Math.sin(yaw) + y * Math.cos(yaw)];
  const toCommon = (place, p) => { const r = rot(place.yaw, p[0], p[1]); return [place.x + r[0], place.y + r[1], p[2]]; };
  const fromCommon = (place, p) => { const r = rot(-place.yaw, p[0] - place.x, p[1] - place.y); return [r[0], r[1], p[2]]; };
  const qYaw = (yaw) => [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
  const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qCommon = (place, q) => qMul(qYaw(place.yaw), q);

  // the furniture as room planes (common frame), to be added to the real room's: engine room.js turns a 'solid' into a block from the floor
  // up and a 'table' into a slab, and the physics builds them (Jolt: a convex hull each)
  function furniture(size, place) {
    const L = layout(size), at = (p) => toCommon(place, p), rect = (cx, cy, hx, hy, z) => [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]].map((q) => at([q[0], q[1], z]));
    const planes = [{ l: 'plinth', v: false, p: rect(0, 0, L.plinth.half, L.plinth.half, L.plinth.top) }];
    const c = L.console, t = L.tray;
    planes.push({ l: 'table', v: false, p: rect(c.c[0], c.c[1], c.half[0], c.half[1], c.top) });
    const w = t.wall / 2, h = c.top + t.rim, T = t.half;
    for (const [cx, cy, hx, hy] of [[t.c[0] - T, t.c[1], w, T + w], [t.c[0] + T, t.c[1], w, T + w], [t.c[0], t.c[1] - T, T + w, w], [t.c[0], t.c[1] + T, T + w, w]]) planes.push({ l: 'tray', v: false, p: rect(cx, cy, hx, hy, h) });
    return planes;
  }
  // the real room with the furniture added (one object per room, so that the physics sees "the same room" and rebuilds nothing)
  const merged = new WeakMap();
  function withFurniture(room, size, place) {
    const key = `${size}|${place.x}|${place.y}|${place.yaw}`, base = room || EMPTY;
    let m = merged.get(base);
    if (m && m.key === key) return m.room;
    const out = { planes: (room && room.planes ? room.planes : []).concat(furniture(size, place)) };
    merged.set(base, { key, room: out });
    return out;
  }
  const EMPTY = {};

  // the colour the die shows on each of its faces: the faces in the die's own frame, +x -x +y -y +z -z
  const DIE_FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const DIE_COLOURS = [0, 3, 1, 4, 2, 5];               // opposite faces are far apart in the palette
  const qRot = (q, v) => { const x = q[0], y = q[1], z = q[2], w = q[3], tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
  // the face of the die that is up: { colour, tilt (degrees from flat: a die that is not flat is not read) }
  function dieUp(q) {
    let best = 0, bz = -2;
    DIE_FACES.forEach((f, i) => { const z = qRot(q, f)[2]; if (z > bz) { bz = z; best = i; } });
    return { face: best, colour: DIE_COLOURS[best], tilt: Math.acos(Math.max(-1, Math.min(1, bz))) * 180 / Math.PI };
  }

  Object.assign(J, { LEVELS, PER, BLOCKS, DIE, BASE, SIZES, SIZE_KEYS, COLOURS, WOOD, dims, tuning, rng, colourOrder, blockSpec, blockHome, layout, toCommon, fromCommon, qYaw, qMul, qCommon, qRot, furniture, withFurniture, DIE_FACES, DIE_COLOURS, dieUp });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
