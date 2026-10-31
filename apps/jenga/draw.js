// How Jenga looks: the same module for the headset page and the PC view (rule 1: the drawing of a shared thing lives in one place). An ES module; THREE
// is handed in. Everything is drawn from the shared state (the document's `jstate`), the bodies the host sends (`snap`, net.js), the touches at the board
// and the server's clock, in the COMMON frame: `parent` is a group that holds the page's line-up (the page moves it), and inside it a point (x, y, z) of
// the floor plan is THREE (x, z, -y).
//
// The zen look (Marek's choice), a quiet room with one warm light:
//   the tower    pine blocks stained in six colours, each colour's sign burnt into both ends; a satin oil finish
//   the plinth   charred cedar (yakisugi) on a black foot, a rim of pale hinoki, raked sand in rings round a slate stone under the tower
//   the console  a walnut table on tapered legs; the die's tray in black lacquer lined with vermilion, on indigo felt
//   the board    a walnut stand like a small gate, a panel of washi lit from behind, wooden plaques hanging on cords (stand.js)
//   the score    a hanging scroll (kakejiku) in a brocade of waves, on a stand like the board's
//   the lantern  a paper andon on the floor at the end of the table: the scene's warm light (look.js), its flicker the same everywhere
//   the moments  in fx.js
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATLAS, blockAtlas, dieFace, yakisugi, walnut, hinoki, sand, felt, washi, seigaiha, enso, glow, standOut, blobShadow } from './textures.js';
import { FONT, loadFonts, environment, createRig, mergeStatic } from './look.js';
import { createStand } from './stand.js';
import { createFx } from './fx.js';
import { createDecor } from './decor.js';
import { createShades } from './shades.js';
import { createDemo } from './demo.js';

const S = window.JENGA;
const toV = (p) => [p[0], p[2], -p[1]];
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

