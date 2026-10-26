const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../client/webcam/index.js');
const WC = M.webcam, CAL = M.webcamcal;

const D = Math.PI / 180, W = 1280, H = 720;
const memory = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)), m }; };
const CAM = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.3, -2.3), pitch: -0.25 };
const SPOTS = { pts: [[0, 0, 0], [1.8, 0, 0], [0.7, -1.6, 0]] };
const seen = (p, hfov = 70 * D) => WC.project(CAM, hfov, W, H, p).slice(0, 2);

test('spotsFromDoc: spot 1 is the origin, spot 2 is on the x axis, the check mark is where the player put it, all on the floor', () => {
  const s = CAL.spotsFromDoc({ lined: { 0: { dist: 1.8, how: 'points' } }, checks: { 0: [0.7, -1.6] } });
  assert.deepStrictEqual(s.pts, [[0, 0, 0], [1.8, 0, 0], [0.7, -1.6, 0]]);
});
test('spotsFromDoc: two players measured the distance and placed a check mark each: the means are used', () => {
  const s = CAL.spotsFromDoc({ lined: { 0: { dist: 1.8 }, 1: { dist: 1.82 } }, checks: { 0: [0.70, -1.60], 1: [0.72, -1.58] } });
  assert.deepStrictEqual(s.pts, [[0, 0, 0], [1.81, 0, 0], [0.71, -1.59, 0]]);
});
test('spotsFromDoc: nobody lined up is null; no check mark is a null third spot; damaged entries are ignored', () => {
  assert.strictEqual(CAL.spotsFromDoc({ lined: {}, checks: {} }), null);
  assert.strictEqual(CAL.spotsFromDoc(null), null);
  assert.strictEqual(CAL.spotsFromDoc({ lined: { 0: null, 1: { dist: 'x' }, 2: { dist: -1 } } }), null);
  assert.strictEqual(CAL.spotsFromDoc({ lined: { 0: { dist: 1.5 } }, checks: {} }).pts[2], null);
  assert.strictEqual(CAL.spotsFromDoc({ lined: { 0: { dist: 1.5 } }, checks: { 0: [1, 'a'], 1: 'x', 2: null } }).pts[2], null);
});

test('Calib: no camera, no spots, two clicks: each says what is missing', () => {
  const c = new CAL.Calib(memory());
  assert.match(c.result(SPOTS).why, /not running/);
  c.use('cam1', W, H);
  assert.match(c.result(null).why, /lined up/);
  assert.match(c.result(SPOTS).why, /Click spot 1/);
  c.setClick(0, seen(SPOTS.pts[0])); c.setClick(1, seen(SPOTS.pts[1]));
  assert.match(c.result(SPOTS).why, /check spot/);
  assert.match(c.result({ pts: [SPOTS.pts[0], SPOTS.pts[1], null] }).why, /placed the check spot/);
});

test('Calib: three clicks give the camera', () => {
  const c = new CAL.Calib(memory()); c.use('cam1', W, H);
  SPOTS.pts.forEach((p, i) => c.setClick(i, seen(p)));
  const r = c.result(SPOTS);
  assert.ok(r.ok, r.why);
  assert.ok(Math.hypot(r.cam.x - CAM.x, r.cam.y - CAM.y, r.cam.z - CAM.z) < 1e-3 || r.alts > 0);
  assert.strictEqual(c.result(SPOTS), r, 'the same inputs give the same answer object (it is kept)');
});

test('Calib: when the spots change (a player lines up again and the distance is a little different) the camera is solved again from the same clicks', () => {
  const c = new CAL.Calib(memory()); c.use('cam1', W, H);
  SPOTS.pts.forEach((p, i) => c.setClick(i, seen(p)));
  const a = c.result(SPOTS);
  const longer = { pts: [SPOTS.pts[0], [1.9, 0, 0], SPOTS.pts[2]] };
  const b = c.result(longer);
  assert.ok(a.ok && b.ok);
  assert.ok(Math.hypot(a.cam.x - b.cam.x, a.cam.y - b.cam.y, a.cam.z - b.cam.z) > 0.01, 'a different spot 2 gives a different camera');
  assert.ok(b.rms > a.rms, 'and the clicks fit it worse');
  assert.deepStrictEqual(c.result(SPOTS).cam, a.cam, 'and with the first spots again, the first camera again');
});

