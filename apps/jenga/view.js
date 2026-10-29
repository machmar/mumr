// The PC's view of the Jenga world: a watcher (WorldFeed), no game logic. It draws what the headsets draw, with the same module (draw.js): the
// tower and the die from the host's bodies, the furniture, the scoreboard, the shared board (as the engine draws a menu), everybody's hands and
// heads as ghosts. It can also play the soundtrack (press M once: a page may make no sound before a key).
//   http://<PC>:8766/view.html          (the server's address; ?delay=ms draws the world that much in the past, 70 by default)
//   https://<PC>:8443/webcam.html       the same view over a webcam's picture (the engine's webcam page, docs/ARCHITECTURE.md 6c: window.view below)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER_COLOURS } from '/mumr/xr/players3d.js';
import { createRoom3d } from '/mumr/xr/room3d.js';
import { createCameraMarks } from '/mumr/xr/cammark3d.js';
import { makeGhost } from '/mumr/xr/ghost.js';
import { createScene } from './draw.js';
import { markCursor } from './shades.js';

const M = window.MUMR, J = window.JENGA;
let DELAY = Math.max(0, Math.min(1000, Number(new URLSearchParams(location.search).get('delay') ?? 70)));
const canvas = document.getElementById('view'), hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
// the room this view has instead of a real one: a dark warm floor that fades into the haze, lit by the scene's own light (look.js)
const BG = 0x0f0c0a, scene = new THREE.Scene(), FOG = new THREE.Fog(BG, 3.5, 11); scene.background = new THREE.Color(BG); scene.fog = FOG;
const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 80);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
// left alone for a while, the view drifts slowly round the game (this view's own camera: nothing in the world moves); any key or touch stops it
let touchedAt = performance.now();
for (const ev of ['pointerdown', 'wheel', 'keydown']) addEventListener(ev, () => { touchedAt = performance.now(); controls.autoRotate = false; }, { passive: true });
controls.autoRotateSpeed = 0.35;
const world = new THREE.Group(); scene.add(world);
const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x241c17, roughness: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
const room3d = createRoom3d({ THREE, parent: world });
// the real cameras of the room (cams.js: a webcam page aligned them), small, where they really are: the same drawing as in the headsets
const camMarks = createCameraMarks({ THREE, group: world });

const scene3d = createScene({ THREE, parent: world, renderer, playerColours: PLAYER_COLOURS });

const info = await fetch('/info').then((r) => r.json()).catch(() => ({ build: 0 }));
const life = M.life.make({ name: 'PC view' });
life(`PC view loaded (${navigator.userAgent.slice(0, 90)})`);
const OPTS = { game: J.GAME, player: J.PLAYER, kinds: Object.assign({ wallspot: M.room.SPOT_KIND, rlight: M.room.LIGHT_KIND }, J.KINDS) };
const feed = M.worldfeed.WorldFeed.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, { build: info.build, name: 'PC view', session: OPTS });

// the players: a cone for the head, a tracked hand as ghost fingers in the player's colour (as every headset draws the other players' hands:
// xr/players3d.js), anything else (a controller, a mouse) as dots
const GhostHand = makeGhost(THREE), JR = new Float32Array(25).fill(0.009);
const drawn = new Map(), toV = (x, y, z) => new THREE.Vector3(x, z, -y), mtx = new THREE.Matrix4();
function playerObj(slot) {
  let o = drawn.get(slot);
  if (o) return o;
  const col = PLAYER_COLOURS[slot % PLAYER_COLOURS.length];
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })); head.geometry.rotateZ(-Math.PI / 2);
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: col }), 160);
  world.add(head, dots); o = { head, dots, col, hands: {} }; drawn.set(slot, o); return o;
}