// relit: the page hands the scene's lights to the engine (app.relight), which lights the real floor and walls with them: the painted pool of light
// under the lantern is then not drawn (the PC view has no real room and keeps it)
export function createScene({ THREE, parent, renderer, playerColours = [0xf2c14e, 0x4ea1ff, 0xff6b6b, 0x7bd88f], fontBase = 'fonts/', relit = false }) {
  const root = new THREE.Group(); parent.add(root);
  const furniture = new THREE.Group(); root.add(furniture);               // in the game frame: moved to `place` and turned by its yaw
  const bodies = new THREE.Group(); root.add(bodies);                    // blocks and die: common frame
  const overlay = new THREE.Group(); root.add(overlay);                   // glows, rings, words: common frame
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };
  const demo = createDemo({ THREE, parent: root, own });                  // (the ghost demo: demo.js)
  let fontsVer = 0;
  loadFonts(fontBase).then(() => { fontsVer++; });

  // ---- light and materials
  const env = renderer ? own(environment(THREE, renderer)) : null;
  const rig = createRig({ THREE, renderer, parent: furniture });
  const T = { walnut: walnut(THREE), hinoki: hinoki(THREE), yaki: yakisugi(THREE), felt: felt(THREE) };
  for (const t of Object.values(T)) { own(t.map); own(t.normal); }
  const std = (o) => own(new THREE.MeshStandardMaterial(Object.assign({ envMap: env, envMapIntensity: 0.6 }, o)));
  const phys = (o) => own(new THREE.MeshPhysicalMaterial(Object.assign({ envMap: env, envMapIntensity: 0.7 }, o)));
  const mats = {
    env,
    walnut: std({ map: T.walnut.map, normalMap: T.walnut.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.44 }),
    hinoki: std({ map: T.hinoki.map, normalMap: T.hinoki.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.6 }),
    yaki: std({ map: T.yaki.map, normalMap: T.yaki.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.55, metalness: 0.15, envMapIntensity: 0.9 }),
    lacquer: phys({ color: 0x0d0a09, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.0 }),
    shu: phys({ color: 0xa8301c, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 }),
    felt: std({ map: T.felt.map, normalMap: T.felt.normal, roughness: 1, envMapIntensity: 0.2 }),
    slate: std({ color: 0x6b6762, roughness: 0.7, envMapIntensity: 0.5 }),
    bamboo: std({ color: 0xc9a56a, roughness: 0.3 }),
    cord: std({ color: 0xb2321d, roughness: 0.8, envMapIntensity: 0.2 }),
    lampBack: own(new THREE.MeshBasicMaterial({ color: 0x5a3010 })),
    glass: std({ color: 0xf4e8d0, roughness: 0.06, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
  };
  T.felt.map.repeat.set(3, 3); T.felt.normal.repeat.set(3, 3);
  const blockMats = new Map();
  const blockMat = (colour, variant) => {
    const k = `${colour}:${variant}`;
    let m = blockMats.get(k);
    if (!m) {
      const c = S.COLOURS[colour], a = blockAtlas(THREE, { colour: c.hex, shape: c.shape, variant });
      own(a.map); own(a.normal);
      m = std({ map: a.map, normalMap: a.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.46, envMapIntensity: 0.65 });
      blockMats.set(k, m);
    }
    return m;
  };
  // a block's geometry: a rounded box (long along THREE x, flat along y) whose faces use the atlas: the two ends the right quarter, the rest the left
  function blockGeometry(d) {
    const g = own(new RoundedBoxGeometry(d.L, d.H, d.W, 2, Math.min(0.0016 * d.k * 1.6, d.H * 0.14)));
    const uv = g.attributes.uv, per = uv.count / 6;
    for (let side = 0; side < 6; side++) {
      const [u0, u1] = side < 2 ? ATLAS.endU : ATLAS.longU;
      for (let i = side * per; i < (side + 1) * per; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), uv.getY(i));
    }
    uv.needsUpdate = true;
    return g;
  }
  function dieMaterials() {
    const D = S.DIE_COLOURS;                                        // (physics faces +x -x +y -y +z -z; THREE order: right left top bottom front back)
    return [D[0], D[1], D[4], D[5], D[3], D[2]].map((ci, k) => { const c = S.COLOURS[ci], t = dieFace(THREE, c.hex, c.shape, 70 + k); own(t.map); own(t.normal); return std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.45, envMapIntensity: 0.65 }); });
  }

  // ---- the blocks and the die. A block is an Object3D that holds where it is (fx.js reads it) and is drawn as one instance of the InstancedMesh of
  // its stain: 12 draw calls for 54 blocks, in the picture and in the shadow
  let size = null, geo = null, dieMesh = null, inst = [];
  const blocks = [];
  function buildBodies(sz) {
    blocks.length = 0;
    if (dieMesh) bodies.remove(dieMesh);
    const d = S.dims(sz), L = S.layout(sz);
    geo = blockGeometry(d);
    for (let i = 0; i < S.BLOCKS; i++) { const o = new THREE.Object3D(); o.geometry = geo; o.visible = false; o.userData.i = i; blocks.push(o); }
    dieMesh = new THREE.Mesh(own(new RoundedBoxGeometry(L.die.size, L.die.size, L.die.size, 3, L.die.size * 0.13)), dieMaterials());
    dieMesh.visible = false; bodies.add(dieMesh);
    size = sz;
  }
  let seedUsed = null;
  function paintBlocks(seed) {
    const col = S.colourOrder(seed), byMat = new Map();
    for (const im of inst) { bodies.remove(im); im.dispose(); }
    blocks.forEach((o, i) => { const m = blockMat(col[i], i % 2); if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(i); });
    inst = [...byMat].map(([m, list]) => {
      const im = new THREE.InstancedMesh(geo, m, list.length); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      list.forEach((i, k) => { blocks[i].userData.inst = im; blocks[i].userData.k = k; });
      bodies.add(im); return im;
    });
    seedUsed = seed;
  }

  // ---- the furniture (game frame), rebuilt when the size changes
  const shadowTex = { round: own(blobShadow(THREE, 128, false)), square: own(blobShadow(THREE, 128, true)) };
  const furnSig = (sz, place) => `${sz}|${place && place.arr ? JSON.stringify(place.arr) : ''}`;
  let furnKey = null, scroll = null, lanternGlow = null, lanternMat = null, catcher = null;
  function disposeGroup(g) { for (let i = g.children.length - 1; i >= 0; i--) { const c = g.children[i]; if (c.userData.own) { g.remove(c); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } } }
  // a box with the wood's grain at one scale on each face (the texture repeats every TILE metres)
  const TILE = 0.36;
  function boxGeo(w, h, dp, rounded = 0, turn = true) {
    const g = rounded ? new RoundedBoxGeometry(w, h, dp, 2, rounded) : new THREE.BoxGeometry(w, h, dp), uv = g.attributes.uv, per = uv.count / 6, sc = [[dp, h], [dp, h], [w, dp], [w, dp], [w, h], [w, h]];
    const up = turn && h > w && h > dp;             // (a post: the grain runs up it; not the charred boards, which stand up in their texture)
    for (let f = 0; f < 6; f++) for (let i = f * per; i < (f + 1) * per; i++) {
      const a = uv.getX(i) * sc[f][0] / TILE, b = uv.getY(i) * sc[f][1] / TILE;
      if (up && f !== 2 && f !== 3) uv.setXY(i, b, a); else uv.setXY(i, a, b);
    }
    return g;
  }
  // a tapered post (a four-sided cylinder) with the grain running up it
  const postGeo = (r0, r1, len) => { const g = new THREE.CylinderGeometry(r0, r1, len, 4, 1); g.rotateY(Math.PI / 4); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * len / TILE, uv.getX(i) * 0.25); return g; };
  // (shadows: only the plinth casts, besides the bodies; only the plinth, the sand and the floor round it take them: the light's box is round the tower)
  let shadows = false;
  const add = (geo, mat, x, y, z, parentG = furniture, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData.own = true; m.castShadow = shadow && shadows; m.receiveShadow = shadows; parentG.add(m); return m; };
  const box = (w, h, dp, mat, x, y, z, parentG, r = 0) => add(boxGeo(w, h, dp, r, mat !== mats.yaki), mat, x, y, z, parentG);
  const at = (gx, gy, gz) => [gx, gz, -gy];                     // game frame floor plan -> THREE inside the furniture group
  // a soft shadow on the floor under something (round or square, w x d metres)
  const floorShadow = (gx, gy, w, dp, square, opacity = 0.55, yaw = 0, parentG = furniture) => {
    const m = add(new THREE.PlaneGeometry(w, dp), own(new THREE.MeshBasicMaterial({ map: square ? shadowTex.square : shadowTex.round, transparent: true, opacity, depthWrite: false, color: 0x000000 })), ...at(gx, gy, 0.0015), parentG, false);
    m.rotation.set(-Math.PI / 2, 0, yaw); m.receiveShadow = false; m.renderOrder = 1; return m;
  };
  // a beam whose ends curve up (the kasagi of a gate), along x
  const beamGeo = (len, th, dp, lift) => {
    const g = new THREE.BoxGeometry(len, th, dp, 32, 1, 1), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / TILE, uv.getY(i) * 0.1);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (len / 2); p.setY(i, p.getY(i) + lift * Math.pow(Math.abs(x), 3.2)); }
    g.computeVertexNormals(); return g;
  };
  const sandCache = new Map();
  function buildFurniture(sz, place) {
    disposeGroup(furniture);
    const L = S.layout(sz, place), d = L.d, h = L.plinth.half, top = L.plinth.top, k = d.k;
    rig.fit(L);
    // -- the plinth: a black foot set back, the charred cedar body, a rim of hinoki, sand, the slate stone
    shadows = true;
    const foot = Math.min(0.03, top * 0.3), inset = Math.min(0.018, h * 0.08), rimW = Math.max(0.018, 0.022 * Math.sqrt(k)), rimUp = 0.006 * Math.sqrt(k), sink = 0.002;
    box(2 * (h - inset), foot, 2 * (h - inset), mats.lacquer, 0, foot / 2, 0);
    box(2 * h, top - foot - 0.004, 2 * h, mats.yaki, 0, foot + (top - foot - 0.004) / 2, 0);
    for (const [x, z, w, dp] of [[0, -h + rimW / 2, 2 * h, rimW], [0, h - rimW / 2, 2 * h, rimW], [-h + rimW / 2, 0, rimW, 2 * h - 2 * rimW], [h - rimW / 2, 0, rimW, 2 * h - 2 * rimW]]) box(w, 0.004 + rimUp, dp, mats.hinoki, x, top - 0.004 + (0.004 + rimUp) / 2, z, furniture, 0.0015);
    const sh = h - rimW, stoneH = d.L * 0.5 * 1.3, sk = `${sz}`;
    if (!sandCache.has(sk)) { const t = sand(THREE, { stone: stoneH / sh, rings: Math.max(7, Math.round(9 * Math.sqrt(sh / 0.14))), seed: 4 }); own(t.map); own(t.normal); sandCache.set(sk, std({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1), roughness: 0.96, envMapIntensity: 0.25 })); }
    const sandM = add(new THREE.PlaneGeometry(2 * sh, 2 * sh), sandCache.get(sk), 0, top - sink, 0, furniture, false); sandM.rotation.x = -Math.PI / 2; sandM.receiveShadow = true;
    const stoneT = 0.006 * Math.sqrt(k);
    add(new RoundedBoxGeometry(2 * stoneH, stoneT, 2 * stoneH, 2, stoneT * 0.4), mats.slate, 0, top - stoneT / 2, 0);
    shadows = false;
    floorShadow(0, 0, 2 * h * 1.35, 2 * h * 1.35, true, 0.6);
    // the shadow catcher: the real floor round the tower takes the tower's shadows (and the blocks' when they fall)
    const r = Math.max(0.42, h * 1.5 + d.height * 0.9);
    catcher = add(new THREE.PlaneGeometry(2 * r, 2 * r), own(new THREE.ShadowMaterial({ color: 0x140a04, opacity: 0.42, depthWrite: false })), 0, 0.002, 0, furniture, false);
    catcher.rotation.x = -Math.PI / 2; catcher.renderOrder = 1; catcher.receiveShadow = true;
    // -- the console: a walnut top, tapered legs, an apron; black lacquer feet. It is built in its own frame (x along it, y across it towards
    //    its back) and stood where the arrangement puts it (spec.js layout: u, v; a mirrored arrangement has its back on the other hand)
    const c = L.console, tt = 0.034, hx = c.half[0], hy = c.half[1], vs = Math.sign(c.u[0] * c.v[1] - c.u[1] * c.v[0]) || 1;
    const cg = new THREE.Group(); cg.position.set(...at(c.c[0], c.c[1], 0)); cg.rotation.y = c.yaw; cg.userData.own = true; furniture.add(cg);
    box(2 * hx, tt, 2 * hy, mats.walnut, ...at(0, 0, c.top - tt / 2), cg, 0.006);
    const legIn = 0.06, legH = c.top - tt;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      add(postGeo(0.026, 0.017, legH), mats.walnut, ...at(sx * (hx - legIn), sy * (hy - legIn), legH / 2), cg);
      add(new THREE.CylinderGeometry(0.02, 0.021, 0.012, 4, 1).rotateY(Math.PI / 4), mats.lacquer, ...at(sx * (hx - legIn), sy * (hy - legIn), 0.006), cg);
      floorShadow(sx * (hx - legIn), sy * (hy - legIn), 0.16, 0.16, false, 0.5, 0, cg);
    }
    for (const sy of [-1, 1]) box(2 * (hx - legIn), 0.055, 0.018, mats.walnut, ...at(0, sy * (hy - legIn), c.top - tt - 0.0275), cg);
    for (const sx of [-1, 1]) box(0.018, 0.055, 2 * (hy - legIn), mats.walnut, ...at(sx * (hx - legIn), 0, c.top - tt - 0.0275), cg);
    floorShadow(0, 0, 2 * hx + 0.25, 2 * hy + 0.25, true, 0.32, 0, cg);
    // -- the die's tray: black lacquer walls lined with vermilion, a vermilion lip, indigo felt (square to the table)
    const Tr = L.tray, tw = Tr.wall, th = Tr.rim, tz = c.top, tc = [-0.22, vs * -0.06];          // (spec.js layout: in a little from the end, so that the dice tower astride its far wall stands on the table)
    const felt3 = add(new THREE.PlaneGeometry(2 * Tr.half, 2 * Tr.half), mats.felt, ...at(tc[0], tc[1], tz + 0.0008), cg, false); felt3.rotation.x = -Math.PI / 2;
    // (the end wall and the back wall stop where the dice tower stands on their corner: spec.js trayWalls)
    for (const [x, y, w, dp, ix, iy] of S.trayWalls(L).map(([u0, u1, v0, v1]) => { const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, end = u1 - u0 < v1 - v0; return [tc[0] + cu, tc[1] + vs * cv, u1 - u0, v1 - v0, end ? -Math.sign(cu) : 0, end ? 0 : -Math.sign(cv) * vs]; })) {
      // (w is along the table, dp across it: in THREE, x and z)
      box(w, th, dp, mats.lacquer, ...at(x, y, tz + th / 2), cg, 0.004);
      const lw = ix ? 0.002 : w - 2 * tw, ld = iy ? 0.002 : dp - 2 * tw;
      box(lw, th - 0.006, ld, mats.shu, ...at(x + ix * (tw / 2 + 0.001), y + iy * (tw / 2 + 0.001), tz + (th - 0.006) / 2 + 0.001), cg);
    }
    // -- the dice tower (spec.js dtowerParts: the host's physics has the same boxes): windows of pale glass in walnut frames, so that the die is seen
    //    tumbling down it (Marek, 2026-10-31), black lacquer planks behind them; a black lacquer skirt at its foot, a vermilion lip round the
    //    mouth, a small roof of black lacquer edged in vermilion
    const DT = L.dtower, dq = new THREE.Quaternion(), fr = 0.012;
    for (const b of S.dtowerParts(L)) {
      const g = new THREE.Group(); g.position.set(...at(b.p[0], b.p[1], b.p[2])); g.quaternion.set(b.q[0], b.q[2], -b.q[1], b.q[3]); dq.copy(g.quaternion); g.userData.own = true; furniture.add(g);      // (own: a rebuild takes it away, or the old tower's glass stayed behind)
      const lx = b.size[0], ly = b.size[2], lz = b.size[1];
      if (b.part !== 'wall') { box(lx, ly, lz, b.part === 'post' ? mats.walnut : mats.lacquer, 0, 0, 0, g, b.part === 'plank' ? 0 : 0.002); }
      if (b.part === 'roof') box(lx + 0.006, 0.005, lz + 0.006, mats.shu, 0, -0.0075, 0, g, 0.002);
      if (b.part !== 'wall') continue;
      // a pane of glass, framed: rails along the top and the foot (or the door's lintel), one across at the middle planks' height, a muntin up the middle
      const long = Math.max(lx, lz), along = (w, h, y, mat, grow = 0.002, r = 0.002) => lx > lz ? box(w, h, lz + grow, mat, 0, y, 0, g, r) : box(lx + grow, h, w, mat, 0, y, 0, g, r);
      const upright = (x, w) => lx > lz ? box(w, ly, lz + 0.001, mats.walnut, x, 0, 0, g, 0.001) : box(lx + 0.001, ly, w, mats.walnut, 0, 0, x, g, 0.001);
      box(lx > lz ? lx - 0.004 : lx * 0.5, ly - 0.004, lx > lz ? lz * 0.5 : lz - 0.004, mats.glass, 0, 0, 0, g);
      along(long, fr, ly / 2 - fr / 2, mats.walnut);
      along(long, fr, -ly / 2 + fr / 2, mats.walnut);
      const mid = DT.base + DT.H * 0.62 - b.p[2]; if (Math.abs(mid) < ly / 2 - fr) along(long, 0.008, mid, mats.walnut);
      upright(0, 0.006);
      along(long + 0.004, 0.008, ly / 2 + 0.004, mats.shu, 0.004);                                     // (the lip round the mouth)
      const foot = DT.base + 0.009 - b.p[2]; if (foot - 0.009 > -ly / 2 - 0.001) along(long + 0.008, 0.018, foot, mats.lacquer, 0.008);       // (the skirt; the front wall stops short of the table)
    }
    // (the four corner posts, up its whole height)
    { const cy = Math.cos(DT.yaw), sy = Math.sin(DT.yaw), e = DT.A + DT.t / 2;
      for (const [u, v] of [[-e, -e], [-e, e], [e, -e], [e, e]]) { const m = box(DT.t + 0.006, DT.H + 0.006, DT.t + 0.006, mats.walnut, ...at(DT.c[0] + u * cy - v * sy, DT.c[1] + u * sy + v * cy, DT.base + DT.H / 2), furniture, 0.002); m.quaternion.copy(dq); } }
    // -- the lantern: a paper andon on the floor; walnut posts, a black cap, washi with a lattice, lit from inside
    const lx = L.lantern[0], ly = L.lantern[1], LH = 0.74, pw = 0.2, p0 = 0.17, p1 = 0.64;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(0.016, LH, 0.016, mats.walnut, ...at(lx + sx * (pw / 2 + 0.004), ly + sy * (pw / 2 + 0.004), LH / 2));
    for (const z of [p0 - 0.008, p1 + 0.008, 0.05]) for (const [ax, ay, w, dp] of [[0, -1, pw + 0.03, 0.014], [0, 1, pw + 0.03, 0.014], [-1, 0, 0.014, pw + 0.03], [1, 0, 0.014, pw + 0.03]]) box(w, 0.014, dp, mats.walnut, ...at(lx + ax * (pw / 2 + 0.004), ly + ay * (pw / 2 + 0.004), z));
    box(pw + 0.07, 0.016, pw + 0.07, mats.lacquer, ...at(lx, ly, LH + 0.008), furniture, 0.004);
    if (!lanternMat) {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const g = cv.getContext('2d');
      washi(g, 256, 512, 17, [246, 214, 168]);
      const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, 'rgba(120,60,20,0.25)'); gr.addColorStop(0.45, 'rgba(255,220,160,0)'); gr.addColorStop(1, 'rgba(120,60,20,0.3)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
      g.strokeStyle = 'rgba(70,40,20,0.85)'; g.lineWidth = 5; for (const x of [85, 171]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); } for (let y = 102; y < 512; y += 102) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace;
      lanternMat = own(new THREE.MeshStandardMaterial({ map: t, emissive: 0xffd9a8, emissiveMap: t, emissiveIntensity: 0.8, roughness: 1, side: THREE.DoubleSide }));
    }
    const paper = add(new THREE.BoxGeometry(pw, p1 - p0, pw), lanternMat, ...at(lx, ly, (p0 + p1) / 2), furniture, false);
    paper.material = [lanternMat, lanternMat, own(new THREE.MeshBasicMaterial({ visible: false })), own(new THREE.MeshBasicMaterial({ color: 0x3a2010 })), lanternMat, lanternMat];
    if (!lanternGlow) lanternGlow = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: own(glow(THREE)), color: 0xffa250, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })));
    standOut(THREE, lanternGlow, 0.16);
    lanternGlow.scale.set(0.95, 1.25, 1); lanternGlow.position.set(...at(lx, ly, (p0 + p1) / 2)); furniture.add(lanternGlow);
    if (!relit) { const pool = floorShadow(lx, ly, 1.3, 1.3, false, 0.2); pool.material.color.set(0xffa860); pool.material.blending = THREE.AdditiveBlending; pool.material.map = own(glow(THREE)); }       // (its light on the floor)
    floorShadow(lx, ly, 0.36, 0.36, true, 0.5);
    rig.lampAt = [lx, ly, (p0 + p1) / 2];
    // -- the scroll's stand: two posts on cross feet, a top beam like the board's, the scroll hanging from it on a cord
    const SC = L.score, sh0 = SC.bottom + SC.h, sg = new THREE.Group(); sg.position.set(...at(SC.c[0], SC.c[1], 0)); sg.rotation.y = Math.PI / 2 + SC.yaw; sg.userData.own = true; furniture.add(sg);
    const postX = SC.w / 2 + 0.09, postH = sh0 + 0.16;
    for (const sx of [-1, 1]) {
      add(postGeo(0.016, 0.02, postH), mats.walnut, sx * postX, postH / 2, 0, sg);
      box(0.05, 0.035, 0.34, mats.walnut, sx * postX, 0.0175, 0, sg, 0.006);
      add(new THREE.BoxGeometry(0.056, 0.008, 0.08), mats.lacquer, sx * postX, 0.004, 0.13, sg); add(new THREE.BoxGeometry(0.056, 0.008, 0.08), mats.lacquer, sx * postX, 0.004, -0.13, sg);
    }
    add(beamGeo(2 * postX + 0.2, 0.03, 0.05, 0.02), mats.walnut, 0, postH, 0, sg);
    add(beamGeo(2 * postX + 0.23, 0.012, 0.058, 0.023), mats.lacquer, 0, postH + 0.021, 0, sg);
    box(2 * postX, 0.02, 0.026, mats.walnut, 0, postH - 0.12, 0, sg);
    floorShadow(SC.c[0], SC.c[1], 2 * postX + 0.3, 0.5, true, 0.4, SC.yaw + Math.PI / 2);
    buildScroll(sg, SC, postH);
    buildHowto(sg, postX, postH);
    mergeStatic(THREE, mergeGeometries, furniture);
    furnKey = furnSig(sz, place);
  }

  // ---- how to take a block (Marek, 2026-10-29): a sign of wood with a washi face, hanging on two cords from an arm out of the scroll stand's post.
  //      Pictures more than words (Marek, 2026-10-31), and under it on a cord a round button that plays the ghost demo (demo.js)
  let howto = null;
  function buildHowto(sg, postX, postH) {
    // (on the stand's -x side: arrange.js keeps that much more room there)
    const armY = postH - 0.2, armL = 0.3, W = 0.27, H = 0.4, cx = -(postX + armL - 0.15), top = armY - 0.07, R = 0.04, by = top - H - 0.02 - 0.07 - R;
    if (!howto) {
      const cv = document.createElement('canvas'); cv.width = 680; cv.height = 1000;
      const tex = own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const bc = document.createElement('canvas'); bc.width = bc.height = 256;
      const btex = own(new THREE.CanvasTexture(bc)); btex.colorSpace = THREE.SRGBColorSpace;
      howto = { cv, tex, mat: own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14, envMap: env, envMapIntensity: 0.2 })), key: null,
        bc, btex, bmat: own(new THREE.MeshStandardMaterial({ map: btex, roughness: 0.5, emissive: 0xffffff, emissiveMap: btex, emissiveIntensity: 0.2, envMap: env, envMapIntensity: 0.4 })), button: null, lit: null };
    }
    box(armL, 0.022, 0.03, mats.walnut, -(postX + armL / 2), armY, 0, sg, 0.004);
    box(0.03, 0.03, 0.036, mats.lacquer, -(postX + armL - 0.012), armY, 0, sg, 0.004);
    for (const dx of [-0.09, 0.09]) add(new THREE.CylinderGeometry(0.0013, 0.0013, armY - top, 5), mats.cord, cx + dx, (armY + top) / 2, 0.004, sg, false);
    box(W + 0.02, H + 0.02, 0.012, mats.walnut, cx, top - H / 2, 0, sg, 0.004);
    add(new THREE.PlaneGeometry(W, H), howto.mat, cx, top - H / 2, 0.0065, sg, false);
    // the button: a cord from the sign's foot, a walnut ring round a vermilion face with the sign of play on it (both sides)
    const cordTop = top - H - 0.01, cordLen = cordTop - (by + R + 0.008);
    add(new THREE.CylinderGeometry(0.0013, 0.0013, cordLen, 5), mats.cord, cx, cordTop - cordLen / 2, 0, sg, false);
    const bg = new THREE.Group(); bg.position.set(cx, by, 0); bg.userData.own = true; sg.add(bg);
    for (const m of [
      add(new THREE.CylinderGeometry(R + 0.008, R + 0.008, 0.016, 40).rotateX(Math.PI / 2), mats.walnut, 0, 0, 0, bg),
      add(new THREE.CircleGeometry(R, 40), howto.bmat, 0, 0, 0.0085, bg, false),
      add(new THREE.CircleGeometry(R, 40).rotateY(Math.PI), howto.bmat, 0, 0, -0.0085, bg, false),
    ]) m.userData.keep = true;                                                      // (not merged: it moves when pressed)
    howto.button = bg; howto.R = R;
    howto.key = null;
  }
  function drawButton(on) {
    const g = howto.bc.getContext('2d'), n = 256;
    g.fillStyle = on ? '#e0683a' : '#a8301c'; g.fillRect(0, 0, n, n);
    const gr = g.createRadialGradient(n * 0.4, n * 0.35, 10, n / 2, n / 2, n * 0.6); gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, n, n);
    g.fillStyle = '#fff3e0'; g.beginPath(); g.moveTo(n * 0.4, n * 0.24); g.lineTo(n * 0.4, n * 0.6); g.lineTo(n * 0.7, n * 0.42); g.closePath(); g.fill();
    g.font = `700 32px ${FONT.body}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('show me', n / 2, n * 0.8);
    howto.btex.needsUpdate = true; howto.lit = on;
  }
  // the pictures: blocks seen from above (rectangles), fingertips (round pads), the way things go (arrows), a red cross for "no", a green tick for "yes"
  function drawHowto() {
    const g = howto.cv.getContext('2d'), W = howto.cv.width, H = howto.cv.height;
    washi(g, W, H, 17, [248, 240, 224]);
    g.fillStyle = 'rgba(178,48,28,0.9)'; g.fillRect(30, 30, 8, H - 60);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.font = `800 50px ${FONT.head}`; g.fillStyle = '#221a14'; g.fillText('Taking a block', 64, 92);
    const wood = '#c99a62', red = '#b8402a', ink = '#3a2e24';
    const blk = (x, y, w, h, c = wood) => { g.fillStyle = c; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(40,25,10,0.7)'; g.lineWidth = 3; g.strokeRect(x, y, w, h); };
    const arrow = (xa, ya, xb, yb, c = '#a8301c') => { const a = Math.atan2(yb - ya, xb - xa); g.strokeStyle = g.fillStyle = c; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb - 14 * Math.cos(a), yb - 14 * Math.sin(a)); g.stroke(); g.beginPath(); g.moveTo(xb, yb); g.lineTo(xb - 26 * Math.cos(a - 0.5), yb - 26 * Math.sin(a - 0.5)); g.lineTo(xb - 26 * Math.cos(a + 0.5), yb - 26 * Math.sin(a + 0.5)); g.closePath(); g.fill(); };
    const tip = (x, y, r = 16) => { g.fillStyle = '#f0c9a8'; g.strokeStyle = '#7a4a30'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); };
    const cross = (x, y) => { g.strokeStyle = '#c0281c'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 20, y - 20); g.lineTo(x + 20, y + 20); g.moveTo(x + 20, y - 20); g.lineTo(x - 20, y + 20); g.stroke(); };
    const tick = (x, y) => { g.strokeStyle = '#3c7a3a'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(x - 20, y); g.lineTo(x - 6, y + 16); g.lineTo(x + 22, y - 18); g.stroke(); };
    const label = (t, y) => { g.font = `700 34px ${FONT.head}`; g.fillStyle = '#a8301c'; g.fillText(t, 64, y); };
    const rule = (y) => { g.fillStyle = 'rgba(80,60,40,0.18)'; g.fillRect(64, y, W - 110, 2); };
    const bw = 190, bh = 40, xa = 96, xb = 380;
    // 1. the middle block: poke it out, then pinch the end that sticks out
    let y = 150; label('1  poke, then pinch', y);
    for (let k = 0; k < 3; k++) blk(xa, y + 24 + k * (bh + 4), bw, bh, k === 1 ? red : wood);
    tip(xa - 30, y + 24 + 1.5 * bh + 4); arrow(xa - 8, y + 24 + 1.5 * bh + 4, xa + 56, y + 24 + 1.5 * bh + 4);
    for (let k = 0; k < 3; k++) blk(xb + (k === 1 ? 60 : 0), y + 24 + k * (bh + 4), bw, bh, k === 1 ? red : wood);
    tip(xb + 60 + bw - 22, y + 24 + bh + 4 - 12, 13); tip(xb + 60 + bw - 22, y + 24 + 2 * bh + 4 + 12, 13);
    arrow(xb + 60 + bw + 6, y + 24 + 1.5 * bh + 4, xb + 60 + bw + 70 > W - 30 ? W - 34 : xb + 60 + bw + 70, y + 24 + 1.5 * bh + 4);
    rule(y + 190);
    // 2. an outer block: pinch its outer side and draw it out sideways (yes); not by its end (no)
    y = 390; label('2  outer: from its side', y);
    for (let k = 0; k < 3; k++) blk(xa + 20, y + 70 + k * (bh + 4), bw, bh, k === 0 ? red : wood);
    tip(xa + 20 + bw / 2 - 30, y + 54, 13); tip(xa + 20 + bw / 2 + 30, y + 54, 13);
    arrow(xa + 20 + bw / 2, y + 44, xa + 20 + bw / 2, y + 2);
    tick(xa + 20 + bw + 40, y + 70 + bh / 2);
    for (let k = 0; k < 3; k++) blk(xb, y + 70 + k * (bh + 4), bw, bh, k === 0 ? red : wood);
    tip(xb + bw + 18, y + 70 + bh / 2, 13); cross(xb + bw + 34, y + 70 + bh + 40);
    rule(y + 230);
    // 3. a red thread from the hand: it cannot be held there
    y = 670; label('3  red thread: not there', y);
    blk(xa + 20, y + 36, bw, bh); tip(xa + 20 + bw + 120, y + 36 + bh / 2);
    g.strokeStyle = '#d0301c'; g.lineWidth = 5; g.setLineDash([12, 9]); g.beginPath(); g.moveTo(xa + 20 + bw + 104, y + 36 + bh / 2); g.lineTo(xa + 20 + bw + 4, y + 36 + bh / 2); g.stroke(); g.setLineDash([]);
    cross(xb + 200, y + 36 + bh / 2);
    rule(y + 120);
    // 4. the die: over the little tower's mouth, let go; and the button under the sign shows it all
    y = 830; label('4  die: drop it in', y);
    g.fillStyle = '#5a3a22'; g.fillRect(xa + 60, y + 40, 84, 110); g.fillStyle = 'rgba(200,230,255,0.55)'; g.fillRect(xa + 72, y + 52, 60, 86);
    g.fillStyle = '#f2ead8'; g.strokeStyle = ink; g.lineWidth = 3; g.fillRect(xa + 84, y - 10, 36, 36); g.strokeRect(xa + 84, y - 10, 36, 36);
    arrow(xa + 102, y + 30, xa + 102, y + 70);
    g.font = `600 30px ${FONT.body}`; g.fillStyle = ink; g.fillText('see it done:', xb - 40, y + 90); g.fillText('the button  ▼', xb - 40, y + 130);
    howto.tex.needsUpdate = true;
    drawButton(false);
  }
  // ---- the scroll (kakejiku): brocade of waves round a washi heart; a thin rod at the top, a roller with black ends at the bottom; ink and a red seal
  const SCW = 1024;
  function buildScroll(sg, SC, postH) {
    const W = SC.w, Hh = SC.h, H = Math.round(SCW * Hh / W);
    if (!scroll) {
      const cv = document.createElement('canvas'); cv.width = SCW; cv.height = H;
      const tex = own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const mat = own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16, envMap: env, envMapIntensity: 0.25 }));
      scroll = { cv, g: cv.getContext('2d'), tex, mat, H, key: null };
    }
    const cy = SC.bottom + Hh / 2, grp = new THREE.Group(); grp.position.set(0, cy, 0.0); sg.add(grp); grp.userData.own = true;
    add(new THREE.PlaneGeometry(W, Hh), scroll.mat, 0, 0, 0, grp, false);
    add(new THREE.PlaneGeometry(W, Hh), own(new THREE.MeshStandardMaterial({ color: 0x1d2236, roughness: 0.9 })), 0, 0, -0.001, grp, false).rotation.y = Math.PI;
    add(new THREE.BoxGeometry(W + 0.02, 0.016, 0.012), mats.walnut, 0, Hh / 2 + 0.006, 0.004, grp);
    const roller = new THREE.CylinderGeometry(0.012, 0.012, W + 0.03, 16); roller.rotateZ(Math.PI / 2);
    add(roller, mats.walnut, 0, -Hh / 2 - 0.008, 0.004, grp);
    for (const sx of [-1, 1]) { const cap = new THREE.CylinderGeometry(0.016, 0.016, 0.03, 16); cap.rotateZ(Math.PI / 2); add(cap, mats.lacquer, sx * (W / 2 + 0.03), -Hh / 2 - 0.008, 0.004, grp); }
    // the cord: from the top rod up to a hook in the beam
    const hookY = postH - 0.012 - cy, rodY = Hh / 2 + 0.012;
    for (const sx of [-1, 1]) { const len = Math.hypot(W * 0.3, hookY - rodY), cg = new THREE.CylinderGeometry(0.0013, 0.0013, len, 5); const cm = add(cg, mats.cord, sx * W * 0.15, (hookY + rodY) / 2, 0.004, grp, false); cm.rotation.z = -sx * Math.atan2(W * 0.3, hookY - rodY); }
    scroll.grp = grp; scroll.key = null;
  }
  // (the brocade and the paper are painted once and copied: painting them pixel by pixel at every change of the state took a third of a second, and a
  //  headset stopped for most of a second at every move: Marek's run, 2026-10-28)
  let scrollBg = null;
  function drawScore(state, colours) {
    const g = scroll.g, W = SCW, H = scroll.H, B = 70;                   // (B: the brocade's width)
    if (!scrollBg || scrollBg.height !== H) {
      scrollBg = document.createElement('canvas'); scrollBg.width = W; scrollBg.height = H; const bg = scrollBg.getContext('2d');
      seigaiha(bg, 0, 0, W, H, { r: 26 });
      bg.fillStyle = 'rgba(201,162,90,0.85)'; bg.fillRect(B - 6, B - 6, W - 2 * B + 12, H - 2 * B + 12);                  // (a thin gold rule round the paper)
      washi(bg, W - 2 * B, H - 2 * B, 3, [246, 238, 222], B, B);
    }
    g.clearRect(0, 0, W, H); g.drawImage(scrollBg, 0, 0);
    const x0 = B + 60, x1 = W - B - 60;
    g.textBaseline = 'alphabetic'; g.fillStyle = '#221a14'; g.textAlign = 'left';
    g.font = `800 108px ${FONT.head}`; g.fillText('Score', x0, B + 150);
    g.fillStyle = '#7a6552'; g.font = `500 36px ${FONT.body}`; g.textAlign = 'right';
    g.fillText(state.round ? `round ${state.round} of ${state.rounds}` : 'three rounds make a match', x1, B + 140);
    g.strokeStyle = 'rgba(34,26,20,0.75)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, B + 192); g.lineTo(x1, B + 192); g.stroke();
    const rows = S.scoreboard(state), rowH = 176, y0 = B + 230;
    rows.forEach((r, k) => {
      const y = y0 + k * rowH, colour = hex(colours[r.slot % colours.length]);
      g.globalAlpha = r.present ? 1 : 0.42;
      if (r.turn) enso(g, x0 + 34, y + 58, 50, { seed: 3 + k, width: 12, colour: '178,48,28' });
      g.fillStyle = colour; g.beginPath(); g.arc(x0 + 34, y + 58, 22, 0, Math.PI * 2); g.fill();
      g.textAlign = 'left'; g.fillStyle = '#221a14'; g.font = `700 58px ${FONT.head}`; g.fillText(r.name, x0 + 100, y + 60);
      g.font = `500 32px ${FONT.body}`; g.fillStyle = '#7a6552';
      g.fillText(r.rounds.map((v) => (v === null ? '·' : v > 0 ? `+${v}` : `${v}`)).join('    '), x0 + 102, y + 112);
      g.textAlign = 'right'; g.fillStyle = r.winner ? '#a87a22' : '#221a14'; g.font = `800 104px ${FONT.head}`; g.fillText(String(r.total), x1, y + 92);
      if (r.winner) { g.font = `700 30px ${FONT.body}`; g.fillStyle = '#a87a22'; g.fillText('W I N N E R', x1 - 120, y + 46); }
      g.globalAlpha = 1;
      if (k < rows.length - 1) { g.strokeStyle = 'rgba(34,26,20,0.16)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y + rowH - 22); g.lineTo(x1, y + rowH - 22); g.stroke(); }
    });
    // (fewer than four players leave paper below them: a faint ensō there, as a scroll would have)
    if (rows.length && rows.length < 4) { const top = y0 + rows.length * rowH, room = H - B - 190 - top, r = Math.min(150, room * 0.36); if (r > 60) enso(g, W / 2, top + room / 2, r, { seed: 9 + rows.length, width: r * 0.2, alpha: 0.16 }); }
    if (!rows.length) { enso(g, W / 2, y0 + 210, 150, { seed: 9, width: 30 }); g.textAlign = 'center'; g.fillStyle = '#7a6552'; g.font = `500 38px ${FONT.body}`; g.fillText('the names appear when a match starts', W / 2, y0 + 440); }
    g.textAlign = 'left'; g.font = `500 30px ${FONT.body}`;
    (state.ticker || []).slice(-3).forEach((t, i, a) => { g.globalAlpha = 0.4 + 0.6 * (i + 1) / a.length; g.fillStyle = '#4a3b2e'; g.fillText(t.length > 46 ? `${t.slice(0, 45)}…` : t, x0, H - B - 150 + i * 46); });
    g.globalAlpha = 1;
    scroll.tex.needsUpdate = true;
  }

  // ---- the board (stand.js) and the moments (fx.js)
  const stand = createStand({ THREE, parent: root, mats });
  const fx = createFx({ THREE, overlay, own, mats });
  const decor = createDecor({ THREE, parent: root, env, own, relit });
  const shades = createShades({ THREE, parent: root, env, own });

  // ---- every frame. t: the server's clock in ms (the same on every page), now: this page's
  let last = null, prevState = null, placeKey = null, arrivedAt = -1e9;
  // heads: where the players are, [{ slot, x, y }] in the common frame (from everybody's presence: whose turn it is is lit at their feet)
  // deco: the document's jdeco (the room's garden, deco.js); garden: the Garden setting (0..2); shades: { lights, cursor, dark } (shades.js)
  // hands: everybody's hands for the pinch's aim (fx.js), [{ at, gap, pinch }] in the common frame
  function update({ state, snap, now = performance.now(), t, lay, touches = [], heads = [], hands = [], deco = null, garden = 2, shades: sh = null, me = null, jdemo = null }) {
    if (!state) return;
    warmRestore();
    const ts = (t === undefined || t === null ? now : t) / 1000, dt = last === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    if (size !== state.size || !blocks.length) { buildBodies(state.size); seedUsed = null; }      // (new meshes: painted again)
    if (furnKey !== furnSig(state.size, state.place)) buildFurniture(state.size, state.place);
    if (seedUsed !== state.seed) paintBlocks(state.seed);
    const pl = state.place || { x: 0, y: 0, yaw: 0 }, L = S.layout(state.size, pl);
    furniture.position.set(pl.x, 0, -pl.y); furniture.rotation.set(0, pl.yaw, 0);
    const T0 = performance.now(); timing.score = 0; timing.stand = 0; timing.fx = 0;
    if (howto && howto.key !== fontsVer) { howto.key = fontsVer; drawHowto(); }
    const key = `${fontsVer}|${state.round}|${state.rounds}|${state.phase === 'match_end'}|${JSON.stringify(S.scoreboard(state))}|${(state.ticker || []).slice(-3).join('|')}`; if (key !== scroll.key) { scroll.key = key; drawScore(state, playerColours); timing.score = performance.now() - T0; }
    // blocks and die from the host's bodies
    if (snap) {
      for (const it of snap.items) {
        const m = it.i === S.DIE ? dieMesh : blocks[it.i];
        if (!m) continue;
        const p = toV(it.p); m.position.set(p[0], p[1], p[2]); m.quaternion.set(it.q[0], it.q[2], -it.q[1], it.q[3]); m.visible = true;
        if (m.userData.inst) { m.updateMatrix(); m.userData.inst.setMatrixAt(m.userData.k, m.matrix); }
      }
      for (const im of inst) { im.instanceMatrix.needsUpdate = true; im.visible = true; }
    } else { for (const m of blocks) m.visible = false; for (const im of inst) im.visible = false; if (dieMesh) dieMesh.visible = false; }
    // the ghost demo, in place of the tower (its blocks are not drawn while it plays); the button lit while it plays (demo.js)
    const tMs = t === undefined || t === null ? now : t, demoOn = demo.update(state, jdemo, tMs);
    if (demoOn) for (const im of inst) im.visible = false;
    if (howto && howto.button) {
      if (howto.lit !== demoOn) drawButton(demoOn);
      const since = jdemo ? (tMs - jdemo.at) / 1000 : 9;
      howto.button.position.z = since >= 0 && since < 0.35 ? -0.008 * Math.sin((since / 0.35) * Math.PI) : 0;          // (pressed: it gives a little)
    }
    // the light
    // the game put down somewhere new: the lantern swells a little as it arrives (fx.js: rings of light on the floor and the sand)
    const pk = `${pl.x}|${pl.y}|${pl.yaw}|${state.size}`, arrived = placeKey !== null && pk !== placeKey;
    if (arrived) arrivedAt = ts;
    placeKey = pk;
    const swell = 1 + 0.45 * Math.max(0, 1 - (ts - arrivedAt) / 1.8) * Math.min(1, (ts - arrivedAt) / 0.25);
    const flick = rig.update(ts, rig.lampAt) * swell;
    // the key light: from the real ceiling light nearest the game (within 3 m of the tower, along the floor), if the room has one
    let near = null;
    for (const lt of (sh && sh.lights) || []) {
      const g = S.fromCommon(pl, [(lt.a[0] + lt.b[0]) / 2, (lt.a[1] + lt.b[1]) / 2, lt.h]), dd = Math.hypot(g[0], g[1]);
      if (dd < 3 && (!near || dd < near.dd)) near = { x: g[0], y: g[1], h: lt.h, w: Math.max(lt.w || 0.1, lt.len || 0), dd };
    }
    rig.aim(near);
    lightFlick = flick; lightK += ((['fall', 'replay'].includes(state.phase) ? 0.3 : 1) - lightK) * Math.min(1, dt * 3);
    rig.lamp.intensity *= swell;
    if (lanternMat) lanternMat.emissiveIntensity = 0.78 * flick;
    if (lanternGlow) lanternGlow.material.opacity = 0.42 * flick;
    // the board, the moments
    const T1 = performance.now();
    stand.update({ state, lay: lay || S.board(state, {}), touches, t: ts, dt, colours: playerColours, fonts: fontsVer });
    timing.stand = performance.now() - T1;
    const moments = prevState && prevState.rev !== state.rev && S.momentsBetween ? S.momentsBetween(prevState, state) : [];
    if (arrived) moments.push('arrived');
    prevState = state;
    const T2 = performance.now();
    fx.update({ state, snap, t: ts, dt, blocks, dieMesh, L, place: pl, moments, fonts: fontsVer, lampAt: rig.lampAt, heads, colours: playerColours, hands, me });
    timing.fx = performance.now() - T2;
    decor.update({ plan: deco, level: garden, t: ts, wc: fx.clock(), lightK });
    warmStep();
    shades.update({ lights: sh ? sh.lights : [], cursor: sh ? sh.cursor : null, dark: sh ? sh.dark : 0, t: ts, lightK });
    propLight(sh ? sh.dark : 0);
  }
  function dispose() { stand.dispose(); fx.dispose(); decor.dispose(); shades.dispose(); for (const o of disposables) if (o && o.dispose) o.dispose(); parent.remove(root); }
  // The lights of this world that light the real room (the engine's relight: app.relight): the lantern, and a little the board's lit paper. At the
  // fall they nearly go out with the room (the focus is the tower). In world coordinates.
  const lightsOut = [{ at: new THREE.Vector3(), colour: 0xffa45a, range: 2.6, power: 0 }, { at: new THREE.Vector3(), colour: 0xffe2b8, range: 1.1, power: 0 }];
  let lightK = 1, lightFlick = 1;
  function relights() {
    if (!furnKey) return [];
    rig.lamp.getWorldPosition(lightsOut[0].at); stand.glowAt.getWorldPosition(lightsOut[1].at);
    lightsOut[0].power = 0.9 * lightFlick * lightK; lightsOut[1].power = 0.35 * lightK;
    return lightsOut.concat(decor.relights(), shades.relights());
  }
  // how dear this page's drawing is (its player's Quality: 2 high, 1 medium, 0 low): shadows, the motes, the garden's smoke and petals
  // ---- the props darken with the room (Marek, 2026-10-29: "props don't dim, they stick out like a sore thumb"; "the table round the tower is uncomfortably
  //      bright when it dims"): every material of the furniture, the garden and the board's plaques takes k = 1 - 0.8 dark of its colour, its reflections
  //      and its own faint glow; the lights (the lantern, the lamps and candles, the shades, the board's lit paper) and the tower and the die do not.
  const propBase = new Map();
  const propList = () => [...Object.entries(mats).filter(([k]) => !['env', 'lampBack'].includes(k)).map(([, m]) => m), scroll && scroll.mat, howto && howto.mat, ...sandCache.values(), ...decor.props(), ...stand.props()].filter(Boolean);
  let propK = 1, propN = 0;
  function propLight(dark) {
    const k = 1 - 0.8 * Math.max(0, Math.min(1, dark || 0)), list = propList();
    if (Math.abs(k - propK) < 0.01 && list.length === propN) return;
    propK = k; propN = list.length;
    for (const m of list) {
      if (!propBase.has(m)) propBase.set(m, { c: m.color ? m.color.clone() : null, e: m.envMapIntensity, ei: m.emissiveIntensity });
      const b = propBase.get(m);
      if (b.c) m.color.copy(b.c).multiplyScalar(k);
      if (b.e !== undefined) m.envMapIntensity = b.e * k;
      if (b.ei !== undefined) m.emissiveIntensity = b.ei * k;
    }
  }
  let qual = 2;
  const timing = { score: 0, stand: 0, fx: 0 };
  // Warming up: a headset makes a shader the first time a thing is drawn, and that stops it for a good part of a second; the moments (the glows, the
  // rings, the words of the fall, the aim, YOUR TURN) appear one by one in a game, so each stopped the game once. For a few frames everything of the
  // game that is hidden is drawn (the effects are at no strength then: nothing is seen), and so are `extra` things of the engine's (the room's dim).
  let warm = 0, warmExtra = [], warmed = [];
  function warmUp(extra = [], frames = 3) { warm = frames; warmExtra = extra; }
  function warmRestore() { for (const o of warmed) o.visible = false; warmed = []; }          // (first thing in a frame: the frame then sets what it shows)
  function warmStep() {
    if (warm <= 0) return;
    warm--;
    const show = (o) => { if (!o.visible && (o.isMesh || o.isPoints || o.isSprite || o.isLine || o.isGroup || o.isObject3D)) { o.visible = true; warmed.push(o); } };
    root.traverse(show); for (const o of warmExtra) show(o);
  }          // (ms this frame: the scroll redrawn, the board, the moments; app.js logs a slow frame with them)
  function quality(q) { if (q === qual) return; qual = q; rig.quality(q); fx.quality(q); decor.quality && decor.quality(q); }
  // the demo's button (common frame, its middle) and its radius, for the page to see a fingertip press it
  const bw = new THREE.Vector3();
  function demoButton() { if (!howto || !howto.button) return null; howto.button.getWorldPosition(bw); root.worldToLocal(bw); return { p: [bw.x, -bw.z, bw.y], r: howto.R }; }
  return { root, update, demoButton, demoRunning: (state, jd, ms) => demo.running(state, jd, ms), relights, quality, timing, warmUp, boardPose: stand.pose, boardAspect: stand.aspect, boardWidth: stand.width, dispose, group: { furniture, bodies, overlay } };
}
