// The textures, made with canvas at start (an ES module; THREE is handed in): no picture files. Wood with its grain (and, as a normal map, its bump),
// the colour of a block as a stain in the wood and a stamped shape on its two ends, raked sand for the plinth, felt for the die's tray, washi paper for
// the scoreboard. The same seed makes the same texture on every page (a block is the same block for everybody).
//
// A block's atlas: one texture for the whole block, so that a block is one draw call. The long faces use the left 2/3, the two ends the right third.
export const ATLAS = { w: 768, h: 128, longU: [0, 512 / 768], endU: [512 / 768, 1] };

// ---- noise
const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s, oct = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, s + i * 17); a *= 0.5; f *= 2; } return v; }
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// a normal map from a height field (Float32Array w*h in 0..1), strength s
function normalFrom(THREE, hgt, w, h, s, wrapU = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), at = (x, y) => hgt[((y + h) % h) * w + (wrapU ? (x + w) % w : Math.max(0, Math.min(w - 1, x)))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * s, dy = (at(x, y - 1) - at(x, y + 1)) * s, l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    img.data[o] = (dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function colourTexture(THREE, canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// ---- shapes (the sign of a colour): drawn in a box of side 2r at (x, y)
export function drawShape(g, shape, x, y, r) {
  g.beginPath();
  if (shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === 'triangle') { g.moveTo(x, y - r); g.lineTo(x + r * 0.95, y + r * 0.8); g.lineTo(x - r * 0.95, y + r * 0.8); g.closePath(); }
  else if (shape === 'square') g.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  else if (shape === 'diamond') { g.moveTo(x, y - r); g.lineTo(x + r * 0.8, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.8, y); g.closePath(); }
  else if (shape === 'wave') { for (let k = 0; k < 3; k++) { g.moveTo(x - r, y + (k - 1) * r * 0.55); g.bezierCurveTo(x - r * 0.5, y + (k - 1) * r * 0.55 - r * 0.45, x, y + (k - 1) * r * 0.55 + r * 0.45, x + r, y + (k - 1) * r * 0.55); } g.lineWidth = r * 0.28; g.lineCap = 'round'; g.stroke(); return; }
  else if (shape === 'flower') { for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; g.moveTo(x, y); g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.3, a, 0, Math.PI * 2); } }
  g.fill();
}

// ---- wood: a block's atlas for one colour. opts: { colour (hex), shape, seed }
export function woodAtlas(THREE, opts) {
  const { w, h } = ATLAS, W = 512, E = 256, seed = opts.seed | 0;
  const col = document.createElement('canvas'); col.width = w; col.height = h;
  const g = col.getContext('2d'), img = g.createImageData(w, h), hgt = new Float32Array(w * h);
  const stain = rgb(opts.colour), pine = [232, 205, 160], dark = [150, 108, 62];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let height, tone;
    if (x < W) {                                    // the long faces: rings flowing along the block, pores and streaks
      const warp = fbm(x * 0.006, y * 0.03, seed) * 2.6, rings = 0.5 + 0.5 * Math.sin((y / h * 5.5 + warp) * Math.PI * 2);
      const streak = fbm(x * 0.05, y * 0.7, seed + 5), pore = vnoise(x * 0.35, y * 0.9, seed + 9) > 0.86 ? 0.25 : 0;
      height = Math.min(1, 0.5 * rings + 0.42 * streak + pore); tone = 0.15 + 0.85 * (1 - rings * 0.75) * (0.82 + 0.3 * streak);
    } else {                                        // the ends: growth rings seen from the end, off to one side
      const ex = x - W, cx = E / 4 + 20 * hash(seed, 3, 1), cy = -h * 0.6, d = Math.hypot(ex - cx, y - cy), warp = fbm(ex * 0.05, y * 0.05, seed + 2) * 3;
      const rings = 0.5 + 0.5 * Math.sin(d * 0.33 + warp * 2), grain = vnoise(ex * 0.6, y * 0.6, seed + 4);
      height = 0.6 * rings + 0.3 * grain; tone = 0.2 + 0.8 * (1 - rings * 0.55) * (0.85 + 0.25 * grain);
    }
    // the stain: wood tones with the colour soaked in (more in the soft part of the ring)
    const k = Math.min(1, Math.max(0, tone)), o = (y * w + x) * 4, soak = 0.62 + 0.25 * (1 - k);
    for (let c = 0; c < 3; c++) {
      const wood = lerp(dark[c], pine[c], k), v = lerp(wood, stain[c] * (0.55 + 0.55 * k), soak);
      img.data[o + c] = Math.max(0, Math.min(255, v));
    }
    img.data[o + 3] = 255; hgt[y * w + x] = height;
  }
  g.putImageData(img, 0, 0);
  // the stamp on both ends: a darker print of the colour's shape, engraved a little
  const hc = document.createElement('canvas'); hc.width = w; hc.height = h;
  const hg = hc.getContext('2d'), himg = hg.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = hgt[i] * 255; himg.data[i * 4 + 3] = 255; }
  hg.putImageData(himg, 0, 0);
  const ex = W + (w - W) / 2, ey = h / 2, r = 40;
  g.fillStyle = 'rgba(20,12,8,0.62)'; g.strokeStyle = 'rgba(20,12,8,0.62)'; drawShape(g, opts.shape, ex, ey, r);
  hg.fillStyle = '#202020'; hg.strokeStyle = '#202020'; drawShape(hg, opts.shape, ex, ey, r);
  const hd = hg.getImageData(0, 0, w, h).data, hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = hd[i * 4] / 255;
  return { map: colourTexture(THREE, col), normal: normalFrom(THREE, hf, w, h, 2.2) };
}

