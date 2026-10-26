// The PC's view of the cube world: a watcher (WorldFeed), no game logic. Everything comes in the common frame, which is this page's
// floor plan: the floor is the common floor, spot 1 of the line-up is the origin. Drawn a little in the past (DELAY), between samples.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER_COLOURS } from '/mumr/xr/players3d.js';
import { makePanels } from '/mumr/xr/panel3d.js';
import { makeShoes } from '/mumr/xr/feet3d.js';
import { createRoom3d } from '/mumr/xr/room3d.js';
import { createHandWall, SIZE as WALL_SIZE, wallSpot } from '/mumr/xr/handwall.js';
import { createModel3d } from '/mumr/xr/roommodel3d.js';
import { createPointers } from '/mumr/xr/pointer3d.js';
import { createCameraMarks } from '/mumr/xr/cammark3d.js';
import { makeCube, setCube, ownerOf } from './draw.js';

// DELAY: how far in the past the world is drawn, so that it can be blended between packets (they come every 22 ms); ?delay=ms changes it
// (the webcam page, webcam.html, sets it to the camera's latency: window.view.setDelay)
const M = window.MUMR, C = window.CUBE;
let DELAY = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get('delay') ?? 50)));
const canvas = document.getElementById('view'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);                  // (the PC view is a monitor: a sharper picture is not worth the frame rate)
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20242c);
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 60); camera.position.set(-1.5, 3.2, 3.5);
const controls = new OrbitControls(camera, canvas); controls.target.set(0.8, 0, -0.5); controls.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 3, 2); scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const grid = new THREE.GridHelper(8, 40, 0x55607a, 0x353b4a); world.add(grid);
// the real cameras of the room (cams.js: a webcam page aligned them), small, where they really are: the same drawing as in the headsets
const camMarks = createCameraMarks({ THREE, group: world });
const cubeMesh = makeCube(THREE, C.SIZE); world.add(cubeMesh, cubeMesh.userData.holder);
const { Panel } = makePanels(THREE, renderer);
const room3d = createRoom3d({ THREE, parent: world });
// the hand wall and the pointing rays, as the headsets draw them (worked out here from everybody's joints, as each headset does)
const handWall = createHandWall({ THREE, parent: world }), pointers = createPointers({ THREE, parent: world }), grips = new M.grab.Grips();
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`, models = new Map();     // (the room as the supplier sent it: the common frame is this page's floor plan)
const toV = (x, y, z) => new THREE.Vector3(x, z, -y);

const info = await fetch('/info').then((r) => r.json()).catch(() => ({ build: 0 }));
const life = M.life.make({ name: 'PC view' });
life(`PC view loaded (${navigator.userAgent.slice(0, 90)})`);
const feed = M.worldfeed.WorldFeed.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, { build: info.build, name: 'PC view', session: { game: C.GAME, player: C.PLAYER, kinds: { wallspot: M.room.SPOT_KIND } } });

// each player: a cone for the head, a dot for every joint and point, two discs for the spots (1 at the origin, 2 at dist along x), the check mark
const drawn = new Map();
function playerObj(slot) {
  let o = drawn.get(slot);
  if (o) return o;
  const col = PLAYER_COLOURS[slot % PLAYER_COLOURS.length], mat = new THREE.MeshBasicMaterial({ color: col });
  const headM = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
  headM.geometry.rotateZ(-Math.PI / 2);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), mat, 160);
  const check = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 32), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
  check.rotation.x = -Math.PI / 2;
  world.add(headM, dots, check);
  o = { headM, dots, check, panels: {}, feet: makeShoes(THREE, world, col) };
  drawn.set(slot, o);
  return o;
}
const spotMat = new THREE.MeshBasicMaterial({ color: 0xece9e2, side: THREE.DoubleSide }), spots = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 32), spotMat); m.rotation.x = -Math.PI / 2; m.position.y = 0.002; world.add(m); return m; });
const mtx = new THREE.Matrix4();

function frame() {
  const t = feed.serverNow(), at = t === null ? undefined : t - DELAY, S = feed.session;
  room3d.set(S.doc.room ? S.doc.room.data : null);
  const c = feed.sample('cube', null, at);
  if (c) setCube(cubeMesh, C.unpacked(c.data), C.COLOURS[(S.doc.game.colour || 0) % C.COLOURS.length], ownerOf(S.holder('cube'), null, PLAYER_COLOURS));
  const here = new Set(), everyone = [];
  let dist = null;
  for (const p of feed.players()) {
    here.add(p.slot);
    const o = playerObj(p.slot);
    if (p.lined) dist = p.lined.dist;
    const pr = feed.sample('presence', p.slot, at);
    o.headM.visible = !!pr;
    let n = 0;
    if (pr) {
      const h = pr.data.head;
      o.headM.position.copy(toV(h[0], h[1], h[3])); o.headM.rotation.set(0, h[2], 0);
      for (const s of pr.data.sources) if (!s.foot) for (const q of (s.joints || s.points.map((x) => [x.x, x.y, x.z]))) if (n < 160) { const v = toV(q[0], q[1], q[2]); mtx.makeTranslation(v.x, v.y, v.z); o.dots.setMatrixAt(n++, mtx); }
    }
    o.dots.count = n; o.dots.instanceMatrix.needsUpdate = true;
    o.feet.update(pr ? pr.data.sources : []);
    if (pr) for (const s of pr.data.sources) if (!s.foot) everyone.push(Object.assign({}, s, { id: `p${p.slot}-${s.id}`, slot: p.slot }));
    o.check.visible = !!p.check;
    if (p.check) o.check.position.copy(toV(p.check[0], p.check[1], (p.check[2] || 0) + 0.003));
    // that player's menus, where they float, drawn from its own state and mode (the same layouts the headsets draw): the cube's menu ('main')
    // and the engine's menu on the wrist ('wrist', engine/client/sysmenu.js)
    const m = feed.sample('menus', p.slot), info = m ? m.data.info || {} : {};
    for (const id of ['main', 'wrist']) {
      const row = m && Array.isArray(m.data.panels) ? m.data.panels.find((r) => r[0] === id) : null;
      let q = o.panels[id];
      if (!row) { if (q) q.panel.mesh.visible = false; continue; }
      const wrist = id === 'wrist', lay = wrist ? M.sysmenu.SysMenu.layout(info.sys) : C.menu(S.stateOf(p.slot), info);
      if (!q) { q = o.panels[id] = { panel: new Panel(0.42, lay), key: '' }; scene.add(q.panel.mesh); }
      q.panel.setWidth(wrist ? M.sysmenu.SysMenu.width(info.sys) : 0.42);
      q.panel.mesh.visible = true;
      q.panel.pose(row.length >= 8 ? { x: row[1], y: row[2], h: row[3], q: row.slice(4, 8) } : { x: row[1], y: row[2], h: row[3], yaw: row[4], pitch: row[5] });
      const look = { edge: PLAYER_COLOURS[p.slot % PLAYER_COLOURS.length], note: wrist ? (info.sys && info.sys.note) || '' : `player ${p.slot + 1}` };
      const key = JSON.stringify([lay.w, lay.h, lay.buttons.map((b) => [b.label, b.value, b.active, b.off]), look.note]);
      if (key !== q.key) { q.key = key; q.panel.draw(lay, look); }        // (only when it changed: a redraw is a canvas and a texture upload)
    }
  }
  for (const [slot, o] of [...drawn]) if (!here.has(slot)) { for (const x of [o.headM, o.dots, o.check]) world.remove(x); for (const q of Object.values(o.panels)) q.panel.dispose(); o.feet.dispose(); drawn.delete(slot); }
  const gestures = grips.update(everyone), roomNow = S.doc.room ? S.doc.room.data : null;
  // the room models where the players have them open, with the cube and the viewer in them (the viewer: where the document says)
  const F = roomNow ? M.model.frameOf(roomNow) : null, spot = S.doc.wallspot || (roomNow ? wallSpot(roomNow) : null), seenModels = new Set();
  if (F) for (const p of feed.players()) {
    const m = feed.sample('menus', p.slot), row = m && Array.isArray(m.data.panels) ? m.data.panels.find((r) => r[0] === 'model') : null;
    if (!row) continue;
    seenModels.add(p.slot);
    if (!models.has(p.slot)) models.set(p.slot, createModel3d({ THREE, parent: world }));
    const things = [];
    if (c) things.push({ id: 'cube', kind: 'box', at: [c.data[0], c.data[1], c.data[2]], yaw: C.heading(c.data.slice(3, 7)), size: [C.SIZE], colour: C.COLOURS[(S.doc.game.colour || 0) % C.COLOURS.length] });
    if (spot) things.push({ id: 'viewer', kind: 'panel', at: [spot.x, spot.y, spot.h], yaw: spot.yaw, size: [WALL_SIZE.w, WALL_SIZE.h], colour: 0x4ea1ff });
    const k = m.data.info && m.data.info.model ? +m.data.info.model.k || 1 : 1;
    models.get(p.slot).update({ x: row[1], y: row[2], z: row[3], yaw: row[4], k }, F, roomNow, things, { edge: PLAYER_COLOURS[p.slot % PLAYER_COLOURS.length] });
  }
  for (const [slot, d] of [...models]) if (!seenModels.has(slot)) { d.dispose(); models.delete(slot); }
  handWall.update(roomNow, gestures.map((g) => { const s = everyone.find((q) => q.id === g.id); return { name: `player ${s.slot + 1}, ${/left/.test(g.id) ? 'left' : 'right'}`, colour: hex(PLAYER_COLOURS[s.slot % PLAYER_COLOURS.length]), source: s, g }; }), performance.now(), S.doc.wallspot || null);
  const box = c ? { id: 'cube', label: 'cube', x: c.data[0], y: c.data[1], z: c.data[2], half: C.HALF, yaw: C.heading(c.data.slice(3, 7)) } : null;
  pointers.update(gestures.filter((g) => g.point).map((g) => {
    const hit = M.grab.pointAt(g.point, box ? [box] : [], roomNow, 8), s = everyone.find((q) => q.id === g.id);
    return { from: g.point.from, at: hit ? hit.at : g.point.from.map((v, i) => v + g.point.dir[i] * 3), label: hit ? hit.label || hit.what : '', colour: PLAYER_COLOURS[s.slot % PLAYER_COLOURS.length] };
  }));
  spots[0].visible = spots[1].visible = dist !== null;
  if (dist !== null) spots[1].position.set(dist, 0.002, 0);
  camMarks.update(Object.values(S.doc.cameras));
  const st = feed.status();
  hud.textContent = `${feed.ready ? 'connected' : 'waiting for the server'}, ${st.players} player(s), drawn ${DELAY} ms in the past (?delay=), event ${st.events}, ${st.packets} packets, clock spread ${st.clockSpreadMs === null ? '-' : st.clockSpreadMs.toFixed(1)} ms\n`
    + `cube: ${c ? `${c.data[0].toFixed(2)}, ${c.data[1].toFixed(2)} m${c.data[13] > 0.5 ? ', held' : ''}, simulated by ${(ownerOf(S.holder('cube'), null, PLAYER_COLOURS) || { text: 'nobody' }).text}` : 'not seen yet'}   count ${S.doc.game.count ?? 0}   room: ${S.doc.room ? `${S.doc.room.data.planes.length} planes${S.doc.room.by === null ? '' : `, uploaded by player ${S.doc.room.by + 1}`}` : 'none'}`;
  controls.update();
  renderer.render(scene, camera);
  perf.frames++;
  const now = performance.now();
  if (now - perf.t0 >= 10000) {
    // every 10 s to the server's log: how fast this page draws, how much comes in, and how old the newest is (the first headset run found
    // this view "super laggy" in Firefox, and the server had to drop packets for it)
    const ages = Object.entries(st.ages).map(([k, v]) => `${k} ${v.map((q) => q[1]).join('/')}`).join(', ');
    life(`view: ${(perf.frames * 1000 / (now - perf.t0)).toFixed(0)} fps, ${((st.packets - perf.p0) * 1000 / (now - perf.t0)).toFixed(0)} packets/s, ages (ms) ${ages}, late by their stamps (ms) ${Object.entries(st.late).map(([k, v]) => `${k} ${v}`).join(', ')}, drawn ${DELAY} ms back, clock fallbacks ${st.offClock}, clock spread ${st.clockSpreadMs === null ? '-' : st.clockSpreadMs.toFixed(1)} ms`);
    perf.t0 = now; perf.frames = 0; perf.p0 = st.packets;
  }
}
const perf = { t0: performance.now(), frames: 0, p0: 0 };
function resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(frame);
window.__view = { feed, frame };
// What the webcam page (webcam.html, engine/client/webcam/mixed.js) needs of this view: the feed, the scene and its camera and controls (the page
// replaces controls.update, which is called once a frame just before drawing), the delay, the cameras' drawing, and the parts of the picture
// that its Show menu switches (engine/client/webcam/mixedshow.js; this view draws the room as one outline, so it has no separate walls or boxes).
const each = (f) => [...drawn.values()].flatMap(f);
window.view = { feed, scene, camera, renderer, orbit: controls, setDelay: (ms) => { DELAY = ms; }, camMarks, world, frame,
  parts: {
    hands: () => each((o) => [o.dots]),
    head: () => each((o) => [o.headM]),
    floor: { objects: () => [room3d.group], static: true },
    grid: { objects: () => [grid], static: true },
    marks: () => spots.concat(each((o) => [o.check])),
    cameras: { objects: () => [camMarks.group], static: true },
    menus: () => each((o) => Object.values(o.panels).map((q) => q.panel.mesh)),
  } };
// a page of another build reloads itself (the server refuses an old one)
setInterval(async () => { try { const i = await (await fetch('/info')).json(); if (i.build && info.build && i.build !== info.build) location.reload(); } catch (e) { /* the server is away */ } }, 3000);
