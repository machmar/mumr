// The textures, made with canvas at start (an ES module; THREE is handed in): no picture files. The same seed makes the same texture on every
// page (a block is the same block for everybody).
//
//   the blocks    pine with its grain, stained in the six colours (the soft wood soaks up more of the stain than the hard rings), the
//                 colour's sign burnt into both ends (a yakiin brand); one atlas per colour and variant, so a block is one draw call
//   yakisugi      charred cedar boards for the plinth: black, cracked into scales, with a silvery sheen on the scales
//   walnut        the console, the stands, the lantern's frame
//   hinoki        pale cypress: the plaques of the board, the plinth's rim
//   sand          raked in rings round the stone the tower stands on, out to the frame (karesansui)
//   felt          indigo, for the die's tray
//   washi         paper (a 2D canvas to draw on): fibres, flecks of bark, a warm cloudiness
//   seigaiha      the waves of the scroll's brocade
//   enso          the brush circle
// A block's atlas: one texture for the whole block. The long faces use the left 3/4, the two ends the right quarter.
export const ATLAS = { w: 1024, h: 256, longU: [0, 768 / 1024], endU: [768 / 1024, 1] };

// ---- noise
export const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
export function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, s, oct = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, s + i * 17); a *= 0.5; f *= 2; } return v; }
// the same noise, but repeating every `p` units in x and y (for tiles)
function tnoise(x, y, s, p) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi), m = (v) => ((v % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function tfbm(x, y, s, p, oct = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * tnoise(x * f, y * f, s + i * 17, p * f); a *= 0.5; f *= 2; } return v; }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
// a small seeded random (mulberry32)
export function rand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// a normal map from a height field (Float32Array w*h in 0..1), strength s; wrap: the field repeats (a tile)
function normalFrom(THREE, hgt, w, h, s, wrap = false) {
  const c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  const at = (x, y) => hgt[(wrap ? (y + h) % h : clamp(y, 0, h - 1)) * w + (wrap ? (x + w) % w : clamp(x, 0, w - 1))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * s, dy = (at(x, y + 1) - at(x, y - 1)) * s, l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    img.data[o] = (dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export function colourTexture(THREE, c, wrap = false) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const put = (img, o, r, g, b) => { img.data[o] = clamp(r, 0, 255); img.data[o + 1] = clamp(g, 0, 255); img.data[o + 2] = clamp(b, 0, 255); img.data[o + 3] = 255; };

// ---- shapes (the sign of a colour): drawn in a box of side 2r at (x, y)
export function drawShape(g, shape, x, y, r) {
  g.beginPath();
  if (shape === 'circle') g.arc(x, y, r * 0.92, 0, Math.PI * 2);
  else if (shape === 'triangle') { g.moveTo(x, y - r); g.lineTo(x + r * 0.95, y + r * 0.72); g.lineTo(x - r * 0.95, y + r * 0.72); g.closePath(); }
  else if (shape === 'square') g.rect(x - r * 0.76, y - r * 0.76, r * 1.52, r * 1.52);
  else if (shape === 'diamond') { g.moveTo(x, y - r); g.lineTo(x + r * 0.78, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.78, y); g.closePath(); }
  else if (shape === 'wave') {
    const lw = g.lineWidth; g.lineWidth = r * 0.26; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const yy = y + (k - 1) * r * 0.58; g.moveTo(x - r, yy); g.bezierCurveTo(x - r * 0.45, yy - r * 0.48, x + r * 0.05, yy + r * 0.48, x + r, yy); }
    g.stroke(); g.lineWidth = lw; return;
  } else if (shape === 'flower') { for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; g.moveTo(x, y); g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.3, a, 0, Math.PI * 2); } }
  g.fill();
}

// ---- a brand burnt into wood: a dark core with a scorched halo (on the colour canvas) and a dent (on the height canvas)
function brand(g, hg, shape, x, y, r) {
  g.save();
  g.filter = `blur(${Math.max(2, r * 0.12)}px)`; g.fillStyle = 'rgba(70,32,10,0.5)'; g.strokeStyle = g.fillStyle; drawShape(g, shape, x, y, r * 1.14);
  g.filter = `blur(${Math.max(1, r * 0.03)}px)`; g.fillStyle = 'rgba(28,14,6,0.92)'; g.strokeStyle = g.fillStyle; drawShape(g, shape, x, y, r);
  g.filter = 'none'; g.restore();
  if (hg) { hg.save(); hg.filter = `blur(${Math.max(1, r * 0.04)}px)`; hg.fillStyle = '#1a1a1a'; hg.strokeStyle = '#1a1a1a'; drawShape(hg, shape, x, y, r); hg.restore(); }
}

// ---- the blocks. The grain of a variant is worked out once; each colour stains it.
const grainCache = new Map();
function grain(variant) {
  if (grainCache.has(variant)) return grainCache.get(variant);
  const { w, h } = ATLAS, LW = 768, seed = 101 + variant * 31, late = new Float32Array(w * h), streak = new Float32Array(w * h), hgt = new Float32Array(w * h);
  const ringsN = 7 + variant * 1.6, cx = 256 * (0.3 + 0.4 * hash(variant, 1, 7)), cy = -h * (0.9 + 0.5 * hash(variant, 2, 7));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let lw, st, hh, i = y * w + x;
    if (x < LW) {                                       // the long faces: rings flowing along the block, gently cathedral'd, fine pores and streaks
      const u = x / LW, v = y / h, warp = fbm(u * 1.6, v * 1.2, seed) * 2.2 + 0.5 * Math.sin(u * 4.5 + variant) * (v - 0.5);
      const ph = (v * ringsN + warp) % 1, f = ph < 0 ? ph + 1 : ph;
      lw = sstep(0.72, 0.88, f) * (1 - sstep(0.92, 1, f));                // the latewood: a thin hard ring
      st = fbm(u * 60, v * 3.5, seed + 5, 3);
      const pore = vnoise(u * 300, v * 30, seed + 9) > 0.82 ? 1 : 0;
      hh = 0.65 - 0.4 * lw - 0.15 * pore + 0.1 * st;
    } else {                                            // the ends: growth rings seen from the end, round a pith off the block, and fine rays
      const ex = x - LW, d = Math.hypot(ex - cx, (y - cy) * 1.0), wv = fbm(ex * 0.02, y * 0.02, seed + 2) * 2.2;
      const ph = (d * 0.045 + wv) % 1;
      lw = sstep(0.6, 0.85, ph) * (1 - sstep(0.88, 1, ph));
      const ray = vnoise(Math.atan2(y - cy, ex - cx) * 160, d * 0.05, seed + 4);
      st = 0.5 + 0.5 * ray;
      hh = 0.55 - 0.3 * lw + 0.25 * (vnoise(ex * 0.8, y * 0.8, seed + 6) - 0.5);
    }
    late[i] = lw; streak[i] = st; hgt[i] = hh;
  }
  const out = { late, streak, hgt };
  grainCache.set(variant, out);
  return out;
}
// opts: { colour (hex), shape, variant }
export function blockAtlas(THREE, opts) {
  const { w, h } = ATLAS, LW = 768, E = 256, gr = grain(opts.variant || 0), c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  const st = rgb(opts.colour).map((v) => v / 255), lum = 0.3 * st[0] + 0.59 * st[1] + 0.11 * st[2];
  const pine = [236, 214, 178], hard = [186, 140, 92];
  for (let i = 0; i < w * h; i++) {
    const lw = gr.late[i], s = gr.streak[i], base = [0, 1, 2].map((k) => lerp(pine[k], hard[k], lw * 0.6 + (s - 0.5) * 0.3));
    // the stain: multiplied into the wood, stronger in the soft wood; a dark stain keeps a little of the wood's warmth
    const soak = 0.6 + 0.16 * (1 - lw), o = i * 4, grey = (base[0] + base[1] + base[2]) / 3;
    const col = [0, 1, 2].map((k) => { const stained = lerp(base[k], grey, 0.25) * Math.pow(st[k], 0.9) * (1.1 + 0.3 * (0.5 - lum)); return lerp(base[k], stained, soak); });
    put(img, o, col[0], col[1], col[2]);
  }
  g.putImageData(img, 0, 0);
  // the height field as a canvas, to burn the brand into
  const hc = canvas(w, h), hg = hc.getContext('2d'), himg = hg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = gr.hgt[i] * 255; himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = v; himg.data[i * 4 + 3] = 255; }
  hg.putImageData(himg, 0, 0);
  // a faint darkening along the long edges (the stain gathers where the faces meet), then the brand on the ends
  const eg = g.createLinearGradient(0, 0, 0, h); eg.addColorStop(0, 'rgba(30,15,5,0.16)'); eg.addColorStop(0.07, 'rgba(30,15,5,0)'); eg.addColorStop(0.93, 'rgba(30,15,5,0)'); eg.addColorStop(1, 'rgba(30,15,5,0.16)');
  g.fillStyle = eg; g.fillRect(0, 0, LW, h);
  brand(g, hg, opts.shape, LW + E / 2, h / 2, 64);
  const hd = hg.getImageData(0, 0, w, h).data, hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = hd[i * 4] / 255;
  return { map: colourTexture(THREE, c), normal: normalFrom(THREE, hf, w, h, 3) };
}