test('Calib: clicks and the field of view are kept per camera and picture size', () => {
  const store = memory(), c = new CAL.Calib(store); c.use('cam1', W, H);
  c.setClick(0, [100, 200]); c.setFov(62);
  const d = new CAL.Calib(store); d.use('cam1', W, H);
  assert.deepStrictEqual(d.clicks[0], [100, 200]); assert.strictEqual(d.fovDeg, 62); assert.ok(d.fovMeasured);
  const e = new CAL.Calib(store); e.use('cam1', 640, 480);
  assert.strictEqual(e.clicks[0], null, 'another picture size: another lens setting, nothing carried over'); assert.strictEqual(e.fovDeg, CAL.DEF_FOV); assert.ok(!e.fovMeasured);
  const f = new CAL.Calib(store); f.use('cam2', W, H);
  assert.strictEqual(f.clicks[0], null);
});
test('Calib: a damaged or foreign saved record is ignored', () => {
  const store = memory(); store.set('mumr.webcam.cam1.1280x720', { v: 1, clicks: [[5000, 1], 'x', [1, 2]], shots: [3, 500, 'a', 66], choice: 9 });
  const c = new CAL.Calib(store); c.use('cam1', W, H);
  assert.deepStrictEqual(c.clicks, [null, null, [1, 2]]); assert.deepStrictEqual(c.shots, [66]); assert.strictEqual(c.choice, 0);
  store.set('mumr.webcam.cam1.1280x720', 'rubbish'); c.use('cam1', W, H); assert.deepStrictEqual(c.clicks, [null, null, null]);
});

test('Calib: field-of-view shots from the printed frame: the median of the last five', () => {
  const c = new CAL.Calib(memory()); c.use('cam1', W, H);
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, w = CAL.FOV_SHEET.w, h = CAL.FOV_SHEET.h, tilt = 55 * D;
  const corners = (hf) => [[0, 0], [w, 0], [w, h], [0, h]].map(([X, Y]) => { const b = Y - h / 2, a = X - w / 2; return WC.project(cam, hf * D, W, H, [0.6 - b * Math.sin(tilt), -a, b * Math.cos(tilt)]).slice(0, 2); });
  const got = c.addFovShot(corners(64));
  assert.ok(Math.abs(got - 64) < 1e-4); assert.ok(Math.abs(c.fovDeg - 64) < 1e-4 && c.fovMeasured);
  for (let i = 0; i < 6; i++) c.addFovShot(corners(64));
  assert.strictEqual(c.shots.length, 5);
  const flat = [[0, 0], [w, 0], [w, h], [0, h]].map(([X, Y]) => WC.project(cam, 70 * D, W, H, [0.6, -(X - w / 2), Y - h / 2]).slice(0, 2));
  assert.strictEqual(c.addFovShot(flat), null, 'a frame that faces the lens is not a measurement'); assert.strictEqual(c.shots.length, 5);
  c.clearFov(); assert.strictEqual(c.fovDeg, CAL.DEF_FOV);
});

test('the sheet in make_align_sheets.py (codes, marker size and places) is the one the detector and the page assume', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'make_align_sheets.py'), 'utf8');
  const codes = JSON.parse(/FOV_CODES\s*=\s*(\[[^\]]*\])/.exec(src)[1]);
  const side = +/FOV_MARKER_MM\s*=\s*(\d+)/.exec(src)[1];
  const pos = [.../FOV_MARKER_POS_MM\s*=\s*\[([^\]]*)\]/.exec(src)[1].matchAll(/\((\d+),\s*(\d+)\)/g)].map((m) => [+m[1], +m[2]]);
  assert.deepStrictEqual(codes, M.markers.FOV_CODES);
  assert.strictEqual(side, M.markers.SHEET.side);
  assert.deepStrictEqual(pos, M.markers.SHEET.pos);
  assert.strictEqual(+/FOV_BAR_MM\s*=\s*(\d+)/.exec(src)[1], CAL.BAR_MM, 'the length of the two bars');
  assert.strictEqual((src.match(new RegExp(`${CAL.BAR_MM} mm`, 'g')) || []).length >= 2, true);
});

