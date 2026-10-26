// Printed square markers (ArUco style: a black border, then 4 x 4 black or white cells that say which marker it is) and a detector for them. No THREE
// and no DOM: the detector takes a grey picture (a Uint8Array, W x H) and says where each marker's corners are, to better than a pixel.
//
// A marker is 6 x 6 cells: the outer ring is black, the inner 4 x 4 are the code (bit r * 4 + c of the code is the cell in row r, column c; 1 = black).
// The four codes of the field-of-view sheet were searched so that no two of them, in any of the four turns, are closer than 6 bits (and none looks like
// its own turned copy), so a marker read with one wrong cell is still unambiguous, and a turned one says which way up it is.
//
//   detect(gray, W, H, opts?) -> [{ id, corners: [[u, v] x 4], size }]   corners in the marker's own order: top left, top right, bottom right,
//                                                                          bottom left (as printed), whichever way up it is seen
//   cellsOf(code)              the 6 x 6 cells of a marker, for drawing it
//   cornerMM(k, i), sheetPose(p), sheetToPicture(pose, hfov, W, H, Xmm, Ymm)   where the sheet's marker corners are, and where the sheet is in front of a camera
(function (M) {
  const WC = M.webcam, D2R = Math.PI / 180;
  const FOV_CODES = [14858, 39031, 50870, 56793];        // ids 0..3 of the field-of-view sheet: top left, top right, bottom right, bottom left
  // The printed field-of-view sheet (tools/make_align_sheets.py: FOV_MARKER_MM, FOV_MARKER_POS_MM; a test keeps the two in step): the page, and the
  // markers' side and top left corners, all in millimetres, on the printed side, ids in the order of FOV_CODES.
  const SHEET = { page: [210, 297], side: 44, pos: [[8, 8], [158, 8], [158, 245], [8, 245]] };
  const L = SHEET;
  const pop = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

  // the 6 x 6 cells of a code, row by row: 1 = black
  function cellsOf(code) {
    const cells = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) cells.push(r === 0 || c === 0 || r === 5 || c === 5 ? 1 : (code >> ((r - 1) * 4 + (c - 1))) & 1);
    return cells;
  }

  // ---- the picture to black and white: a pixel is dark when it is clearly darker than the mean of its neighbourhood
  function darkMask(gray, W, H, win, C) {
    const I = new Uint32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    const r = win >> 1, dark = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        if (gray[y * W + x] * ((x1 - x0) * (y1 - y0)) < sum - C * ((x1 - x0) * (y1 - y0))) dark[y * W + x] = 1;
      }
    }
    return dark;
  }

  // ---- the convex hull of points (monotone chain), counter-clockwise in a y-up picture
  function hull(P) {
    P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  const polyArea = (Q) => { let a = 0; for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

  // the four corners of a convex shape that is nearly a quadrilateral: the two hull points furthest apart are opposite corners, the other two are the
  // hull points furthest from the line between them, on each side. Returned clockwise on the screen (y down).
  function quadOf(Hl) {
    if (Hl.length < 4) return null;
    let bi = 0, bj = 1, bd = -1;
    for (let i = 0; i < Hl.length; i++) for (let j = i + 1; j < Hl.length; j++) { const d = (Hl[i][0] - Hl[j][0]) ** 2 + (Hl[i][1] - Hl[j][1]) ** 2; if (d > bd) { bd = d; bi = i; bj = j; } }
    const A = Hl[bi], B = Hl[bj], dx = B[0] - A[0], dy = B[1] - A[1];
    let C = null, D = null, cd = 0, dd = 0;
    for (const p of Hl) { const s = dx * (p[1] - A[1]) - dy * (p[0] - A[0]); if (s > cd) { cd = s; C = p; } if (-s > dd) { dd = -s; D = p; } }
    if (!C || !D) return null;
    const Q = [A, C, B, D];
    if (polyArea(Q) < 0) Q.reverse();                 // (screen y is down: a positive area here is clockwise on the screen)
    return Q;
  }

  // the least-squares line through points: [px, py, dx, dy] (a point on it and its direction)
  function fitLine(P) {
    const n = P.length, mx = P.reduce((s, p) => s + p[0], 0) / n, my = P.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of P) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; sxy += x * y; syy += y * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [mx, my, Math.cos(th), Math.sin(th)];
  }
  function meet(l, m) {
    const det = l[2] * -m[3] - l[3] * -m[2];
    if (Math.abs(det) < 1e-9) return null;
    const bx = m[0] - l[0], by = m[1] - l[1], t = (bx * -m[3] - by * -m[2]) / det;
    return [l[0] + t * l[2], l[1] + t * l[3]];
  }

  // the corners moved onto the straight edges of the dark shape: a line is fitted to the boundary pixels along each side and neighbours are intersected
  function refine(Q, boundary) {
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = Q[i], b = Q[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 8) return null;
      const near = [];
      for (const p of boundary) {
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len), off = Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
        if (t > 0.12 && t < 0.88 && off < Math.max(2.5, len * 0.04)) near.push(p);
      }
      if (near.length < 6) return null;
      lines.push(fitLine(near));
    }
    // The boundary pixels are the outermost DARK pixels, so the true edge is half a pixel further out than the line through their centres:
    // move each line that far away from the middle of the shape. (And the picture's pixel x covers [x, x + 1): its centre is x + 0.5.)
    const mx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, my = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4;
    for (const l of lines) {
      let nx = -l[3], ny = l[2];
      if (nx * (l[0] - mx) + ny * (l[1] - my) < 0) { nx = -nx; ny = -ny; }
      l[0] += nx * 0.5; l[1] += ny * 0.5;
    }
    const out = [];
    for (let i = 0; i < 4; i++) { const p = meet(lines[(i + 3) % 4], lines[i]); if (!p) return null; out.push([p[0] + 0.5, p[1] + 0.5]); }
    return out;
  }

  // the square [0, 6] x [0, 6] to the quadrilateral Q (corners in order): the projective map as 8 numbers
  function squareToQuad(Q, s) {
    const [x0, y0] = Q[0], [x1, y1] = Q[1], [x2, y2] = Q[2], [x3, y3] = Q[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
    const k = 1 / s;
    return { a: (x1 - x0 + g * x1) * k, b: (x3 - x0 + h * x3) * k, c: x0, d: (y1 - y0 + g * y1) * k, e: (y3 - y0 + h * y3) * k, f: y0, g: g * k, h: h * k };
  }
  const mapSq = (M, u, v) => { const w = M.g * u + M.h * v + 1; return [(M.a * u + M.b * v + M.c) / w, (M.d * u + M.e * v + M.f) / w]; };

  // read the 6 x 6 cells of the shape Q (corners in order, starting wherever) and say which code it is, if it is a marker
  function readCells(gray, W, H, Q) {
    const M = squareToQuad(Q, 6); if (!M) return null;
    const avg = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      let s = 0, n = 0;
      for (const du of [0.3, 0.5, 0.7]) for (const dv of [0.3, 0.5, 0.7]) {
        const [x, y] = mapSq(M, c + du, r + dv), xi = Math.floor(x), yi = Math.floor(y);
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
        s += gray[yi * W + xi]; n++;
      }
      avg.push(s / n);
    }
    const border = [], inner = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) (r === 0 || c === 0 || r === 5 || c === 5 ? border : inner).push(avg[r * 6 + c]);
    const dk = border.reduce((s, v) => s + v, 0) / border.length, wh = Math.max(...inner);
    if (wh - dk < 40) return null;                                   // no contrast: not a printed marker
    const thr = (dk + wh) / 2;
    if (border.some((v) => v > thr)) return null;                    // the ring is black all round
    let code = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (avg[(r + 1) * 6 + c + 1] < thr) code |= 1 << (r * 4 + c);
    return code;
  }

  // opts: { codes: the dictionary (default: the field-of-view sheet's), maxBits: wrong cells allowed (1), win, C: the threshold, minSide (px, 14), maxSide,
  //         prefer: 'largest' (of each id the biggest copy, not the best read: for a screen that shows the camera's own picture, where every nested copy is smaller) }
  function detect(gray, W, H, opts = {}) {
    const codes = opts.codes || FOV_CODES, maxBits = opts.maxBits === undefined ? 1 : opts.maxBits;
    const win = opts.win || 25, C = opts.C === undefined ? 7 : opts.C, minSide = opts.minSide || 14, maxSide = opts.maxSide || Math.min(W, H);
    const dark = darkMask(gray, W, H, win, C);
    const lab = new Int32Array(W * H), stack = new Int32Array(W * H), found = [];
    let next = 0;
    for (let s = 0; s < W * H; s++) {
      if (!dark[s] || lab[s]) continue;
      const id = ++next; let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = s; lab[s] = id;
      while (sp) {
        const p = stack[--sp], x = p % W, y = (p / W) | 0; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && dark[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && dark[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && dark[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && dark[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw < minSide || bh < minSide || bw > maxSide * 1.5 || bh > maxSide * 1.5 || area < minSide * minSide * 0.5) continue;
      if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) continue;           // (touching the edge of the picture: not whole)
      // the boundary of this shape
      const boundary = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * W + x;
        if (lab[p] === id && (lab[p - 1] !== id || lab[p + 1] !== id || lab[p - W] !== id || lab[p + W] !== id)) boundary.push([x, y]);
      }
      const Hl = hull(boundary), Q0 = quadOf(Hl);
      if (!Q0 || Math.abs(polyArea(Q0)) < 0.85 * Math.abs(polyArea(Hl))) continue;   // not a quadrilateral
      const Q = refine(Q0, boundary);
      if (!Q) continue;
      let hit = null;
      for (let k = 0; k < 4 && !hit; k++) {
        const R = [Q[k], Q[(k + 1) % 4], Q[(k + 2) % 4], Q[(k + 3) % 4]], code = readCells(gray, W, H, R);
        if (code === null) continue;
        for (let i = 0; i < codes.length; i++) if (pop(code ^ codes[i]) <= maxBits) { hit = { id: i, corners: R, bits: pop(code ^ codes[i]) }; break; }
      }
      if (hit) found.push({ id: hit.id, corners: hit.corners, bits: hit.bits, size: Math.sqrt(Math.abs(polyArea(hit.corners))) });
    }
    // one of each id (the better read), left to right
    const best = new Map();
    const largest = opts.prefer === 'largest';
    for (const m of found) { const o = best.get(m.id); if (!o || (largest ? m.size > o.size : m.bits < o.bits || (m.bits === o.bits && m.size > o.size))) best.set(m.id, m); }
    return [...best.values()].sort((a, b) => a.id - b.id);
  }

  // ---- the sheet
  // marker k's corner i (0 top left, 1 top right, 2 bottom right, 3 bottom left), in millimetres on the sheet
  const cornerMM = (k, i) => { const [x, y] = L.pos[k], s = L.side; return [[x, y], [x + s, y], [x + s, y + s], [x, y + s]][i]; };

  // ---- where the sheet is, in front of a camera at the origin looking along +x (x forward, y left, z up): d metres away, leaning back by tilt (its top
  // edge further than its bottom), turned about the vertical by yaw, rolled about the line of sight, and shifted left and up (metres). Angles in degrees.
  function sheetPose(p) {
    const tilt = (p.tilt || 0) * D2R, yaw = (p.yaw || 0) * D2R, roll = (p.roll || 0) * D2R;
    const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
    const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
    let ex = [0, -1, 0], ey = [-Math.sin(tilt), 0, -Math.cos(tilt)];      // printed right, printed down
    ex = rotX(rotZ(ex, yaw), roll); ey = rotX(rotZ(ey, yaw), roll);
    return { O: [p.d, p.left || 0, p.up || 0], ex, ey };
  }
  // a point of the sheet (millimetres) in the picture: [u, v, depth]
  // scale: { sx, sy } when the sheet is not the printed size (a phone shows it small, maybe stretched): how much bigger than the printed one it is across and down
  function sheetToPicture(pose, hfov, W, H, Xmm, Ymm, scale) {
    const sx = scale ? scale.sx : 1, sy = scale ? scale.sy : 1;
    const x = (Xmm - L.page[0] / 2) * sx / 1000, y = (Ymm - L.page[1] / 2) * sy / 1000;
    const P = [pose.O[0] + x * pose.ex[0] + y * pose.ey[0], pose.O[1] + x * pose.ex[1] + y * pose.ey[1], pose.O[2] + x * pose.ex[2] + y * pose.ey[2]];
    return WC.project({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, hfov, W, H, P);
  }

  M.markers = { FOV_CODES, SHEET, cellsOf, detect, cornerMM, sheetPose, sheetToPicture };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
