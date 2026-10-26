const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const WC = M.webcam;

const D = Math.PI / 180, W = 1280, H = 720, HFOV = 70 * D;
// a repeatable noise source: the same clicks every run
let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const SPOTS = [[0, 0, 0], [1.8, 0, 0], [0.7, -1.6, 0]];       // spot 1, spot 2, check spot on the floor (m)
const clicksOf = (cam, pts, noise = 0, hfov = HFOV) => pts.map((p) => { const q = WC.project(cam, hfov, W, H, p); return [q[0] + noise * gauss(), q[1] + noise * gauss()]; });
// a camera 2.5 to 5 m from the spots, 0.6 to 1.6 m up, looking roughly at them (a tripod or a desk)
function aCamera() {
  const bearing = rnd() * 2 * Math.PI, d = 2.5 + rnd() * 2.5, cx = 0.9 + d * Math.cos(bearing), cy = -0.6 + d * Math.sin(bearing), cz = 0.6 + rnd();
  return { x: cx, y: cy, z: cz, yaw: Math.atan2(-0.6 - cy, 0.9 - cx) + (rnd() - 0.5) * 0.3, pitch: Math.atan2(-cz, d) + (rnd() - 0.5) * 0.15 };
}
const inPicture = (cam, pts) => pts.every((p) => { const q = WC.project(cam, HFOV, W, H, p); return q[2] > 0 && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H; });

test('project: a point straight ahead lands in the middle of the picture, one to the right of it right of the middle', () => {
  const cam = { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 };
  const mid = WC.project(cam, HFOV, W, H, [4, 0, 1]);
  assert.ok(Math.abs(mid[0] - W / 2) < 1e-9 && Math.abs(mid[1] - H / 2) < 1e-9 && Math.abs(mid[2] - 4) < 1e-9);
  const right = WC.project(cam, HFOV, W, H, [4, -1, 1]);          // looking along +x, the right-hand side is -y
  assert.ok(right[0] > W / 2 && Math.abs(right[1] - H / 2) < 1e-9);
  const low = WC.project(cam, HFOV, W, H, [4, 0, 0]);             // the floor is below the middle of the picture
  assert.ok(low[1] > H / 2);
  const left = WC.project(cam, HFOV, W, H, [4, 4 * Math.tan(HFOV / 2), 1]);   // the edge of the field of view
  assert.ok(Math.abs(left[0]) < 1e-9);
});

test('solve: three spots, exact clicks: the camera comes back', () => {
  let n = 0;
  while (n < 12) {
    const cam = aCamera(); if (!inPicture(cam, SPOTS)) continue; n++;
    const r = WC.solve(SPOTS, clicksOf(cam, SPOTS), { hfov: HFOV, W, H });
    assert.ok(r.ok, r.why);
    const all = [r].concat(r.alts);
    assert.ok(all.some((c) => dist3(c.cam, cam) < 1e-3), 'the true place is the answer or one of its alternatives');
    assert.ok(r.rms < 1e-3);
  }
});

test('solve: clicks off by a pixel: the camera is within a few centimetres, and the true place is never lost', () => {
  const errs = []; let n = 0, wrong = 0;
  while (n < 150) {
    const cam = aCamera(); if (!inPicture(cam, SPOTS)) continue; n++;
    const r = WC.solve(SPOTS, clicksOf(cam, SPOTS, 1), { hfov: HFOV, W, H });
    assert.ok(r.ok, r.why);
    const e = dist3(r.cam, cam);
    if (e > 0.3) { wrong++; assert.ok(r.alts.some((c) => dist3(c.cam, cam) < 0.3), 'a wrong best fit must come with the right place as an alternative'); } else errs.push(e);
  }
  errs.sort((a, b) => a - b);
  assert.ok(errs[errs.length >> 1] < 0.04, `median ${errs[errs.length >> 1]}`);
  assert.ok(wrong <= 4, `${wrong} of ${n} best fits on the wrong side`);
});