test('FOV_SHEET (the four-click fallback) is the distance between the marker centres of that sheet', () => {
  const S = M.markers.SHEET;
  assert.strictEqual(CAL.FOV_SHEET.w, (S.pos[1][0] - S.pos[0][0]) / 1000);
  assert.strictEqual(CAL.FOV_SHEET.h, (S.pos[3][1] - S.pos[0][1]) / 1000);
  assert.strictEqual(CAL.FOV_SHEET.w, 0.15); assert.strictEqual(CAL.FOV_SHEET.h, 0.237);
});

test('Calib: a field of view measured elsewhere (the automatic measurement) is kept like a click-measured one', () => {
  const store = memory(), c = new CAL.Calib(store); c.use('cam1', W, H);
  assert.strictEqual(c.addFovDeg(64.2), 64.2); c.addFovDeg(63.8); c.addFovDeg(64.0);
  assert.ok(Math.abs(c.fovDeg - 64.0) < 1e-9 && c.fovMeasured && c.shots.length === 3);
  assert.strictEqual(c.addFovDeg(3), null, 'a field of view of 3 degrees is not one'); assert.strictEqual(c.addFovDeg(NaN), null); assert.strictEqual(c.shots.length, 3);
  const d = new CAL.Calib(store); d.use('cam1', W, H); assert.deepStrictEqual(d.shots, [64.2, 63.8, 64.0]);
});

// ---- named field-of-view calibrations (the dropdown of the webcam panel)
test('FOV library: the current field of view is saved under a name and can be used on another camera later', () => {
  const store = memory(), c = new CAL.Calib(store); c.use('camA', W, H);
  c.setFov(63.2);
  const r = c.saveFov('Laptop webcam');
  assert.ok(r.ok, r.why); assert.strictEqual(r.entry.name, 'Laptop webcam'); assert.strictEqual(r.entry.fovDeg, 63.2);
  assert.strictEqual(c.fovId, r.entry.id); assert.strictEqual(c.fovName, 'Laptop webcam');
  assert.deepStrictEqual(c.fovLib().map((e) => e.name), ['Laptop webcam']);
  const d = new CAL.Calib(store); d.use('camB', 640, 480);                                   // another camera, another size: nothing known yet
  assert.ok(!d.fovMeasured); assert.strictEqual(d.fovId, null);
  const e = d.useFov(r.entry.id);
  assert.ok(e && d.fovDeg === 63.2 && d.fovId === r.entry.id && d.fovName === 'Laptop webcam' && d.fovMeasured);
  const f = new CAL.Calib(store); f.use('camB', 640, 480);                                   // and it is still there after a reload
  assert.strictEqual(f.fovDeg, 63.2); assert.strictEqual(f.fovName, 'Laptop webcam');
});

test('FOV library: only a measured or typed field of view can be saved; the assumed one cannot', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H);
  const r = c.saveFov('x'); assert.strictEqual(r.ok, false); assert.match(r.why, /Measure or type/);
  assert.deepStrictEqual(c.fovLib(), []);
});

test('FOV library: names are trimmed, not empty, at most 40 characters, and unique whatever the case', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(60);
  assert.strictEqual(c.saveFov('   ').ok, false); assert.match(c.saveFov('').why, /name/i); assert.strictEqual(c.saveFov(null).ok, false);
  assert.strictEqual(c.saveFov('x'.repeat(41)).ok, false);
  const a = c.saveFov('  Desk   cam '); assert.ok(a.ok); assert.strictEqual(a.entry.name, 'Desk cam');
  c.setFov(70.5);
  const dup = c.saveFov('desk CAM'); assert.strictEqual(dup.ok, false); assert.match(dup.why, /already/);
  assert.ok(c.saveFov('Tripod cam').ok); assert.deepStrictEqual(c.fovLib().map((e) => e.name), ['Desk cam', 'Tripod cam']);
  assert.notStrictEqual(c.fovLib()[0].id, c.fovLib()[1].id);
});

