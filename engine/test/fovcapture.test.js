const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const MK = M.markers, FC = M.fovcapture;

const D = Math.PI / 180, W = 1280, H = 720, TRUE_DEG = 63, TRUE = TRUE_DEG * D;
let seed = 31337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const lerp = (a, b, f) => a + (b - a) * f;
const mix = (A, B, f) => { const o = {}; for (const k of Object.keys(A)) o[k] = lerp(A[k], B[k], f); return o; };
const pose = (i) => { const T = FC.TARGETS[i]; return { d: T.d, tilt: T.tilt, yaw: T.yaw, roll: T.roll, left: T.left, up: T.up }; };
const AWAY = { d: 1.2, tilt: 30, yaw: 0, roll: 0, left: 0.5, up: 0.3 };
const FACE_ON = { d: 0.6, tilt: 0, yaw: 0, roll: 0, left: 0, up: 0 };

// what the detector says about the sheet in a pose: four markers, corners a little off
function seen(p, noise = 0.25, hfov = TRUE) {
  const P = MK.sheetPose(p);
  return [0, 1, 2, 3].map((k) => ({ id: k, corners: [0, 1, 2, 3].map((i) => { const [X, Y] = MK.cornerMM(k, i), q = MK.sheetToPicture(P, hfov, W, H, X, Y); return [q[0] + noise * gauss(), q[1] + noise * gauss()]; }) }));
}
// a scene to drive a FovCapture through: frames 120 ms apart (about eight a second, as the page runs the detector)
function scene() {
  const cap = new FC.FovCapture({ W, H, hfovDeg: 70 });
  const sc = { cap, t: 0, last: null, shotsAt: [] };
  sc.frame = (markers) => { sc.t += 120; const before = cap.shots.length; sc.last = cap.feed(markers, sc.t); if (cap.shots.length > before) sc.shotsAt.push(sc.t); return sc.last; };
  sc.show = (p, noise) => sc.frame(seen(p, noise));
  sc.hold = (p, n, noise) => { for (let i = 0; i < n; i++) sc.show(p, noise); return sc.last; };
  sc.move = (A, B, n = 8, noise) => { for (let i = 0; i <= n; i++) sc.show(mix(A, B, i / n), noise); return sc.last; };
  return sc;
}

test('nothing in view: it says what to do', () => {
  const sc = scene(), s = sc.frame([]);
  assert.strictEqual(s.state, 'looking'); assert.strictEqual(s.shots, 0); assert.match(s.msg, /Hold sheet 4/);
  assert.ok(s.next && s.next.n === 1, 'it already suggests the first place');
});

test('the sheet comes in, moves, settles: one snapshot, about half a second after it is steady, with the right field of view', () => {
  const sc = scene();
  sc.move(AWAY, pose(0));
  assert.strictEqual(sc.cap.shots.length, 0, 'nothing while it moves');
  const settled = sc.t;
  sc.hold(pose(0), 12);
  assert.strictEqual(sc.cap.shots.length, 1);
  const wait = sc.shotsAt[0] - settled;
  assert.ok(wait >= 400 && wait <= 900, `${wait} ms after it settled`);
  assert.ok(Math.abs(sc.cap.fovDeg - TRUE_DEG) < 0.3, `${sc.cap.fovDeg}`);
  assert.strictEqual(sc.last.state, 'taken');
});

test('held still for longer it does not shoot again', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);
  sc.hold(pose(0), 30);
  assert.strictEqual(sc.cap.shots.length, 1); assert.match(sc.last.msg, /next place/);
});

test('the places come in the suggested order, then it is done, with the field of view right', () => {
  const sc = scene(); let from = AWAY; const order = [];
  for (let round = 0; round < 8 && sc.last === null ? true : round < 8 && sc.last.next; round++) {
    const idx = (sc.last ? sc.last.next.n : 1) - 1; order.push(idx + 1);
    sc.move(from, pose(idx)); sc.hold(pose(idx), 9); from = pose(idx);
  }
  assert.deepStrictEqual(order, [1, 2, 3]);
  assert.strictEqual(sc.cap.shots.length, 3); assert.ok(sc.cap.done, 'three shots that agree are enough');
  assert.strictEqual(sc.last.next, null);
  assert.ok(Math.abs(sc.cap.fovDeg - TRUE_DEG) < 0.3, `${sc.cap.fovDeg}`); assert.ok(sc.cap.spread < 0.5, `spread ${sc.cap.spread}`);
});

test('a sheet that drifts slowly (4 mm a frame) gets no snapshot', () => {
  const sc = scene();
  for (let i = 0; i < 40; i++) { const p = pose(2); p.left += i * 0.004; sc.show(p); }
  assert.strictEqual(sc.cap.shots.length, 0);
});

