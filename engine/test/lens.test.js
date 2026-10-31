// The lens model (lens.js): picture to ideal and back, the limits, the extra frustum, and the shader's text.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const LN = M.lens;

const W = 1280, H = 720;
const L = (a1, a2) => ({ a1, a2, W, H });
const GRID = []; for (let u = 0; u <= W; u += 80) for (let v = 0; v <= H; v += 60) GRID.push([u, v]);

test('toIdeal and toPicture are inverses to a hundredth of a pixel, over the whole picture', () => {
  for (const [a1, a2] of [[-0.2, 0], [0.15, 0.02], [-0.3, 0.1], [0.05, -0.02], [-0.12, 0.01]]) {
    for (const [u, v] of GRID) {
      const q = LN.toIdeal(L(a1, a2), u, v), back = LN.toPicture(L(a1, a2), q[0], q[1]);
      assert.ok(back, `(${a1}, ${a2}) at ${u},${v} did not converge`);
      assert.ok(Math.hypot(back[0] - u, back[1] - v) < 0.01, `(${a1}, ${a2}) at ${u},${v}: ${back}`);
    }
  }
});

test('the centre does not move, no lens is the identity, and a1 < 0 pulls the ideal point towards the centre (barrel)', () => {
  assert.deepStrictEqual(LN.toIdeal(L(-0.2, 0.05), W / 2, H / 2), [W / 2, H / 2]);
  assert.deepStrictEqual(LN.toPicture(L(-0.2, 0.05), W / 2, H / 2), [W / 2, H / 2]);
  for (const lens of [L(0, 0), null, undefined, {}, { a1: 0, a2: 0, W, H }]) { assert.strictEqual(LN.isNone(lens), true); assert.deepStrictEqual(LN.toIdeal(lens, 100, 50), [100, 50]); assert.deepStrictEqual(LN.toPicture(lens, 100, 50), [100, 50]); }
  assert.strictEqual(LN.isNone(L(0, 0.001)), false);
  const q = LN.toIdeal(L(-0.2, 0), 0, 0); assert.ok(Math.hypot(q[0] - W / 2, q[1] - H / 2) < Math.hypot(W / 2, H / 2), 'a corner moves inwards');
  const p = LN.toIdeal(L(0.2, 0), 0, 0); assert.ok(Math.hypot(p[0] - W / 2, p[1] - H / 2) > Math.hypot(W / 2, H / 2), 'a pincushion moves it outwards');
});

test('the formula, by hand: a point at r = 0.5 with a1 = -0.2, a2 = 0.1', () => {
  const R = 0.5 * Math.hypot(W, H), r = 0.5, u = W / 2 + r * R, q = LN.toIdeal(L(-0.2, 0.1), u, H / 2);
  assert.ok(Math.abs(q[0] - (W / 2 + r * (1 - 0.2 * 0.25 + 0.1 * 0.0625) * R)) < 1e-9); assert.ok(Math.abs(q[1] - H / 2) < 1e-9);
});

test('valid: within 0.5 and not folding over; a map that folds is refused, and so are things that are not numbers', () => {
  for (const [a1, a2] of [[0, 0], [-0.12, 0.01], [0.3, -0.1], [-0.3, 0.1], [0.49, 0]]) assert.strictEqual(LN.valid(L(a1, a2)), true, `${a1}, ${a2}`);
  for (const [a1, a2] of [[-0.45, -0.3], [0.5, 0], [0, -0.5], [-0.49, -0.49], [NaN, 0], [0, Infinity]]) assert.strictEqual(LN.valid(L(a1, a2)), false, `${a1}, ${a2}`);
  assert.strictEqual(LN.valid(null), false); assert.strictEqual(LN.valid({ a1: 'x', a2: 0 }), false);
});

test('bounds: 1 when the ideal picture is inside the real one, more when it is wider; every picture point has its ideal point inside the extended frustum', () => {
  assert.strictEqual(LN.bounds(L(0, 0)).m, 1); assert.strictEqual(LN.bounds(null).m, 1);
  assert.strictEqual(LN.bounds(L(-0.2, 0)).m, 1, 'barrel: the ideal picture is smaller');
  for (const [a1, a2] of [[0.2, 0], [0.15, 0.05], [0.3, 0.1], [-0.2, 0.1]]) {
    const lens = L(a1, a2), m = LN.bounds(lens).m;
    for (const [u, v] of GRID) { const q = LN.toIdeal(lens, u, v); assert.ok(Math.abs(q[0] - W / 2) <= m * W / 2 + 1e-6 && Math.abs(q[1] - H / 2) <= m * H / 2 + 1e-6, `(${a1}, ${a2}) ${u},${v}`); }
  }
  assert.ok(LN.bounds(L(0.2, 0)).m > 1.1);
});