test('FOV library: rename and delete; deleting the one in use keeps the field of view but forgets its name', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(61);
  const a = c.saveFov('One').entry; c.setFov(66); const b = c.saveFov('Two').entry;
  assert.ok(c.renameFov(a.id, 'First').ok); assert.deepStrictEqual(c.fovLib().map((e) => e.name), ['First', 'Two']);
  assert.strictEqual(c.renameFov(a.id, 'two').ok, false, 'a name that is taken by another one');
  assert.ok(c.renameFov(b.id, 'TWO').ok, 'the same name in another case, for itself, is fine');
  assert.strictEqual(c.renameFov('nope', 'x').ok, false);
  assert.strictEqual(c.fovId, b.id);
  assert.ok(c.deleteFov(b.id)); assert.strictEqual(c.fovId, null); assert.strictEqual(c.fovName, null); assert.strictEqual(c.fovDeg, 66, 'the number stays');
  assert.deepStrictEqual(c.fovLib().map((e) => e.name), ['First']);
  assert.strictEqual(c.deleteFov('nope'), false);
});

test('FOV library: measuring again, typing a value or assuming 70 again forgets which calibration was applied', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(63); const e = c.saveFov('A').entry;
  assert.strictEqual(c.fovId, e.id); c.setFov(64); assert.strictEqual(c.fovId, null);
  c.useFov(e.id); c.addFovDeg(62); assert.strictEqual(c.fovId, null);
  c.useFov(e.id); c.clearFov(); assert.strictEqual(c.fovId, null); assert.strictEqual(c.fovDeg, CAL.DEF_FOV);
  c.useFov(e.id); assert.strictEqual(c.fovId, e.id); assert.strictEqual(c.fovDeg, 63);
});

test('FOV library: a damaged or foreign record is ignored, bad entries are dropped, and the library is shared by all cameras', () => {
  const store = memory(); store.set('mumr.webcam.fovlib', 'rubbish');
  const c = new CAL.Calib(store); c.use('camA', W, H); assert.deepStrictEqual(c.fovLib(), []);
  store.set('mumr.webcam.fovlib', { v: 1, list: [{ id: 'f1', name: 'Good', fovDeg: 64 }, { id: 'f2', name: '', fovDeg: 60 }, { id: 'f3', name: 'Bad number', fovDeg: 500 }, null, 'x', { name: 'No id', fovDeg: 60 }] });
  assert.deepStrictEqual(c.fovLib().map((e) => e.name), ['Good']);
  const r = c.useFov('f1'); assert.ok(r); c.use('camA', W, H); assert.strictEqual(c.fovName, 'Good', 'the camera record remembers which one');
  store.set('mumr.webcam.fovlib', { v: 1, list: [] }); c.use('camA', W, H);
  assert.strictEqual(c.fovId, null, 'an entry that is gone is not applied any more'); assert.strictEqual(c.fovDeg, 64, 'but the number the camera has stays');
});

// ---- the sheet as it is shown: a phone shows sheet 4 small, and maybe a little stretched; the two 100 mm bars say how big (and how stretched)
test('sheet size: nothing entered is the printed size; one bar scales both ways; two bars can differ (a stretched picture); bad numbers are ignored', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H);
  assert.deepStrictEqual(c.sheetScale, { sx: 1, sy: 1 }); assert.deepStrictEqual(c.sheetBars(), { h: null, v: null });
  c.setSheetBars(28, null); assert.deepStrictEqual(c.sheetScale, { sx: 0.28, sy: 0.28 });
  c.setSheetBars(null, 31); assert.deepStrictEqual(c.sheetScale, { sx: 0.31, sy: 0.31 });
  c.setSheetBars(28, 35); assert.deepStrictEqual(c.sheetScale, { sx: 0.28, sy: 0.35 });
  for (const bad of [0, -5, 4.9, 1001, NaN, 'a', Infinity, undefined, null]) { c.setSheetBars(bad, null); assert.deepStrictEqual(c.sheetScale, { sx: 1, sy: 1 }, String(bad)); }
  c.setSheetBars('28.5', ' 30 '); assert.deepStrictEqual(c.sheetBars(), { h: 28.5, v: 30 }, 'numbers typed into a field are numbers');
  c.clearSheetBars(); assert.deepStrictEqual(c.sheetScale, { sx: 1, sy: 1 });
});

