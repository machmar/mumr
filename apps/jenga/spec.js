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
      world: { substep: 1 / 240, slop: 0.0005 * k, maxMove: 0.004 * k, sleepAfter: 0.4, sleepV: 0.02 * r, velocitySteps: 20, positionSteps: 6, baumgarte: 0.05 },      // (a gentle position correction: a stronger one has no friction in it and walks a stack
                                                                                                                                    //  that leans on one side off it, block by block, when the tower is kept awake)
      hold: { force: 4 * k * k * k, omega: 80 / r, spring: 20, speed: 5, breakAway: 1.5 * d.L },      // a grip's strength (N), how stiff its spring is (rad/s), when it lets go (m behind the hand)
      hand: { force: 3 * k * k * k, omega: 120, mass: 0.02 * k * k * k },                               // a fingertip pushes with at most this (N): it stops at a block that will not give
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
  // where a slot of a level is (game frame), whatever the level (a block put on top starts a level above the 18th)
  function slotHome(level, slot, size, plinthTop) {
    const d = dims(size), along = level % 2 === 0, off = (slot - 1) * (d.W + 0.00005 * d.k);
    return { p: [along ? 0 : off, along ? off : 0, plinthTop + d.H / 2 + level * d.H + 0.0002 * d.k], q: along ? [0, 0, 0, 1] : [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  }
  const blockHome = (i, size, plinthTop) => slotHome(Math.floor(i / PER), i % PER, size, plinthTop);

  // ---- where things stand (game frame: the tower at the origin, x from the player who put the game here towards the tower)
  // P is where that player stands; the console is to the side of the plinth, and the board and the scoreboard face P (everybody else walks round).
  // The ARRANGEMENT says where the furniture stands: the host works it out from the real room when the game is put down (arrange.js: the console
  // on whichever side has room, the scroll and the lantern where they fit, nothing on a wall, a sofa or a table) and keeps it in the place
  // (`place.arr`, game frame), so every page and the host's physics have the same one. An arrangement made for another size is not used.
  //   arr: { size, p (how far P is in front of the tower), q (how far P is to its side), c (the console's middle), u (along the console, away from P), v (across it, away from the
  //          tower: its back, where the board stands), s (the scroll's stand), l (the lantern) }
  const TABLE = { half: [0.55, 0.3], top: 0.78 };
  function defaultArr(size) {
    const d = dims(size), half = Math.max(0.16, 2 * d.L), C = [-0.15, half + 0.62];
    return { size: dims(size).size, p: half + 0.8, c: C, u: [1, 0], v: [0, 1], s: [C[0] + 0.95, C[1] + 0.15], l: [C[0] - 0.8, C[1] + 0.05] };
  }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function layout(size, place) {
    const d = dims(size), half = Math.max(0.16, 2 * d.L), top = d.plinth, tableH = TABLE.top;
    const A = place && place.arr && place.arr.size === d.size ? place.arr : defaultArr(size);
    const P = [-A.p, A.q || 0], C = A.c, U = A.u, V = A.v, face = (p) => Math.atan2(P[1] - p[1], P[0] - p[0]);
    const at = (du, dv) => [C[0] + U[0] * du + V[0] * dv, C[1] + U[1] * du + V[1] * dv];          // (a point on the console: along it, across it)
    const bc = at(0.1, 0.14), sc = A.s, tray = at(-0.3, -0.06);
    // the board faces the front of the table, turned towards P by about half the way (at most a third of a right angle either way)
    const front = Math.atan2(-V[1], -V[0]), boardYaw = front + Math.max(-0.6, Math.min(0.6, 0.45 * wrap(face(bc) - front)));
    return {
      d, P, plinth: { half, top },
      console: { c: C, u: U, v: V, at, yaw: Math.atan2(U[1], U[0]), half: TABLE.half, top: tableH },  // a table: 1.1 m along u, 0.6 m across
      tray: { c: tray, half: 0.17, rim: 0.045, wall: 0.02 },                                        // the die rolls here (square to the table)
      board: { c: bc, w: 0.72, bottom: tableH + 0.05, pitch: 0, yaw: boardYaw },                     // the shared menu: a stand along the back of the table
      score: { c: sc, w: 0.62, h: 0.86, bottom: tableH + 0.02, yaw: face(sc) },                     // the scroll hangs on its own stand, facing P
      lantern: A.l,                                                                                  // a paper lantern standing on the floor
      die: { size: Math.max(0.04, Math.min(0.06, 0.04 * Math.sqrt(d.k))), at: [tray[0], tray[1], tableH + 0.025] },
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
    const L = layout(size, place), at = (p) => toCommon(place, p), c = L.console, U = c.u, V = c.v, t = L.tray;
    // a rectangle in the game frame, its sides along u and v (half sizes hu, hv), at height z, as a room plane's outline (common frame)
    const rect = (q, hu, hv, z) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => at([q[0] + U[0] * hu * a + V[0] * hv * b, q[1] + U[1] * hu * a + V[1] * hv * b, z]));
    const planes = [{ l: 'plinth', v: false, p: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => at([a * L.plinth.half, b * L.plinth.half, L.plinth.top])) }];
    planes.push({ l: 'table', v: false, p: rect(c.c, c.half[0], c.half[1], c.top) });
    const w = t.wall / 2, h = c.top + t.rim, T = t.half, on = (du, dv) => [t.c[0] + U[0] * du + V[0] * dv, t.c[1] + U[1] * du + V[1] * dv];
    // (the tray's walls stand on the table: slabs from its top up, not solids from the floor, which made an edge under the table that a falling block
    //  caught on: Marek's run, 2026-10-28)
    for (const [q, hu, hv] of [[on(-T, 0), w, T + w], [on(T, 0), w, T + w], [on(0, -T), T + w, w], [on(0, T), T + w, w]]) planes.push({ l: 'tray table', v: false, p: rect(q, hu, hv, h), thick: t.rim });
    return planes;
  }
  // the real room with the furniture added (one object per room, so that the physics sees "the same room" and rebuilds nothing)
  const merged = new WeakMap();
  function withFurniture(room, size, place) {
    const key = `${size}|${place.x}|${place.y}|${place.yaw}|${place.arr ? JSON.stringify(place.arr) : ''}`, base = room || EMPTY;
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

  Object.assign(J, { LEVELS, PER, BLOCKS, DIE, BASE, SIZES, SIZE_KEYS, COLOURS, WOOD, dims, tuning, rng, colourOrder, blockSpec, blockHome, slotHome, layout, defaultArr, TABLE, toCommon, fromCommon, qYaw, qMul, qCommon, qRot, furniture, withFurniture, DIE_FACES, DIE_COLOURS, dieUp });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
