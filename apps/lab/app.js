// The MUMR lab: the experiments of docs/PLAN.md section 3.1 in one app, chosen on the menu (every player sees the same one).
//   pile    N boxes simulated on this page alone (no sharing): drop them into a heap, poke it; frame time, simulation time and how many
//           are moving go to the log every 5 s
//   island  a stack of 5 boxes, each with a token of its own (today's rule): one player pushes the bottom while the other lifts the top;
//           once a second the log says the token hand-overs, the jumps of a box, and whether the stack stayed together
//   drift   Start, then touch the printed cross with the index finger when asked (once a minute, ten times): the first touch is the
//           cross, the others are measured against it (and against the other player's touch of the same round)
// All three simulate in the common frame (boxes.js), so every page's boxes are turned the same way whatever its line-up.
//   node tools/run.js lab                    headsets: https://<PC>:8443/
//   node tools/run.js lab --http             two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40   (add &room=demo for a room)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp, PLAYER_COLOURS } from '/mumr/xr/app.js';

const L = window.LAB, Q = window.MUMR.physics.quat;
const pile = new L.World(10), island = new L.World(L.ISLAND), watch = new L.Watch(), perf = new L.Perf(), drift = new L.Drift();
const STACK_AT = [0.5, 0], meshes = [];
const tot = { handovers: 0, jumps: 0, worst: 0, broken: 0 };       // the island since its last reset
let lagFrames = 0;                                                  // frames in this log window in which the physics hit its time budget and ran slow
let app = null, mode = 'pile', count = 10, claimUntil = 0, lastFrame = 0, frameS = 1 / 60, last = { perf: null, island: null, drift: null }, mark = null;
island.layout('stack', L.ISLAND, STACK_AT);

const common = (sources) => (app.space.ok ? sources.map((s) => L.commonSource(s, (p) => app.space.toCommon(p))) : sources);
const toPlan = (p) => (app.space.ok ? app.space.fromCommon(p) : p);
const front = () => { const h = app.head(), c = [h[0] + Math.cos(h[2]) * 0.7, h[1] + Math.sin(h[2]) * 0.7]; return app.space.ok ? app.space.toCommon(c) : c; };
const world = () => (mode === 'island' ? island : pile);

// what the data window shows
function dataInfo() {
  const S = app.S;
  return { mode, perf: last.perf, pile: { n: pile.boxes.length, moving: pile.movingCount() },
    island: { together: watch.together(island), moving: island.movingCount(), last: last.island, totals: tot, holders: L.TYPES.map((t) => app.ownerText(S.holder(t.token))) },
    drift, nextIn: drift.nextAt === null ? 0 : drift.nextAt - performance.now() / 1000,
    me: S.me === null ? 0 : S.me, players: S.connected ? S.others + 1 : 1, lined: app.space.ok, rtt: app.link.rtt };
}

function setMode(m, n) {
  if (m === mode && n === count) return;
  mode = m; count = n;
  if (m === 'pile') pile.layout('grid', n);
  if (m === 'island') { island.layout('stack', L.ISLAND, STACK_AT); Object.assign(tot, { handovers: 0, jumps: 0, worst: 0, broken: 0 }); }
  if (m !== 'drift') drift.stop();
  app.life(`lab: ${m}${m === 'pile' ? `, ${n} cubes` : ''}`);
}

// the log line for a drift touch: against the cross, and against the other player's touch of the same round
function driftLine(row, others) {
  if (row.missed) return `drift: round ${row.round} missed (no touch in time)`;
  if (row.first) return `drift: round ${row.round}, the cross is at (${row.common[0].toFixed(3)}, ${row.common[1].toFixed(3)})`;
  const o = others.find((q) => q.round === row.round);
  if (o) row.other = Math.round(Math.hypot(row.common[0] - o.x, row.common[1] - o.y) * 1000);
  return `drift: round ${row.round}, ${row.mm} mm from the cross (dx ${row.dx}, dy ${row.dy}), largest ${drift.largest} mm${o ? `; ${row.other} mm from player ${o.slot + 1}'s touch` : ''}`;
}