test('sheet size: it is kept in the browser for every camera, and a damaged record is ignored', () => {
  const store = memory(), c = new CAL.Calib(store); c.use('camA', W, H); c.setSheetBars(28, 31);
  const d = new CAL.Calib(store); d.use('camB', 640, 480); assert.deepStrictEqual(d.sheetBars(), { h: 28, v: 31 }); assert.deepStrictEqual(d.sheetScale, { sx: 0.28, sy: 0.31 });
  store.set('mumr.webcam.sheetbars', 'rubbish'); assert.deepStrictEqual(d.sheetScale, { sx: 1, sy: 1 });
  store.set('mumr.webcam.sheetbars', { v: 1, h: 9999, v2: -3 }); assert.deepStrictEqual(d.sheetBars(), { h: null, v: null });
});

// four clicks on the square centres of a sheet shown with the plane stretched by (px, py) of the printed size, seen at an angle by a camera of the given field of view
function clickedSheet(px, py, hfovDeg) {
  const cam0 = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, w = CAL.FOV_SHEET.w * px, h = CAL.FOV_SHEET.h * py, tilt = 55 * D;
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([X, Y]) => WC.project(cam0, hfovDeg * D, W, H, [0.4 * px - (Y - h / 2) * Math.sin(tilt), -(X - w / 2), (Y - h / 2) * Math.cos(tilt)]).slice(0, 2));
}
test('the four-click fallback: a smaller copy of the sheet measures the same field of view (only the shape counts) ...', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H);
  const deg = c.addFovShot(clickedSheet(0.28, 0.28, 63));
  assert.ok(Math.abs(deg - 63) < 0.05, `${deg}`);
});
test('... and a picture that is shown stretched is wrong until the bars are entered, then right', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H);
  const clicks = clickedSheet(0.28, 0.35, 63);                                        // (the sheet is 25 % taller on the screen than wide, against the printed shape)
  const wrong = c.addFovShot(clicks); assert.ok(Math.abs(wrong - 63) > 1, `unstretched assumption gives ${wrong}`);
  c.clearFov(); c.setSheetBars(28, 35);
  const right = c.addFovShot(clicks); assert.ok(Math.abs(right - 63) < 0.05, `with the bars: ${right}`);
});

// ---- camera profiles: the field of view, the lens and the latency of a camera, saved together under a name
test('profiles: the old list of named field-of-view calibrations shows up as profiles without a lens and a latency, and is never written', () => {
  const store = memory(); store.set('mumr.webcam.fovlib', { v: 1, list: [{ id: 'f1', name: 'Laptop', fovDeg: 63.2 }, { id: 'f4', name: 'Tripod', fovDeg: 71 }] });
  const c = new CAL.Calib(store); c.use('camA', W, H);
  assert.deepStrictEqual(c.profiles(), [{ id: 'f1', name: 'Laptop', fovDeg: 63.2, a1: null, a2: null, latencyMs: null }, { id: 'f4', name: 'Tripod', fovDeg: 71, a1: null, a2: null, latencyMs: null }]);
  c.setFov(66); const r = c.saveProfile('Desk');
  assert.ok(r.ok, r.why); assert.strictEqual(r.entry.id, 'f5', 'the numbering goes on after the old ones');
  assert.deepStrictEqual(store.get('mumr.webcam.fovlib', null), { v: 1, list: [{ id: 'f1', name: 'Laptop', fovDeg: 63.2 }, { id: 'f4', name: 'Tripod', fovDeg: 71 }] }, 'the old key is left alone');
  const two = store.get('mumr.webcam.profiles', null);
  assert.strictEqual(two.v, 2); assert.deepStrictEqual(two.list.map((e) => e.name), ['Laptop', 'Tripod', 'Desk']);
});