// the soundtrack, if asked for with M
const sound = new J.Soundtrack({ base: 'music/', now: () => { const t = feed.serverNow(); return t === null ? Date.now() : t; } });
// the director's view, with or without sound: which scene and track the host's director chose, how tense it is here, and the moments it answers (?hud=0 hides it)
const dir = { tension: new J.Tension(), prev: null, moments: [] };
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
  const s = feed.session.doc.jenga || J.waiting(), L = J.layout(s.size, s.place), [p, t] = spots[k](s, L);
  camera.position.copy(toV(...p)); controls.target.copy(toV(...t)); controls.update();
}
addEventListener('keydown', (e) => { if (['1', '2', '3', '4'].includes(e.key)) aim(+e.key); });

function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---- how dear this page's drawing is (as a player's Quality on the headset, logic.js QUALITY: 2 high, 1 medium, 0 low): the scene's shadows, motes, smoke
//      and petals (draw.js quality) and the picture's resolution. Auto starts high and steps down while the page draws under 45 frames a second (Marek,
//      2026-10-29: the webcam page was not smooth). This browser's own choice (kept in it): nothing in the world changes.
const QKEY = 'jenga.view.quality', PIX = [0.75, 1, Math.min(2, devicePixelRatio)];
let qWant = 'auto'; try { qWant = localStorage.getItem(QKEY) || 'auto'; } catch (e) { /* private window */ }
let qNow = -1, qAuto = 2;
function applyQuality() {
  const q = qWant === 'auto' ? qAuto : J.QUALITY.indexOf(qWant);
  if (q === qNow) return;
  qNow = q; scene3d.quality(q); renderer.setPixelRatio(PIX[q]); resize();
  qSel.options[0].text = `auto · ${J.QUALITY[qAuto]}`;
  life(`PC view: quality ${J.QUALITY[q]}${qWant === 'auto' ? ' (auto)' : ''}, pixel ratio ${PIX[q]}`);
}
const qSel = document.createElement('select'); qSel.id = 'quality'; qSel.title = 'How much this page draws (only this browser)';
for (const v of ['auto', ...J.QUALITY]) qSel.add(new Option(v === 'auto' ? 'auto' : v, v));
qSel.value = qWant; document.body.appendChild(qSel);
qSel.addEventListener('change', () => { qWant = qSel.value; try { localStorage.setItem(QKEY, qWant); } catch (e) { /* not kept */ } qSel.blur(); applyQuality(); });
const fps = { n: 0, t0: performance.now() };
function autoQuality(now) {
  fps.n++;
  if (now - fps.t0 < 2000) return;
  const f = fps.n * 1000 / (now - fps.t0); fps.n = 0; fps.t0 = now;
  if (document.visibilityState === 'visible' && f < 45 && qAuto > 0) { qAuto--; life(`PC view: ${f.toFixed(0)} fps, auto quality down to ${J.QUALITY[qAuto]}`); }
  applyQuality();
}
applyQuality();
// ---- Align (the webcam page only): the rings and crosses of the three floor spots over the picture are shown only while aligning (Marek, 2026-10-29:
//      they could not be hidden); the button turns it on and off, and clicking a spot in the picture shows them while it is waited for (webcamview.js)
let aligning = false;
const alignBtn = document.createElement('button'); alignBtn.id = 'align'; alignBtn.textContent = 'Align'; alignBtn.title = 'Show the floor spots over the picture, to align the camera';
alignBtn.addEventListener('click', () => { aligning = !aligning; alignBtn.classList.toggle('on', aligning); alignBtn.blur(); });
document.body.appendChild(alignBtn);
function alignMarks() {
  const mx = window.mixed;
  alignBtn.style.display = mx ? '' : 'none';
  if (mx) mx.show.marks = aligning;
}
// (pressing Spot 1, Spot 2 or Check spot on the webcam panel is aligning: Align turns on, so the click and its rings can be seen)
addEventListener('click', (e) => { if (e.target && /^wcSpot[0-2]$/.test(e.target.id) && !aligning) alignBtn.click(); }, true);
// F: the picture alone, full screen (every panel and text hidden); F or Escape again brings them back
addEventListener('keydown', (e) => {
  if ((e.key !== 'f' && e.key !== 'F') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
  const bare = document.body.classList.toggle('bare');
  if (bare && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  if (!bare && document.fullscreenElement) document.exitFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('bare'); });

let last = performance.now(), hudAt = 0, marker = null, markerSlot = null;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  autoQuality(now);
  alignMarks();
  const sn = feed.serverNow(), at = sn === null ? undefined : sn - DELAY, S = feed.session, state = S.doc.jenga || J.waiting();
  room3d.set(S.doc.room ? S.doc.room.data : null);
  camMarks.update(Object.values(S.doc.cameras || {}));
  // through a webcam (webcam.html) the real floor is the camera's picture: no floor of this view's own and no haze over the picture
  const throughCam = !!(window.mixed && window.mixed.WCV.running);
  floor.visible = !throughCam; scene.fog = throughCam ? null : FOG;
  const smp = feed.sample('jenga', null, at), snap = smp ? smp.data : null;
  // the room's ceiling lights and their shades, and the aim of whoever marks them (from their presence, as every headset works it out)
  const roomNow = S.doc.room ? S.doc.room.data : null, lights = M.room.lights(roomNow, S.doc.rlights || {});
  const mslot = S.doc.jmark && Number.isInteger(S.doc.jmark.slot) ? S.doc.jmark.slot : null, mpr = mslot === null ? null : feed.sample('presence', mslot, at);
  if (!mpr) { marker = null; markerSlot = null; } else if (markerSlot !== mslot) { marker = new M.room.LightMarker(); markerSlot = mslot; }
  const cursor = mpr ? markCursor(M.room, marker, [mpr.data.head[0], mpr.data.head[1], mpr.data.head[3]], mpr.data.sources, M.room.ceilingHeight(roomNow), lights, now).cursor : null;
  const lay = J.board(state, { here: S.peers.size, game: S.stateOf(null), mine: { ghost: true }, host: S.hostHere && !!S.doc.jenga,
    mark: { slot: mpr ? mslot : null, mine: false, name: mpr ? ((state.players || []).find((p) => p.slot === mslot) || {}).name || `Player ${mslot + 1}` : '', n: lights.length } });
  const heads = feed.players().map((p) => { const pr = feed.sample('presence', p.slot, at); return pr ? { slot: p.slot, x: pr.data.head[0], y: pr.data.head[1] } : null; }).filter(Boolean);
  scene3d.update({ state, snap, now, t: sn === null ? undefined : sn, lay, heads, deco: S.doc.jdeco || null, garden: S.game('garden'),
    shades: { lights, cursor, dark: M.dim.level(S.doc.dim, sn).dark } });
  const tn = dir.tension.update(S.doc.jenga || null, snap ? snap.items : null, dt), mu = S.doc.jmusic || null;
  for (const w of J.momentsBetween(dir.prev, S.doc.jenga || null)) dir.moments.push({ text: MOMENT[w] || w, t: now });
  const dl = M.dim.level(S.doc.dim, sn);                           // (what the headsets' passthrough is drawn at: this view has no real room to dim)
  dir.prev = S.doc.jenga || null; dir.moments = dir.moments.filter((m) => now - m.t < 4500);
  const track = mu && mu.track ? mu.track.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/&/g, '&amp;').replace(/</g, '&lt;') : 'no tracks';
  hudBox.innerHTML = `<div class="k">music</div><div class="scene">${mu ? mu.scene : 'none (no host)'}</div>${mu ? `<div class="k">${track}</div>` : ''}<div class="k">tension ${Math.round(tn * 100)}%</div><div class="bar"><i style="width:${Math.round(tn * 100)}%"></i></div><div class="k">room dim ${Math.round(dl.dark * 100)}% · grey ${Math.round(dl.mute * 100)}%</div>${dir.moments.map((m) => `<div class="m">\u266a ${m.text}</div>`).join('')}`;
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
    const used = new Set();
    if (pr) {
      const h = pr.data.head; o.head.position.copy(toV(h[0], h[1], h[3])); o.head.rotation.set(0, h[2], 0);
      for (const s of pr.data.sources) {
        if (s.foot) continue;
        if (Array.isArray(s.joints) && s.joints.length === 25) {
          used.add(s.id);
          let g = o.hands[s.id];
          if (!g) { g = o.hands[s.id] = { ghost: new GhostHand(0.55), jp: new Float32Array(75) }; world.add(g.ghost.mesh); }
          for (let i = 0; i < 25; i++) { const j = s.joints[i]; g.jp[i * 3] = j[0]; g.jp[i * 3 + 1] = j[2]; g.jp[i * 3 + 2] = -j[1]; }
          g.ghost.update(g.jp, JR, o.col); g.ghost.mesh.visible = true;
        } else for (const q of s.points.map((x) => [x.x, x.y, x.z])) if (n < 160) { const v = toV(q[0], q[1], q[2]); mtx.makeTranslation(v.x, v.y, v.z); o.dots.setMatrixAt(n++, mtx); }
      }
    }
    for (const [id, g] of Object.entries(o.hands)) if (!used.has(id)) g.ghost.mesh.visible = false;
    o.dots.count = n; o.dots.instanceMatrix.needsUpdate = true;
  }
  for (const [slot, o] of [...drawn]) if (!here.has(slot)) { world.remove(o.head, o.dots); for (const g of Object.values(o.hands)) { world.remove(g.ghost.mesh); g.ghost.dispose(); } drawn.delete(slot); }
  // the soundtrack plays the host's record and follows the same shared state
  if (sound.music.ctx) { const fw = new THREE.Vector3(); camera.getWorldDirection(fw); sound.update(S.doc.jenga || null, snap ? snap.items : null, dt, S.game('music'), { x: camera.position.x, y: -camera.position.z, yaw: Math.atan2(-fw.z, fw.x) }, S.doc.jmusic || null); }
  if (!controls.autoRotate && now - touchedAt > 30000) controls.autoRotate = true;
  controls.update();
  renderer.render(scene, camera);
  if (now - hudAt < 5) hud.textContent = [state.phase.replace('_', ' '), `round ${state.round} of ${state.rounds}`, S.hostHere ? null : 'NO HOST', `${S.others} ${S.others === 1 ? 'player' : 'players'}`, smp ? null : 'waiting for bodies', sound.music.ctx ? `music: ${sound.scene || ''}` : 'M for the music'].filter(Boolean).join('   ·   ');
  requestAnimationFrame(frame);
}
setInterval(() => sound.music.tick(), 1000);
window.__view = { feed, scene3d, camera, controls, sound, aim, renderer, scene };
// What the webcam page (webcam.html, engine/client/webcam/mixed.js) needs of this view: the feed, the scene and its camera and controls (the page
// replaces controls.update, which is called once a frame just before drawing), the delay, the cameras' drawing, the parts of the picture that its
// Show menu switches (this view draws the room as one outline and the players' heads and joints; the board is the game's, not a menu) and the lights
// that light the real room (as the headsets' relight: the lantern, the lamps, the candles, the shades), in this view's world.
const each = (f) => [...drawn.values()].flatMap(f);
window.view = { feed, scene, camera, renderer, orbit: controls, setDelay: (ms) => { DELAY = ms; }, camMarks, world, relights: () => scene3d.relights(),
  parts: {
    hands: () => each((o) => [o.dots, ...Object.values(o.hands).map((g) => g.ghost.mesh)]),
    head: () => each((o) => [o.head]),
    floor: { objects: () => [room3d.group], static: true },
    cameras: { objects: () => [camMarks.group], static: true },
  } };
requestAnimationFrame(frame);