// ---- a face of the die: the same stained pine, the colour's sign burnt in the middle
export function dieFace(THREE, colour, shape, seed) {
  const n = 256, c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), st = rgb(colour).map((v) => v / 255);
  const hc = canvas(n, n), hg = hc.getContext('2d'), himg = hg.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const warp = fbm(x * 0.01, y * 0.004, seed) * 1.6, f = ((y / n) * 4 + warp) % 1, lw = sstep(0.62, 0.86, f) * (1 - sstep(0.9, 1, f)), s = fbm(x * 0.25, y * 0.02, seed + 3, 3);
    const o = (y * n + x) * 4, base = [0, 1, 2].map((k) => lerp([238, 216, 178][k], [168, 118, 70][k], lw * 0.75 + (s - 0.5) * 0.25));
    put(img, o, ...base.map((b, k) => lerp(b, b * Math.pow(st[k], 0.95) * 1.1, 0.74)));
    const hv = (0.65 - 0.4 * lw) * 255; himg.data[o] = himg.data[o + 1] = himg.data[o + 2] = hv; himg.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(himg, 0, 0);
  brand(g, hg, shape, n / 2, n / 2, 68);
  const hd = hg.getImageData(0, 0, n, n).data, hf = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) hf[i] = hd[i * 4] / 255;
  return { map: colourTexture(THREE, c), normal: normalFrom(THREE, hf, n, n, 3) };
}