test('profiles: a profile keeps the field of view, the lens and the latency, and brings all three to another camera', () => {
  const store = memory(), c = new CAL.Calib(store); c.use('camA', W, H);
  assert.ok(!c.lensMeasured && !c.latencyMeasured); assert.strictEqual(c.a1, 0); assert.strictEqual(c.a2, 0); assert.strictEqual(c.latencyMs, null);
  c.setFov(64); assert.ok(c.setLens(-0.12, 0.01)); assert.ok(c.setLatency(85));
  const r = c.saveProfile('Webcam A'); assert.ok(r.ok, r.why);
  assert.deepStrictEqual(r.entry, { id: 'f1', name: 'Webcam A', fovDeg: 64, a1: -0.12, a2: 0.01, latencyMs: 85 });
  const d = new CAL.Calib(store); d.use('camB', 640, 480);
  assert.ok(!d.lensMeasured && d.latencyMs === null);
  const e = d.useProfile('f1'); assert.ok(e);
  assert.strictEqual(d.fovDeg, 64); assert.strictEqual(d.a1, -0.12); assert.strictEqual(d.a2, 0.01); assert.strictEqual(d.latencyMs, 85); assert.strictEqual(d.profileName, 'Webcam A');
  const f = new CAL.Calib(store); f.use('camB', 640, 480);                                    // and after a reload
  assert.strictEqual(f.a1, -0.12); assert.strictEqual(f.latencyMs, 85); assert.strictEqual(f.profileId, 'f1');
});

test('profiles: measuring the lens or the latency again forgets which profile was applied, and the other parts stay', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(64); c.setLens(-0.1, 0); c.setLatency(80); c.saveProfile('P');
  assert.strictEqual(c.profileName, 'P'); c.setLatency(90); assert.strictEqual(c.profileId, null); assert.strictEqual(c.a1, -0.1); assert.strictEqual(c.fovDeg, 64);
  c.useProfile('f1'); c.setLens(-0.2, 0.02); assert.strictEqual(c.profileId, null); assert.strictEqual(c.latencyMs, 80);
  c.useProfile('f1'); c.clearLens(); assert.ok(!c.lensMeasured); assert.strictEqual(c.a1, 0); assert.strictEqual(c.profileId, null);
  c.useProfile('f1'); c.clearLatency(); assert.strictEqual(c.latencyMs, null);
});

test('profiles: a lens that is not a lens, and a latency that is not one, are refused and leave what was there', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setLens(-0.1, 0.02); c.setLatency(80);
  for (const bad of [[0.6, 0], [0, -0.5], [NaN, 0], [0, undefined], ['a', 'b'], [Infinity, 0]]) assert.strictEqual(c.setLens(...bad), false, JSON.stringify(bad));
  for (const bad of [-1, 2001, NaN, '85', null, Infinity]) assert.strictEqual(c.setLatency(bad), false, String(bad));
  assert.strictEqual(c.a1, -0.1); assert.strictEqual(c.a2, 0.02); assert.strictEqual(c.latencyMs, 80);
});

test('profiles: only something measured is worth saving; the lens alone, or the latency alone, is enough', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H);
  assert.strictEqual(c.saveProfile('x').ok, false);
  c.setLatency(70); const r = c.saveProfile('Latency only'); assert.ok(r.ok);
  assert.deepStrictEqual(r.entry, { id: 'f1', name: 'Latency only', fovDeg: CAL.DEF_FOV, a1: null, a2: null, latencyMs: 70 });
});

