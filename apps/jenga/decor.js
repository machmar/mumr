// The room's garden, drawn (an ES module; THREE is handed in): the small calm things the host has placed in the real room (deco.js plan, the document's
// `jdeco`). Every one is made from its seed, so it is the same stone, the same stalk, the same branch on every headset and the PC view (rule 1).
//
//   garden    a strip of sand raked along a wall's foot, edged with small flat stones, two or three stones in it and a mound of moss
//   stones    a few river stones and a mound of moss
//   lamp      a small paper lantern on the floor; it lights the real wall and floor round it (engine relight)
//   bamboo    a few stalks in a corner, their leaves high up, swaying in a slow air
//   vase      a vase on a table with one branch in blossom; now and then a petal falls and lies on the table, then fades
//   incense   a stick in a small stone, a glowing tip and a thin curl of smoke
//   candle    a small candle; its flame lights the table and the wall behind it (engine relight)
// How they move: the garden grows in when it is planned (each thing in turn, over half a minute), the bamboo sways, the flames flicker (the server's
// clock); the petals and the smoke live on the WORLD's clock (fx.js): they stop when the tower falls, run back with the rewind and slowly with the replay.
// The Garden setting (logic.js): 0 none, 1 sparse (the things the plan marks p 0), 2 full. Cheap: the still parts are merged, one mesh a material
// (about a dozen draw calls), a vertex shader grows and sways them; no lights of their own (the lamps and candles light the real room through the
// engine's relight; the PC view, which has no real room, gets a painted pool of light instead).
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, hash, vnoise, rakedStrip, glow, puff, washi } from './textures.js';

const toV = (x, y, z) => [x, z, -y];                // common frame floor plan -> THREE (inside the common group)
const GROW = 7;                                     // s: one thing growing in
const SMOKE = 70;                                   // puffs in one thread of incense smoke