// ---- yakisugi: a tile of four charred boards standing side by side (repeats)
export function yakisugi(THREE, seed = 21) {
  const n = 512, c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n), BOARDS = 4, bw = n / BOARDS;
  // the scales: cells of a grid stretched along the board, their edges the cracks
  const CX = 18, CY = 12;                                   // cells across a board, and along the tile
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const b = Math.floor(x / bw), bx = (x % bw) / bw;
    const px = bx * CX, py = (y / n) * CY * 3 + hash(b, 0, seed) * 7;
    let f1 = 9, f2 = 9;
    const ix = Math.floor(px), iy = Math.floor(py);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cxp = ix + i, cyp = iy + j, ox = hash(cxp, cyp + b * 97, seed), oy = hash(cxp + 31, cyp + b * 97, seed + 1);
      const dx = (cxp + ox - px), dy = (cyp + oy - py) * 0.55, d = Math.hypot(dx, dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const crack = 1 - sstep(0.02, 0.12, f2 - f1), bulge = sstep(0, 0.6, f2 - f1), gap = 1 - sstep(0, 0.035, Math.min(bx, 1 - bx));
    const nz = tfbm(x / 64, y / 64, seed + 3, 8, 3), o = (y * n + x) * 4;
    const k = clamp(0.5 + 0.35 * bulge - 0.4 * crack - 0.6 * gap + 0.3 * (nz - 0.5));
    put(img, o, lerp(12, 40, k), lerp(11, 36, k), lerp(10, 33, k));
    hgt[y * n + x] = clamp(0.4 + 0.3 * bulge - 0.35 * crack - 0.7 * gap + 0.1 * nz);
  }
  g.putImageData(img, 0, 0);
  return { map: colourTexture(THREE, c, true), normal: normalFrom(THREE, hgt, n, n, 1.8, true) };
}

