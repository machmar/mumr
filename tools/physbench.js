// The physics benchmark (docs/superpowers/plans/2026-10-26-physics-performance.md, task A0): what engine/client/physics.js costs a frame,
// and whether it still does the same thing.
//   node tools/physbench.js [--n 10,30,50] [--settings lab|cube] [--room] [--hands] [--secs 4] [--save file.json] [--compare file.json] [--module path]
// (--module: another copy of physics.js to measure instead, e.g. the one before a change, for an A/B in the same minute)
// For each n: a heap dropped as apps/lab/boxes.js drops it, stepped at 72 Hz; the frame's ms (mean, p95, max, first second), how many sleep at
// the end, the worst overlap (box in box, box in floor), the heap's height. Then the small scenes (one cube dropped on a corner and thrown, a
// stack of five), whose end states are not chaotic: --save writes them, --compare says how far they are from a saved run (mm and degrees).
// A heap's end state is chaotic (a float rounded the other way gives another heap), so heaps are compared by their numbers, not box by box.
const fs = require('fs');
const path = require('path');
const M = require('../engine/client/index.js');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]; };
if (arg('module', false)) { delete M.physics; require(path.resolve(arg('module'))); }
const P = M.physics;
const NS = String(arg('n', '10,30,50')).split(',').map(Number), SETTINGS = arg('settings', 'lab'), SECS = +arg('secs', 4);
const LAB = { world: { substep: 1 / 72, maxMove: 0.02, rounds: 8 }, sleep: { v: 0.03, w: 0.3, after: 0.3 } };        // (apps/lab/boxes.js PHYSICS and SLEEP)
const CFG = SETTINGS === 'cube' ? { world: {}, sleep: {} } : LAB;
const SIZE = 0.12, FRAME = 1 / 72;

// a table under half of the heap and two walls beside it (the room format of room.js: planes { l, v (upright), p (corners) })
const plane = (l, v, p) => ({ l, v, p });
const ROOM = { planes: [
  plane('table', false, [[0.5, -0.5, 0.4], [1.2, -0.5, 0.4], [1.2, 0.5, 0.4], [0.5, 0.5, 0.4]]),
  plane('wall', true, [[0.1, -2, 0], [0.1, 2, 0], [0.1, 2, 2.4], [0.1, -2, 2.4]]),
  plane('wall', true, [[-2, 0.45, 0], [2, 0.45, 0], [2, 0.45, 2.4], [-2, 0.45, 2.4]]),
] };

// one hand of 25 joints sweeping through the heap and back, once every 2 s, 5 cm above the floor
function hand(t) {
  const x = 0.5 + 0.35 * Math.sin(t * Math.PI), joints = [];
  for (let i = 0; i < 25; i++) joints.push([x + (i % 5) * 0.02, -0.04 + Math.floor(i / 5) * 0.02, 0.05 + (i % 3) * 0.01]);
  return [{ id: 'h', spheres: P.handSpheres({ points: [], joints }) }];
}

function heap(n, room) {
  const w = new P.World(Object.assign({ room: room ? ROOM : null }, CFG.world));
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = 0.05 + 0.045 * (i % 7);
    w.add(P.makeBox({ size: [SIZE, SIZE, SIZE], p: [0.5 + Math.cos(a) * r, Math.sin(a) * r, SIZE / 2 + 0.05 + i * 0.07], sleep: CFG.sleep }));
  }
  return w;
}

// the deepest a box is in another box or below the floor (m; 0: nothing inside anything)
function worstOverlap(w) {
  let worst = 0;
  const B = w.bodies;
  for (let i = 0; i < B.length; i++) {
    for (const c of P.corners(B[i])) worst = Math.max(worst, -c[2]);
    for (let j = i + 1; j < B.length; j++) for (const c of w._boxBox(B[i], B[j])) worst = Math.max(worst, -c.gap);
  }
  return worst;
}