test('a sheet that is shaken hard (six pixels of noise on every corner) gets no snapshot, and the page says to keep it steadier', () => {
  const sc = scene(); sc.hold(pose(0), 40, 6);
  assert.strictEqual(sc.cap.shots.length, 0); assert.match(sc.last.msg, /steadier/);
});

test('a trembling hand (about 3 px, twice a second, and the lean wobbling) still gets a snapshot, and the field of view is right', () => {
  const sc = scene(); sc.move(AWAY, pose(0));
  const settled = sc.t;
  for (let i = 0; i < 30; i++) {
    const ph = 2 * Math.PI * 2 * (sc.t / 1000), p = pose(0);
    p.left += 0.0018 * Math.sin(ph); p.up += 0.0014 * Math.cos(ph * 1.3); p.tilt += 0.6 * Math.sin(ph * 0.9);
    sc.show(p, 0.4);
  }
  assert.strictEqual(sc.cap.shots.length, 1, 'a shot');
  assert.ok(sc.shotsAt[0] - settled < 2500, `${sc.shotsAt[0] - settled} ms`);
  assert.ok(Math.abs(sc.cap.fovDeg - TRUE_DEG) / TRUE_DEG < 0.015, `${sc.cap.fovDeg}`);
});

test('a sheet that is moving slowly (1 mm a frame, about a pixel and a half) still gets a snapshot, and the field of view is right', () => {
  const sc = scene(); sc.move(AWAY, pose(0));
  for (let i = 0; i < 30; i++) { const p = pose(0); p.left += i * 0.001; sc.show(p); }
  assert.ok(sc.cap.shots.length >= 1, 'a shot');
  assert.ok(Math.abs(sc.cap.fovDeg - TRUE_DEG) / TRUE_DEG < 0.015, `${sc.cap.fovDeg}`);
});

test('a marker under a finger: no shot, and it says how many are missing', () => {
  const sc = scene(); let s;
  for (let i = 0; i < 12; i++) s = sc.frame(seen(pose(0)).slice(0, 3));
  assert.strictEqual(sc.cap.shots.length, 0); assert.strictEqual(s.state, 'looking'); assert.match(s.msg, /1 of the 4 markers are not seen/);
  assert.deepStrictEqual(s.seen, [0, 1, 2]);
});

test('a sheet that faces the camera is refused, and the message stays until it is moved', () => {
  const sc = scene(); sc.hold(FACE_ON, 14);
  assert.strictEqual(sc.cap.shots.length, 0); assert.match(sc.last.msg, /Lean the sheet further back/);
  sc.hold(FACE_ON, 6); assert.match(sc.last.msg, /Lean the sheet further back/, 'still there');
  sc.move(FACE_ON, pose(0)); assert.doesNotMatch(sc.last.msg, /Lean the sheet further back/, 'gone once it moves');
});

test('after a shot, putting the sheet down and picking it up in the same place is not a second shot', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);
  for (let i = 0; i < 6; i++) sc.frame([]);                                       // out of sight for 0.7 s: it is ready for another
  assert.strictEqual(sc.last.state, 'looking');
  sc.hold(pose(0), 12);
  assert.strictEqual(sc.cap.shots.length, 1); assert.match(sc.last.msg, /same place/);
});

test('the suggestions skip a place that a shot already covers', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);
  assert.strictEqual(sc.cap.next().n, 2);
  sc.move(pose(0), pose(2)); sc.hold(pose(2), 12);                                   // (went to place 3 instead of 2)
  assert.strictEqual(sc.cap.shots.length, 2);
  assert.strictEqual(sc.cap.next().n, 4, 'places 1 and 3 are covered and are skipped; place 2 was shown and not used, so the outline moves on, and place 2 comes round again after the others');
});

test('every suggested place is inside the picture with all four markers, whatever the field of view is assumed to be', () => {
  for (const deg of [55, 70, 90]) {
    const cap = new FC.FovCapture({ W, H, hfovDeg: deg });
    const views = FC.TARGETS.map((_, n) => cap.view(n)).filter(Boolean);
    assert.ok(views.length >= 4, `${views.length} places fit at ${deg} degrees`);
    for (const v of views) {
      assert.strictEqual(v.outline.length, 4);
      for (const sl of v.slots) for (const [u, w] of sl) assert.ok(u >= 10 && u <= W - 10 && w >= 10 && w <= H - 10, `place ${v.n} at ${deg}: (${u}, ${w})`);
    }
  }
});

test('turning the sheet in place to another lean counts as moving: it can be shot again without taking it away', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);
  const p2 = Object.assign({}, pose(0), { tilt: 62 });                                  // the same middle, leaning back further
  sc.move(pose(0), p2, 4); sc.hold(p2, 12);
  assert.strictEqual(sc.cap.shots.length, 2);
});