// ---- long-grained wood as a tile (walnut, hinoki): tones [light, dark], how many growth rings across the tile. The grain runs along u.
function plankTile(THREE, { seed, light, dark, rings = 24, n = 512, pores = 0.12 }) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, warp = tfbm(u * 3, v * 3, seed, 3, 4) * 1.6;
    const f = ((v * rings + warp) % 1 + 1) % 1, lw = sstep(0.74, 0.88, f) * (1 - sstep(0.93, 1, f));
    const st = tfbm(u * 2, v * 48, seed + 5, 2, 3), pore = tnoise(u * 256, v * 96, seed + 9, 32) > 0.8 ? 1 : 0;
    const k = clamp(0.42 + 0.58 * (1 - lw * 0.42) * (0.72 + 0.56 * st) - pore * pores), o = (y * n + x) * 4;
    put(img, o, lerp(dark[0], light[0], k), lerp(dark[1], light[1], k), lerp(dark[2], light[2], k));
    hgt[y * n + x] = 0.6 - 0.25 * lw - 0.25 * pore + 0.1 * (st - 0.5);
  }
  g.putImageData(img, 0, 0);
  return { map: colourTexture(THREE, c, true), normal: normalFrom(THREE, hgt, n, n, 1.2, true) };
}
export const walnut = (THREE) => plankTile(THREE, { seed: 41, light: [118, 80, 56], dark: [58, 36, 24], rings: 22 });
export const hinoki = (THREE) => plankTile(THREE, { seed: 57, light: [214, 182, 136], dark: [172, 132, 88], rings: 30, pores: 0.05 });

// ---- the sand of the plinth: raked in rings round the stone (stone: its half size as a fraction of the sand's half size), out to the frame
export function sand(THREE, { stone = 0.25, rings = 13, seed = 4, n = 1024 } = {}) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n);
  const spacing = (1 - stone) / rings;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = (x + 0.5) / n * 2 - 1, py = (y + 0.5) / n * 2 - 1;
    const qx = Math.max(Math.abs(px) - stone, 0), qy = Math.max(Math.abs(py) - stone, 0);
    let d = Math.hypot(qx, qy) + (fbm(px * 3, py * 3, seed) - 0.5) * spacing * 0.35;          // (the rake's hand is not perfect)
    // further out, the rings turn towards the square of the frame
    const sq = Math.max(Math.abs(px), Math.abs(py)) - stone, blend = sstep(0.25, 0.85, Math.max(Math.abs(px), Math.abs(py)));
    d = lerp(d, sq, blend * 0.75);
    const ridge = 0.5 + 0.5 * Math.cos((d / spacing) * Math.PI * 2), tooth = 0.5 + 0.5 * Math.cos((d / spacing) * Math.PI * 2 * 3);
    const grainN = hash(x, y, seed + 1), speck = grainN > 0.985 ? -0.35 : grainN < 0.01 ? 0.2 : 0;
    const hh = d < 0 ? 0.5 : ridge * 0.75 + tooth * 0.12 + (grainN - 0.5) * 0.12, o = (y * n + x) * 4;
    const tone = 0.84 + 0.16 * hh + speck * 0.4 + (fbm(px * 6, py * 6, seed + 3) - 0.5) * 0.06;
    put(img, o, 226 * tone, 219 * tone, 204 * tone);
    hgt[y * n + x] = hh;
  }
  g.putImageData(img, 0, 0);
  return { map: colourTexture(THREE, c), normal: normalFrom(THREE, hgt, n, n, 3.2) };
}

