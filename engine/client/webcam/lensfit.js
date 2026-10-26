// Working out how a camera's lens bends straight lines (lens.js: a1, a2) from pictures of the marker board that the screen shows (screencodes.js). No THREE and no DOM.
//
// The board is flat and its layout is known, so the corners of its markers seen through a perfect (pinhole) camera are a plane homography of the board's corners. A lens spoils that:
// the picture's corners are not a homography of the board's. For a candidate lens the picture corners of each snapshot are taken to ideal points (lens.toIdeal), a homography is fitted to
// them by least squares (webcam.homography), and the **reprojection errors in pixels** are summed over all snapshots. Levenberg-Marquardt over (a1, a2) minimises that, from several
// starting lenses. The focal length does not enter (lens.js normalises by the picture's diagonal), so the field of view is a by-product: webcam.fovFromPlane on the ideal points of each
// snapshot (it needs views that are not face-on), the median of the snapshots that give one; the page only shows it as a cross-check against the sheet.
//
//   fit(snapshots, { W, H, board })  snapshots: [{ markers: [{ id, corners: [[u, v] x 4] }] }] (the detector's output, the picture's own pixels); board: the layout that was on the screen
//                                    (screencodes.board(...)) -> { ok: true, a1, a2, rmsBefore, rmsAfter, fovDeg | null, n, why } | { ok: false, why }
//                                    `why` on an ok answer is 'no measurable distortion' when the lens made no real difference (a1 = a2 = 0 is then returned)
//   diversity(snapshots, { W, H, board })  -> { ok, why, usable }: at least 5 snapshots with at least 12 markers each, taken at distances that differ by a quarter, and with
//                                    markers that reach towards the edges of the picture (a lens shows at the edges)
(function (M) {
  const WC = () => M.webcam, LN = () => M.lens, SC = () => M.screencodes;
  const MIN_MARKERS = 12, MIN_SNAPSHOTS = 5, MIN_RATIO = 1.25, MIN_REACH = 0.5;
  const STARTS = [[0, 0], [-0.1, 0], [0.1, 0], [-0.2, 0.05], [0.2, -0.05], [-0.3, 0.1]];
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // what each snapshot gives: the board's corners and the picture's corners that go with them, for the markers the board has
  function prepare(snapshots, board) {
    const byId = new Map((board && board.markers ? board.markers : []).map((m) => [m.id, m])), out = [];
    for (const s of Array.isArray(snapshots) ? snapshots : []) {
      const src = [], dst = [], sides = [];
      for (const m of s && Array.isArray(s.markers) ? s.markers : []) {
        const b = byId.get(m && m.id);
        if (!b || !Array.isArray(m.corners) || m.corners.length !== 4 || !m.corners.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) continue;
        for (let i = 0; i < 4; i++) { src.push(SC().cornerPoint(b, i)); dst.push(m.corners[i]); }
        sides.push((Math.hypot(m.corners[1][0] - m.corners[0][0], m.corners[1][1] - m.corners[0][1]) + Math.hypot(m.corners[3][0] - m.corners[0][0], m.corners[3][1] - m.corners[0][1])) / 2);
      }
      if (src.length >= MIN_MARKERS * 4) out.push({ src, dst, side: median(sides) });
    }
    return out;
  }

  function diversity(snapshots, opts) {
    const data = prepare(snapshots, opts.board), W = opts.W, H = opts.H, R = 0.5 * Math.hypot(W, H);
    const total = Array.isArray(snapshots) ? snapshots.length : 0;
    if (data.length < MIN_SNAPSHOTS) return { ok: false, usable: data.length, why: total < MIN_SNAPSHOTS ? `At least ${MIN_SNAPSHOTS} snapshots are needed (there are ${total})` : `At least ${MIN_SNAPSHOTS} snapshots with ${MIN_MARKERS} markers or more are needed (${data.length} of ${total} have that many)` };
    const sides = data.map((d) => d.side);
    if (Math.max(...sides) < MIN_RATIO * Math.min(...sides)) return { ok: false, usable: data.length, why: 'The snapshots are alike: move the camera nearer, and then farther, between them' };
    let reach = 0;
    for (const d of data) for (const p of d.dst) reach = Math.max(reach, Math.hypot(p[0] - W / 2, p[1] - H / 2) / R);
    if (reach < MIN_REACH) return { ok: false, usable: data.length, why: 'The markers never come near the edges of the picture: bring the camera nearer, so that the board reaches the edges' };
    return { ok: true, usable: data.length, why: null };
  }

  // the residuals (dx, dy for every corner of every snapshot) for a lens, or null when the lens is not a lens
  function residuals(data, W, H, a1, a2) {
    const lens = { a1, a2, W, H };
    if (!LN().valid(lens)) return null;
    const res = [];
    for (const d of data) {
      const ideal = d.dst.map((p) => LN().toIdeal(lens, p[0], p[1])), Hm = WC().homography(d.src, ideal);
      if (!Hm) return null;
      for (let i = 0; i < d.src.length; i++) { const q = WC().applyH(Hm, d.src[i][0], d.src[i][1]); res.push(q[0] - ideal[i][0], q[1] - ideal[i][1]); }
    }
    return res;
  }
  const sumsq = (r) => { let s = 0; for (const v of r) s += v * v; return s; };

  function lm(data, W, H, start) {
    let th = start.slice(), r = residuals(data, W, H, th[0], th[1]);
    if (!r) return null;
    let c = sumsq(r), lam = 1e-3;
    for (let it = 0; it < 60; it++) {
      const h = 1e-5, J = [0, 1].map((k) => { const t = th.slice(); t[k] += h; const rk = residuals(data, W, H, t[0], t[1]); return rk ? rk.map((v, i) => (v - r[i]) / h) : null; });
      if (!J[0] || !J[1]) break;
      const a = sumsq(J[0]), b = J[0].reduce((s, v, i) => s + v * J[1][i], 0), d = sumsq(J[1]);
      const g0 = J[0].reduce((s, v, i) => s + v * r[i], 0), g1 = J[1].reduce((s, v, i) => s + v * r[i], 0);
      let moved = false;
      for (let tries = 0; tries < 12 && !moved; tries++) {
        const A = a * (1 + lam), D = d * (1 + lam), det = A * D - b * b;
        if (Math.abs(det) < 1e-30) { lam *= 10; continue; }
        const s0 = -(D * g0 - b * g1) / det, s1 = -(A * g1 - b * g0) / det, t = [th[0] + s0, th[1] + s1], rt = residuals(data, W, H, t[0], t[1]);
        if (rt && sumsq(rt) < c) { th = t; r = rt; const was = c; c = sumsq(rt); lam = Math.max(lam / 3, 1e-9); moved = Math.abs(s0) + Math.abs(s1) > 1e-10 || was - c > 1e-12; if (Math.abs(s0) + Math.abs(s1) < 1e-9) return { th, c }; }
        else lam *= 4;
      }
      if (!moved) break;
    }
    return { th, c };
  }

  function fit(snapshots, opts) {
    const W = opts && opts.W, H = opts && opts.H, board = opts && opts.board;
    if (!(W > 0 && H > 0) || !board || !Array.isArray(board.markers)) return { ok: false, why: 'The picture and the board are not known' };
    const div = diversity(snapshots, { W, H, board });
    if (!div.ok) return { ok: false, why: div.why };
    const data = prepare(snapshots, board), count = data.reduce((s, d) => s + d.src.length, 0);
    const rms = (r) => Math.sqrt(sumsq(r) / count);                // (per corner: the distance in pixels)
    const r0 = residuals(data, W, H, 0, 0);
    if (!r0) return { ok: false, why: 'The markers cannot be fitted to a flat board: is the board the one that was on the screen?' };
    let best = null;
    for (const s of STARTS) { const f = lm(data, W, H, s); if (f && (!best || f.c < best.c)) best = f; }
    if (!best) return { ok: false, why: 'The lens could not be worked out from these snapshots' };
    const before = rms(r0), after = Math.sqrt(best.c / count);
    const real = Math.abs(best.th[0]) >= 0.01 || Math.abs(best.th[1]) >= 0.01;
    const better = after < 0.85 * before && before - after > 0.3;
    let a1 = best.th[0], a2 = best.th[1], why = null;
    if (!real || !better) { a1 = 0; a2 = 0; why = 'no measurable distortion'; }
    if (Math.abs(a1) >= LN().LIMIT || Math.abs(a2) >= LN().LIMIT) return { ok: false, why: 'The distortion came out larger than a lens can have: the markers were probably misread. Try again with a steadier hand.' };
    const lens = { a1, a2, W, H }, fovs = [];
    for (const d of data) {
      const f = WC().fovFromPlane(d.src.map((p, i) => { const q = LN().toIdeal(lens, d.dst[i][0], d.dst[i][1]); return [p[0], p[1], q[0], q[1]]; }), W, H);
      if (Number.isFinite(f)) fovs.push(f * 180 / Math.PI);
    }
    return { ok: true, a1, a2, rmsBefore: before, rmsAfter: why ? before : after, fovDeg: fovs.length ? median(fovs) : null, n: data.length, why };
  }

  M.lensfit = { fit, diversity, MIN_MARKERS, MIN_SNAPSHOTS };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