test('toPicture says null when it has no answer (not a number)', () => {
  assert.strictEqual(LN.toPicture(L(0.2, 0.05), NaN, 5), null); assert.strictEqual(LN.toPicture(L(0.2, 0.05), 5, NaN), null);
  assert.ok(LN.toPicture(L(0.2, 0.05), 5, 5), 'and a point of the picture has one');
});

test('the shader text has the same formula, and evaluating the same expression in JS agrees with toIdeal', () => {
  const g = LN.glsl();
  assert.match(g, /vec2 lensIdeal\(vec2 uv, float a1, float a2, vec2 size\)/); assert.match(g, /0\.5 \* length\(size\)/); assert.match(g, /1\.0 \+ a1 \* r2 \+ a2 \* r2 \* r2/);
  for (const [a1, a2] of [[-0.12, 0.01], [0.2, -0.03]]) for (const [u, v] of GRID.slice(0, 40)) {
    const uv = [u / W, v / H], R = 0.5 * Math.hypot(W, H), p = [(uv[0] - 0.5) * W / R, (uv[1] - 0.5) * H / R], r2 = p[0] * p[0] + p[1] * p[1], s = 1 + a1 * r2 + a2 * r2 * r2;
    const out = [0.5 + p[0] * s * R / W, 0.5 + p[1] * s * R / H], q = LN.toIdeal(L(a1, a2), u, v);
    assert.ok(Math.abs(out[0] * W - q[0]) < 1e-9 && Math.abs(out[1] * H - q[1]) < 1e-9);
  }
});

test('gridLines: with no lens the grid is straight; with a barrel lens the outer lines bulge and the middle ones stay straight; every point is a picture point', () => {
  const none = LN.gridLines(L(0, 0), 8, 6, 12);
  assert.strictEqual(none.length, 9 + 7);
  for (const line of none) { const xs = line.pts.map((p) => p[0]), ys = line.pts.map((p) => p[1]); if (line.kind === 'v') assert.ok(Math.max(...xs) - Math.min(...xs) < 1e-6); else assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6); }
  const barrel = LN.gridLines(L(-0.25, 0.04), 8, 6, 12), v = (i) => barrel.find((l) => l.kind === 'v' && l.i === i), bow = (l) => Math.max(...l.pts.map((p) => p[0])) - Math.min(...l.pts.map((p) => p[0]));
  assert.ok(bow(v(4)) < 1e-6, 'the line through the centre is straight'); assert.ok(bow(v(1)) > 5, `a line near the edge is bent: ${bow(v(1))}`); assert.ok(bow(v(0)) > bow(v(1)), 'the outermost the most');
  for (const l of barrel) for (const p of l.pts) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  assert.deepStrictEqual(LN.gridLines(null), []); assert.deepStrictEqual(LN.gridLines({ a1: 0, a2: 0, W: 0, H: 0 }), []);
});

test('cornerBend: nothing for no lens, and how far the corner moves for one', () => {
  assert.deepStrictEqual(LN.cornerBend(L(0, 0)), { px: 0, percent: 0 }); assert.deepStrictEqual(LN.cornerBend(null), { px: 0, percent: 0 });
  const b = LN.cornerBend(L(-0.25, 0)), R = 0.5 * Math.hypot(W, H);
  assert.ok(Math.abs(b.px - 0.25 * R) < 1e-9, `${b.px}`); assert.ok(Math.abs(b.percent - 25) < 1e-9);
  assert.ok(LN.cornerBend(L(0.1, 0.05)).px > 0);
});

test("the way back from the ideal picture: toPicture(toIdeal(p)) is p, and the shader's steps (pictureUV, lensPicture) land on the same point, to the edges", () => {
  const W = 1280, H = 720;
  for (const [a1, a2] of [[-0.25, 0.03], [-0.12, 0.01], [0.15, -0.02]]) {
    const lens = { a1, a2, W, H };
    for (const [u, v] of [[640, 360], [100, 80], [1270, 10], [5, 715], [900, 500], [1280, 720]]) {
      const id = LN.toIdeal(lens, u, v), back = LN.toPicture(lens, id[0], id[1]);
      assert.ok(back && Math.hypot(back[0] - u, back[1] - v) < 0.01, `toPicture(toIdeal) a1 ${a1} at ${u}, ${v}`);
      const q = LN.pictureUV(a1, a2, [W / H, 1], id[0] / W, id[1] / H);
      assert.ok(Math.hypot(q[0] * W - u, q[1] * H - v) < 0.5, `pictureUV (${LN.PICTURE_STEPS} steps) within half a pixel: a1 ${a1} at ${u}, ${v}: ${(q[0] * W).toFixed(2)}, ${(q[1] * H).toFixed(2)}`);
    }
  }
  assert.ok(LN.glsl().includes('vec2 lensPicture(') && LN.glsl().includes(`k < ${LN.PICTURE_STEPS}`), 'the shader has the same number of steps');
});
