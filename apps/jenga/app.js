// Jenga on createApp: what the app gives the engine is its shared board (one menu for everybody), its drawing, and nothing else. There is no
// simulation here: the PC host plays the game (host.js) and the page draws the bodies it sends and the state it keeps in the document.
//   node tools/run.js jenga --http          two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40      (a PC view: /view.html)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp, PLAYER_COLOURS } from '/mumr/xr/app.js';
import { createScene } from './draw.js';

const J = window.JENGA;
const stream = new J.Stream(60);
const sound = new J.Soundtrack({ base: 'music/' });
let scene3d = null, common = null, app = null, lastDraw = performance.now(), noHostAt = null, lastClear = -1e9;
const state = () => (app && app.S.doc.jenga) || J.waiting();
const hostHere = () => !!app && (app.S.hostHere || app.S.isHost);
const info = () => ({ here: app.S.connected ? app.S.others + 1 : 1, game: app.S.stateOf(null), mine: app.S.stateOf(null), host: hostHere() && !!app.S.doc.jenga });
const hostBody = () => app.bodies[0];
// where everybody stands, in the common frame (this player's head and the others' from presence): the scene lights the feet of whoever is on turn
function heads(a, now) {
  const sp = a.space, c = (x, y) => (sp.ok ? sp.toCommon([x, y]) : [x, y]), h = a.head(), out = [];
  if (a.S.me !== null && a.S.me !== undefined) { const p = c(h[0], h[1]); out.push({ slot: a.S.me, x: p[0], y: p[1] }); }
  for (const o of a.presence.others(now)) { const p = c(o.head[0], o.head[1]); out.push({ slot: o.slot, x: p[0], y: p[1] }); }
  return out;
}

// the buttons of the board: the host's commands (the game is the host's), and the settings (acting on the shared settings, or on this player's own)
function press(id) {
  if (['start', 'round', 'lobby', 'size', 'reroll', 'skip', 'back'].includes(id)) { hostBody().ask(id, {}); return; }
  if (id === 'place') {
    // the tower goes in front of this player (the console is at its side, facing this player), turned the way the player looks
    // (the host arranges the furniture for the real room round where this player stands: arrange.js; it may move the tower to where it fits)
    const s = state(), half = J.layout(s.size).plinth.half, h = app.head(), sp = app.space, dist = half + 0.8;
    const c = sp.ok ? sp.toCommon([h[0], h[1]]) : [h[0], h[1]], yaw = sp.ok ? sp.yawToCommon(h[2]) : h[2];
    hostBody().ask('place', { x: c[0] + Math.cos(yaw) * dist, y: c[1] + Math.sin(yaw) * dist, yaw, hx: c[0], hy: c[1] });
    return;
  }
  app.S.press(null, id);
}

app = await createApp({
  THREE, OrbitControls, anchorKey: 'mumr.jenga.anchor',
  session: { game: J.GAME, player: J.PLAYER, actions: J.ACTIONS, press: J.press, kinds: J.KINDS },
  menu: false,                                  // one menu for everybody: the board
  handMask: true,
  boards: [{ id: 'main', w: J.BOARD.w, panel: false, pose: () => scene3d && scene3d.boardPose(state()), lay: () => J.board(state(), info()), press }],      // (drawn by stand.js)
  bodies: () => [{ token: J.TOKEN, type: 'jenga', policy: 'host', slowEvery: 0, adapter: J.pageAdapter(stream) }],
  setup: ({ world, renderer, lights }) => {
    common = new THREE.Group(); world.add(common);          // the common frame: moved by this page's line-up every frame
    scene3d = createScene({ THREE, parent: common, renderer, playerColours: PLAYER_COLOURS });
    lights.hemi.visible = false; lights.sun.visible = false;              // (the scene has its own light: look.js)
  },
  draw: (a, now) => {
    const sp = a.space;
    if (sp.ok) { common.position.set(sp.frame.x, sp.fz, -sp.frame.y); common.rotation.set(0, sp.frame.yaw, 0); } else { common.position.set(0, 0, 0); common.rotation.set(0, 0, 0); }
    const snap = stream.at(now);
    scene3d.update({ state: state(), snap, now, t: a.S.serverNow(), lay: J.board(state(), info()), touches: a.boardTouches('main'), heads: heads(a, now) });
    // the soundtrack follows the shared state and the bodies (every headset hears the same scene: it is worked out from the same data)
    if (sound.music.ctx) { const h = a.head(), sp = a.space, c = sp.ok ? sp.toCommon([h[0], h[1]]) : [h[0], h[1]]; sound.update(app.S.doc.jenga || null, snap ? snap.items : null, Math.min(0.1, (now - lastDraw) / 1000), app.S.game('music'), { x: c[0], y: c[1], yaw: sp.ok ? sp.yawToCommon(h[2]) : h[2] }); }
    lastDraw = now;
    // the room's dim is the host's (focus.js) and the server keeps it: a host that goes away in the middle of a fall must not leave everybody in a dark room, so
    // any page that has had no host for a few seconds lets it go (every page does: the same ask, the same look)
    if (hostHere() || !a.S.connected) noHostAt = null; else if (noHostAt === null) noHostAt = now;
    if (noHostAt !== null && now - noHostAt > 4000 && now - lastClear > 6000) { const lv = a.dimLevel(); if (lv.dark > 0 || lv.mute > 0) { lastClear = now; a.dim({ dark: 0, mute: 0, fade: 1500 }); } }
  },
  status: () => { const s = app && app.S.doc.jenga; return s ? `${s.phase}, round ${s.round}/${s.rounds}, ${s.moves} moves${hostHere() ? '' : '   NO HOST'}` : 'waiting for the host'; },
});
// the music: the tracks Marek supplies (music/tracks.json, made by `node apps/jenga/music/build-manifest.js`); a page may make no sound before a tap or a click
fetch('music/tracks.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => { sound.music.load(m || {}); app.life(`music: ${sound.music.tracks} tracks`); });
sound.music.log = (t) => app.life(t);
const wake = () => { if (!sound.music.ctx) { try { sound.music.start(); app.life('music: started'); } catch (e) { app.life(`music: no audio (${e.message})`); } } else sound.music.start(); };
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, wake, { passive: true });
document.getElementById('enter')?.addEventListener('click', wake);
setInterval(() => sound.music.tick(), 1000);
window.__jenga = Object.assign(app, { stream, scene3d, sound });
