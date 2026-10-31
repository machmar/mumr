// How a camera's lens bends straight lines, as two numbers, and the maths to go between the picture the camera gives and the ideal (pinhole) picture the overlay is drawn in.
// No THREE and no DOM. The camera's picture is never straightened: the overlay is bent to match it (overlaylens.js, the shader below).
//
// A lens is { a1, a2, W, H } (W x H: the picture's size in pixels). A picture point (u, v) is made normalised, p = ((u - W/2), (v - H/2)) / R, R = the half diagonal of the picture
// (so every point of the picture is within 1 of the centre, and a1, a2 do not depend on the field of view), and the ideal point is
//     p_ideal = p * (1 + a1 r^2 + a2 r^4),   r = |p|.
// Barrel distortion (straight lines bulge outwards, a wide-angle webcam) has a1 < 0 in this direction: the ideal point is nearer the centre than the picture's.
//
//   toIdeal(lens, u, v)     [u', v']: the ideal point of a picture point (marker corners, clicks)
//   toPicture(lens, u, v)   [u, v]: the picture point of an ideal point (the 2D layer's rings: where an ideal point lands in the picture), by Newton steps; null when it does not converge
//   isNone(lens)            both numbers are 0 (or there is no lens): nothing to do
//   valid(lens)             |a1|, |a2| < 0.5 and the map does not fold over anywhere in the picture (the ideal radius grows with the picture's)
//   bounds(lens)            { m }: the factor (at least 1) by which the ideal picture that is rendered must be wider and higher than the real one, so that every point of the real picture
//                           has its ideal point inside it
//   gridLines(lens, nx, ny, steps)   the lines of a straight grid (nx x ny cells over the ideal picture) as they appear in the camera's picture: [{ kind: 'v' | 'h', i, pts: [[u, v], ...] }]
//   cornerBend(lens)        { px, percent }: how far the corner of the picture is from the corner of the ideal picture, in pixels and as a part of the half diagonal
//   glsl()                  the shader function `vec2 lensIdeal(vec2 uv, float a1, float a2, vec2 size)` (uv: the picture's own 0..1, y either way; the result is the ideal 0..1 point,
//                           outside 0..1 when the ideal picture is wider than the real one) and its way back, `vec2 lensPicture(vec2 ideal, float a1, float a2, vec2 size)`: the picture's
//                           0..1 point of an ideal 0..1 point, by PICTURE_STEPS Newton steps from the ideal point (the people cutout reads the person mask there, peoplecut.js)
//   pictureUV(a1, a2, size, u, v)   [u, v]: the same steps as lensPicture, in JS, on 0..1 points (size: [aspect, 1]), so that tests can check the shader's sums
(function (M) {
  const LIMIT = 0.5;
  const half = (lens) => 0.5 * Math.hypot(lens.W, lens.H);
  const isNone = (lens) => !lens || !(Math.abs(lens.a1 || 0) > 0 || Math.abs(lens.a2 || 0) > 0);

  function toIdeal(lens, u, v) {
    if (isNone(lens)) return [u, v];
    const R = half(lens), x = (u - lens.W / 2) / R, y = (v - lens.H / 2) / R, r2 = x * x + y * y, s = 1 + lens.a1 * r2 + lens.a2 * r2 * r2;
    return [lens.W / 2 + x * s * R, lens.H / 2 + y * s * R];
  }

  function toPicture(lens, u, v) {
    if (isNone(lens)) return [u, v];
    const R = half(lens), xi = (u - lens.W / 2) / R, yi = (v - lens.H / 2) / R, ri = Math.hypot(xi, yi);
    if (ri === 0) return [lens.W / 2, lens.H / 2];
    let r = ri;
    for (let k = 0; k < 12; k++) {
      const r2 = r * r, f = r * (1 + lens.a1 * r2 + lens.a2 * r2 * r2) - ri, d = 1 + 3 * lens.a1 * r2 + 5 * lens.a2 * r2 * r2;
      if (!(d > 1e-6)) return null;
      const step = f / d; r -= step;
      if (Math.abs(step) * R < 0.0005) return [lens.W / 2 + xi / ri * r * R, lens.H / 2 + yi / ri * r * R];
    }
    return null;
  }

  function valid(lens) {
    if (!lens || ![lens.a1, lens.a2].every(Number.isFinite) || Math.abs(lens.a1) >= LIMIT || Math.abs(lens.a2) >= LIMIT) return false;
    for (let i = 0; i <= 100; i++) { const r = i / 100, r2 = r * r; if (!(1 + 3 * lens.a1 * r2 + 5 * lens.a2 * r2 * r2 > 0.05)) return false; }
    return true;
  }

  function bounds(lens) {
    if (isNone(lens)) return { m: 1 };
    let mx = lens.W / 2, my = lens.H / 2;
    const n = 64, edge = (u, v) => { const q = toIdeal(lens, u, v); mx = Math.max(mx, Math.abs(q[0] - lens.W / 2)); my = Math.max(my, Math.abs(q[1] - lens.H / 2)); };
    for (let i = 0; i <= n; i++) { const t = i / n; edge(t * lens.W, 0); edge(t * lens.W, lens.H); edge(0, t * lens.H); edge(lens.W, t * lens.H); }
    return { m: Math.max(1, mx / (lens.W / 2), my / (lens.H / 2)) };
  }

  function gridLines(lens, nx = 8, ny = 6, steps = 24) {
    const out = [];
    if (!lens || !(lens.W > 0) || !(lens.H > 0)) return out;
    for (let i = 0; i <= nx; i++) { const pts = []; for (let s = 0; s <= steps; s++) { const q = toPicture(lens, i / nx * lens.W, s / steps * lens.H); if (q) pts.push(q); } out.push({ kind: 'v', i, pts }); }
    for (let j = 0; j <= ny; j++) { const pts = []; for (let s = 0; s <= steps; s++) { const q = toPicture(lens, s / steps * lens.W, j / ny * lens.H); if (q) pts.push(q); } out.push({ kind: 'h', i: j, pts }); }
    return out;
  }
  function cornerBend(lens) {
    if (!lens || !(lens.W > 0) || !(lens.H > 0) || isNone(lens)) return { px: 0, percent: 0 };
    const q = toIdeal(lens, 0, 0), px = Math.hypot(q[0], q[1]);
    return { px, percent: px / half(lens) * 100 };
  }

  // lensPicture's steps, in JS (the shader does exactly this)
  const PICTURE_STEPS = 4;
  function pictureUV(a1, a2, size, u, v) {
    const R = 0.5 * Math.hypot(size[0], size[1]), px = (u - 0.5) * size[0] / R, py = (v - 0.5) * size[1] / R, ri = Math.hypot(px, py);
    if (ri < 1e-6) return [u, v];
    let r = ri;
    for (let k = 0; k < PICTURE_STEPS; k++) { const r2 = r * r; r -= (r * (1 + a1 * r2 + a2 * r2 * r2) - ri) / Math.max(1e-6, 1 + 3 * a1 * r2 + 5 * a2 * r2 * r2); }
    const k = r / ri;
    return [0.5 + px * k * R / size[0], 0.5 + py * k * R / size[1]];
  }

  const GLSL = [
    'vec2 lensIdeal(vec2 uv, float a1, float a2, vec2 size) {',
    '  float R = 0.5 * length(size);',
    '  vec2 p = (uv - 0.5) * size / R;',
    '  float r2 = dot(p, p);',
    '  float s = 1.0 + a1 * r2 + a2 * r2 * r2;',
    '  return 0.5 + p * s * R / size;',
    '}',
    'vec2 lensPicture(vec2 ideal, float a1, float a2, vec2 size) {',
    '  float R = 0.5 * length(size);',
    '  vec2 p = (ideal - 0.5) * size / R;',
    '  float ri = length(p);',
    '  if (ri < 1e-6) return ideal;',
    '  float r = ri;',
    `  for (int k = 0; k < ${PICTURE_STEPS}; k++) { float r2 = r * r; r -= (r * (1.0 + a1 * r2 + a2 * r2 * r2) - ri) / max(1e-6, 1.0 + 3.0 * a1 * r2 + 5.0 * a2 * r2 * r2); }`,
    '  return 0.5 + p * (r / ri) * R / size;',
    '}',
  ].join(String.fromCharCode(10));
  const glsl = () => GLSL;

  M.lens = { toIdeal, toPicture, pictureUV, PICTURE_STEPS, isNone, valid, bounds, glsl, gridLines, cornerBend, LIMIT };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