app = await createApp({
  THREE, OrbitControls, anchorKey: 'mumr.lab.anchor',
  session: { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS },
  menu: L.menu,
  handMask: true,
  handWall: true,                // (the hand window on the room's longest wall)
  // the room model (from the menu): the cubes can be moved in it (the viewer is the engine's); a hand in it may be shown full size
  roomModel: {
    open: (st) => !!st.model, handIrl: (st) => !!st.handIrl,
    things: () => {
      if (mode === 'drift') return [];
      const w = world(), yaw = app.space.ok ? app.space.yawFromCommon(0) : 0;
      return w.boxes.map((b, i) => {
        const d = w.drawn(b), p = toPlan([d.x, d.y, d.z]);
        // moved in the model, a cube is held by the hand there: this page takes it and it follows, and falls where it is let go
        return { id: `box${i}`, label: `cube ${i + 1}`, kind: 'box', at: p, yaw, size: [L.SIZE], colour: 0xe8a33d,
          drag: (phase, at) => { b.steer = phase === 'drop' ? null : app.space.ok ? app.space.toCommon(at) : at; } };
      });
    },
  },
  // the windows: the numbers of the test, and what the test is for (each follows you, carried by its bar or a fist)
  windows: [
    { id: 'data', title: 'data window', w: 0.55, bearing: 0.55, dist: 0.85, desktop: { x: -0.5, y: 0.5, h: 1.2, yaw: -1.2, pitch: 0.15 }, lay: () => L.dataLayout(dataInfo()) },
    { id: 'about', title: 'about window', w: 0.62, bearing: 1.1, dist: 0.95, desktop: { x: -0.9, y: -0.3, h: 1.2, yaw: -0.5, pitch: 0.15 }, lay: () => L.description(mode) },
  ],
  bodies: () => L.TYPES.map((t, i) => ({ token: t.token, type: t.name, adapter: L.adapter(island, i, (s) => common(s), () => mode === 'island') })),
  setup: ({ world: floor, S, life }) => {
    const geo = new THREE.BoxGeometry(L.SIZE, L.SIZE, L.SIZE), edges = new THREE.EdgesGeometry(geo);
    for (let i = 0; i < L.MAX_BOXES; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.55, metalness: 0.05 }));
      m.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x14161c })));
      m.visible = false; floor.add(m); meshes.push(m);
    }
    mark = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.04, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide }));
    mark.position.y = 0.003; mark.visible = false; floor.add(mark);
    S.on('drift', (e) => { if (e.slot !== S.me) life(`drift: player ${e.slot + 1} touched in round ${e.round}`); });
  },
  step: (dt, t, hands, own) => {
    const S = app.S, now = performance.now(), m = S.game('mode') || 'pile', n = S.game('n') || 10;
    setMode(m, n);
    const frameMs = lastFrame ? now - lastFrame : dt * 1000; lastFrame = now;
    const w = world(), t0 = performance.now();
    w.room = S.connected && app.space.ok ? (S.doc.room ? S.doc.room.data : null) : app.room.local();      // (the server's room is in the common frame; alone, the own scan is the plan)
    frameS = dt;
    if (m !== 'drift') w.step(dt, t, common(hands));
    // a reset of the island: this page takes the boxes and the others follow what it sends
    if (m === 'island' && now < claimUntil) for (const b of app.bodies) S.claim(b.token, now);
    const sim = performance.now() - t0;
    if (w.pw.lagged) lagFrames++;
    const r = perf.add(now, frameMs, sim);
    if (r && m !== 'drift') { last.perf = r; app.life(`lab: ${m === 'pile' ? `pile of ${pile.boxes.length}` : 'island'}: ${r.fps} fps, frame ${r.p50}/${r.p95} ms (p50/p95), simulation ${r.sim} ms, ${w.movingCount()} moving, physics cut short in ${lagFrames} frames`); lagFrames = 0; }
    // the drift probe: this page's index fingertips
    const tips = own.map((s) => { const p = (s.points || []).find((q) => q.name === 'index'); return p ? { id: s.id, x: p.x, y: p.y, z: p.z } : null; }).filter(Boolean);
    const row = drift.update(t, tips, (xy) => (app.space.ok ? app.space.toCommon(xy) : xy));
    if (row) {
      const others = Object.entries(S.doc.drift || {}).filter(([slot]) => +slot !== S.me).map(([slot, q]) => Object.assign({ slot: +slot }, q));
      const line = driftLine(row, others);
      last.drift = line; app.life(line); app.say(row.missed ? `Round ${row.round}: missed` : row.first ? 'The cross is set' : `Round ${row.round}: ${row.mm} mm`);
      if (!row.missed) S.emit({ k: 'drift', slot: S.me === null ? 0 : S.me, round: row.round, x: row.common[0], y: row.common[1] });
    }
    if (drift.asking && Math.floor(t) !== Math.floor(t - dt) && Math.floor(t) % 5 === 0) app.say(`Round ${drift.round}: touch the cross`);
  },
  ghostColour: 'grips',
  onAction: (id, from) => {
    const now = performance.now();
    if (id === 'reset') {
      if (mode === 'pile') pile.layout('grid', count);
      else if (mode === 'island') { island.layout('stack', L.ISLAND, STACK_AT); claimUntil = now + 1500; Object.assign(tot, { handovers: 0, jumps: 0, worst: 0, broken: 0 }); }
      else drift.reset();
      app.say('Reset');
    } else if (id === 'dropPile' && mode === 'pile') { pile.layout('pile', count, front()); app.say(`${count} cubes dropped`); }
    else if (id === 'driftStart' && mode === 'drift') { drift.start(now / 1000); app.life(`drift: started by ${from === null ? 'this page' : `player ${from + 1}`}`); app.say('Drift started: touch the cross with the index finger'); }
  },
  draw: ({ S }) => {
    const w = world();
    meshes.forEach((m, i) => {
      const b = mode !== 'drift' ? w.boxes[i] : null;
      m.visible = !!b;
      if (!b) return;
      const d = w.drawn(b), p = toPlan([d.x, d.y, d.z]), yaw = app.space.ok ? app.space.yawFromCommon(0) : 0;
      const qp = Q.mul(Q.fromAxisAngle([0, 0, 1], yaw), d.q);                       // (the box's turn in the common frame, then the page's line-up)
      m.position.set(p[0], p[2], -p[1]); m.quaternion.set(qp[0], qp[2], -qp[1], qp[3]);
      let colour = w.isMoving(b) ? 0xe8a33d : 0x9aa3b2;
      if (mode === 'island') { const h = S.holder(L.TYPES[i].token); colour = h === null || h === undefined ? 0xcfd6e2 : h === S.me ? PLAYER_COLOURS[S.me % PLAYER_COLOURS.length] : PLAYER_COLOURS[h % PLAYER_COLOURS.length]; }
      m.material.color.set(d.held ? 0xffffff : colour);
    });
    mark.visible = mode === 'drift' && !!drift.ref;
    if (mark.visible) { const p = toPlan([drift.ref[0], drift.ref[1], 0]); mark.position.set(p[0], 0.003, -p[1]); }
    if (mode === 'island') {
      watch.frame(island, frameS);
      const hv = app.bodies.reduce((a, b) => a + (b.stats.handovers || 0), 0), r = watch.report(island, hv, performance.now());
      if (r) { last.island = r; tot.handovers += r.handovers; tot.jumps += r.jumps; tot.worst = Math.max(tot.worst, r.worst); if (!r.together) tot.broken++; if (r.handovers || r.jumps || !r.together) app.life(`lab: island: ${r.handovers} hand-overs/s, ${r.jumps} jumps (worst ${r.worst} mm), stack ${r.together ? 'together' : 'BROKEN'}, ${r.moving} moving`); }
    }
  },
  status: () => {
    if (mode === 'pile') return `pile of ${pile.boxes.length}, ${pile.movingCount()} moving${last.perf ? `   frame ${last.perf.p50}/${last.perf.p95} ms, simulation ${last.perf.sim} ms` : ''}`;
    if (mode === 'island') return `island: stack ${watch.together(island) ? 'together' : 'BROKEN'}, ${island.movingCount()} moving${last.island ? `   last second: ${last.island.handovers} hand-overs, ${last.island.jumps} jumps` : ''}`;
    return `drift: ${drift.on ? (drift.asking ? `round ${drift.round}: TOUCH THE CROSS` : `round ${drift.round} of ${drift.cfg.rounds} done, next in ${Math.max(0, Math.round(drift.nextAt - performance.now() / 1000))} s`) : 'not running'}   largest ${drift.largest} mm${last.drift ? `   ${last.drift}` : ''}`;
  },
});
window.__lab = Object.assign(app, { pile, island, drift, watch, perf });