export function createDecor({ THREE, parent, env, own, relit = false }) {
  const root = new THREE.Group(); parent.add(root);
  const U = { grow: { value: 0 }, wind: { value: 0 } };
  // the materials, patched so that the vertex shader grows each thing from its foot and sways what may sway
  const patch = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGrow = U.grow; sh.uniforms.uWind = U.wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aGrow; attribute float aSway; uniform float uGrow; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float gk = clamp((uGrow - aGrow.w) / ${GROW.toFixed(1)}, 0.0, 1.0); gk = gk * gk * (3.0 - 2.0 * gk);
          transformed = aGrow.xyz + (transformed - aGrow.xyz) * gk;
          float sw = aSway * aSway;
          transformed.x += sw * 0.045 * (sin(uWind * 0.83 + aGrow.x * 2.1) * 0.7 + sin(uWind * 2.1 + aGrow.z * 3.3 + position.y * 2.0) * 0.3);
          transformed.z += sw * 0.032 * (sin(uWind * 0.61 + aGrow.z * 1.7) * 0.7 + sin(uWind * 1.7 + aGrow.x * 2.9 + position.y * 1.6) * 0.3);`);
    };
    m.customProgramCacheKey = () => 'jenga-decor';
    return own(m);
  };
  const std = (o) => patch(new THREE.MeshStandardMaterial(Object.assign({ envMap: env, envMapIntensity: 0.5 }, o)));
  const strip = rakedStrip(THREE); own(strip.map); own(strip.normal);
  const paperTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d');
    washi(g, 128, 256, 23, [246, 214, 168]);
    g.strokeStyle = 'rgba(70,40,20,0.8)'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 256); g.moveTo(0, 128); g.lineTo(128, 128); g.stroke();
    const t = own(new THREE.CanvasTexture(cv)); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const M = {
    sand: std({ map: strip.map, normalMap: strip.normal, roughness: 0.95, envMapIntensity: 0.2 }),
    stone: std({ vertexColors: true, roughness: 0.62 }),
    moss: std({ vertexColors: true, roughness: 1, envMapIntensity: 0.15 }),
    wood: std({ color: 0x4a3020, roughness: 0.55 }),
    black: std({ color: 0x100c0a, roughness: 0.3, envMapIntensity: 0.9 }),
    paper: std({ map: paperTex, emissive: 0xffd9a8, emissiveMap: paperTex, emissiveIntensity: 0.8, roughness: 1 }),
    bamboo: std({ vertexColors: true, roughness: 0.38, envMapIntensity: 0.7 }),
    leaf: std({ color: 0x4f7a2e, roughness: 0.7, side: THREE.DoubleSide }),
    glaze: std({ vertexColors: true, roughness: 0.22, envMapIntensity: 1.1 }),
    bark: std({ color: 0x3a2a20, roughness: 0.85 }),
    blossom: std({ vertexColors: true, emissive: 0xffd6de, emissiveIntensity: 0.1, roughness: 0.8, side: THREE.DoubleSide }),
    wax: std({ color: 0xf2e6cc, emissive: 0xffd9a0, emissiveIntensity: 0.18, roughness: 0.6 }),
    stick: std({ color: 0x5a2a1c, roughness: 0.9 }),
  };
  const tongueGeo = own((() => {
    const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14, y = t * 3.2, r = Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - t * 0.35) * 0.95; pts.push(new THREE.Vector2(Math.max(0.001, r), y)); }
    const g = new THREE.LatheGeometry(pts, 12), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const t = pos.getY(i) / 3.2, w = t < 0.18 ? t / 0.18 : 1, c = t < 0.18 ? [0.25, 0.3, 0.6] : t < 0.75 ? [1, 0.86, 0.55] : [1, 0.55, 0.2], k = (t < 0.18 ? 0.5 + w * 0.5 : 1) * (1 - Math.max(0, t - 0.8) * 2.5);
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
  })());
  const tGlow = own(glow(THREE)), tPuff = own(puff(THREE)), poolGeo = own(new THREE.PlaneGeometry(1, 1));

  // ---- geometry helpers: every piece carries aGrow (where its thing grows from, when it starts) and aSway (how much it sways)
  const pieces = [];                                 // [{ geo, mat, p }]
  function piece(geo, mat, p, from, start, sway = null, colour = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) { const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(colour, i * 3); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); }
    const ag = new Float32Array(n * 4), as = new Float32Array(n);
    for (let i = 0; i < n; i++) { ag[i * 4] = from[0]; ag[i * 4 + 1] = from[1]; ag[i * 4 + 2] = from[2]; ag[i * 4 + 3] = start; as[i] = sway ? sway(g.attributes.position.getY(i), i) : 0; }
    g.setAttribute('aGrow', new THREE.Float32BufferAttribute(ag, 4)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(as, 1));
    pieces.push({ geo: g, mat, p });
  }
  // a plum flower: five round petals, a little cupped, pale pink deepening to the middle, a yellow-green eye; and a closed bud
  function flowerGeo(r, seed) {
    const R = rand(seed), N = 40, pos = [0, 0, 0], col = [0.86, 0.62, 0.42], idx = [], rot = R() * 6.28, blush = 0.86 + R() * 0.12;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, k = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos((a + rot) * 2.5)), 0.6), rr = r * k;
      pos.push(Math.cos(a) * rr, Math.sin(a) * rr, rr * rr / r * 0.35); col.push(1, blush, blush + 0.03);
      // (a ring between eye and edge so the pink can deepen inward)
      pos.push(Math.cos(a) * rr * 0.35, Math.sin(a) * rr * 0.35, rr * 0.04); col.push(0.95, 0.66, 0.72);
    }
    for (let i = 0; i < N; i++) { const o = 1 + i * 2, inner = o + 1, o2 = o + 2, inner2 = o + 3; idx.push(0, inner, inner2, inner, o, o2, inner, o2, inner2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function budGeo(r) {
    const g = new THREE.SphereGeometry(r, 6, 4); g.scale(1, 1, 1.4);
    const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = 0.9; c[i + 1] = 0.48; c[i + 2] = 0.56; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
  }
  // a stone: an icosahedron pushed about by noise, flattened, its colour from a few river-stone greys and browns
  const STONES = [[0.3, 0.29, 0.28], [0.43, 0.41, 0.37], [0.21, 0.21, 0.22], [0.5, 0.46, 0.4], [0.27, 0.25, 0.23], [0.36, 0.37, 0.36]];
  function stoneGeo(r, flat, seed) {
    let g = new THREE.IcosahedronGeometry(1, 2); g.deleteAttribute('uv'); g = mergeVertices(g);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), base = STONES[seed % STONES.length], R = rand(seed);
    const sx = 0.8 + R() * 0.5, sz = 0.8 + R() * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), n1 = vnoise(x * 1.7 + seed * 0.13, z * 1.7 + y * 1.3, seed) - 0.5, n2 = vnoise(x * 5.3 + y * 2.1, z * 5.3 - y * 1.7, seed + 7) - 0.5;
      const k = 1 + n1 * 0.42 + n2 * 0.1;
      pos.setXYZ(i, x * r * k * sx, Math.max(-0.3, y) * r * k * flat, z * r * k * sz);
      // (darker in the hollows, lighter on top where it is worn; a few flecks)
      const shade = 0.72 + 0.32 * (y * 0.5 + 0.5) + n2 * 0.3 + (hash(i, seed, 5) > 0.93 ? 0.18 : 0), vein = Math.abs(Math.sin((x + z * 0.6) * 9 + seed)) < 0.06 ? 0.25 : 0;
      col[i * 3] = Math.min(1, base[0] * shade + vein); col[i * 3 + 1] = Math.min(1, base[1] * shade + vein); col[i * 3 + 2] = Math.min(1, base[2] * shade + vein * 0.9);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  // a mound of moss: a bumpy dome, greens with darker hollows
  function mossGeo(r, seed) {
    const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), b = vnoise(x * 4 + seed, z * 4 + y * 3, seed + 3), f = vnoise(x * 11 + y * 5, z * 11 - y * 4, seed + 8), k = 1 + (b - 0.5) * 0.3 + (f - 0.5) * 0.14;
      pos.setXYZ(i, x * r * k, y * r * 0.55 * k, z * r * k);
      // (cushion moss: a deep green, yellower where the light falls on its tips, near black in its folds)
      const t = 0.55 + 0.6 * f, hollow = 0.6 + 0.4 * y;
      col[i * 3] = (0.2 + 0.1 * f) * t * hollow; col[i * 3 + 1] = (0.34 + 0.08 * b) * t * hollow; col[i * 3 + 2] = 0.12 * t * hollow;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  const place = (g, at, yaw = 0) => { g.rotateY(yaw); g.translate(at[0], at[1], at[2]); return g; };      // (THREE position, turn about the up axis)
  const yawOf = (n) => Math.atan2(n[1], n[0]);         // a floor-plan direction as a turn about THREE's up axis (x towards the plan's y)

  // ---- the kinds
  const lights = [], flames = [], vases = [], smokes = [], pools = [];
  function build(it, k) {
    const R = rand(it.seed), start = 2 + k * 2.2 + R() * 1.5, n = [Math.cos(it.yaw), Math.sin(it.yaw)], u = [-n[1], n[0]];
    const at = (du, dn, z = 0) => toV(it.at[0] + u[0] * du + n[0] * dn, it.at[1] + u[1] * du + n[1] * dn, (it.at[2] || 0) + z);
    const foot = at(0, 0, 0), p = it.p || 0;
    const stone = (du, dn, r, flat, s) => piece(place(stoneGeo(r, flat, s), at(du, dn, r * flat * 0.25), R() * 6), M.stone, p, foot, start + R() * 2);
    const moss = (du, dn, r, s) => piece(place(mossGeo(r, s), at(du, dn, -0.004)), M.moss, p, foot, start + 1.5 + R() * 2);
    if (it.kind === 'garden') {
      const L = it.len, D = 0.26, g = new THREE.PlaneGeometry(L, D); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 0.45, uv.getY(i));
      piece(place(g, at(0, 0, 0.003), yawOf(u)), M.sand, p, foot, start);
      for (let s = -L / 2 + 0.03; s < L / 2 - 0.02; s += 0.055 + R() * 0.02) stone(s, D / 2 + 0.012, 0.018 + R() * 0.012, 0.35, (it.seed + Math.round(s * 100)) >>> 0);   // (the edge)
      const nBig = 2 + Math.floor(R() * 2);
      for (let i = 0; i < nBig; i++) { const s = (-0.5 + (i + 0.5) / nBig + (R() - 0.5) * 0.18) * L * 0.85; stone(s, (R() - 0.5) * 0.08, 0.045 + R() * 0.045, 0.55 + R() * 0.2, (it.seed + i * 7) >>> 0); if (R() < 0.6) moss(s + 0.08 + R() * 0.05, (R() - 0.5) * 0.06, 0.04 + R() * 0.035, it.seed + i); }
    } else if (it.kind === 'stones') {
      const nS = 3 + Math.floor(R() * 2);
      for (let i = 0; i < nS; i++) stone((R() - 0.5) * 0.24, (R() - 0.5) * 0.14, 0.035 + R() * 0.06, 0.5 + R() * 0.25, (it.seed + i * 13) >>> 0);
      moss((R() - 0.5) * 0.18, (R() - 0.5) * 0.1, 0.05 + R() * 0.03, it.seed + 3);
    } else if (it.kind === 'lamp') {
      const W = 0.15, H = 0.38, b = (w, h, d, x, y, z, m) => piece(place(new THREE.BoxGeometry(w, h, d), at(x, y, z), yawOf(u)), m, p, foot, start);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) b(0.012, H, 0.012, sx * W / 2, sy * W / 2, H / 2, M.wood);
      b(W + 0.03, 0.012, W + 0.03, 0, 0, H + 0.006, M.black); b(W + 0.01, 0.01, W + 0.01, 0, 0, 0.04, M.wood);
      b(W - 0.006, H - 0.09, W - 0.006, 0, 0, 0.045 + (H - 0.09) / 2, M.paper);
      lights.push({ at: at(0, 0, 0.22), range: 1.7, power: 0.6, colour: 0xffa860, p, start, seed: it.seed });
      flames.push({ at: at(0, 0, 0.22), size: 0.32, colour: 0xffa860, p, start, seed: it.seed, soft: true });
      if (!relit) pools.push({ at: at(0, 0, 0.004), size: 1.2, p, start });
    } else if (it.kind === 'bamboo') {
      const nS = 3 + Math.floor(R() * 3);
      for (let i = 0; i < nS; i++) {
        const a = R() * Math.PI * 2, rr = R() * 0.09, h = 1.25 + R() * 0.8, r = 0.011 + R() * 0.006, lean = [(R() - 0.5) * 0.1 + n[0] * 0.05, (R() - 0.5) * 0.1 + n[1] * 0.05];
        const base = [it.at[0] + Math.cos(a) * rr, it.at[1] + Math.sin(a) * rr], b0 = toV(base[0], base[1], 0);
        const sway = (y) => Math.min(1, Math.pow(Math.max(0, y) / h, 1.6));
        const g = new THREE.CylinderGeometry(r * 0.8, r, h, 8, 14, true); g.translate(0, h / 2, 0);
        const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
        for (let v = 0; v < pos.count; v++) { const y = pos.getY(v), t = y / h; pos.setX(v, pos.getX(v) + lean[0] * t * t); pos.setZ(v, pos.getZ(v) - lean[1] * t * t); const c = 0.85 + 0.15 * vnoise(v, y * 9, i); col[v * 3] = (0.52 + 0.18 * t) * c; col[v * 3 + 1] = (0.6 + 0.08 * t) * c; col[v * 3 + 2] = 0.26 * c; }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
        piece(g.translate(b0[0], 0, b0[2]), M.bamboo, p, b0, start + i * 0.6, (y) => sway(y));
        for (let y = 0.22 + R() * 0.1; y < h - 0.05; y += 0.24 + R() * 0.1) { const t = y / h, ring = new THREE.TorusGeometry(r * (1 - 0.2 * t) + 0.0012, 0.0016, 4, 12); ring.rotateX(Math.PI / 2); ring.translate(b0[0] + lean[0] * t * t, y, b0[2] - lean[1] * t * t); piece(ring, M.bamboo, p, b0, start + i * 0.6, () => sway(y), [0.5, 0.54, 0.24]); }
        // the leaves: sprigs from the upper nodes, long and narrow, hanging out and down
        for (let y = h * 0.55; y < h; y += 0.12 + R() * 0.08) {
          const t = y / h, nL = 2 + Math.floor(R() * 3);
          for (let l = 0; l < nL; l++) {
            const len = 0.11 + R() * 0.08, w = 0.016 + R() * 0.008, sh = new THREE.Shape();
            sh.moveTo(0, 0); sh.quadraticCurveTo(len * 0.35, w, len, 0); sh.quadraticCurveTo(len * 0.35, -w, 0, 0);
            const lg = new THREE.ShapeGeometry(sh, 4); lg.rotateX(-Math.PI / 2); lg.rotateZ(-0.5 - R() * 0.5); lg.rotateY(R() * Math.PI * 2);
            lg.translate(b0[0] + lean[0] * t * t, y, b0[2] - lean[1] * t * t);
            piece(lg, M.leaf, p, b0, start + i * 0.6 + 2, () => Math.min(1, sway(y) + 0.25));
          }
        }
      }
    } else if (it.kind === 'vase') {
      const R2 = rand(it.seed + 1), s = 0.85 + R2() * 0.35, prof = [[0.001, 0], [0.04, 0.002], [0.058, 0.035], [0.056, 0.09], [0.034, 0.14], [0.02, 0.165], [0.024, 0.18], [0.021, 0.185], [0.001, 0.185]].map(([r, y]) => new THREE.Vector2(r * s, y * s));
      const g = new THREE.LatheGeometry(prof, 28), pos = g.attributes.position, col = new Float32Array(pos.count * 3), glazes = [[0.13, 0.14, 0.13], [0.52, 0.6, 0.52], [0.1, 0.11, 0.16], [0.62, 0.55, 0.44]], gz = glazes[it.seed % glazes.length];
      for (let v = 0; v < pos.count; v++) { const y = pos.getY(v) / (0.185 * s), drip = 0.85 + 0.2 * vnoise(Math.atan2(pos.getZ(v), pos.getX(v)) * 4, y * 6, it.seed); col[v * 3] = gz[0] * drip; col[v * 3 + 1] = gz[1] * drip; col[v * 3 + 2] = gz[2] * drip; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const vb = at(0, 0, 0);
      piece(g.translate(vb[0], vb[1], vb[2]), M.glaze, p, vb, start);
      // the branch (an ume, plum, as in a tokonoma): it leaves the vase leaning out, turns at each joint, thinner every time; open flowers
      // and buds along the outer twigs
      const tips = [], up = new THREE.Vector3(0, 1, 0), qq = new THREE.Quaternion();
      const seg = (from, dir, len, r, depth, t0) => {
        const to = from.clone().addScaledVector(dir, len), g2 = new THREE.CylinderGeometry(r * 0.72, r, len, 6, 1); g2.translate(0, len / 2, 0);
        g2.applyQuaternion(qq.setFromUnitVectors(up, dir)); g2.translate(from.x, from.y, from.z);
        const swayOf = () => Math.min(0.7, (to.y - vb[1]) * 1.4);
        piece(g2, M.bark, p, vb, t0, swayOf);
        // (a knot at the joint hides the seam where the next segment turns away)
        const kn = new THREE.SphereGeometry(r * 0.78, 6, 4); kn.translate(to.x, to.y, to.z); piece(kn, M.bark, p, vb, t0, swayOf);
        if (depth >= 1) {
          const nb = depth === 1 ? 2 : 3 + Math.floor(R2() * 3);
          for (let b = 0; b < nb; b++) {
            const q2 = from.clone().lerp(to, 0.25 + R2() * 0.75), open = R2() > 0.3, fg = open ? flowerGeo(0.009 + R2() * 0.004, it.seed + tips.length * 7 + b) : budGeo(0.0045 + R2() * 0.002);
            // (each flower faces out from the twig, a little up)
            const side = new THREE.Vector3(R2() - 0.5, R2() * 0.6, R2() - 0.5).normalize();
            fg.applyQuaternion(qq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), side)); fg.translate(q2.x + side.x * r, q2.y + side.y * r, q2.z + side.z * r);
            piece(fg, M.blossom, p, vb, t0 + 1.5 + b * 0.3, swayOf);
          }
        }
        if (depth >= 3) { tips.push(to.clone()); return; }
        const kids = depth === 0 ? 1 + (R2() > 0.4 ? 1 : 0) : 1 + Math.floor(R2() * 2.2);
        for (let c = 0; c < kids; c++) {
          // (a sharp turn at each joint: the zigzag of an old plum)
          const turn = (c === 0 ? 1 : -1) * (0.5 + R2() * 0.5), d2 = dir.clone().add(new THREE.Vector3(turn * (R2() > 0.5 ? 1 : -1) * 0.6, 0.15 + R2() * 0.35, (R2() - 0.5) * 0.9)).normalize();
          seg(to, d2, len * (0.62 + R2() * 0.25), r * 0.72, depth + 1, t0 + 0.8);
        }
      };
      const mouth = new THREE.Vector3(vb[0], vb[1] + 0.18 * s, vb[2]), lean0 = new THREE.Vector3(Math.cos(it.yaw), 0, -Math.sin(it.yaw));
      const dir0 = new THREE.Vector3(lean0.x * 0.45 + (R2() - 0.5) * 0.25, 1, lean0.z * 0.45 + (R2() - 0.5) * 0.25).normalize();
      seg(mouth, dir0, 0.13 + R2() * 0.05, 0.0065, 0, start + 1);
      vases.push({ tips, table: vb[1], start, seed: it.seed, p });
    } else if (it.kind === 'incense') {
      const b0 = at(0, 0, 0), dish = new THREE.CylinderGeometry(0.032, 0.036, 0.014, 16); dish.translate(b0[0], b0[1] + 0.007, b0[2]);
      piece(dish, M.stone, p, b0, start, null, [0.22, 0.21, 0.2]);
      const lean = new THREE.Vector3((R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3).normalize(), st = new THREE.CylinderGeometry(0.0013, 0.0013, 0.2, 5); st.translate(0, 0.1, 0);
      st.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lean)); st.translate(b0[0], b0[1] + 0.012, b0[2]);
      piece(st, M.stick, p, b0, start + 0.5);
      const tip = [b0[0] + lean.x * 0.2, b0[1] + 0.012 + lean.y * 0.2, b0[2] + lean.z * 0.2];
      flames.push({ at: tip, size: 0.025, colour: 0xff6a2a, p, start, seed: it.seed, ember: true });
      smokes.push({ at: tip, p, start, seed: it.seed });
    } else if (it.kind === 'candle') {
      const b0 = at(0, 0, 0), c = new THREE.CylinderGeometry(0.026, 0.028, 0.07, 18); c.translate(b0[0], b0[1] + 0.035, b0[2]);
      piece(c, M.wax, p, b0, start);
      const wick = new THREE.CylinderGeometry(0.0009, 0.0011, 0.012, 4); wick.translate(b0[0], b0[1] + 0.074, b0[2]);
      piece(wick, M.stick, p, b0, start + 1, null, [0.15, 0.12, 0.1]);
      const top = [b0[0], b0[1] + 0.088, b0[2]];
      lights.push({ at: top, range: 0.95, power: 0.38, colour: 0xffb35c, p, start, seed: it.seed });
      flames.push({ at: top, size: 0.045, colour: 0xffb060, p, start, seed: it.seed });
      flames.push({ at: [top[0], top[1] - 0.009, top[2]], size: 0.011, p, start, seed: it.seed, tongue: true });
      if (!relit) pools.push({ at: [b0[0], b0[1] + 0.002, b0[2]], size: 0.5, p, start });
    }
  }

  // ---- what is built: the still parts merged (one mesh a material and a priority), the moving parts as sprites, points and instances
  let built = null, meshes = [], sprites = [], petals = null, smokePts = null, planAt = 0;
  function clear() {
    for (const m of meshes) { root.remove(m); m.geometry.dispose(); }
    for (const s of sprites) { root.remove(s); s.material.dispose(); }
    if (petals) { root.remove(petals); petals.geometry.dispose(); petals.material.dispose(); petals = null; }
    if (smokePts) { root.remove(smokePts); smokePts.geometry.dispose(); smokePts.material.dispose(); smokePts = null; }
    meshes = []; sprites = []; pieces.length = 0; lights.length = 0; flames.length = 0; vases.length = 0; smokes.length = 0; pools.length = 0;
  }
  function rebuild(plan) {
    clear();
    (plan.items || []).forEach((it, k) => build(it, k));
    const groups = new Map();
    for (const pc of pieces) { const key = `${pc.p}|${pc.mat.uuid}`; if (!groups.has(key)) groups.set(key, { mat: pc.mat, p: pc.p, geos: [] }); groups.get(key).geos.push(pc.geo); }
    for (const g of groups.values()) {
      const geo = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
      if (g.geos.length > 1) for (const x of g.geos) x.dispose();
      const m = new THREE.Mesh(geo, g.mat); m.userData.p = g.p; m.frustumCulled = false; root.add(m); meshes.push(m);
    }
    // the flames and glows (round: sprites), and on the PC view the pools of light on the floor (flat: they lie on it)
    for (const f of flames) {
      if (f.tongue) { const m = new THREE.Mesh(tongueGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); m.position.set(...f.at); m.userData.f = f; m.renderOrder = 3; root.add(m); sprites.push(m); continue; }
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tGlow, color: f.colour, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      s.position.set(...f.at); s.userData.f = f; s.renderOrder = 3; root.add(s); sprites.push(s);
    }
    for (const q of pools) {
      const m = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: tGlow, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      m.rotation.x = -Math.PI / 2; m.position.set(...q.at); m.scale.setScalar(q.size); m.userData.f = Object.assign({ pool: true }, q); root.add(m); sprites.push(m);
    }
    // the petals (falling and lying) and the smoke
    if (vases.length) {
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.006, 0.006, 0, 0.013); sh.quadraticCurveTo(-0.006, 0.006, 0, 0);
      petals = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh, 3), new THREE.MeshStandardMaterial({ color: 0xf7d6dd, emissive: 0xffd6de, emissiveIntensity: 0.15, roughness: 0.8, side: THREE.DoubleSide, transparent: true }), vases.length * 3);
      petals.frustumCulled = false; root.add(petals);
    }
    if (smokes.length) {
      const N = SMOKE * smokes.length, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1));
      // (each puff its own size: thin where it leaves the stick, wider as it rises and spreads)
      const mat = new THREE.PointsMaterial({ size: 1, map: tPuff, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('uniform float size;', 'uniform float size;\nattribute float aSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;'); };
      mat.customProgramCacheKey = () => 'jenga-smoke';
      smokePts = new THREE.Points(g, mat);
      smokePts.frustumCulled = false; root.add(smokePts);
    }
    built = plan;
  }

  // ---- every frame. plan: the document's jdeco; level: the Garden setting (0..2); t: the server's clock (s); wc: the world's clock (s, fx.js);
  // lightK: how much light the game lets the room have now (draw.js: low at the fall)
  const out = [], q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  function update({ plan, level = 2, t, wc, lightK = 1 }) {
    if (!plan || !plan.items) { if (built) { clear(); built = null; } root.visible = false; return; }
    if (plan !== built) { rebuild(plan); planAt = (plan.at || t * 1000) / 1000; }
    root.visible = level > 0;
    const show = (p) => level > 0 && p <= level - 1;
    const gt = t - planAt, wt = wc - planAt, grownBy = (start) => Math.max(0, Math.min(1, (gt - start) / GROW));
    U.grow.value = gt; U.wind.value = wt;
    for (const m of meshes) m.visible = show(m.userData.p);
    const flick = (seed, k) => 0.82 + 0.1 * Math.sin(t * 7.1 + seed % 17) + 0.06 * Math.sin(t * 12.7 + seed % 5) + 0.04 * Math.sin(t * 2.3 + k);
    sprites.forEach((s, k) => {
      const f = s.userData.f, on = show(f.p) ? grownBy(f.start + 3) : 0;
      s.visible = on > 0.01;
      if (!s.visible) return;
      if (f.pool) { s.material.opacity = 0.16 * on * lightK; return; }
      // (the candle's flame: it stretches and leans a little as the air moves)
      if (f.tongue) { const fl = flick(f.seed, k); s.scale.set(f.size * (0.9 + 0.1 * fl), f.size * (0.8 + 0.4 * fl), f.size * (0.9 + 0.1 * fl)); s.rotation.z = Math.sin(t * 1.9 + f.seed) * 0.06 + Math.sin(t * 5.3) * 0.03; s.material.opacity = on; return; }
      const fl = f.soft ? 0.9 + 0.1 * flick(f.seed, k) : flick(f.seed, k);
      s.scale.setScalar(f.size * (f.soft ? 1 : 0.85 + 0.25 * fl)); s.material.opacity = (f.soft ? 0.45 : f.ember ? 0.9 : 0.85) * fl * on * (f.soft ? lightK : 1);
    });
    M.paper.emissiveIntensity = 0.8 * (0.9 + 0.1 * flick(3, 0)) * (0.5 + 0.5 * lightK);
    // petals: one falls from a blossom every half minute or so, lies on the table a while, and fades
    if (petals) {
      let n = 0;
      vases.forEach((vz) => {
        const R = rand(vz.seed + 9), period = 24 + R() * 14, phase = R() * period, vis = show(vz.p) && grownBy(vz.start + 4) >= 1;
        for (let j = 0; j < 3; j++) {
          const life = (wt + phase + j * period / 3) % period, k = Math.floor((wt + phase + j * period / 3) / period), R2 = rand(vz.seed * 31 + k * 7 + j);
          const tip = vz.tips[Math.floor(R2() * vz.tips.length)] || null;
          if (!vis || !tip || life > 16) { m4.makeScale(0, 0, 0); petals.setMatrixAt(n++, m4); continue; }
          const fall = Math.min(1, life / 6), dx = (R2() - 0.5) * 0.12, dz = (R2() - 0.5) * 0.12, drift = Math.sin(life * 2.2 + j) * 0.02;
          v3.set(tip.x + dx * fall + drift, tip.y + (vz.table + 0.002 - tip.y) * (fall * fall * (3 - 2 * fall)), tip.z + dz * fall);
          e.set(fall < 1 ? life * 2.1 : -Math.PI / 2, life * 1.3 + j, fall < 1 ? life * 1.7 : 0); q.setFromEuler(e);
          const fade = life < 6 ? Math.min(1, life * 2) : Math.max(0, 1 - (life - 10) / 6);
          m4.compose(v3, q, sc.setScalar(Math.max(0.001, fade))); petals.setMatrixAt(n++, m4);
        }
      });
      petals.instanceMatrix.needsUpdate = true;
    }
    // smoke: from each glowing tip a thread that rises straight a hand's width, then breaks into slow curls that widen and fade
    if (smokePts) {
      const pos = smokePts.geometry.attributes.position, col = smokePts.geometry.attributes.color, sz = smokePts.geometry.attributes.aSize;
      smokes.forEach((sm, si) => {
        const vis = show(sm.p) ? grownBy(sm.start + 3) : 0, s7 = sm.seed % 7;
        for (let i = 0; i < SMOKE; i++) {
          const k = si * SMOKE + i, ph = ((wt * 0.075 + i / SMOKE) % 1 + 1) % 1, h = ph * 0.46, br = Math.max(0, ph - 0.22), turb = Math.pow(br, 1.3);
          // (the shape of the curl drifts with time, not with the puff, so the thread holds together as a ribbon)
          const cx = Math.sin(h * 19 - wt * 0.6 + s7) * 0.05 * turb + Math.sin(h * 41 - wt * 1.3) * 0.012 * turb + Math.sin(wt * 0.17 + s7) * 0.03 * ph * ph;
          const cz = Math.cos(h * 15 - wt * 0.5 + s7 * 2) * 0.04 * turb + Math.sin(wt * 0.13 + s7) * 0.02 * ph * ph;
          pos.setXYZ(k, sm.at[0] + cx + Math.sin(h * 60 + wt * 2) * 0.0008, sm.at[1] + h, sm.at[2] + cz);
          sz.setX(k, 0.016 + 0.1 * Math.pow(ph, 1.3));
          const a = vis * Math.min(1, ph * 30) * Math.pow(1 - ph, 2.2) * (0.09 - 0.06 * Math.min(1, ph * 2));
          col.setXYZ(k, a, a, a * 0.96);
        }
      });
      pos.needsUpdate = true; col.needsUpdate = true; sz.needsUpdate = true;
    }
    // the lights the lamps and candles throw on the real room (draw.js hands them to the engine)
    out.length = 0;
    lights.forEach((l, k) => { if (!show(l.p)) return; const on = grownBy(l.start + 3); if (on <= 0) return; out.push({ local: l.at, colour: l.colour, range: l.range, power: l.power * on * flick(l.seed, k) * lightK }); });
  }
  // this frame's lights in world coordinates
  const lw = [];
  function relights() {
    root.updateMatrixWorld();
    while (lw.length < out.length) lw.push({ at: new THREE.Vector3(), colour: 0, range: 0, power: 0 });
    return out.map((l, i) => { const w = lw[i]; w.at.set(...l.local).applyMatrix4(root.matrixWorld); w.colour = l.colour; w.range = l.range; w.power = l.power; return w; });
  }
  function dispose() { clear(); parent.remove(root); }
  return { root, update, relights, dispose };
}
