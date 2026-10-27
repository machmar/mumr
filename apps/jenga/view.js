// The PC's view of the Jenga world: a watcher (WorldFeed), no game logic. It draws what the headsets draw, with the same module (draw.js): the
// tower and the die from the host's bodies, the furniture, the scoreboard, the shared board (as the engine draws a menu), everybody's hands and
// heads as ghosts. It can also play the soundtrack (press M once: a page may make no sound before a key).
//   http://<PC>:8766/view.html          (the server's address; ?delay=ms draws the world that much in the past, 70 by default)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER_COLOURS } from '/mumr/xr/players3d.js';
import { makePanels } from '/mumr/xr/panel3d.js';
import { createRoom3d } from '/mumr/xr/room3d.js';
import { createScene } from './draw.js';

const M = window.MUMR, J = window.JENGA;
const DELAY = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get('delay') ?? 70)));
const canvas = document.getElementById('view'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1b1f27);
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 80);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a4350, 1.5));
const sun = new THREE.DirectionalLight(0xffe9c8, 1.5); sun.position.set(2, 4, 2); scene.add(sun);
const world = new THREE.Group(); scene.add(world);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1 })); floor.rotation.x = -Math.PI / 2; world.add(floor);
world.add(new THREE.GridHelper(20, 40, 0x4a556b, 0x30384a));
const room3d = createRoom3d({ THREE, parent: world });

const sample = J.board(J.waiting(), {}), aspect = sample.h / sample.w;
const scene3d = createScene({ THREE, parent: world, playerColours: PLAYER_COLOURS, boardAspect: aspect });
const { Panel } = makePanels(THREE, renderer);
let panel = null;

const info = await fetch('/info').then((r) => r.json()).catch(() => ({ build: 0 }));
const life = M.life.make({ name: 'PC view' });
life(`PC view loaded (${navigator.userAgent.slice(0, 90)})`);
const OPTS = { game: J.GAME, player: J.PLAYER, kinds: Object.assign({ wallspot: M.room.SPOT_KIND }, J.KINDS) };
const feed = M.worldfeed.WorldFeed.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, { build: info.build, name: 'PC view', session: OPTS });

// the players: a cone for the head and a dot for every joint (as the cube's PC view does)
const drawn = new Map(), toV = (x, y, z) => new THREE.Vector3(x, z, -y), mtx = new THREE.Matrix4();
function playerObj(slot) {
  let o = drawn.get(slot);
  if (o) return o;
  const col = PLAYER_COLOURS[slot % PLAYER_COLOURS.length];
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })); head.geometry.rotateZ(-Math.PI / 2);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: col }), 160);
  world.add(head, dots); o = { head, dots }; drawn.set(slot, o); return o;
}

// the soundtrack, if asked for with M
const sound = new J.Soundtrack({ base: 'music/' });
fetch('music/tracks.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => sound.music.load(m || {}));
addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') { if (!sound.music.ctx) sound.music.start(); else { sound.music.dispose(); } } });

// the camera's places
const spots = {
  1: (s, L) => { const t = J.toCommon(s.place, [0, 0, L.plinth.top + L.d.height * 0.5]), p = J.toCommon(s.place, [-(L.plinth.half + 0.8 + L.d.height * 0.4), -L.plinth.half * 0.4, L.plinth.top + L.d.height * 0.8]); return [p, t]; },
  2: (s, L) => { const t = J.toCommon(s.place, [L.console.c[0], L.console.c[1], 0.95]), p = J.toCommon(s.place, [L.P[0], L.P[1], 1.5]); return [p, t]; },
  3: (s, L) => { const t = J.toCommon(s.place, [-0.3, L.console.c[1] * 0.5, 0.6]), p = J.toCommon(s.place, [L.P[0] - 0.9, -1.6 - L.plinth.half, 2.4]); return [p, t]; },
  4: (s, L) => { const t = J.toCommon(s.place, [0, 0, L.plinth.top + L.d.height * 0.55]), p = J.toCommon(s.place, [L.P[0], L.P[1], 1.55]); return [p, t]; },
};
let placedKey = null;
function aim(k) {
  const s = feed.session.doc.jenga || J.waiting(), L = J.layout(s.size), [p, t] = spots[k](s, L);
  camera.position.copy(toV(...p)); controls.target.copy(toV(...t)); controls.update();
}
addEventListener('keydown', (e) => { if (['1', '2', '3', '4'].includes(e.key)) aim(+e.key); });

function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let last = performance.now(), hudAt = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  const sn = feed.serverNow(), at = sn === null ? undefined : sn - DELAY, S = feed.session, state = S.doc.jenga || J.waiting();
  room3d.set(S.doc.room ? S.doc.room.data : null);
  const smp = feed.sample('jenga', null, at), snap = smp ? smp.data : null;
  scene3d.update({ state, snap, now, camera });
  // the first time the game's place is known: the camera looks at it
  const key = `${state.size}|${state.place.x}|${state.place.y}|${state.place.yaw}`;
  if (key !== placedKey) { placedKey = key; aim(4); }
  // the board, drawn as the engine draws a menu (nobody presses it here)
  const bp = scene3d.boardPose(state), lay = J.board(state, { here: S.peers.size, game: S.stateOf(null), mine: { ghost: true }, host: S.hostHere && !!S.doc.jenga });
  if (!panel) { panel = new Panel(0.64, lay, {}); scene.add(panel.mesh); }
  if (bp) { panel.pose({ x: bp.x, y: bp.y, h: bp.h, yaw: bp.yaw, pitch: bp.pitch }); }
  if (now - hudAt > 120) { hudAt = now; panel.draw(lay, {}); }
  panel.tick(dt, [camera.position.x, camera.position.y, camera.position.z]);
  // the players
  const here = new Set();
  for (const p of feed.players()) {
    here.add(p.slot);
    const o = playerObj(p.slot), pr = feed.sample('presence', p.slot, at);
    o.head.visible = !!pr;
    let n = 0;
    if (pr) {
      const h = pr.data.head; o.head.position.copy(toV(h[0], h[1], h[3])); o.head.rotation.set(0, h[2], 0);
      for (const s of pr.data.sources) if (!s.foot) for (const q of (s.joints || s.points.map((x) => [x.x, x.y, x.z]))) if (n < 160) { const v = toV(q[0], q[1], q[2]); mtx.makeTranslation(v.x, v.y, v.z); o.dots.setMatrixAt(n++, mtx); }
    }
    o.dots.count = n; o.dots.instanceMatrix.needsUpdate = true;
  }
  for (const [slot, o] of [...drawn]) if (!here.has(slot)) { world.remove(o.head, o.dots); drawn.delete(slot); }
  // the soundtrack follows the same shared state
  if (sound.music.ctx) { const fw = new THREE.Vector3(); camera.getWorldDirection(fw); sound.update(S.doc.jenga || null, snap ? snap.items : null, dt, S.game('music'), { x: camera.position.x, y: -camera.position.z, yaw: Math.atan2(-fw.z, fw.x) }); }
  controls.update();
  renderer.render(scene, camera);
  if (now - hudAt < 5) hud.textContent = `${state.phase}  round ${state.round}/${state.rounds}  ${S.hostHere ? '' : 'NO HOST  '}players ${S.others}  ${smp ? 'bodies ok' : 'waiting for bodies'}  ${sound.music.ctx ? `music ${sound.scene || ''}` : 'press M for the music'}`;
  requestAnimationFrame(frame);
}
setInterval(() => sound.music.tick(), 1000);
window.__view = { feed, scene3d, camera, controls, sound, aim };
requestAnimationFrame(frame);