// ---- felt for the tray: indigo fibres (repeats)
export function felt(THREE, seed = 12) {
  const n = 256, c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = tfbm(x / 8, y / 8, seed, 32, 3), fib = hash(x, y, seed + 2), o = (y * n + x) * 4, k = 0.75 + 0.4 * f + (fib - 0.5) * 0.18;
    put(img, o, 30 * k, 40 * k, 70 * k); hgt[y * n + x] = f;
  }
  g.putImageData(img, 0, 0);
  return { map: colourTexture(THREE, c, true), normal: normalFrom(THREE, hgt, n, n, 1.2, true) };
}

// ---- washi paper on a 2D canvas (x, y, w, h: where): a warm cloudiness, long kozo fibres, a few flecks of bark. tint: [r, g, b]
export function washi(g, w, h, seed = 3, tint = [246, 239, 224], x0 = 0, y0 = 0) {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = fbm(x * 0.012, y * 0.012, seed, 4), o = (y * w + x) * 4, k = 0.93 + 0.09 * f;
    put(img, o, tint[0] * k, tint[1] * k, tint[2] * k);
  }
  g.putImageData(img, x0, y0);
  const r = rand(seed * 7 + 1);
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.lineCap = 'round';
  for (let i = 0; i < (w * h) / 900; i++) {                // the fibres: thin curls, a little lighter or darker than the paper
    const x = x0 + r() * w, y = y0 + r() * h, a = r() * Math.PI * 2, L = 12 + r() * 60, bend = (r() - 0.5) * 30;
    g.strokeStyle = r() < 0.6 ? `rgba(255,252,244,${0.25 + r() * 0.35})` : `rgba(160,140,110,${0.06 + r() * 0.1})`; g.lineWidth = 0.6 + r() * 1.1;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L / 2 - Math.sin(a) * bend, y + Math.sin(a) * L / 2 + Math.cos(a) * bend, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  for (let i = 0; i < (w * h) / 40000; i++) { g.fillStyle = `rgba(110,85,55,${0.15 + r() * 0.25})`; g.beginPath(); g.ellipse(x0 + r() * w, y0 + r() * h, 0.8 + r() * 2.2, 0.5 + r() * 1, r() * 3, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// ---- seigaiha: overlapping waves, for the brocade round the scroll (on a 2D canvas, in the rect)
export function seigaiha(g, x0, y0, w, h, { ground = '#1d2740', line = 'rgba(205,170,98,0.55)', r = 22 } = {}) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = ground; g.fillRect(x0, y0, w, h);
  g.strokeStyle = line; g.lineWidth = Math.max(1, r * 0.07);
  for (let row = -1; row * r * 0.5 < h + r; row++) {
    const y = y0 + row * r * 0.5, off = (row % 2) * r;
    for (let x = x0 - 2 * r + off; x < x0 + w + 2 * r; x += 2 * r) {
      g.fillStyle = ground; g.beginPath(); g.arc(x, y + r, r, Math.PI, 0); g.fill();
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(x, y + r, r * (1 - (k - 1) * 0.28), Math.PI, 0); g.stroke(); }
    }
  }
  g.restore();
}

// ---- an ensō: the brush circle, drawn in many bristles (open at `gap`, from `from` round), in `colour`; t: how much of it is drawn (0..1)
export function enso(g, x, y, r, { seed = 7, colour = '20,16,14', width = r * 0.16, from = -Math.PI * 0.42, gap = 0.12, t = 1, alpha = 1 } = {}) {
  const rr = rand(seed), bristles = 26, sweep = (Math.PI * 2 - gap * Math.PI * 2) * t, steps = Math.max(8, Math.round(140 * t));
  for (let b = 0; b < bristles; b++) {
    const off = (rr() - 0.5) * width, dry = 0.55 + rr() * 0.6, a0 = rr() * 0.05;
    g.strokeStyle = `rgba(${colour},${(0.18 + rr() * 0.22) * alpha})`; g.lineWidth = width / bristles * 3.2 * (0.6 + rr() * 0.8); g.lineCap = 'round';
    g.beginPath();
    let drawing = false;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, a = from + a0 + u * sweep, press = Math.sin(Math.min(1, u * 6) * Math.PI / 2) * (1 - 0.65 * Math.pow(u, 2.2));       // (pressed in at the start, lifting at the end)
      const skip = u > dry && hash(b, i, seed) < (u - dry) * 2.2;                                                                               // (the brush runs dry: bristles drop out)
      const rad = r + off * press + Math.sin(u * 9 + b) * r * 0.008;
      if (skip) { drawing = false; continue; }
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (!drawing) { g.moveTo(px, py); drawing = true; } else g.lineTo(px, py);
    }
    g.stroke();
  }
}

