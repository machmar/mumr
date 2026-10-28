// The PC's view of the Jenga world: a watcher (WorldFeed), no game logic. It draws what the headsets draw, with the same module (draw.js): the
// tower and the die from the host's bodies, the furniture, the scoreboard, the shared board (as the engine draws a menu), everybody's hands and
// heads as ghosts. It can also play the soundtrack (press M once: a page may make no sound before a key).
//   http://<PC>:8766/view.html          (the server's address; ?delay=ms draws the world that much in the past, 70 by default)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER_COLOURS } from '/mumr/xr/players3d.js';
import { createRoom3d } from '/mumr/xr/room3d.js';
import { createScene } from './draw.js';

const M = window.MUMR, J = window.JENGA;
const DELAY = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get('delay') ?? 70)));
const canvas = document.getElementById('view'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
// the room this view has instead of a real one: a dark warm floor that fades into the haze, lit by the scene's own light (look.js)
const BG = 0x0f0c0a, scene = new THREE.Scene(); scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 3.5, 11);
const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 80);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
const world = new THREE.Group(); scene.add(world);
const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x241c17, roughness: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
const room3d = createRoom3d({ THREE, parent: world });

const scene3d = createScene({ THREE, parent: world, renderer, playerColours: PLAYER_COLOURS });

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
// the director's view, with or without sound: which scene the music is in, how tense it is, and the moments it answers (?hud=0 hides it)
const dir = { tension: new J.Tension(), scene: null, since: 0, t: 0, prev: null, moments: [] };
const FAST = new URLSearchParams(location.search).get('fast') === '1';               // (?fast=1: the scene the music is heading for, without the dwell: for the scene videos)
const hudBox = document.createElement('div');
hudBox.className = 'dir'; if (new URLSearchParams(location.search).get('hud') === '0') hudBox.style.display = 'none';
document.body.appendChild(hudBox);
const MOMENT = { rolled: 'die rolled: soft bell, short swell', pulled: 'block pulled: swell + riser', placed: 'placed: bell', placedWell: 'placed well: bells', placedBad: 'foul: low bell', fall: 'FALL: music ducks, deep boom', replay: 'REPLAY: riser, music returns louder', aftermath: 'bells', roundEnd: 'round over: bell', matchEnd: 'match over: bells, long swell', start: 'start: bells' };
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
  const lay = J.board(state, { here: S.peers.size, game: S.stateOf(null), mine: { ghost: true }, host: S.hostHere && !!S.doc.jenga });
  const heads = feed.players().map((p) => { const pr = feed.sample('presence', p.slot, at); return pr ? { slot: p.slot, x: pr.data.head[0], y: pr.data.head[1] } : null; }).filter(Boolean);
  scene3d.update({ state, snap, now, t: sn === null ? undefined : sn, lay, heads });
  dir.t += dt; const tn = dir.tension.update(S.doc.jenga || null, snap ? snap.items : null, dt);
  const sc = J.sceneFor(S.doc.jenga || null, tn, dir.scene, dir.t - dir.since, FAST ? 0 : undefined); if (sc !== dir.scene) { dir.scene = sc; dir.since = dir.t; }
  for (const w of J.momentsBetween(dir.prev, S.doc.jenga || null)) dir.moments.push({ text: MOMENT[w] || w, t: now });
  const dl = M.dim.level(S.doc.dim, sn);                           // (what the headsets' passthrough is drawn at: this view has no real room to dim)
  dir.prev = S.doc.jenga || null; dir.moments = dir.moments.filter((m) => now - m.t < 4500);
  hudBox.innerHTML = `<div class="k">music</div><div class="scene">${dir.scene}</div><div class="k">tension ${Math.round(tn * 100)}%</div><div class="bar"><i style="width:${Math.round(tn * 100)}%"></i></div><div class="k">room dim ${Math.round(dl.dark * 100)}% · grey ${Math.round(dl.mute * 100)}%</div>${dir.moments.map((m) => `<div class="m">\u266a ${m.text}</div>`).join('')}`;
  // the first time the game's place is known: the camera looks at it
  const key = `${state.size}|${state.place.x}|${state.place.y}|${state.place.yaw}`;
  if (key !== placedKey) { placedKey = key; aim(4); }
  if (now - hudAt > 120) hudAt = now;
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
  if (now - hudAt < 5) hud.textContent = [state.phase.replace('_', ' '), `round ${state.round} of ${state.rounds}`, S.hostHere ? null : 'NO HOST', `${S.others} ${S.others === 1 ? 'player' : 'players'}`, smp ? null : 'waiting for bodies', sound.music.ctx ? `music: ${sound.scene || ''}` : 'M for the music'].filter(Boolean).join('   ·   ');
  requestAnimationFrame(frame);
}
setInterval(() => sound.music.tick(), 1000);
window.__view = { feed, scene3d, camera, controls, sound, aim, renderer, scene };
requestAnimationFrame(frame);
