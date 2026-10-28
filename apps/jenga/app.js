// Jenga on createApp: what the app gives the engine is its shared board (one menu for everybody), its drawing, and nothing else. There is no
// simulation here: the PC host plays the game (host.js) and the page draws the bodies it sends and the state it keeps in the document.
//   node tools/run.js jenga --http          two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40      (a PC view: /view.html)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createApp, PLAYER_COLOURS } from '/mumr/xr/app.js';
import { createScene } from './draw.js';
import { markCursor } from './shades.js';

const J = window.JENGA, R = window.MUMR.room;
const stream = new J.Stream(60);
const sound = new J.Soundtrack({ base: 'music/', now: () => (app ? app.S.serverNow() : Date.now()) });
let scene3d = null, common = null, app = null, lastDraw = performance.now(), noHostAt = null, lastClear = -1e9;
const state = () => (app && app.S.doc.jenga) || J.waiting();
const hostHere = () => !!app && (app.S.hostHere || app.S.isHost);
const info = () => ({ here: app.S.connected ? app.S.others + 1 : 1, game: app.S.stateOf(null), mine: app.S.stateOf(null), host: hostHere() && !!app.S.doc.jenga, mark: markInfo() });
// ---- the room's ceiling lights (engine room.js lights: the scan's lamps and the ones marked; shades.js hangs a paper shade under each), and who marks them
const serverRoom = () => (app.S.doc.room ? app.S.doc.room.data : null);
const roomLights = () => R.lights(serverRoom(), app.S.doc.rlights || {});
// the player marking, if they are here (a player who left marks nothing)
function markSlot(now = performance.now()) {
  const m = app.S.doc.jmark, slot = m && Number.isInteger(m.slot) ? m.slot : null;
  return slot !== null && (slot === app.S.me || app.presence.others(now).some((o) => o.slot === slot)) ? slot : null;
}
const nameOf = (slot) => ((state().players || []).find((p) => p.slot === slot) || {}).name || `Player ${slot + 1}`;
function markInfo() { const slot = markSlot(); return { slot, mine: slot !== null && slot === app.S.me, name: slot === null ? '' : nameOf(slot), n: roomLights().length }; }
// where the marking player points (every page works it out from that player's head and hands; only their own page sends what they mark)
let marker = null, markerSlot = null;
function marking(a, now, lights) {
  const slot = markSlot(now), sp = a.space;
  if (slot === null || !sp.ok) { marker = null; markerSlot = null; return null; }
  if (markerSlot !== slot) { marker = new R.LightMarker(); markerSlot = slot; }
  const mine = slot === a.S.me, o = mine ? null : a.presence.others(now).find((q) => q.slot === slot), head = mine ? a.head() : o && o.head;
  if (!head) return null;
  const srcs = mine ? a.everyone.filter((s) => s.slot === undefined || s.slot === null) : (o.sources || []);
  const cs = srcs.map((s) => Object.assign({}, s, { points: (s.points || []).map((q) => { const v = sp.toCommon([q.x, q.y, q.z]); return { name: q.name, x: v[0], y: v[1], z: v[2] }; }) }));
  const r = markCursor(R, marker, sp.toCommon([head[0], head[1], head[3]]), cs, R.ceilingHeight(serverRoom()), lights, now);
  if (mine && r.done) { a.S.emit(r.done); a.life(`jenga: ${r.done.del ? 'a ceiling light unshaded' : 'a ceiling light marked'} (${r.done.id})`); }
  return r.cursor;
}
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
  if (id === 'lights') { const m = app.S.doc.jmark; app.S.emit({ k: 'jmark', slot: m && m.slot === app.S.me ? null : app.S.me }); return; }
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

const perf = { at: 0, frames: 0, worst: 0, ms: 0, t0: 0 };          // (the frame rate, into the server log every 5 s)
app = await createApp({
  THREE, OrbitControls, anchorKey: 'mumr.jenga.anchor',
  session: { game: J.GAME, player: J.PLAYER, actions: J.ACTIONS, press: J.press, kinds: J.KINDS },
  menu: false,                                  // one menu for everybody: the board
  handMask: true,
  boards: [{ id: 'main', w: J.BOARD.w, panel: false, pose: () => scene3d && scene3d.boardPose(state()), lay: () => J.board(state(), info()), press }],      // (drawn by stand.js)
  bodies: () => [{ token: J.TOKEN, type: 'jenga', policy: 'host', slowEvery: 0, adapter: J.pageAdapter(stream) }],
  setup: ({ world, renderer, lights }) => {
    common = new THREE.Group(); world.add(common);          // the common frame: moved by this page's line-up every frame
    scene3d = createScene({ THREE, parent: common, renderer, playerColours: PLAYER_COLOURS, relit: true });
    lights.hemi.visible = false; lights.sun.visible = false;              // (the scene has its own light: look.js)
  },
  draw: (a, now) => {
    perf.t0 = performance.now();
    const sp = a.space;
    if (sp.ok) { common.position.set(sp.frame.x, sp.fz, -sp.frame.y); common.rotation.set(0, sp.frame.yaw, 0); } else { common.position.set(0, 0, 0); common.rotation.set(0, 0, 0); }
    const snap = stream.at(now);
    const lights = roomLights();
    scene3d.update({ state: state(), snap, now, t: a.S.serverNow(), lay: J.board(state(), info()), touches: a.boardTouches('main'), heads: heads(a, now), deco: a.S.doc.jdeco || null, garden: a.S.game('garden'),
      shades: { lights, cursor: marking(a, now, lights), dark: a.dimLevel().dark } });
    a.relight(scene3d.relights());                       // (the lantern lights the real room: the dim lifts round it, the walls warm)
    perf.frames++; perf.worst = Math.max(perf.worst, now - lastDraw); perf.ms += performance.now() - perf.t0;
    if (now - perf.at >= 5000) { app.life(`jenga perf: ${(perf.frames * 1000 / (now - perf.at)).toFixed(0)} fps, worst frame ${perf.worst.toFixed(0)} ms, scene ${(perf.ms / Math.max(1, perf.frames)).toFixed(1)} ms, ${a.renderer ? a.renderer.info.render.calls : '?'} draw calls`); perf.at = now; perf.frames = 0; perf.worst = 0; perf.ms = 0; }
    // the soundtrack plays the host's record (every headset the same track at the same place) and follows the shared state and the bodies
    if (sound.music.ctx) { const h = a.head(), sp = a.space, c = sp.ok ? sp.toCommon([h[0], h[1]]) : [h[0], h[1]]; sound.update(app.S.doc.jenga || null, snap ? snap.items : null, Math.min(0.1, (now - lastDraw) / 1000), app.S.game('music'), { x: c[0], y: c[1], yaw: sp.ok ? sp.yawToCommon(h[2]) : h[2] }, app.S.doc.jmusic || null); }
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