// ---- the plinth: raked sand round a stone (rings of fine lines round the tower), as a repeating tile of `tile` metres
export function sandTexture(THREE, seed = 4) {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const rake = 0.5 + 0.5 * Math.sin((y / n) * Math.PI * 2 * 22 + fbm(x * 0.01, y * 0.01, seed) * 1.5), grain = vnoise(x * 0.9, y * 0.9, seed + 1);
    const hgh = rake * 0.7 + grain * 0.3, o = (y * n + x) * 4, tone = 0.8 + 0.2 * hgh;
    img.data[o] = 218 * tone; img.data[o + 1] = 207 * tone; img.data[o + 2] = 184 * tone; img.data[o + 3] = 255; hgt[y * n + x] = hgh;
  }
  g.putImageData(img, 0, 0);
  const t = colourTexture(THREE, c, [1, 1]), nm = normalFrom(THREE, hgt, n, n, 2.5, true);
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map: t, normal: nm };
}

// ---- dark wood for the console, the frames and the plinth's sides (long grain, no stain)
export function darkWood(THREE, seed = 8, repeat = [1, 1]) {
  const w = 256, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const warp = fbm(x * 0.01, y * 0.04, seed) * 2.5, rings = 0.5 + 0.5 * Math.sin((y / h * 7 + warp) * Math.PI * 2), streak = fbm(x * 0.03, y * 0.8, seed + 3), o = (y * w + x) * 4, k = 0.55 + 0.45 * (1 - rings * 0.6) * (0.85 + 0.3 * streak);
    img.data[o] = 74 * k; img.data[o + 1] = 52 * k; img.data[o + 2] = 38 * k; img.data[o + 3] = 255; hgt[y * w + x] = 0.55 * rings + 0.45 * streak;
  }
  g.putImageData(img, 0, 0);
  const t = colourTexture(THREE, c, repeat), nm = normalFrom(THREE, hgt, w, h, 2, true);
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping; nm.repeat.set(repeat[0], repeat[1]); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map: t, normal: nm };
}

// ---- felt for the tray: fine fibres
export function feltTexture(THREE, seed = 12) {
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), hgt = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = fbm(x * 0.5, y * 0.5, seed, 3), o = (y * n + x) * 4;
    img.data[o] = 54 * (0.7 + 0.5 * f); img.data[o + 1] = 82 * (0.7 + 0.5 * f); img.data[o + 2] = 66 * (0.7 + 0.5 * f); img.data[o + 3] = 255; hgt[y * n + x] = f;
  }
  g.putImageData(img, 0, 0);
  const t = colourTexture(THREE, c, [4, 4]), nm = normalFrom(THREE, hgt, n, n, 1.5, true);
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping; nm.repeat.set(4, 4);
  return { map: t, normal: nm };
}

// ---- washi paper (a 2D canvas to draw on): fibres and a slight warmth
export function washi(g, w, h, seed = 3) {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = fbm(x * 0.07, y * 0.02, seed, 3), fib = vnoise(x * 0.4, y * 0.05, seed + 2), k = 0.9 + 0.1 * f - (fib > 0.8 ? 0.04 : 0), o = (y * w + x) * 4;
    img.data[o] = 247 * k; img.data[o + 1] = 240 * k; img.data[o + 2] = 224 * k; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