test('profiles: a damaged record, or an entry with a lens that is not one, does no harm', () => {
  const store = memory(); store.set('mumr.webcam.profiles', { v: 9, list: [] });
  const c = new CAL.Calib(store); c.use('camA', W, H);
  assert.deepStrictEqual(c.profiles(), [], 'a version we do not know is not read (and the old key is empty)');
  store.set('mumr.webcam.profiles', 'rubbish'); assert.deepStrictEqual(c.profiles(), []);
  store.set('mumr.webcam.profiles', { v: 2, list: [{ id: 'f1', name: 'Odd', fovDeg: 64, a1: 3, a2: 0, latencyMs: 99999 }, { id: 'f2', name: 'Fine', fovDeg: 60, a1: -0.1, a2: 0.02, latencyMs: 40 }, { id: 'f3', name: '', fovDeg: 60 }, { id: 'f4', name: 'Tiny', fovDeg: 5 }, null, 'x'] });
  assert.deepStrictEqual(c.profiles(), [{ id: 'f1', name: 'Odd', fovDeg: 64, a1: null, a2: null, latencyMs: null }, { id: 'f2', name: 'Fine', fovDeg: 60, a1: -0.1, a2: 0.02, latencyMs: 40 }]);
});

test('profiles: a camera record of the first version still loads, and the new one keeps the lens and the latency of that camera', () => {
  const store = memory(); store.set('mumr.webcam.fovlib', { v: 1, list: [{ id: 'f1', name: 'Old', fovDeg: 64 }] });
  store.set(`mumr.webcam.camA.${W}x${H}`, { v: 1, clicks: [[10, 10], null, null], shots: [64], choice: 0, fovId: 'f1' });
  const c = new CAL.Calib(store); c.use('camA', W, H);
  assert.strictEqual(c.profileName, 'Old'); assert.deepStrictEqual(c.clicks[0], [10, 10]);
  c.setLens(-0.05, 0); c.setLatency(60);
  const d = new CAL.Calib(store); d.use('camA', W, H);
  assert.strictEqual(d.a1, -0.05); assert.strictEqual(d.latencyMs, 60); assert.strictEqual(d.profileId, null, 'measured since: no longer the saved profile');
});

test('delayFor: the address wins, then the measured latency of the camera, then 60 ms', () => {
  assert.deepStrictEqual(CAL.delayFor('?delay=100', 85), { ms: 100, from: 'address' });
  assert.deepStrictEqual(CAL.delayFor('?delay=0', 85), { ms: 0, from: 'address' }, 'zero is a value');
  assert.deepStrictEqual(CAL.delayFor('?x=1', 84.6), { ms: 85, from: 'profile' });
  assert.deepStrictEqual(CAL.delayFor('', null), { ms: 60, from: 'default' });
  assert.deepStrictEqual(CAL.delayFor(undefined, undefined), { ms: 60, from: 'default' });
  for (const bad of ['?delay=', '?delay=abc', '?delay=-5', '?delay=99999']) assert.deepStrictEqual(CAL.delayFor(bad, 70), { ms: 70, from: 'profile' }, bad);
  assert.deepStrictEqual(CAL.delayFor('?delay=abc', NaN), { ms: 60, from: 'default' });
  assert.deepStrictEqual(CAL.delayFor('', 5000), { ms: 60, from: 'default' }, 'a latency that cannot be right is not used');
});

// ---- profiles that are made empty and filled in by the calibrations (the calibration mode's parameter section)
test('createProfile: an empty profile (field of view assumed), which the camera then uses; names as for any profile', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); c.setFov(66); c.setLens(-0.1, 0); c.setLatency(80);
  const r = c.createProfile('  Desk   cam ');
  assert.ok(r.ok, r.why); assert.deepStrictEqual(r.entry, { id: 'f1', name: 'Desk cam', fovDeg: null, a1: null, a2: null, latencyMs: null });
  assert.strictEqual(c.profileId, 'f1'); assert.strictEqual(c.fovMeasured, false); assert.strictEqual(c.fovDeg, CAL.DEF_FOV); assert.ok(!c.lensMeasured && !c.latencyMeasured, 'the camera now has what the profile has: nothing yet');
  assert.deepStrictEqual(c.profiles().map((e) => e.name), ['Desk cam']);
  assert.strictEqual(c.createProfile('desk CAM').ok, false); assert.strictEqual(c.createProfile('').ok, false); assert.strictEqual(c.createProfile('x'.repeat(41)).ok, false);
  const b = c.createProfile('Tripod'); assert.ok(b.ok); assert.strictEqual(b.entry.id, 'f2'); assert.strictEqual(c.profileId, 'f2');
});