test('solve: a camera low over the floor can be on either side: the other place is offered', () => {
  // clicks that fit a camera at (5.24, -2.63, 0.75) and, almost as well, one on the other side of the spots (measured 2026-10-15)
  const r = WC.solve(SPOTS, [[612, 368], [780, 409], [384, 405]], { hfov: HFOV, W, H });
  assert.ok(r.ok);
  const places = [r.cam].concat(r.alts.map((a) => a.cam));
  assert.ok(places.length >= 2, 'two places');
  assert.ok(places.some((c) => dist3(c, { x: 5.24, y: -2.63, z: 0.75 }) < 0.5), 'the true place is among them');
});

test('solve: two spots cannot give the height; with the height known they can', () => {
  const cam = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.3, -2.3), pitch: -0.25 };
  const two = SPOTS.slice(0, 2), px = clicksOf(cam, two);
  const no = WC.solve(two, px, { hfov: HFOV, W, H });
  assert.strictEqual(no.ok, false); assert.match(no.why, /check spot/);
  const yes = WC.solve(two, px, { hfov: HFOV, W, H, known: { z: 1.2 } });
  assert.ok(yes.ok && dist3(yes.cam, cam) < 1e-3, 'exact clicks and the true height: the true camera');
});

test('solve: a known lens position leaves only the way it looks', () => {
  const cam = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.3, -2.3), pitch: -0.25 };
  const two = SPOTS.slice(0, 2), r = WC.solve(two, clicksOf(cam, two), { hfov: HFOV, W, H, known: { x: cam.x, y: cam.y, z: cam.z } });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.cam.yaw - cam.yaw) < 1e-4 && Math.abs(r.cam.pitch - cam.pitch) < 1e-4);
});

test('solve: three spots in a line say the height is ambiguous', () => {
  const line = [[0, 0, 0], [1.8, 0, 0], [3.6, 0.1, 0]];
  const r = WC.solve(line, [[100, 300], [400, 320], [700, 330]], { hfov: HFOV, W, H });
  assert.strictEqual(r.ok, false); assert.match(r.why, /line/);
});

test('solve: one click, or clicks that do not match the spots, is refused', () => {
  assert.strictEqual(WC.solve([SPOTS[0]], [[1, 1]], { hfov: HFOV, W, H }).ok, false);
  assert.strictEqual(WC.solve(SPOTS, [[1, 1]], { hfov: HFOV, W, H }).ok, false);
});

test('solve: a field of view that is off by 10 % hardly shows in the clicks (so it has to be measured)', () => {
  const cam = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.3, -2.3), pitch: -0.25 }, px = clicksOf(cam, SPOTS);
  const right = WC.solve(SPOTS, px, { hfov: HFOV, W, H }), wrong = WC.solve(SPOTS, px, { hfov: HFOV * 1.1, W, H });
  assert.ok(right.rms < 0.01);
  assert.ok(wrong.rms < 4, `the error of a wrong FOV is only ${wrong.rms} px`);
  assert.ok(dist3(wrong.cam, cam) > 0.2, 'but the camera it finds is far from the real one');
});

// a printed frame of w x h metres, lying `tilt` radians off facing the lens, `d` metres in front of it, turned by `roll`
function frameCorners(w, h, d, tilt, roll, noise, hfov = HFOV) {
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([X, Y]) => {
    const xx = X - w / 2, yy = Y - h / 2, a = xx * Math.cos(roll) - yy * Math.sin(roll), b = xx * Math.sin(roll) + yy * Math.cos(roll);
    const q = WC.project(cam, hfov, W, H, [d - b * Math.sin(tilt), -a, b * Math.cos(tilt)]);
    return [q[0] + noise * gauss(), q[1] + noise * gauss()];
  });
}
test('fovFromRect: exact corners of a tilted frame give the field of view', () => {
  for (const hf of [55, 70, 90]) {
    const f = WC.fovFromRect(frameCorners(0.18, 0.267, 0.6, 50 * D, 0.2, 0, hf * D), 0.18, 0.267, W, H);
    assert.ok(f !== null && Math.abs(f / D - hf) < 1e-6, `${hf}: ${f / D}`);
  }
});
test('fovFromRect: a frame held 0.5 to 0.9 m away at 40 to 65 degrees, corners off by a pixel: within a few percent', () => {
  const e = [];
  for (let i = 0; i < 100; i++) {
    const f = WC.fovFromRect(frameCorners(0.18, 0.267, 0.5 + rnd() * 0.4, (40 + rnd() * 25) * D, (rnd() - 0.5) * 0.6, 1), 0.18, 0.267, W, H);
    e.push(f === null ? 1 : Math.abs(f - HFOV) / HFOV);
  }
  e.sort((a, b) => a - b);
  assert.ok(e[50] < 0.03, `median ${e[50]}`); assert.ok(e[90] < 0.08, `p90 ${e[90]}`);
});
test('fovFromRect: a frame that faces the lens says nothing', () => {
  assert.strictEqual(WC.fovFromRect(frameCorners(0.18, 0.267, 0.6, 0, 0, 0), 0.18, 0.267, W, H), null);
});

