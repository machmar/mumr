// A webcam placed by hand (webcam/handcam.js): one click on a spot turns it; a headset carries it by the body knob (camknobs.js).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const { aimFrom, HandCam } = M.handcam, WC = M.webcam, { CamKnobs } = M.camknobs;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const store = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) }; };

test('aimFrom: the turn with which a camera at a known place sees a spot at the clicked pixel', () => {
  const W = 1280, H = 720, hfov = 1.2;
  for (const cam of [{ x: 0.4, y: -1.1, z: 0.9, yaw: 0.7, pitch: -0.35 }, { x: -2, y: 1, z: 1.6, yaw: -2.6, pitch: -0.6 }, { x: 0.2, y: 0.3, z: 0.25, yaw: 3.0, pitch: 0.05 }]) {
    const spot = [cam.x + 1.4 * Math.cos(cam.yaw + 0.2), cam.y + 1.4 * Math.sin(cam.yaw + 0.2), 0];
    const uv = WC.project(cam, hfov, W, H, spot);
    const a = aimFrom([cam.x, cam.y, cam.z], uv, spot, hfov, W, H);
    assert.ok(a, 'found');
    near(Math.atan2(Math.sin(a.yaw - cam.yaw), Math.cos(a.yaw - cam.yaw)), 0, 1e-4, 'yaw');
    near(a.pitch, cam.pitch, 1e-4, 'pitch');
  }
  assert.strictEqual(aimFrom([0, 0, 1], [640, 360], [0, 0, 1.01], 1.2, 1280, 720), null, 'a spot on top of the camera: no answer');
});

test('HandCam: put behind the spots at first, moved by a headset, turned by the aim click, kept for the next launch', () => {
  const st = store(), spots = { pts: [[0, 0, 0], [1, 0, 0], [0.5, 0.6, 0]] }, W = 1280, H = 720, hfov = 1.1;
  const h = new HandCam(st); h.aimIdeal = (uv) => uv;
  assert.strictEqual(h.pose({ hfov, W, H, spots }), null, 'off: nothing');
  h.start(spots.pts);
  let P = h.pose({ hfov, W, H, spots });
  assert.ok(P.hand && !P.aimed && P.z > 1 && P.x < 0, 'behind the spots, up, looking at them');
  assert.ok(h.ask({ x: 2.5, y: -1.5, z: 0.8 }));
  assert.ok(!h.ask({ x: 2.5, y: -1.5, z: 40 }), 'not into the ceiling');
  const real = { x: 2.5, y: -1.5, z: 0.8, yaw: 2.4, pitch: -0.3 }, uv = WC.project(real, hfov, W, H, spots.pts[2]);
  h.setAim(2, uv);
  P = h.pose({ hfov, W, H, spots });
  assert.ok(P.aimed);
  const back = WC.project(P, hfov, W, H, spots.pts[2]);
  near(back[0], uv[0], 0.5, 'the spot lands where it was clicked (u)'); near(back[1], uv[1], 0.5, '(v)');
  const again = new HandCam(st); again.aimIdeal = (q) => q;
  const Q = again.pose({ hfov, W, H, spots });
  assert.ok(Q && Q.aimed && Math.hypot(Q.x - 2.5, Q.y + 1.5, Q.z - 0.8) < 1e-9, 'the next launch: on, in the same place, turned the same way');
});

test('CamKnobs: a camera placed by hand has a white knob on itself that moves it one to one; others do not', () => {
  const K = new CamKnobs(), c = { id: 'cam-h', x: 1, y: 2, z: 1.2, yaw: 0.3, pitch: -0.2, hfov: 1.1, aspect: 1.78, hand: true };
  const body = K.knobs([c]).find((k) => k.axis === 'body');
  assert.ok(body && body.x === 1 && body.z === 1.2, 'on the camera');
  assert.ok(!K.knobs([Object.assign({}, c, { hand: false })]).some((k) => k.axis === 'body'), 'a solved camera has only the three');
  K.update([{ id: 'r', x: 1, y: 2, z: 1.2, pinch: false }], [c]);
  K.update([{ id: 'r', x: 1, y: 2, z: 1.2, pinch: true }], [c]);
  const r = K.update([{ id: 'r', x: 1.5, y: 1.8, z: 1.0, pinch: true }], [c]);
  const m = r.moves[r.moves.length - 1];
  near(m.x, 1.5, 1e-9, 'x'); near(m.y, 1.8, 1e-9, 'y'); near(m.z, 1.0, 1e-9, 'z');
  const done = K.update([{ id: 'r', x: 1.5, y: 1.8, z: 1.0, pinch: false }], [c]);
  assert.ok(done.release && done.release.x === 1.5);
  assert.strictEqual(M.cams.clean(c).hand, true, 'the world keeps the flag'); assert.strictEqual(M.cams.clean(Object.assign({}, c, { hand: 1 })).hand, undefined);
});