test('reset forgets the shots', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12); sc.cap.reset();
  assert.strictEqual(sc.cap.shots.length, 0); assert.strictEqual(sc.cap.fovDeg, null); assert.strictEqual(sc.cap.status().state, 'looking');
});

// ---- a sheet that is shown small (a phone) and maybe stretched: the page is told how big the 100 mm bars are on the screen
// what the detector sees of a sheet that is really `scale` times the printed one (across, down), in the pose p (the pose is in real metres)
function seenScaled(p, scale, noise = 0.25) {
  const P = MK.sheetPose(p);
  return [0, 1, 2, 3].map((k) => ({ id: k, corners: [0, 1, 2, 3].map((i) => { const [X, Y] = MK.cornerMM(k, i), q = MK.sheetToPicture(P, TRUE, W, H, X, Y, scale); return [q[0] + noise * gauss(), q[1] + noise * gauss()]; }) }));
}
const physical = (i, sx) => { const T = FC.TARGETS[i]; return { d: T.d * sx, tilt: T.tilt, yaw: T.yaw, roll: T.roll, left: T.left * sx, up: T.up * sx }; };
function shoot(cap, scale, i) {
  let t = 0, last = null;
  for (let k = 0; k < 14; k++) { t += 120; last = cap.feed(seenScaled(physical(i, scale.sx), scale), t); }
  return last;
}

test('a sheet shown small (28 % of the printed size, as on a phone): with the size entered the guide shrinks to fit it, with the distances, and the field of view is right', () => {
  const scale = { sx: 0.28, sy: 0.28 };
  const full = new FC.FovCapture({ W, H, hfovDeg: 70 }).next(), small = new FC.FovCapture({ W, H, hfovDeg: 70, scale }).next();
  assert.strictEqual(full.n, 1); assert.strictEqual(small.n, 1);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) assert.ok(Math.abs(full.outline[i][k] - small.outline[i][k]) < 1e-6, 'the same picture: a small sheet held near is a big one held far');
  assert.ok(Math.abs(small.dist - 0.55 * 0.28) < 1e-9 && Math.abs(full.dist - 0.55) < 1e-9, `${small.dist} m and ${full.dist} m`);
  const cap = new FC.FovCapture({ W, H, hfovDeg: 70, scale });
  shoot(cap, scale, 0);
  assert.strictEqual(cap.shots.length, 1); assert.ok(Math.abs(cap.fovDeg - TRUE_DEG) < 0.3, `${cap.fovDeg}`);
});

test('the scale can be given as a function (the page changes it while it measures)', () => {
  let scale = { sx: 0.28, sy: 0.28 };
  const cap = new FC.FovCapture({ W, H, hfovDeg: 70, scale: () => scale });
  assert.ok(Math.abs(cap.next().dist - 0.154) < 1e-9);
  scale = { sx: 0.5, sy: 0.5 }; assert.ok(Math.abs(cap.next().dist - 0.275) < 1e-9);
});

test('a sheet shown stretched (28 % across, 35 % down): wrong without the two sizes, right with them', () => {
  const scale = { sx: 0.28, sy: 0.35 }, wrong = new FC.FovCapture({ W, H, hfovDeg: 70 }), right = new FC.FovCapture({ W, H, hfovDeg: 70, scale });
  shoot(wrong, scale, 0); shoot(right, scale, 0);
  assert.strictEqual(right.shots.length, 1); assert.ok(Math.abs(right.fovDeg - TRUE_DEG) < 0.3, `${right.fovDeg}`);
  assert.ok(wrong.shots.length === 0 || Math.abs(wrong.fovDeg - TRUE_DEG) > 1, `without the sizes it says ${wrong.fovDeg}`);
});

test('markers.sheetToPicture: a scale of 1 or none is the printed sheet, and a smaller sheet at a proportionally smaller distance is the same picture', () => {
  const P = MK.sheetPose({ d: 0.55, tilt: 50, yaw: 20, roll: 10, left: 0.05, up: 0 }), Q = MK.sheetPose({ d: 0.55 * 0.28, tilt: 50, yaw: 20, roll: 10, left: 0.05 * 0.28, up: 0 });
  const a = MK.sheetToPicture(P, TRUE, W, H, 30, 40), b = MK.sheetToPicture(P, TRUE, W, H, 30, 40, { sx: 1, sy: 1 }), c = MK.sheetToPicture(Q, TRUE, W, H, 30, 40, { sx: 0.28, sy: 0.28 });
  for (let k = 0; k < 2; k++) { assert.strictEqual(a[k], b[k]); assert.ok(Math.abs(a[k] - c[k]) < 1e-6, `${a[k]} vs ${c[k]}`); }
});