test('homography: maps its own points exactly, and the points between them as the projective map does', () => {
  const H0 = [1.2, 0.1, 5, -0.05, 0.9, 3, 0.0004, 0.0002, 1];
  const src = [[0, 0], [100, 0], [100, 160], [0, 160], [50, 80], [20, 120]];
  const H = WC.homography(src, src.map(([x, y]) => WC.applyH(H0, x, y)));
  assert.ok(H, 'a homography');
  for (const [x, y] of [...src, [33, 71], [90, 10], [-20, 200]]) {
    const a = WC.applyH(H, x, y), b = WC.applyH(H0, x, y);
    assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, `(${x}, ${y}): ${a} vs ${b}`);
  }
});
test('homography: fewer than four points, or points that do not match, give null', () => {
  assert.strictEqual(WC.homography([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]]), null);
  assert.strictEqual(WC.homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0]]), null);
});

// pairs for a 4 x 4 grid of points on a w x h plane (the way sixteen marker corners lie on a sheet), seen at the given pose
function gridPairs(w, h, d, tilt, roll, noise, hfov = HFOV) {
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, out = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const X = w * i / 3, Y = h * j / 3, xx = X - w / 2, yy = Y - h / 2, a = xx * Math.cos(roll) - yy * Math.sin(roll), b = xx * Math.sin(roll) + yy * Math.cos(roll);
    const q = WC.project(cam, hfov, W, H, [d - b * Math.sin(tilt), -a, b * Math.cos(tilt)]);
    out.push([X, Y, q[0] + noise * gauss(), q[1] + noise * gauss()]);
  }
  return out;
}
test('fovFromPlane: sixteen exact points give the field of view', () => {
  for (const hf of [55, 70, 90]) {
    const f = WC.fovFromPlane(gridPairs(0.15, 0.24, 0.6, 50 * D, 0.2, 0, hf * D), W, H);
    assert.ok(f !== null && Math.abs(f / D - hf) < 1e-6, `${hf}: ${f / D}`);
  }
});
test('fovFromPlane: with a pixel of noise sixteen points are better than the four corners of the same picture', () => {
  const e16 = [], e4 = [];
  for (let i = 0; i < 100; i++) {
    const pairs = gridPairs(0.15, 0.24, 0.5 + rnd() * 0.3, (40 + rnd() * 25) * D, (rnd() - 0.5) * 0.6, 1);
    const f16 = WC.fovFromPlane(pairs, W, H), f4 = WC.fovFromPlane([pairs[0], pairs[3], pairs[15], pairs[12]], W, H);
    e16.push(f16 === null ? 1 : Math.abs(f16 - HFOV) / HFOV); e4.push(f4 === null ? 1 : Math.abs(f4 - HFOV) / HFOV);
  }
  e16.sort((a, b) => a - b); e4.sort((a, b) => a - b);
  assert.ok(e16[50] < e4[50], `sixteen ${e16[50]} against four ${e4[50]}`);
  assert.ok(e16[50] < 0.02 && e16[90] < 0.05, `median ${e16[50]}, p90 ${e16[90]}`);
});
test('fovFromPlane: a plane that faces the lens, or too few points, say nothing', () => {
  assert.strictEqual(WC.fovFromPlane(gridPairs(0.15, 0.24, 0.6, 0, 0, 0), W, H), null);
  assert.strictEqual(WC.fovFromPlane(gridPairs(0.15, 0.24, 0.6, 50 * D, 0, 0).slice(0, 3), W, H), null);
});
