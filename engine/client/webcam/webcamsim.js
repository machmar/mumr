// A picture of the printed field-of-view sheet as a camera would see it, for the Node tests and for trying the webcam page without a camera or a printout.
// No THREE and no DOM: it returns a grey picture (a Uint8Array, W x H, 0 black to 255 white).
//
//   renderSheet(pose, opts) -> Uint8Array
//     pose   where the sheet is in front of the camera (markers.js sheetPose): { d, tilt, yaw, roll, left, up } (metres, degrees)
//     opts   W, H (1280 x 720), hfovDeg (70), noise (grey levels of noise, 3), seed (1), gradient (0.15: how much brighter one side of the picture is),
//            scale ({ sx, sy }: the sheet is shown that much of the printed size across and down; the pose is in real metres), ss (the picture is sampled ss x ss times a pixel, 3), cover: [ids] (those markers are painted over with paper),
//            flip: [{ id, r, c }] (those cells of a marker's code are inverted), paper (225), ink (22), table (70: what is round the sheet),
//            lens: { a1, a2 } (lens.js): the picture is what a camera with that lens shows (the straight sheet's edges are bent)
(function (M) {
  const WC = M.webcam, MK = M.markers, D2R = Math.PI / 180;
  const inv3 = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };

  function renderSheet(pose, opts = {}) {
    const W = opts.W || 1280, H = opts.H || 720, hfov = (opts.hfovDeg || 70) * D2R, noise = opts.noise === undefined ? 3 : opts.noise;
    const paper = opts.paper || 225, ink = opts.ink || 22, table = opts.table || 70, ss = opts.ss || 3, gradient = opts.gradient === undefined ? 0.15 : opts.gradient;
    const L = MK.SHEET, cover = new Set(opts.cover || []);
    const cells = MK.FOV_CODES.map((c) => MK.cellsOf(c));
    for (const f of opts.flip || []) cells[f.id][(f.r + 1) * 6 + (f.c + 1)] ^= 1;
    const P = MK.sheetPose(pose);
    const corners = [[0, 0], [L.page[0], 0], [L.page[0], L.page[1]], [0, L.page[1]]];
    const px = corners.map(([X, Y]) => MK.sheetToPicture(P, hfov, W, H, X, Y, opts.scale || null));      // (scale: { sx, sy }, a sheet shown smaller or stretched)
    const Hm = WC.homography(corners, px.map((p) => [p[0], p[1]])), Hi = inv3(Hm);
    let seed = (opts.seed || 1) >>> 0 || 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const value = (X, Y) => {
      if (X < 0 || Y < 0 || X > L.page[0] || Y > L.page[1]) return table;
      for (let k = 0; k < 4; k++) {
        const [mx, my] = L.pos[k];
        if (X >= mx && X < mx + L.side && Y >= my && Y < my + L.side) {
          if (cover.has(k)) return paper;
          const c = Math.min(5, Math.floor((X - mx) / L.side * 6)), r = Math.min(5, Math.floor((Y - my) / L.side * 6));
          return cells[k][r * 6 + c] ? ink : paper;
        }
      }
      return paper;
    };
    const img = new Uint8Array(W * H), offs = Array.from({ length: ss }, (_, i) => (i + 0.5) / ss);
    const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]), LNs = M.lens, lensFull = opts.lens ? { a1: opts.lens.a1 || 0, a2: opts.lens.a2 || 0, W, H } : null, bent = lensFull && !LNs.isNone(lensFull);
    const x0 = bent ? 0 : Math.max(0, Math.floor(Math.min(...xs)) - 2), x1 = bent ? W - 1 : Math.min(W - 1, Math.ceil(Math.max(...xs)) + 2);
    const y0 = bent ? 0 : Math.max(0, Math.floor(Math.min(...ys)) - 2), y1 = bent ? H - 1 : Math.min(H - 1, Math.ceil(Math.max(...ys)) + 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s;
      if (x < x0 || x > x1 || y < y0 || y > y1) s = table;
      else { s = 0; for (const a of offs) for (const b of offs) { const q = bent ? LNs.toIdeal(lensFull, x + a, y + b) : [x + a, y + b], [X, Y] = WC.applyH(Hi, q[0], q[1]); s += value(X, Y); } s /= ss * ss; }
      s = s * (1 + gradient * (x / W - 0.5)) + noise * gauss();
      img[y * W + x] = Math.max(0, Math.min(255, Math.round(s)));
    }
    return img;
  }

  // ---- the marker board that the calibration mode shows on a screen, seen by a camera with a lens
  // boardCorners(pose, lens, opts) -> [{ id, corners: [[u, v] x 4] }]: where the corners of every marker of the board are in the picture (the truth, plus noise), as the detector would give them
  //   pose   where the screen is in front of the camera (markers.js sheetPose): { d, tilt, yaw, roll, left, up } (metres, degrees); the screen is `screenW` metres wide
  //   lens   { a1, a2 } (lens.js): how the camera bends what it sees (the picture is the ideal one bent by it)
  //   opts   board (screencodes.board, required), W, H (1280 x 720), hfovDeg (70), screenW (0.34 m), noise (picture pixels, 0.5), seed (1),
  //          screen { w, h }: the screen's size in the board's pixels (default: the board's extent plus its margins)
  function boardCorners(pose, lens, opts) {
    const W = opts.W || 1280, H = opts.H || 720, hfov = (opts.hfovDeg || 70) * D2R, board = opts.board, screenW = opts.screenW || 0.34, noise = opts.noise === undefined ? 0.5 : opts.noise;
    const SCN = M.screencodes, LN = M.lens, P = MK.sheetPose(pose), lensFull = { a1: lens ? lens.a1 : 0, a2: lens ? lens.a2 : 0, W, H };
    const sw = opts.screen ? opts.screen.w : board.markers.reduce((m, b) => Math.max(m, b.x + b.side), 0) + board.markers.reduce((m, b) => Math.min(m, b.x), Infinity), sh = opts.screen ? opts.screen.h : board.markers.reduce((m, b) => Math.max(m, b.y + b.side), 0) + board.markers.reduce((m, b) => Math.min(m, b.y), Infinity);
    const mpp = screenW / sw;                                      // metres per board pixel (the board is centred on the screen: its extent plus its margins is the screen)
    let seed = (opts.seed || 1) >>> 0 || 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const out = [];
    for (const m of board.markers) {
      const corners = [];
      for (let i = 0; i < 4; i++) {
        const [x, y] = SCN.cornerPoint(m, i), X = (x - sw / 2) * mpp, Y = (y - sh / 2) * mpp;
        const Q = [P.O[0] + X * P.ex[0] + Y * P.ey[0], P.O[1] + X * P.ex[1] + Y * P.ey[1], P.O[2] + X * P.ex[2] + Y * P.ey[2]];
        const q = WC.project({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, hfov, W, H, Q);
        if (!(q[2] > 0.05)) { corners.length = 0; break; }                     // behind the camera
        const bent = LN.toPicture(lensFull, q[0], q[1]);
        if (!bent) { corners.length = 0; break; }
        corners.push([bent[0] + noise * gauss(), bent[1] + noise * gauss()]);
      }
      // a marker that is not whole in the picture is not detected (as markers.detect)
      if (corners.length === 4 && corners.every((c) => c[0] > 2 && c[1] > 2 && c[0] < W - 3 && c[1] < H - 3)) out.push({ id: m.id, corners });
    }
    return out;
  }

  M.webcamsim = { renderSheet, boardCorners };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
