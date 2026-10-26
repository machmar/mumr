const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const WC = M.webcam, MK = M.markers, SIM = M.webcamsim;

const D = Math.PI / 180, W = 1280, H = 720, HFOV = 70 * D;
let seed = 777;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

// a random pose of the sheet in front of the camera: 0.45 to 0.85 m away, leaning back 40 to 65 degrees, turned, rolled, a little off the middle
const randomPose = () => ({ d: 0.45 + rnd() * 0.4, tilt: 40 + rnd() * 25, yaw: (rnd() - 0.5) * 70, roll: (rnd() - 0.5) * 60, left: (rnd() - 0.5) * 0.2, up: (rnd() - 0.5) * 0.1 });
// where the corners of marker k really are in the picture: [[u, v] x 4]
const truth = (pose, k, hfov = HFOV) => { const P = MK.sheetPose(pose); return [0, 1, 2, 3].map((i) => { const [X, Y] = MK.cornerMM(k, i); return MK.sheetToPicture(P, hfov, W, H, X, Y); }); };
const wholeSheetInPicture = (pose) => [0, 1, 2, 3].every((k) => truth(pose, k).every((p) => p[2] > 0 && p[0] > 20 && p[0] < W - 20 && p[1] > 20 && p[1] < H - 20));
const poseInPicture = () => { for (;;) { const p = randomPose(); if (wholeSheetInPicture(p)) return p; } };

test('the four codes cannot be mistaken for each other or for their own turned copies', () => {
  const pop = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };
  const rot = (c) => { let o = 0; for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) if ((c >> (r * 4 + k)) & 1) o |= 1 << (k * 4 + (3 - r)); return o; };
  const turns = (c) => { const a = [c]; for (let i = 0; i < 3; i++) a.push(rot(a[i])); return a; };
  const C = MK.FOV_CODES;
  for (const c of C) for (let i = 1; i < 4; i++) assert.ok(pop(c ^ turns(c)[i]) >= 4, `${c} looks like itself turned ${i * 90} degrees`);
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(Math.min(...turns(C[a]).map((x) => pop(x ^ C[b]))) >= 5, `${a} and ${b}`);
});

test('detect: all four markers, the right ids, corners within a pixel, and the field of view from the 16 corners within 1.5 %', () => {
  const errs = [], ferr = [];
  for (let n = 0; n < 12; n++) {
    const pose = poseInPicture(), img = SIM.renderSheet(pose, { seed: 100 + n, ss: 2 });
    const found = MK.detect(img, W, H);
    assert.deepStrictEqual(found.map((m) => m.id), [0, 1, 2, 3], `pose ${JSON.stringify(pose)}`);
    const pairs = [];
    for (const m of found) {
      const t = truth(pose, m.id);
      m.corners.forEach((c, i) => { errs.push(Math.hypot(c[0] - t[i][0], c[1] - t[i][1])); const [X, Y] = MK.cornerMM(m.id, i); pairs.push([X / 1000, Y / 1000, c[0], c[1]]); });
    }
    const f = WC.fovFromPlane(pairs, W, H);
    ferr.push(f === null ? 1 : Math.abs(f - HFOV) / HFOV);
  }
  errs.sort((a, b) => a - b);
  assert.ok(med(errs) < 0.6, `median corner error ${med(errs)}`);
  assert.ok(errs[errs.length - 1] < 2.5, `worst corner error ${errs[errs.length - 1]}`);
  assert.ok(Math.max(...ferr) < 0.015, `worst field of view error ${Math.max(...ferr)}`);
});

test('detect: an empty picture, a plain wall and noise show no markers', () => {
  assert.deepStrictEqual(MK.detect(new Uint8Array(W * H).fill(200), W, H), []);
  assert.deepStrictEqual(MK.detect(new Uint8Array(W * H), W, H), []);
  const noisy = new Uint8Array(W * H); for (let i = 0; i < noisy.length; i++) noisy[i] = Math.floor(rnd() * 256);
  assert.deepStrictEqual(MK.detect(noisy, W, H), []);
  const blobs = new Uint8Array(W * H).fill(210);                       // dark squares that are not markers
  for (let b = 0; b < 12; b++) { const x = 40 + Math.floor(rnd() * 1100), y = 40 + Math.floor(rnd() * 600), s = 20 + Math.floor(rnd() * 40); for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) blobs[(y + j) * W + x + i] = 20; }
  assert.deepStrictEqual(MK.detect(blobs, W, H), [], 'solid squares are not markers');
});

test('detect: a marker that is covered is simply not there; the other three are found', () => {
  const pose = poseInPicture(), found = MK.detect(SIM.renderSheet(pose, { seed: 5, ss: 2, cover: [2] }), W, H);
  assert.deepStrictEqual(found.map((m) => m.id), [0, 1, 3]);
});

test('detect: one cell read wrongly still gives the marker; two do not give any other marker', () => {
  const pose = poseInPicture();
  assert.deepStrictEqual(MK.detect(SIM.renderSheet(pose, { seed: 6, ss: 2, flip: [{ id: 1, r: 1, c: 2 }] }), W, H).map((m) => m.id), [0, 1, 2, 3]);
  const two = MK.detect(SIM.renderSheet(pose, { seed: 7, ss: 2, flip: [{ id: 1, r: 1, c: 2 }, { id: 1, r: 3, c: 0 }] }), W, H).map((m) => m.id);
  assert.deepStrictEqual(two, [0, 2, 3], 'a marker with two wrong cells is dropped, not turned into another one');
});

test('detect: a sheet seen upside down gives the same ids, and each marker\'s corners in its own printed order', () => {
  let pose = poseInPicture(); pose = Object.assign({}, pose, { roll: pose.roll + 180 });
  if (!wholeSheetInPicture(pose)) pose = Object.assign({}, pose, { left: 0, up: 0, yaw: 0 });
  const found = MK.detect(SIM.renderSheet(pose, { seed: 8, ss: 2 }), W, H);
  assert.deepStrictEqual(found.map((m) => m.id), [0, 1, 2, 3]);
  for (const m of found) { const t = truth(pose, m.id); m.corners.forEach((c, i) => assert.ok(Math.hypot(c[0] - t[i][0], c[1] - t[i][1]) < 2.5, `marker ${m.id} corner ${i}`)); }
});

test('detect: a marker cut by the edge of the picture is not reported', () => {
  const pose = { d: 0.5, tilt: 45, yaw: 0, roll: 0, left: 0.30, up: 0 };             // shifted to the left so that the sheet's left side is out of the picture
  const found = MK.detect(SIM.renderSheet(pose, { seed: 9, ss: 2 }), W, H);
  for (const m of found) m.corners.forEach((c) => assert.ok(c[0] > 0 && c[0] < W && c[1] > 0 && c[1] < H));
  assert.ok(found.length >= 1 && found.length < 4, `${found.length} markers: some are cut by the edge, some are whole`);
});

test('detect: a dim, low-contrast picture still works, and one picture takes well under 150 ms', () => {
  const pose = poseInPicture(), img = SIM.renderSheet(pose, { seed: 10, ss: 2, paper: 120, ink: 60, noise: 4 });
  const t0 = Date.now(), found = MK.detect(img, W, H), ms = Date.now() - t0;
  assert.deepStrictEqual(found.map((m) => m.id), [0, 1, 2, 3]);
  assert.ok(ms < 150, `${ms} ms`);
});