// ---- soft round glow (white; coloured by the material), and a ring with soft edges, for sprites and floor glows
export function glow(THREE, n = 128, inner = 0) {
  const c = canvas(n, n), g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, inner * n / 2, n / 2, n / 2, n / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  return colourTexture(THREE, c);
}
// a soft puff (a gaussian with no bright core): smoke
export function puff(THREE, n = 64) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), o = (y * n + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = d < 1 ? Math.exp(-d * d * 4.5) * (1 - d * d) * 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return colourTexture(THREE, c);
}
export function softRing(THREE, n = 256, at = 0.82, width = 0.08) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), a = Math.exp(-Math.pow((d - at) / width, 2)) * (d < 1 ? 1 : 0), o = (y * n + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return colourTexture(THREE, c);
}
// a contact shadow: dark in the middle, fading out (for the floor under the furniture)
export function blobShadow(THREE, n = 128, square = false) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = Math.abs((x + 0.5) / n * 2 - 1), py = Math.abs((y + 0.5) / n * 2 - 1), d = square ? Math.hypot(Math.max(0, px - 0.55), Math.max(0, py - 0.55)) / 0.45 : Math.hypot(px, py);
    const a = Math.pow(clamp(1 - d), 1.8), o = (y * n + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0; img.data[o + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return colourTexture(THREE, c);
}

// ---- a strip of sand raked along its length (the garden at a wall's foot), as a tile repeating along u
export function rakedStrip(THREE, seed = 31) {
  const w = 512, h = 128, c = canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / h, edge = sstep(0, 0.08, v) * sstep(0, 0.08, 1 - v), wob = (tfbm(x / 64, y / 64, seed, 8, 3) - 0.5) * 0.06;
    const ridge = 0.5 + 0.5 * Math.cos((v + wob) * Math.PI * 2 * 6), grainN = hash(x, y, seed + 1);
    const hh = (ridge * 0.75 + (grainN - 0.5) * 0.15) * edge, tone = 0.86 + 0.14 * hh + (grainN > 0.985 ? -0.12 : 0), o = (y * w + x) * 4;
    put(img, o, 224 * tone, 216 * tone, 200 * tone); hgt[y * w + x] = hh;
  }
  g.putImageData(img, 0, 0);
  const map = colourTexture(THREE, c, true), normal = normalFrom(THREE, hgt, w, h, 3, true);
  return { map, normal };
}

