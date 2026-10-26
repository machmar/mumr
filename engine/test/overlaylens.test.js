// How the overlay is rendered for a camera with a lens (overlaylens.js), and that the solver, given clicks through the lens, still finds the camera (webcamcal.js).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const OL = M.overlaylens, LN = M.lens, WC = M.webcam, CAL = M.webcamcal;

const W = 1280, H = 720, D = Math.PI / 180, HFOV = 70 * D, ASPECT = W / H;
const memory = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) }; };

test('no lens, a lens of zero, or a lens that is not one: the overlay is drawn as it always was (one render, nothing bent)', () => {
  for (const lens of [null, undefined, {}, { a1: 0, a2: 0 }, { a1: 0.6, a2: 0 }, { a1: NaN, a2: 0 }, { a1: -0.45, a2: -0.3 }]) assert.deepStrictEqual(OL.renderPlan(lens, W, H, HFOV, ASPECT), { distort: false }, JSON.stringify(lens));
  assert.deepStrictEqual(OL.renderPlan({ a1: -0.1, a2: 0 }, W, H, 0, ASPECT), { distort: false }); assert.deepStrictEqual(OL.renderPlan({ a1: -0.1, a2: 0 }, W, H, HFOV, 0), { distort: false });
});

test('a barrel lens needs no wider frustum; a pincushion needs one; both are bent', () => {
  const barrel = OL.renderPlan({ a1: -0.12, a2: 0.01 }, W, H, HFOV, ASPECT);
  assert.strictEqual(barrel.distort, true); assert.strictEqual(barrel.m, 1); assert.ok(Math.abs(barrel.hfov - HFOV) < 1e-12); assert.strictEqual(barrel.aspect, ASPECT);
  const pin = OL.renderPlan({ a1: 0.2, a2: 0 }, W, H, HFOV, ASPECT);
  assert.strictEqual(pin.distort, true); assert.ok(pin.m > 1.1 && pin.hfov > HFOV);
  assert.ok(Math.abs(Math.tan(pin.hfov / 2) / Math.tan(HFOV / 2) - pin.m) < 1e-12, 'wider by m across');
  assert.ok(Math.abs(Math.tan(pin.vfovDeg * D / 2) - Math.tan(pin.hfov / 2) / ASPECT) < 1e-12, 'and by m up and down: the same aspect');
});

test('every point of the real picture has its ideal point inside the frustum that is rendered', () => {
  for (const [a1, a2] of [[0.2, 0], [0.15, 0.05], [0.3, 0.1], [-0.2, 0.1], [-0.12, 0.01]]) {
    const lens = { a1, a2, W, H }, plan = OL.renderPlan(lens, W, H, HFOV, ASPECT);
    for (let u = 0; u <= W; u += 40) for (let v = 0; v <= H; v += 36) {
      const q = LN.toIdeal(lens, u, v);
      assert.ok(Math.abs(q[0] - W / 2) <= plan.m * W / 2 + 1e-6 && Math.abs(q[1] - H / 2) <= plan.m * H / 2 + 1e-6, `(${a1}, ${a2}) at ${u},${v}`);
    }
  }
});

// ---- the camera from clicks that were made through a lens
const CAM = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.5, -2.5), pitch: -0.27 }, SPOTS = { pts: [[0, 0, 0], [1.5, 0, 0], [0.6, -1.2, 0]] };
const seenThrough = (lens, p) => { const q = WC.project(CAM, HFOV, W, H, p); return lens ? LN.toPicture(lens, q[0], q[1]) : [q[0], q[1]]; };

test('clicks in a picture that a lens has bent give the camera when the lens is known, and a camera that is off when it is not', () => {
  const lens = { a1: -0.15, a2: 0.02, W, H };
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(70);
  SPOTS.pts.forEach((p, i) => c.setClick(i, seenThrough(lens, p)));
  const wrong = c.result(SPOTS); assert.ok(wrong.ok);
  const off = Math.hypot(wrong.cam.x - CAM.x, wrong.cam.y - CAM.y, wrong.cam.z - CAM.z);
  assert.ok(off > 0.01, `without the lens the clicks are wrong (${(off * 100).toFixed(1)} cm)`);
  assert.ok(c.setLens(-0.15, 0.02));
  const r = c.result(SPOTS); assert.ok(r.ok);
  assert.ok(Math.hypot(r.cam.x - CAM.x, r.cam.y - CAM.y, r.cam.z - CAM.z) < 0.005, `with the lens: ${[r.cam.x, r.cam.y, r.cam.z]}`);
  assert.ok(r.rms < 0.05);
  assert.strictEqual(c.idealClicks()[0][0] !== c.clicks[0][0], true, 'the clicks themselves are kept as they were clicked');
  c.clearLens(); assert.ok(Math.hypot(c.result(SPOTS).cam.x - CAM.x, c.result(SPOTS).cam.y - CAM.y) > 0.005, 'and the answer follows the lens');
});

test('no lens: the clicks go to the solver as they are', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(70);
  SPOTS.pts.forEach((p, i) => c.setClick(i, seenThrough(null, p)));
  assert.deepStrictEqual(c.idealClicks(), c.clicks);
  const r = c.result(SPOTS); assert.ok(Math.hypot(r.cam.x - CAM.x, r.cam.y - CAM.y, r.cam.z - CAM.z) < 0.01);
});

test('the four-click field-of-view measurement takes the lens into account', () => {
  const lens = { a1: -0.15, a2: 0.02, W, H }, c = new CAL.Calib(memory()); c.use('camA', W, H);
  const sheet = CAL.FOV_SHEET, pose = M.markers.sheetPose({ d: 0.55, tilt: 55, yaw: 10 }), hfov = 64 * D;
  const corners = [[0, 0], [sheet.w, 0], [sheet.w, sheet.h], [0, sheet.h]].map(([x, y]) => {
    const P = [pose.O[0] + (x - sheet.w / 2) * pose.ex[0] + (y - sheet.h / 2) * pose.ey[0], pose.O[1] + (x - sheet.w / 2) * pose.ex[1] + (y - sheet.h / 2) * pose.ey[1], pose.O[2] + (x - sheet.w / 2) * pose.ex[2] + (y - sheet.h / 2) * pose.ey[2]];
    const q = WC.project({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, hfov, W, H, P); return LN.toPicture(lens, q[0], q[1]);
  });
  const without = c.addFovShot(corners); c.clearFov();
  c.setLens(-0.15, 0.02); const withLens = c.addFovShot(corners);
  assert.ok(Math.abs(withLens - 64) < 0.5, `with the lens ${withLens}`); assert.ok(Math.abs(without - 64) > Math.abs(withLens - 64), `without it ${without} is further away`);
});
