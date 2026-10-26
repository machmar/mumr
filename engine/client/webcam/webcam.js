// Where a fixed webcam stands, from where the player clicked the floor spots in its picture. No THREE and no DOM.
//
// Frame: the headset's own floor frame, as everywhere in the mixed-reality page: x, y on the floor, z up (m).
// A camera is { x, y, z, yaw, pitch }: its position, the heading of its optical axis on the floor (rad, from +x
// towards +y) and its tilt (rad, negative = looking down). It is held level: no roll (a tripod or a desk).
// The picture is W x H pixels, the principal point is its centre, the horizontal field of view is `hfov` (rad).
(function (M) {
  const D2R = Math.PI / 180;
  const fpx = (W, hfov) => (W / 2) / Math.tan(hfov / 2);

  // The camera's right, up and forward vectors in the floor frame.
  function basis(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [cp * cy, cp * sy, sp], r = [sy, -cy, 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { f, r, u };
  }
  // Where the 3D point P (floor frame) lands in the picture: [u, v, depth]; depth <= 0: behind the camera.
  function project(cam, hfov, W, H, P) {
    const b = basis(cam.yaw, cam.pitch), d = [P[0] - cam.x, P[1] - cam.y, (P[2] || 0) - cam.z];
    const xc = d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2];
    const yc = d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2];
    const zc = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2];
    const k = fpx(W, hfov);
    return [W / 2 + k * xc / zc, H / 2 - k * yc / zc, zc];
  }

  // The camera's pose from clicks: pts[i] = [x, y, z] on the floor, px[i] = [u, v] where it was clicked.
  //   opts.hfov  (rad)  opts.W, opts.H  (pixels)
  //   opts.known  { x, y, z } any of them: kept fixed (a lens touched by a fingertip gives all three; a typed height gives z)
  // Needs three points that are not in a line, or a known position (or at least a known height, with two points).
  // -> { ok: true, cam, rms (px), per: [px error of each click], alts: [{ cam, rms, per }] } or { ok: false, why }
  // alts: other places the camera could be that fit almost as well (usually none).
  const FREE = ['x', 'y', 'z', 'yaw', 'pitch'];
  function solve(pts, px, opts) {
    const { hfov, W, H } = opts, known = opts.known || {};
    const n = pts.length;
    if (n < 2 || px.length !== n) return { ok: false, why: 'need at least two clicks' };
    const free = FREE.filter((k) => !(k in known));
    const nEq = 2 * n;
    if (nEq < free.length) {
      return { ok: false, why: known.z === undefined ? 'with two spots the camera height must be known: click the check spot too' : 'not enough clicks' };
    }
    if (n === 3 && !('x' in known) && !('z' in known)) {
      // three spots in a line cannot tell how high the camera is
      const [a, b, c] = pts, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const off = Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / len;
      if (off < 0.3) return { ok: false, why: 'the three spots are nearly in a line: the height is then ambiguous' };
    }
    const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n, cz = pts.reduce((s, p) => s + (p[2] || 0), 0) / n;
    const resid = (cam) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const q = project(cam, hfov, W, H, pts[i]);
        if (!(q[2] > 0.05)) return null;
        out.push(q[0] - px[i][0], q[1] - px[i][1]);
      }
      return out;
    };
    const toCam = (v) => { const c = Object.assign({}, known); free.forEach((k, i) => { c[k] = v[i]; }); return c; };
    const cost = (r) => r.reduce((s, e) => s + e * e, 0);
    // Levenberg-Marquardt on the free parameters, a numeric Jacobian.
    function refine(v) {
      let r = resid(toCam(v)); if (!r) return null;
      let c = cost(r), lambda = 1e-2;
      for (let it = 0; it < 80; it++) {
        const m = free.length, J = [];
        for (let j = 0; j < m; j++) {
          const h = free[j] === 'yaw' || free[j] === 'pitch' ? 1e-6 : 1e-5, w = v.slice(); w[j] += h;
          const r2 = resid(toCam(w)); if (!r2) return null;
          J.push(r2.map((e, i) => (e - r[i]) / h));
        }
        const A = [], g = [];
        for (let a = 0; a < m; a++) {
          A.push([]); g.push(0);
          for (let b = 0; b < m; b++) A[a].push(J[a].reduce((s, e, i) => s + e * J[b][i], 0));
          g[a] = -J[a].reduce((s, e, i) => s + e * r[i], 0);
        }
        let improved = false;
        for (let tries = 0; tries < 12; tries++) {
          const B = A.map((row, a) => row.map((e, b) => e + (a === b ? lambda * (e + 1e-9) : 0)));
          const dv = gauss(B, g); if (!dv) { lambda *= 10; continue; }
          const w = v.map((e, i) => e + dv[i]), r2 = resid(toCam(w));
          if (r2 && cost(r2) < c) { v = w; r = r2; const done = c - cost(r2) < 1e-10; c = cost(r2); lambda = Math.max(1e-9, lambda / 5); improved = true; if (done) return { v, c, r }; break; }
          lambda *= 10;
        }
        if (!improved) break;
      }
      return { v, c, r };
    }
    const found = [];
    const heights = 'z' in known ? [known.z] : [0.5, 1.0, 1.6];
    for (let bearing = 0; bearing < 360; bearing += 30) {
      for (const dist of [1.5, 3, 5]) {
        for (const hz of heights) {
          const sx = cx + dist * Math.cos(bearing * D2R), sy = cy + dist * Math.sin(bearing * D2R);
          const camz = hz + (known.z === undefined ? cz : 0);
          const sx2 = 'x' in known ? known.x : sx, sy2 = 'y' in known ? known.y : sy, sz = 'z' in known ? known.z : camz;
          const yaw = Math.atan2(cy - sy2, cx - sx2), pitch = Math.atan2(cz - sz, Math.hypot(cx - sx2, cy - sy2));
          const start = { x: sx2, y: sy2, z: sz, yaw, pitch };
          const res = refine(free.map((k) => start[k]));
          if (!res) continue;
          const cam = toCam(res.v);
          if (cam.z <= cz + 0.02) continue;                  // the camera is above the floor it looks at
          found.push({ c: res.c, cam, r: res.r });
        }
      }
    }
    if (!found.length) return { ok: false, why: 'no camera position fits these clicks' };
    found.sort((a, b) => a.c - b.c);
    // Distinct places the camera could be (nearer than 0.5 m is the same place): from the front of the sorted list.
    const places = [];
    for (const f of found) if (places.every((p) => Math.hypot(p.cam.x - f.cam.x, p.cam.y - f.cam.y, p.cam.z - f.cam.z) > 0.5)) places.push(f);
    const shape = (f) => {
      const per = []; for (let i = 0; i < n; i++) per.push(Math.hypot(f.r[2 * i], f.r[2 * i + 1]));
      return { cam: Object.assign({}, f.cam, { yaw: Math.atan2(Math.sin(f.cam.yaw), Math.cos(f.cam.yaw)) }), rms: Math.sqrt(f.c / n), per };
    };
    const best = shape(places[0]);
    // another place that fits almost as well: the clicks alone cannot say which one is right (a camera low over the
    // floor sees the same picture from two sides). The page then asks which.
    best.alts = places.slice(1).map(shape).filter((a) => a.rms <= Math.max(2 * best.rms, 2));
    best.ok = true;
    return best;
  }
  // Solve B x = g by Gaussian elimination with pivoting; null when singular.
  function gauss(B, g) {
    const m = g.length, M = B.map((row, i) => row.concat([g[i]]));
    for (let c = 0; c < m; c++) {
      let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < m; r++) { const k = M[r][c] / M[c][c]; for (let j = c; j <= m; j++) M[r][j] -= k * M[c][j]; }
    }
    const x = new Array(m).fill(0);
    for (let r = m - 1; r >= 0; r--) { let s = M[r][m]; for (let j = r + 1; j < m; j++) s -= M[r][j] * x[j]; x[r] = s / M[r][r]; }
    return x;
  }

  // The homography H (9 numbers, row-major, H[8] = 1) that takes plane points [x, y] to picture points [u, v]: least squares over
  // all pairs (at least four), with the usual normalisation of both sets so that metres and pixels do not fight. null: degenerate.
  function homography(src, dst) {
    const n = src.length;
    if (n < 4 || dst.length !== n) return null;
    const norm = (P) => {
      const cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n;
      const d = P.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1, k = Math.SQRT2 / d;
      return { k, cx, cy, pts: P.map((p) => [(p[0] - cx) * k, (p[1] - cy) * k]) };
    };
    const S = norm(src), T = norm(dst);
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    const add = (row, rhs) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
    for (let i = 0; i < n; i++) {
      const [X, Y] = S.pts[i], [x, y] = T.pts[i];
      add([X, Y, 1, 0, 0, 0, -x * X, -x * Y], x);
      add([0, 0, 0, X, Y, 1, -y * X, -y * Y], y);
    }
    const h = gauss(AtA, Atb); if (!h) return null;
    // H = Tdst^-1 * Hn * Tsrc
    const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    const Ts = [S.k, 0, -S.k * S.cx, 0, S.k, -S.k * S.cy, 0, 0, 1], Ti = [1 / T.k, 0, T.cx, 0, 1 / T.k, T.cy, 0, 0, 1];
    const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
    const H = mul(Ti, mul(Hn, Ts)), s = H[8] || 1;
    return H.map((v) => v / s);
  }
  const applyH = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };

  // The horizontal field of view (rad) from a picture of a flat thing of known size lying at an angle to the lens.
  // pairs: [[X, Y, u, v], ...] at least four: a point of the plane (metres) and where it is in the picture (pixels). The principal
  // point is the centre of the W x H picture and the pixels are square. null: the plane faces the lens (a flat-on picture says
  // nothing about the focal length) or the points are degenerate.
  function fovFromPlane(pairs, W, H) {
    const Hm = homography(pairs.map((p) => [p[0], p[1]]), pairs.map((p) => [p[2] - W / 2, p[3] - H / 2]));
    if (!Hm) return null;
    const h1 = [Hm[0], Hm[3], Hm[6]], h2 = [Hm[1], Hm[4], Hm[7]];       // the first two columns of the homography (x, y, w)
    const d1 = h1[2] * h2[2], n1 = h1[0] * h2[0] + h1[1] * h2[1];
    const d2 = h2[2] * h2[2] - h1[2] * h1[2], n2 = h1[0] * h1[0] + h1[1] * h1[1] - h2[0] * h2[0] - h2[1] * h2[1];
    // h1 . h2 = 0 and |h1| = |h2| under K^-1, with K = diag(f, f, 1):  f^2 = -n1 / d1  and  f^2 = n2 / d2
    const f2a = Math.abs(d1) > 1e-12 ? -n1 / d1 : NaN, f2b = Math.abs(d2) > 1e-12 ? n2 / d2 : NaN;
    const pick = Math.abs(d1) >= Math.abs(d2) ? [f2a, f2b] : [f2b, f2a];
    const f2 = pick.find((e) => Number.isFinite(e) && e > 0);
    if (!f2) return null;
    return 2 * Math.atan((W / 2) / Math.sqrt(f2));
  }
  // The same from the four corners of a rectangle w x h: corners in the order [0, 0], [w, 0], [w, h], [0, h] of the rectangle (u, v pixels).
  function fovFromRect(corners, w, h, W, H) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    return fovFromPlane(src.map((p, i) => [p[0], p[1], corners[i][0], corners[i][1]]), W, H);
  }

  M.webcam = { project, basis, solve, fovFromRect, fovFromPlane, homography, applyH, fpx };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