const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
function runHeap(n) {
  const w = heap(n, !!arg('room', false)), times = [], hands = !!arg('hands', false);
  for (let f = 0, t = 0; f < Math.round(SECS / FRAME); f++, t += FRAME) {
    const a = process.hrtime.bigint();
    if (hands) w.setHands(hand(t), t);
    w.step(FRAME);
    times.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  const s = times.slice().sort((a, b) => a - b), mean = (a) => a.reduce((x, v) => x + v, 0) / a.length;
  return { n, mean: mean(times), p95: q(s, 0.95), max: s[s.length - 1], first: mean(times.slice(0, 72)), asleep: w.bodies.filter((b) => b.asleep).length,
    overlap: worstOverlap(w), height: Math.max(...w.bodies.map((b) => b.p[2])), meanZ: mean(w.bodies.map((b) => b.p[2])) };
}

// the small scenes: the same steps every run, end states not chaotic
const SCENES = {
  cornerDrop() {
    const d3 = 1 / Math.sqrt(3), w = new P.World(), b = P.makeBox({ size: [SIZE, SIZE, SIZE], p: [0, 0, 1], q: P.quat.fromAxisAngle([-d3, d3, 0], Math.acos(-d3)) });
    w.add(b); for (let i = 0; i < 3 * 240; i++) w.step(1 / 240); return w.bodies;
  },
  throwOnTable() {
    const w = new P.World({ room: ROOM }), b = P.makeBox({ size: [SIZE, SIZE, SIZE], p: [0.4, 0, 0.8] });
    b.v = [3, 0.5, 0]; b.w = [0, 0, 4]; w.add(b); for (let i = 0; i < 3 * 240; i++) w.step(1 / 240); return w.bodies;
  },
  stack5() {
    const w = new P.World(CFG.world);
    for (let i = 0; i < 5; i++) w.add(P.makeBox({ size: [SIZE, SIZE, SIZE], p: [0.5 + i * 0.004, 0, SIZE / 2 + i * (SIZE + 0.002)], sleep: CFG.sleep }));
    for (let i = 0; i < 3 * 72; i++) w.step(FRAME); return w.bodies;
  },
  push() {
    const w = new P.World(CFG.world), b = P.makeBox({ size: [SIZE, SIZE, SIZE], p: [0.5, 0, SIZE / 2], sleep: CFG.sleep }); w.add(b);
    for (let f = 0, t = 0; f < 2 * 72; f++, t += FRAME) { w.setHands([{ id: 'f', spheres: [{ p: [0.3 + t * 0.4, 0, 0.05], r: 0.012 }] }], t); w.step(FRAME); }
    return w.bodies;
  },
};
const state = (bodies) => bodies.map((b) => ({ p: b.p.slice(), q: b.q.slice() }));
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180 / Math.PI;

const ms = (v) => v.toFixed(2).padStart(6);
console.log(`physics bench${arg('module', false) ? ` (${arg('module')})` : ''}: settings ${SETTINGS}, ${SECS} s at 72 Hz${arg('room', false) ? ', room' : ''}${arg('hands', false) ? ', a hand sweeping' : ''}`);
console.log('    n   mean    p95    max  first s  asleep  overlap mm  top m  mean z m   (ms a frame; first s: the mean over the first second)');
{ const w = heap(20, true); for (let f = 0; f < 144; f++) { w.setHands(hand(f * FRAME), f * FRAME); w.step(FRAME); } }      // (warm the JIT first: else the first n pays for it)
for (const n of NS) {
  const r = runHeap(n);
  console.log(`${String(n).padStart(5)} ${ms(r.mean)} ${ms(r.p95)} ${ms(r.max)}  ${ms(r.first)}  ${String(r.asleep).padStart(3)}/${String(n).padEnd(3)} ${(r.overlap * 1000).toFixed(1).padStart(8)}   ${r.height.toFixed(2).padStart(5)}   ${r.meanZ.toFixed(3)}`);
}
const scenes = {}; for (const k of Object.keys(SCENES)) scenes[k] = state(SCENES[k]());
if (arg('save', false)) { fs.writeFileSync(arg('save'), JSON.stringify(scenes)); console.log(`scenes saved to ${arg('save')}`); }
if (arg('compare', false)) {
  const old = JSON.parse(fs.readFileSync(arg('compare'), 'utf8'));
  for (const k of Object.keys(scenes)) {
    let dp = 0, dq = 0;
    scenes[k].forEach((s, i) => { const o = old[k][i]; dp = Math.max(dp, Math.hypot(s.p[0] - o.p[0], s.p[1] - o.p[1], s.p[2] - o.p[2])); dq = Math.max(dq, angle(s.q, o.q)); });
    console.log(`${k.padEnd(14)} ${(dp * 1000).toFixed(2)} mm  ${dq.toFixed(2)} deg${dp > 0.001 || dq > 1 ? '   DIFFERENT' : ''}`);
  }
}