test('updateProfile: what a calibration found goes into the profile, the rest stays; the camera follows when it uses it', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); const id = c.createProfile('P').entry.id;
  let r = c.updateProfile(id, { fovDeg: 64.123456 }); assert.ok(r.ok); assert.strictEqual(r.entry.fovDeg, 64.12);
  assert.strictEqual(c.fovDeg, 64.12, 'the camera uses this profile, so it has the new field of view at once'); assert.ok(c.fovMeasured);
  r = c.updateProfile(id, { lens: { a1: -0.12, a2: 0.01 }, latencyMs: 85 });
  assert.deepStrictEqual(c.profiles()[0], { id, name: 'P', fovDeg: 64.12, a1: -0.12, a2: 0.01, latencyMs: 85 });
  assert.strictEqual(c.a1, -0.12); assert.strictEqual(c.latencyMs, 85);
  c.updateProfile(id, { latencyMs: 90 }); assert.strictEqual(c.profiles()[0].fovDeg, 64.12, 'what is not in the patch stays'); assert.strictEqual(c.profiles()[0].a1, -0.12);
  c.updateProfile(id, { fovDeg: null }); assert.strictEqual(c.profiles()[0].fovDeg, null); assert.strictEqual(c.fovMeasured, false); assert.strictEqual(c.fovDeg, CAL.DEF_FOV);
  c.updateProfile(id, { lens: null }); assert.ok(!c.lensMeasured);
  // reload: the profile and the camera's record agree
  const store2 = c.store, d = new CAL.Calib(store2); d.use('camA', W, H); assert.strictEqual(d.profileId, id); assert.strictEqual(d.latencyMs, 90);
});

test('updateProfile: a value that is not valid is left out and named; another profile can be filled in and then used; nothing for a profile that is not there', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); const a = c.createProfile('A').entry.id, b = c.createProfile('B').entry.id;
  assert.strictEqual(c.profileId, b);
  let r = c.updateProfile(a, { fovDeg: 500, lens: { a1: 3, a2: 0 }, latencyMs: -4 });
  assert.deepStrictEqual(r.skipped, ['fovDeg', 'lens', 'latencyMs']); assert.deepStrictEqual(c.profiles().find((e) => e.id === a), { id: a, name: 'A', fovDeg: null, a1: null, a2: null, latencyMs: null });
  assert.strictEqual(c.profileId, b, 'the camera still uses B: A was only filled in');
  r = c.updateProfile(a, { latencyMs: 70 }); assert.strictEqual(c.latencyMs, null, 'B has no latency, and the camera uses B');
  r = c.updateProfile(a, { latencyMs: 71 }, { use: true }); assert.strictEqual(c.profileId, a); assert.strictEqual(c.latencyMs, 71);
  assert.strictEqual(c.updateProfile('nope', { latencyMs: 5 }).ok, false); assert.strictEqual(c.updateProfile(a, null).ok, true, 'an empty patch changes nothing');
});

test('removeProfile: gone for good; a camera that used it is back to the assumed field of view, no lens, no latency; another one is untouched', () => {
  const c = new CAL.Calib(memory()); c.use('camA', W, H); const a = c.createProfile('A').entry.id; c.updateProfile(a, { fovDeg: 60, lens: { a1: -0.1, a2: 0 }, latencyMs: 50 });
  const b = c.createProfile('B').entry.id; c.updateProfile(b, { fovDeg: 70.5 });
  assert.strictEqual(c.profileId, b);
  assert.strictEqual(c.removeProfile(a), true); assert.strictEqual(c.profileId, b); assert.strictEqual(c.fovDeg, 70.5); assert.deepStrictEqual(c.profiles().map((e) => e.name), ['B']);
  assert.strictEqual(c.removeProfile(b), true); assert.strictEqual(c.profileId, null); assert.strictEqual(c.fovMeasured, false); assert.strictEqual(c.fovDeg, CAL.DEF_FOV); assert.ok(!c.lensMeasured && !c.latencyMeasured);
  assert.strictEqual(c.removeProfile(b), false); assert.deepStrictEqual(c.profiles(), []);
});