test('a shot that is not at the suggested place still uses the suggestion up: the outline moves on and does not come back to the same place', () => {
  const sc = scene();
  const elsewhere = { d: 0.72, tilt: 40, yaw: 18, roll: 12, left: 0.04, up: -0.03 };           // not near any of the suggested places
  const first = sc.frame([]); assert.strictEqual(first.next.n, 1);
  sc.move(AWAY, elsewhere); sc.hold(elsewhere, 12);
  assert.strictEqual(sc.cap.shots.length, 1);
  assert.strictEqual(sc.last.next.n, 2, 'the second place is suggested, not the first again');
  const other = { d: 0.5, tilt: 60, yaw: -30, roll: -20, left: -0.1, up: 0.05 };
  sc.move(elsewhere, other); sc.hold(other, 12);
  assert.strictEqual(sc.cap.shots.length, 2);
  assert.ok(![1, 2].includes(sc.last.next.n), `a place that was already shown is not shown again straight away (it says ${sc.last.next.n})`);
});

test('the same place twice does not use up a suggestion', () => {
  const sc = scene(); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);
  assert.strictEqual(sc.last.next.n, 2);
  sc.move(pose(0), AWAY); sc.hold(AWAY, 3); sc.move(AWAY, pose(0)); sc.hold(pose(0), 12);                // (the sheet went away and came back to the first place)
  assert.strictEqual(sc.cap.shots.length, 1, 'refused as the same place'); assert.strictEqual(sc.last.next.n, 2, 'the suggestion has not moved');
});

// ---- a camera whose picture is bent: the shots of the sheet disagree, and the lens that makes them agree is found
const LNs = M.lens;
function seenBent(p, lens, noise = 0.25) {
  const P = MK.sheetPose(p);
  return [0, 1, 2, 3].map((k) => ({ id: k, corners: [0, 1, 2, 3].map((i) => { const [X, Y] = MK.cornerMM(k, i), q = MK.sheetToPicture(P, TRUE, W, H, X, Y), b = LNs.toPicture(lens, q[0], q[1]); return [b[0] + noise * gauss(), b[1] + noise * gauss()]; }) }));
}
function drive(lens, places = [0, 1, 2, 3, 4]) {
  const cap = new FC.FovCapture({ W, H, hfovDeg: 70 }); let t = 0;
  for (const n of places) {
    const ms = seenBent(pose(n), lens);
    for (let k = 0; k < 10; k++) { t += 120; cap.feed(ms.map((m) => ({ id: m.id, corners: m.corners.map((c) => [c[0] + 0.1 * gauss(), c[1] + 0.1 * gauss()]) })), t); }
    t += 3000; cap.feed([], t); cap.feed([], t + 600); t += 700;
  }
  return cap;
}

test('a bent picture: the shots disagree and the measurement does not finish, but the lens that makes them agree is found, and the field of view with it', () => {
  for (const a1 of [-0.2, -0.3, -0.25]) {
    const cap = drive({ a1, a2: 0, W, H });
    assert.strictEqual(cap.done, false, `a1 ${a1}: the shots as seen do not agree (${cap.shots.map((s) => s.fovDeg.toFixed(0)).join(', ')})`);
    const g = cap.lensGuess();
    assert.ok(g, `a1 ${a1}: a lens was found`);
    assert.ok(Math.sign(g.a1) === Math.sign(a1) && Math.abs(g.a1 - a1) < 0.08, `a1 ${a1}: found ${g.a1} (it is rough: only the field of view has to be right)`); assert.strictEqual(g.a2, 0);
    assert.ok(Math.abs(g.fovDeg - TRUE_DEG) / TRUE_DEG < 0.015, `a1 ${a1}: field of view ${g.fovDeg}`); assert.ok(g.spread / g.fovDeg <= 0.03);
  }
});

test('a lens that also has a2 is found as the one bend that fits: the field of view is still right', () => {
  const g = drive({ a1: -0.2, a2: 0.03, W, H }).lensGuess();
  assert.ok(g && Math.abs(g.fovDeg - TRUE_DEG) / TRUE_DEG < 0.015, `${g && g.fovDeg}`);
});

test('no bend, or a bend too slight to matter, or fewer than three shots: no guess (the shots agree or there is nothing to go on)', () => {
  const straight = drive({ a1: 0, a2: 0, W, H }); assert.ok(straight.done); assert.strictEqual(straight.lensGuess(), null);
  const slight = drive({ a1: -0.08, a2: 0, W, H }); assert.ok(slight.done, 'the shots agree to 3 percent'); assert.strictEqual(slight.lensGuess(), null);
  const two = drive({ a1: -0.2, a2: 0, W, H }, [0, 1]); assert.strictEqual(two.lensGuess(), null);
  assert.strictEqual(new FC.FovCapture({ W, H }).lensGuess(), null);
});
