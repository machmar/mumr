// The page wiring every MUMR app repeats, in one call (an ES module; THREE and OrbitControls are handed in). It makes the renderer, scene,
// floor and desktop camera; the link, the session, the line-up, the engine's wrist menu, everybody's menus (with the handle under this
// player's own and the fingertip press), presence, the ghost fingers, the hand cutouts, the feet (if asked), everybody's gestures
// (grab.js), the other players, the anchor keeper; entering and
// leaving mixed reality; the desktop rehearsal (?name=A&frame=x,y,deg: a pretend line-up, the mouse as a fingertip, Shift a pinch, a click
// on any menu presses it, Ctrl a fist, ?room=demo a pretend room scan); the fist as the move gesture for whatever can be moved; the room (room.js: the server's, uploaded by a headset; drawn as outlines on the
// desktop and while lining up); giving bodies up while nobody looks at the page; the status line and reloading on a new build.
//
//   const app = await createApp({ THREE, OrbitControls,
//     session: { game, player, actions, press },        the app's settings and buttons (the engine adds its own)
//     menu: (state, info) => layout | false,             the app's floating menu (menus.grid), for this player, the others and the PC view;
//                                                        false: the app has no menu of each player's own (it has boards)
//     bodies: ({ S, space, say, life }) => [{ token, type, adapter }],   the app's bodies (body.js); packets of their types reach them
//     setup(app),                                        (optional) once, before the first frame: the app adds its meshes to app.world
//     step(dt, t, hands, own),                           the app's simulation, every frame (hands: everybody's; own: this page's)
//     draw(app, now),                                    the app's drawing, every frame (app.world is the floor: THREE (x, z, -y))
//     onAction(id, from),                                the app's own action buttons (an action happens at the menu's owner)
//     ghostColour(id, own, grip) -> colour | 'grips',    (optional) this page's ghost fingers' colour for hand `id` (grip: its grab.js
//                                                        state); 'grips' colours a pinch and a fist (GHOST_COLOURS); default: never changes
//     status() -> text,                                  (optional) the app's part of the status line
//     feet: 'off' | 'show' | 'kick',                     (optional) the feet from body tracking as shoes: off (default), shown to
//                                                        everybody, or also given to the app's simulation as sources that may push
//     handMask: true,                                    (optional) the hand cutouts: real hands in front of everything (default on;
//                                                        app.handMask.enabled switches them while the page runs)
//     handWall: false,                                   (optional) the hand window on the room's longest wall (handwall.js); its
//                                                        place is the document's `wallspot` (room.js SPOT_KIND), moved in the room model
//     roomModel: { open(state), handIrl(state), things(app) },   (optional) the room model (model.js): open / handIrl say from a
//                                                        player's state whether that player's model is open and whether their hand
//                                                        is shown full size in the room when it reaches into it; things: the app's
//                                                        movable things [{ id, label, kind: 'box', at, yaw, size: [w], colour,
//                                                        drag(phase, at, preview) }] (the viewer is the engine's)
//     windows: [{ id, w, bearing, dist, desktop, lay(app, now) }],   (optional) text windows for this player only (not sent): each hangs
//                                                        on a wall like the viewer, beside it, and is moved along the walls by its bar
//                                                        (pinch) or a fist; with no wall (no room scan) it floats and follows like the menu
//                                                        (bearing, dist: where it first appears, rad from ahead + is left, 0.8 m; desktop: its
//                                                        pose without a room). Drawn from lay(): a menus.grid layout, redrawn four times a
//                                                        second (a cell with `left: true` is a line of text: `head`, `size`, `flat`). w: metres wide (0.5)
//     boards: [{ id, w, pose(app, now), lay(app, now), press(id, app) }],   (optional) menus that are ONE thing for everybody (rule 1): a panel
//                                                        standing in the room where the app's shared data puts it, drawn the same for every
//                                                        player and pressed by anybody's fingertip. w: metres wide; pose: { x, y, h, yaw, pitch }
//                                                        in the COMMON frame (h above the common floor), or null for no board; lay: a menus.grid
//                                                        layout worked out from shared data; press: what a button does on the page whose
//                                                        player pressed it (it asks the shared world: body.ask, session.emit ...). The press
//                                                        and the fingertip's depth are seen on every page like a menu's.
//     anchorKey, name })                                 (optional) where the anchor is kept; who this page is in the log
//   app: { THREE, scene, world, camera, S, space, presence, menus, lineup, sys, room, grips, handMask, feet, life, say, head(), xr(), bodies,
//          ownerText(slot), gestures (this frame: everybody's hands' grab.js states), everyone (this frame: everybody's hand sources) }
//   (app.room.local(): the room in this page's floor plan, for the app's physics: room.js support / pushOut)
// The page may have the elements #view (canvas), #enter, #xrNote, #say, #status (the cube's page does: its own look); without #view,
// createApp makes the standard ones.
import { enterXR } from './session.js';
import { readInput, readFeet, readPlanes } from './input.js';
import { makeGhost, GHOST_COLOURS, RADII } from './ghost.js';
import { createPlayers, PLAYER_COLOURS } from './players3d.js';
import { makePanels } from './panel3d.js';
import { createRoom3d } from './room3d.js';
import { makeShoes } from './feet3d.js';
import { createHandMask } from './handmask.js';
import { createHandWall, SIZE as WALL_SIZE, wallSpot } from './handwall.js';
import { createModel3d } from './roommodel3d.js';
import { createCameraMarks } from './cammark3d.js';

export { GHOST_COLOURS, PLAYER_COLOURS };
const HOST = 15, MENU_W = 0.42;

export async function createApp(o) {
  const { THREE, OrbitControls } = o, M = window.MUMR, QS = new URLSearchParams(location.search), $ = (id) => document.getElementById(id);
  const QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent), SysMenu = M.sysmenu.SysMenu;
  const LS = { getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } } };

  // ---- the page: a page without #view gets the standard one (a header with Enter mixed reality, the canvas, the status line)
  if (!$('view')) {
    const st = document.createElement('style');
    st.textContent = 'body{margin:0;background:#14161c;color:#ece9e2;font:15px/1.5 system-ui,sans-serif}'
      + 'header{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #39404f}'
      + 'header h1{font-size:19px;margin:0}button{font:600 15px system-ui,sans-serif;padding:9px 14px;border-radius:8px;border:1px solid #4ea1ff;background:#4ea1ff;color:#0b0d12;cursor:pointer}'
      + '#view{display:block;width:100%;height:calc(100vh - 160px);min-height:320px;touch-action:none}'
      + '#status{margin:0;padding:8px 16px;color:#9aa3b2;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;max-height:104px;overflow:auto}#say{margin-left:auto}';
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend', `<header><h1></h1><button id="enter" hidden>Enter mixed reality</button><span id="xrNote"></span><span id="say"></span></header>`
      + '<canvas id="view"></canvas><pre id="status"></pre>');
    document.querySelector('header h1').textContent = document.title;
  }

  // ---- the scene. `world` is the floor: inside it the floor plan (x, y, z) is THREE (x, z, -y).
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.xr.enabled = true;
  const scene = new THREE.Scene(), DESK_BG = new THREE.Color(0x20242c);
  scene.background = DESK_BG;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 50);
  camera.position.set(0.2, 1.7, 2.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.5, 0.4, 0); controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 3, 2); scene.add(sun);
  const world = new THREE.Group(); scene.add(world);
  const grid = new THREE.GridHelper(6, 30, 0x55607a, 0x353b4a); world.add(grid);
  const GhostHand = makeGhost(THREE), ghosts = { left: new GhostHand(), right: new GhostHand() };
  for (const g of Object.values(ghosts)) scene.add(g.mesh);
  const players = createPlayers({ THREE, world, scene, GhostHand });
  const { Panel } = makePanels(THREE, renderer);
  const room3d = createRoom3d({ THREE, parent: world });
  const FEET = o.feet || 'off', ownShoes = makeShoes(THREE, world);
  const handMask = createHandMask({ THREE, renderer, scene });
  handMask.enabled = o.handMask !== false;
  const handWall = o.handWall ? createHandWall({ THREE, parent: world }) : null;
  const mouseDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf2c14e })); mouseDot.visible = false; world.add(mouseDot);

  // ---- the shared world
  const info = await fetch('/info').then((r) => r.json()).catch(() => ({ build: 0 }));
  const NAME = QS.get('name') || o.name || (QUEST ? 'Quest' : 'PC tab');
  const life = M.life.make({ name: NAME });
  let sayT = -1e9;
  const say = (text) => { $('say').textContent = text; sayT = performance.now(); life(`said: ${text}`); };
  life(`page loaded (${navigator.userAgent.slice(0, 80)})`);
  const link = M.link.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, { build: info.build, name: NAME });
  link.onNote = (n) => life(`link: ${n}`);
  const sess = o.session || {};
  const S = new M.session.Session(link, Object.assign({}, sess, { actions: SysMenu.ACTIONS.concat(sess.actions || []), kinds: Object.assign({ wallspot: M.room.SPOT_KIND, winspot: M.room.WIN_KIND }, sess.kinds || {}) }));
  const space = new M.align.Space(null, 0);
  const presence = new M.presence.Presence(S, space);
  const menus = new M.menus.Menus(S, space, { known: (id) => id === 'main' || id === 'wrist' || id === 'model' });
  const lineup = new M.lineup.LineUp(S, space, { store: LS, say, life });
  const room = new M.room.Room(S, space, { life, say });
  let xr = null, keeper = null;
  // the real cameras of the room (cams.js): a small thing where each really is; while lining up three knobs hang in front of each, and a pinch on
  // one moves the camera a twentieth as far as the hand (the page that owns the camera decides, keeps it looking at the same point and announces it)
  const camMarks = createCameraMarks({ THREE, group: world }), camKnobs = new M.camknobs.CamKnobs();
  let camSent = 0, camPend = null;
  const r2 = (v) => Math.round(v * 100) / 100;
  function camInfo() { const list = Object.values(S.doc.cameras), c = list[0]; return { count: list.length, name: c ? c.name : '', x: c ? r2(c.x) : 0, y: c ? r2(c.y) : 0, z: c ? r2(c.z) : 0 }; }
  function camReset() {
    const list = Object.values(S.doc.cameras);
    camKnobs.cancel(); camPend = null;
    if (!list.length) { say('No camera is aligned'); return; }
    for (const c of list) S.resetCamera(c.id);
    say(list.length === 1 ? 'The camera is back where its clicks put it' : `${list.length} cameras are back where their clicks put them`);
  }
  function camFrame(now, tips, cams) {
    if (lineup.active && S.connected && space.ok) {
      const r = camKnobs.update(tips, cams, space.fz);
      if (r.grabbed) life('camera: a knob was taken');
      const last = r.release || (r.moves.length ? r.moves[r.moves.length - 1] : null);
      if (last) camPend = last;
      if (camPend && (r.release || now - camSent >= 50)) {
        const p = camPend, c = space.toCommon([p.x, p.y]);
        S.moveCamera(p.id, c[0], c[1], p.z - space.fz);
        camSent = now; camPend = null;
      }
    } else { camKnobs.cancel(); camPend = null; }
    camMarks.update(cams.map((c) => camKnobs.pose(c)));          // (the one a hand holds is drawn where the hand has taken it: the world catches up a moment later)
  }
  const sys = new SysMenu(S, lineup, {
    exit: () => { if (xr) { life('xr: the Exit button ended the session'); xr.session.end(); } else say('Not in mixed reality'); },
    roomSetup: () => { const r = xr ? xr.roomSetup() : 'none'; say(r === 'started' ? 'Room setup: the headset takes over' : r === 'used' ? 'Room setup was used once: leave mixed reality and come back for it again' : 'No room setup here'); },
    roomUsed: () => !!(xr && xr.roomUsed),
    room, life, cams: camInfo, camReset,
  });
  const bodies = (typeof o.bodies === 'function' ? o.bodies({ S, space, say, life }) : o.bodies || []).map((b) => new M.body.Body(S, b));
  const clicks = new M.clicks.Clicks();
  const pinch = new M.hands.Pinch(), poke = new M.menus.Poke(), follower = new M.follow.Follower(), grips = new M.grab.Grips();
  const HAS_MENU = o.menu !== false;
  const boards = (o.boards || []).map((d) => ({ d, id: d.id, key: `board:${d.id}`, w: d.w || 0.6, lay: null, layAt: -1e9, pose: null }));
  const wins = (o.windows || []).map((d, i) => ({ d, id: d.id, w: d.w || 0.5, h: 0.3, f: new M.follow.Follower({ dist: d.dist || 0.8, bearing: d.bearing === undefined ? 0.5 : d.bearing }),
    panel: null, lay: null, layAt: -1e9, redraw: false, pinch: new Map(), drag: null, order: i }));
  const isHost = (slot) => { const p = S.peers.get(slot); return slot === HOST || !!(p && p.host); };
  const ownerText = (slot) => (slot === null || slot === undefined ? 'nobody' : isHost(slot) ? 'host' : slot === S.me ? 'you' : `player ${slot + 1}`);
  link.onBin = (b) => {
    const p = M.wire.decode(b), now = performance.now();
    if (!p) return;
    if (p.name === 'presence') presence.receive(p, now);
    else if (p.name === 'menus') menus.receive(p, now);
    else for (const body of bodies) body.receive(p, now);
  };
  S.on('action', (id, from) => { if (!sys.press(id) && o.onAction) o.onAction(id, from); });
  S.on('press', (id, from) => { if (from !== S.me) say(`Player ${from + 1} pressed ${id} on your menu`); });
  S.on('peer', (slot, on) => { if (isHost(slot)) { life(`host ${on ? 'here' : 'gone'}`); return; } say(on ? `Player ${slot + 1} is here` : `Player ${slot + 1} left`); life(`peer ${slot + 1} ${on ? 'joined' : 'left'}`); });
  S.on('token', (t, mine) => { life(`${t}: ${mine ? 'simulated here' : `simulated by ${ownerText(S.holder(t))}`}`); if (mine && document.hidden && !xr) away(); });
  S.on('leave', (why) => { if (why === 'version') say('This page is older than the server\'s: reload it'); });
  // a page nobody looks at (a hidden tab, a headset taken off, a frame loop that stopped) draws no frames: it gives its bodies up
  let awayAt = -1e9, last = performance.now();
  function away() {
    const now = performance.now();
    if (now - awayAt < 5000 || !S.connected || !(S.others || S.hostHere)) return;
    const held = bodies.filter((b) => S.holds(b.token));
    if (!held.length) return;
    awayAt = now;
    for (const b of held) S.release(b.token);
    life(`${held.map((b) => b.token).join(', ')}: given up (this page is not looked at)`);
  }
  document.addEventListener('visibilitychange', () => { life(`page ${document.visibilityState}`); if (document.hidden && !xr) away(); });
  setInterval(() => { if (performance.now() - last > 1000) away(); }, 500);
  if (QS.has('frame')) {
    const [x, y, deg] = QS.get('frame').split(',').map(Number);
    lineup.given({ x: x || 0, y: y || 0, yaw: ((deg || 0) * Math.PI) / 180 });
    life(`pretend line-up ${QS.get('frame')}`);
  }
  // a pretend room scan for the desktop rehearsal: a floor, a table, a bed and two walls in this tab's floor plan
  // (?room=two: the same and a second room 5 m away, as Marek's scan had: the room picker)
  if (QS.get('room') === 'two') room.setScan({ planes: [
    { l: 'floor', v: false, p: [[-1, -1.5, 0], [3, -1.5, 0], [3, 1.6, 0], [-1, 1.6, 0]] },
    { l: 'table', v: false, p: [[0.9, 0.0, 0.72], [1.7, 0.0, 0.72], [1.7, 0.6, 0.72], [0.9, 0.6, 0.72]] },
    { l: 'wall', v: true, p: [[-1, 1.6, 0], [3, 1.6, 0], [3, 1.6, 2.4], [-1, 1.6, 2.4]] },
    { l: 'floor', v: false, p: [[5, -1, 0], [8, -1, 0], [8, 2, 0], [5, 2, 0]] },
    { l: 'wall', v: true, p: [[5, 2, 0], [8, 2, 0], [8, 2, 2.4], [5, 2, 2.4]] },
    { l: 'bed', v: false, p: [[6, 0, 0.5], [7.5, 0, 0.5], [7.5, 1.5, 0.5], [6, 1.5, 0.5]] },
  ] });
  if (QS.get('room') === 'demo') room.setScan({ planes: [
    { l: 'floor', v: false, p: [[-1, -1.5, 0], [3, -1.5, 0], [3, 1.6, 0], [-1, 1.6, 0]] },
    { l: 'table', v: false, p: [[0.9, 0.0, 0.72], [1.7, 0.0, 0.72], [1.7, 0.6, 0.72], [0.9, 0.6, 0.72]] },
    { l: 'bed', v: false, p: [[-0.9, -1.4, 0.5], [0.1, -1.4, 0.5], [0.1, -0.5, 0.5], [-0.9, -0.5, 0.5]] },
    { l: 'wall', v: true, p: [[-1, 1.6, 0], [3, 1.6, 0], [3, 1.6, 2.4], [-1, 1.6, 2.4]] },
    { l: 'wall', v: true, p: [[3, -1.5, 0], [3, 1.6, 0], [3, 1.6, 2.4], [3, -1.5, 2.4]] },
  ] });

  // ---- mixed reality
  if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-ar').then((ok) => { $('enter').hidden = !ok; if (!ok) $('xrNote').textContent = 'no mixed reality in this browser: desktop rehearsal'; });
  $('enter').onclick = async () => {
    clicks.unlock();                                           // (the menu's clicks: a page may make no sound before a tap)
    try {
      xr = await enterXR({ renderer, life, onReset: (F) => keeper && keeper.reset(F), onEnd: ended, onVisibility: (v) => { if (v === 'hidden') away(); } });
    } catch (e) { $('xrNote').textContent = `Could not start mixed reality: ${e && e.message ? e.message : e}`; return; }
    scene.background = null; grid.visible = false; mouseDot.visible = false;
    lineup.restart();
    keeper = new M.anchor.Keeper(xr.anchorIO(o.anchorKey || 'mumr.anchor'));
    lineup.setKeeper(keeper);
    follower.pose = null;
    if (QS.get('shared') === '1') say('Shared space asked for: see the server log');
  };
  function ended() { xr = null; keeper = null; lineup.setKeeper(null); lineup.restart(); scene.background = DESK_BG; grid.visible = true; resize(); }

  // ---- the desktop rehearsal: the mouse as a fingertip on the floor (Shift: a pinch), a click on any menu presses it
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  let mouse = null;
  const panelsAll = new Map();   // key -> { panel, owner, id, lay, pose }
  const pointer = (ev) => { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || xr) return;
    pointer(ev);
    const hit = ray.intersectObjects([...panelsAll.values()].map((q) => q.panel.plane), false)[0];
    if (hit) {
      const q = [...panelsAll.values()].find((v) => v.panel.plane === hit.object), n = M.menus.axes(q.pose).normal;
      if (ray.ray.direction.x * n[0] + ray.ray.direction.y * n[1] + ray.ray.direction.z * n[2] > 0) return;      // (from behind: a blank wall)
      const id = M.menus.hit(q.lay, hit.uv.x, 1 - hit.uv.y);
      if (id) pressed(q.owner, id, [...panelsAll].find(([, v]) => v === q)[0]);
      return;
    }
    if (ray.ray.intersectPlane(floorPlane, hitP)) { mouse = { x: hitP.x, y: -hitP.z, pinch: ev.shiftKey, fist: ev.ctrlKey }; canvas.setPointerCapture(ev.pointerId); }
  });
  canvas.addEventListener('pointermove', (ev) => { if (!mouse) return; pointer(ev); if (ray.ray.intersectPlane(floorPlane, hitP)) mouse = { x: hitP.x, y: -hitP.z, pinch: ev.shiftKey, fist: ev.ctrlKey }; });
  canvas.addEventListener('pointerup', () => { mouse = null; });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  // a click of the mouse (no depth to it): the button shows pressed for a quarter of a second, with both clicks
  const flash = { key: null, id: null, t: -1e9, up: false };
  function pressed(owner, id, key) {
    flash.key = key || (owner === null || owner === S.me ? 'own:main' : `${owner}:main`); flash.id = id; flash.t = performance.now(); flash.up = false;
    click('press', flash.key, id);
    act(owner, id);
  }
  // (a board's owner is its key, a string: its button is handled by the page whose player pressed it; a menu's owner is a slot or null)
  const act = (owner, id) => {
    if (typeof owner === 'string') { const b = boards.find((q) => q.key === owner); if (b && b.d.press) b.d.press(id, app); return; }
    S.press(owner === S.me ? null : owner, id);
  };
  let remoteHeld = new Set(), panelList = [];                                           // this frame's panels (menus.js Poke's), for where a click comes from
  function click(kind, key, id) {
    const pn = panelList.find((q) => q.key === key), at = pn && M.menus.buttonAt(pn, id);
    if (at) clicks.play(kind, at.cm2, at.pos);
  }

  // ---- every frame
  let head = [0, 0, 0, 1.6, 0], redrawAt = 0, drag = null, statusAt = 0, headLogAt = 0, netAt = 0;
  const handPinch = new Map(), v3 = new THREE.Vector3(), planeState = {};
  function readHead(frame) {
    if (frame && xr) {
      const vp = frame.getViewerPose(xr.refSpace);
      if (vp) { const p = vp.transform.position, q = vp.transform.orientation; const fx = -2 * (q.x * q.z + q.w * q.y), fy = -2 * (q.y * q.z - q.w * q.x), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)); return [p.x, -p.z, Math.atan2(-fz, fx), p.y - space.floorY, Math.asin(Math.max(-1, Math.min(1, fy)))]; }
      return head;
    }
    camera.getWorldDirection(v3);
    return [camera.position.x, -camera.position.z, Math.atan2(-v3.z, v3.x), camera.position.y, Math.asin(v3.y)];
  }
  const app = { THREE, scene, world, camera, renderer, S, space, presence, menus, lineup, sys, room, grips, handMask, feet: FEET, life, say, bodies, ownerText,
    head: () => head, xr: () => xr, gestures: [], everyone: [] };
  // the hands on the hand wall: everybody's, with their gestures (this page's first, then the others by slot)
  const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;
  function wallHands() {
    return app.gestures.map((g) => {
      const src = app.everyone.find((s) => s.id === g.id), mine = !src || src.slot === undefined, slot = mine ? S.me : src.slot, side = /left/.test(g.id) ? 'left' : /right/.test(g.id) ? 'right' : g.id;
      return { name: `${mine ? 'you' : `player ${slot + 1}`}, ${side}`, colour: slot === null ? '#ece9e2' : hex(PLAYER_COLOURS[slot % PLAYER_COLOURS.length]), source: src, g, order: mine ? -1 : slot };
    }).sort((a, b) => a.order - b.order);
  }
  function onFrame(time, frame) {
    const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (xr) xr.frame = frame || null;
    if (keeper && frame) keeper.update();
    head = readHead(frame);
    if (xr && frame && now - headLogAt > 4000) { headLogAt = now; life(`xr: head ${Math.round(head[3] * 100)} cm above the floor, world raised ${Math.round(space.floorY * 100)} cm`); }
    // this page's hands: in mixed reality the tracked hands; on the desktop the mouse while its button is down
    let own = [], tips = [], feet = [], handsXR = [];
    if (xr && frame) {
      const r = readInput(xr, frame, space, pinch);
      own = r.sources; handsXR = r.hands; tips = r.hands.map((h) => ({ id: h.id, p: h.tip }));
      if (FEET !== 'off') feet = readFeet(xr, frame, space);
      const scan = readPlanes(xr, frame, space, planeState);
      if (scan !== undefined) room.setScan(scan);
    } else if (mouse) {
      const mz = Number.isFinite(mouse.z) ? mouse.z : 0.05;           // (the pretend fingertip is 5 cm up unless a rehearsal script says otherwise: __mumr.poke)
      own = [{ id: 'mouse', pinch: !!mouse.pinch, fist: !!mouse.fist, points: [{ name: 'index', x: mouse.x, y: mouse.y, z: mz }, { name: 'thumb', x: mouse.x, y: mouse.y, z: mz }] }];
    }
    // everybody's hands and what they are doing (grab.js): for the ghost fingers' colours, the hand wall and the app
    app.everyone = presence.hands(own, now);
    app.gestures = grips.update(app.everyone);
    fistMoves(own);
    const ghost = S.stateOf(null).ghost !== false;
    for (const id of ['left', 'right']) {
      const h = handsXR.find((q) => q.id === id && q.jp), g = ghosts[id];
      if (!h || !ghost) { g.mesh.visible = false; continue; }
      const gr = grips.of(id);
      g.update(h.jp, h.jr, o.ghostColour === 'grips' ? GHOST_COLOURS[gr.kind] || GHOST_COLOURS.idle : typeof o.ghostColour === 'function' ? o.ghostColour(id, own, gr) : GHOST_COLOURS.idle);
    }
    ownShoes.update(feet);
    mouseDot.visible = !xr && !!mouse;
    if (mouse) mouseDot.position.set(mouse.x, Number.isFinite(mouse.z) ? mouse.z : 0.05, -mouse.y);
    // lining up, then everything that is shared
    const tipList = M.hands.tips(own, Object.fromEntries(own.map((s) => [s.id, !!s.pinch])));
    lineup.update(now, dt, tipList);
    const camsOwn = space.ok ? Object.values(S.doc.cameras).map((c) => M.cams.toOwn(space.frame, c)) : [];       // (a camera needs a frame to be placed in: none until lined up)
    camFrame(now, tipList, camsOwn);
    S.tick(now);
    room.update(now, [head[0], head[1]]);
    presence.send(now, head, own.concat(feet));
    const all = presence.hands(lineup.active ? [] : own.concat(FEET === 'kick' ? feet : []), now);         // (a hand that lines up does not touch anything)
    if (!lineup.active) for (const b of bodies) b.frame(now, own);
    if (o.step) o.step(dt, now / 1000, all, own);
    for (const b of bodies) b.send(now);
    menusFrame(now, dt, head, handsXR, tips);
    windowsFrame(now, dt, head, handsXR);
    modelFrame(now, own);
    players.update(presence.others(now).map((q) => ({ slot: q.slot, head: q.head, sources: q.sources })), dt);
    players.marks(Object.assign(lineup.marks(), { camKnobs: lineup.active ? camKnobs.knobs(camsOwn).slice(0, 6) : [] }));
    world.position.y = space.floorY;
    room3d.set(room.local()); room3d.group.visible = !xr || lineup.active;
    if (handWall) handWall.update(room.local(), wallHands(), now, viewerPreview || viewerSpot());
    if (xr) handMask.update();
    if (o.draw) o.draw(app, now);
    if (!xr) controls.update();
    renderer.render(scene, camera);
    if (now - statusAt > 300) status(now);
    // every 5 s the network in the log: round trip, the other players' hand packets and the bodies' (rate, gaps, age)
    if (S.connected && now - netAt > 5000) { netAt = now; life(M.presence.netLine(link.rtt, presence.report(now), bodies.filter((b) => !S.holds(b.token)).map((b) => ({ token: b.token, from: ownerText(S.holder(b.token)), r: b.report(now) })), (s) => ownerText(s))); }
  }
  // ---- the fist moves things (Marek, 2026-10-23: by default a full fist anywhere on something that can be moved moves the whole of
  // it): this player's room model, its menu, the viewer (along the walls). A hand whose fist took one of them holds nothing else: its
  // source is marked noHold (which the other players get too), so the app's bodies do not take it as well. (The app's own bodies take a
  // fist by their own rules: the cube does.)
  const fists = new Map();       // hand id -> { what: 'model' | 'menu' | 'viewer', off }
  let lastMenuH = 0.3, lastHandsXR = [];
  // whether p (floor plan) is on a panel of w x h metres at pose (menus.axes), or a little in front of or behind it
  function onPanel(pose, w, h, p) {
    const A = M.menus.axes(pose), q = [p[0] - A.pos[0], p[2] + space.floorY - A.pos[1], -p[1] - A.pos[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.abs(dot(q, A.right)) <= w / 2 + 0.04 && Math.abs(dot(q, A.up)) <= h / 2 + 0.04 && Math.abs(dot(q, A.normal)) <= 0.12;
  }
  function putViewer(s) {
    const c = space.ok ? space.toCommon([s.x, s.y, s.h]) : [s.x, s.y, s.h], yaw = space.ok ? space.yawToCommon(s.yaw) : s.yaw;
    S.emit({ k: 'wallspot', x: +c[0].toFixed(3), y: +c[1].toFixed(3), h: +c[2].toFixed(3), yaw: +yaw.toFixed(4) });
    life(`viewer moved to (${s.x.toFixed(2)}, ${s.y.toFixed(2)}), ${s.h.toFixed(2)} m up`);
  }
  function fistMoves(own) {
    for (const g of app.gestures) {
      if (!own.some((s) => s.id === g.id)) continue;                    // (this page's own hands)
      const f = fists.get(g.id);
      if (f && g.kind !== 'fist') {                                     // let go: it stays where it is
        if (f.what === 'viewer' && viewerPreview) { putViewer(viewerPreview); viewerPreview = null; }
        if (f.what.startsWith('win:')) { const w = wins.find((q) => `win:${q.id}` === f.what); if (w) putWin(w); }
        fists.delete(g.id); life(`fist: let go of the ${f.what}`);
        continue;
      }
      const p = g.at;
      if (f && p) {
        const x = p[0] + f.off[0], y = p[1] + f.off[1], z = p[2] + f.off[2];
        if (f.what === 'model' && modelPose) { modelPose = Object.assign({}, modelPose, { x, y, z }); modelHot = 'move'; }
        else if (f.what === 'menu') follower.place(x, y, z + space.floorY, { x: head[0], y: head[1], th: head[2], py: head[3] + space.floorY });
        else if (f.what.startsWith('win:')) { const w = wins.find((q) => `win:${q.id}` === f.what); if (w) moveWin(w, x, y, z); }
        else if (f.what === 'viewer') { const s = wallSpot(room.local(), [x, y, z]); if (s) viewerPreview = s; }
        continue;
      }
      if (g.kind !== 'fist' || !g.start || !p) continue;
      const ms = modelSpace(), F = RM && ms.room && modelPose ? M.model.frameOf(ms.room) : null, vs = handWall && handWall.spot;
      let took = null;
      if (F && M.model.inside(ms.poseTo(modelPose), F, ms.to(p), 0.03)) took = { what: 'model', off: [modelPose.x - p[0], modelPose.y - p[1], modelPose.z - p[2]] };
      else if (HAS_MENU && follower.pose && onPanel(follower.pose, MENU_W, lastMenuH, p)) { const P = follower.pose; took = { what: 'menu', off: [P.x - p[0], P.y - p[1], P.h - space.floorY - p[2]] }; }
      else if (wins.some((w) => winPose(w) && onPanel(winPose(w), w.w, w.h, p))) { const w = wins.find((q) => winPose(q) && onPanel(winPose(q), q.w, q.h, p)), P = winPose(w); took = { what: `win:${w.id}`, off: [P.x - p[0], P.y - p[1], P.h - space.floorY - p[2]] }; }
      else if (vs && onPanel({ x: vs.x, y: vs.y, h: vs.h + space.floorY, yaw: vs.yaw, pitch: 0 }, WALL_SIZE.w, WALL_SIZE.h, p)) took = { what: 'viewer', off: [vs.x - p[0], vs.y - p[1], vs.h - p[2]] };
      if (took) { fists.set(g.id, took); life(`fist: took the ${took.what}`); }
    }
    for (const id of [...fists.keys()]) if (!own.some((s) => s.id === id)) { const f = fists.get(id); if (f.what === 'viewer' && viewerPreview) { putViewer(viewerPreview); viewerPreview = null; } if (f.what.startsWith('win:')) { const w = wins.find((q) => `win:${q.id}` === f.what); if (w) putWin(w); } fists.delete(id); }
    for (const s of own) if (fists.has(s.id)) s.noHold = true;
  }
  // ---- the viewer's place: the document's wallspot (common frame) in this page's floor plan, or null (the default: the longest wall)
  let viewerPreview = null;
  function viewerSpot() {
    const w = S.doc.wallspot;
    if (!w) return null;
    if (!space.ok) return w;
    const p = space.fromCommon([w.x, w.y, w.h]);
    return { x: p[0], y: p[1], h: p[2], yaw: space.yawFromCommon(w.yaw) };
  }
  // ---- the room models (model.js): this player's (opened from the app's menu), and every other player's where they have it. Everybody
  // can move the things in any of them; only the owner carries and turns a model. A hand that reaches into a model whose owner has
  // "hand IRL" on is also drawn full size in the room, where it would be, whoever's hand it is.
  // Rule 1 (docs/ARCHITECTURE.md): a model is the same thing for everybody, so all its numbers are in the COMMON frame: its room is the
  // server's room, its pose and the hands and things in it are taken into the common frame, and it is drawn in a group that holds this
  // page's line-up. (Each page's own floor plan gave each page a different model frame, and a turn counted twice on the others' pages.)
  // Alone, or with no shared room yet, the common frame is the page's own.
  const RM = o.roomModel || null, modelHands = new M.model.Hands(), model3d = new Map(), bigHands = [];
  const modelGroup = new THREE.Group();
  world.add(modelGroup);
  let modelPose = null, modelHot = null;          // (this page's own model, in its floor plan)
  app.modelPose = () => modelPose;
  function modelSpace() {
    const same = (p) => p;
    if (!(S.connected && space.ok && S.doc.room)) return { room: room.local(), to: same, from: same, yawTo: same, poseTo: same, poseFrom: same, src: same, frame: null };
    const to = (p) => space.toCommon(p), from = (c) => space.fromCommon(c);
    const pose = (f, yaw) => (p) => { const c = f([p.x, p.y, p.z]); return Object.assign({}, p, { x: c[0], y: c[1], z: c[2], yaw: yaw(p.yaw || 0) }); };
    const src = (s) => Object.assign({}, s, s.points ? { points: s.points.map((q) => { const c = to([q.x, q.y, q.z]); return Object.assign({}, q, { x: c[0], y: c[1], z: c[2] }); }) } : {}, s.joints ? { joints: s.joints.map(to) } : {});
    return { room: S.doc.room.data, to, from, yawTo: (y) => space.yawToCommon(y), poseTo: pose(to, (y) => space.yawToCommon(y)), poseFrom: pose(from, (y) => space.yawFromCommon(y)), src, frame: space.frame, fz: space.fz };
  }
  function viewerThing() {
    const r = room.local(), sp = viewerPreview || viewerSpot() || (r ? wallSpot(r) : null);
    if (!handWall || !sp) return null;
    return { id: 'viewer', label: 'viewer', kind: 'panel', at: [sp.x, sp.y, sp.h], yaw: sp.yaw, size: [WALL_SIZE.w, WALL_SIZE.h], colour: 0x4ea1ff,
      drag(phase, at) {
        const s = wallSpot(room.local(), at);                           // (the viewer only goes onto a wall: the nearest one to the hand)
        if (!s) return;
        viewerPreview = phase === 'drop' ? null : s;
        if (phase === 'drop') putViewer(s);
      } };
  }
  // the text windows (o.windows) are things in the room model too, moved like the viewer: only along the walls, the ghost shows where
  // one will go, and the place is taken when it is let go
  function winThings() {
    return wins.filter((w) => w.spot && hasWall()).map((w) => ({ id: `win:${w.id}`, label: w.d.title || w.id, kind: 'panel', at: [w.spot.x, w.spot.y, w.spot.h], yaw: w.spot.yaw, size: [w.w, w.h], colour: 0xf2c14e,
      preview: w.preview ? [w.preview.x, w.preview.y, w.preview.h] : undefined,
      drag(phase, at) {
        const s = M.room.wallSpot(room.local(), { w: w.w, h: w.h }, at);
        if (!s) return;
        if (phase === 'drop') { w.spot = s; w.preview = null; putWin(w); } else w.preview = s;
      } }));
  }
  function modelFrame(now, own) {
    const ms = modelSpace(), r = ms.room, F = RM && r ? M.model.frameOf(r) : null, models = [];
    if (F && RM.open(S.stateOf(null))) {
      if (!modelPose) {
        const h = head;
        modelPose = xr ? { x: h[0] + Math.cos(h[2]) * 0.5, y: h[1] + Math.sin(h[2]) * 0.5, z: Math.max(0.6, h[3] - 0.5), yaw: h[2] - Math.PI / 2, k: 1 } : { x: 0.35, y: 0.1, z: 0.04, yaw: 0, k: 1 };
      }
      models.push({ key: 'own', slot: S.me, mine: true, pose: ms.poseTo(modelPose) });
    } else modelPose = null;
    const others = presence.others(now);
    if (F) for (const q of menus.others(now)) {
      const p = q.panels.find((x) => x.id === 'model');
      if (p) models.push({ key: `p${q.slot}`, slot: q.slot, mine: false, pose: ms.poseTo({ x: p.pose.x, y: p.pose.y, z: p.pose.h - space.floorY, yaw: p.pose.yaw, k: q.info && q.info.model ? +q.info.model.k || 1 : 1 }) });
    }
    // the things, taken into the common frame (a drag hands the app its place back in this page's floor plan)
    const local = F ? (RM.things ? RM.things(app) : []).concat([viewerThing()].filter(Boolean), winThings()) : [];
    const things = local.map((t) => ({ id: t.id, kind: t.kind, at: ms.to(t.at), yaw: ms.yawTo(t.yaw || 0), size: t.size, colour: t.colour, preview: t.preview ? ms.to(t.preview) : undefined, src: t }));
    for (const m of models) { m.F = F; m.things = things; }
    // the hands: this page's own reach into any model
    for (const ev of modelHands.update(lineup.active ? [] : own.map(ms.src), models)) {
      if (ev.what === 'move' || ev.what === 'turn' || ev.what === 'scale') { modelPose = ms.poseFrom(ev.pose); modelHot = ev.what; continue; }
      const th = things.find((t) => t.id === ev.id);
      if (th && th.src.drag) th.src.drag(ev.phase, ms.from(ev.at));
      if (ev.phase === 'start') life(`room model: took the ${ev.id}`);
    }
    if (!modelHands.busy('own')) modelHot = null;
    // drawing: every open model, with the things where they are (and where a thing being moved here will go), in the common frame
    if (ms.frame) { modelGroup.position.set(ms.frame.x, ms.fz, -ms.frame.y); modelGroup.rotation.set(0, ms.frame.yaw, 0); }
    else { modelGroup.position.set(0, 0, 0); modelGroup.rotation.set(0, 0, 0); }
    const keys = new Set(models.map((m) => m.key));
    for (const [k, d] of [...model3d]) if (!keys.has(k)) { d.dispose(); model3d.delete(k); }
    for (const m of models) {
      let d = model3d.get(m.key);
      if (!d) { d = createModel3d({ THREE, parent: modelGroup }); model3d.set(m.key, d); }
      const shown = things.map((t) => ({ id: t.id, kind: t.kind, at: t.at, yaw: t.yaw, size: t.size, colour: t.colour }));
      for (const t of things) if (t.preview) shown.push({ id: t.id, kind: t.kind, at: t.preview, yaw: t.yaw, size: t.size, colour: t.colour, ghost: true });
      if (viewerPreview) { const v = things.find((t) => t.id === 'viewer'); if (v) shown.push({ id: v.id, kind: v.kind, size: v.size, colour: v.colour, at: ms.to([viewerPreview.x, viewerPreview.y, viewerPreview.h]), yaw: ms.yawTo(viewerPreview.yaw), ghost: true }); }
      d.update(m.pose, F, r, shown, { handles: m.mine, hot: m.mine ? modelHot : null, edge: m.mine ? undefined : PLAYER_COLOURS[m.slot % PLAYER_COLOURS.length] });
    }
    // hand IRL: any hand in a model (this page's or another player's), full size where it would be in the room (the model owner's
    // choice, seen by everybody)
    const hands = own.map((s) => ({ s, slot: null })).concat(...others.map((q) => (q.sources || []).map((s) => ({ s, slot: q.slot }))));
    let n = 0;
    for (const m of models) {
      if (!RM.handIrl || !RM.handIrl(S.stateOf(m.mine ? null : m.slot))) continue;
      for (const { s: s0, slot } of hands) {
        if (!s0.joints || s0.foot) continue;
        const s = ms.src(s0), tip = s.joints[9], palm = s.joints[10];
        if (!M.model.inside(m.pose, F, tip, 0.03) && !M.model.inside(m.pose, F, palm, 0.03)) continue;
        if (!bigHands[n]) { bigHands[n] = new GhostHand(0.35, { full: true }); scene.add(bigHands[n].mesh); }
        // (the whole hand, as thick as it is long: its own joints' radii if this page tracks it, typical ones if not, all grown as much)
        const S2 = M.model.scaleOf(m.pose, F), hx = slot === null ? (lastHandsXR.find((q) => q.id === s.id && q.jr) || null) : null;
        const jp = new Float32Array(75), jr = new Float32Array(25).map((_, i) => (hx ? hx.jr[i] : RADII[i]) / S2);
        s.joints.forEach((q, i) => { const p = ms.from(M.model.fromModel(m.pose, F, q)); jp[i * 3] = p[0]; jp[i * 3 + 1] = p[2] + space.floorY; jp[i * 3 + 2] = -p[1]; });
        bigHands[n].update(jp, jr, slot === null ? 0xf2c14e : PLAYER_COLOURS[slot % PLAYER_COLOURS.length]);
        n++;
      }
    }
    for (let i = n; i < bigHands.length; i++) bigHands[i].mesh.visible = false;
  }
  // the menus: the app's floats (it follows us in mixed reality and has a handle; it stands still on the desktop), the engine's is on the
  // wrist; everybody's are drawn from their owner's state and can be pressed
  const otherNote = (slot) => { const q = menus.others(performance.now()).find((m) => m.slot === slot); return q && q.info && q.info.sys ? q.info.sys.note : ''; };
  function menusFrame(now, dt, hd, handsXR, tips) {
    const at = { x: hd[0], y: hd[1], th: hd[2], py: hd[3] + space.floorY };
    if (!follower.pose) { if (xr) follower.snap(at); else follower.set({ x: 0.9, y: 0.55, h: 0.95, yaw: -2.4, pitch: 0.15 }); }
    const sysInfo = sys.info(), ownInfo = { players: S.others + 1, sys: sysInfo, model: modelPose ? { k: +(modelPose.k || 1).toFixed(3) } : undefined };
    const want = new Set(HAS_MENU ? ['own:main'] : []), busyKeys = new Set();
    const list = HAS_MENU ? [{ key: 'own:main', owner: null, id: 'main', pose: follower.pose, w: MENU_W, lay: o.menu(S.stateOf(null), ownInfo) }] : [];
    const leftHand = handsXR.find((h) => h.id === M.sysmenu.WRIST_SIDE && h.jp);
    const wristPose = xr ? sys.place(hd, leftHand ? leftHand.jp : null, space.floorY) : { x: 0.55, y: 0.85, h: 0.95, yaw: -2.0, pitch: 0.15 };
    if (wristPose) { want.add('own:wrist'); list.push({ key: 'own:wrist', owner: null, id: 'wrist', pose: wristPose, w: SysMenu.width(sysInfo), lay: SysMenu.layout(sysInfo), ignore: M.sysmenu.WRIST_SIDE }); }
    // the boards: where the app's shared data puts them (the common frame), the same for everybody; their layouts are worked out four times a second
    for (const b of boards) {
      const cp = b.d.pose(app, now);
      if (!cp) continue;
      if (!b.lay || now - b.layAt > 100) { b.lay = b.d.lay(app, now); b.layAt = now; }
      const lp = space.ok ? space.poseFromCommon({ x: cp.x, y: cp.y, yaw: cp.yaw || 0, h: cp.h }) : { x: cp.x, y: cp.y, yaw: cp.yaw || 0, h: cp.h };
      list.push({ key: b.key, owner: b.key, id: b.id, pose: { x: lp.x, y: lp.y, h: lp.h + space.floorY, yaw: lp.yaw, pitch: cp.pitch || 0 }, w: b.w, lay: b.lay });
      want.add(b.key);
    }
    for (const q of menus.others(now)) for (const p of q.panels) {
      if (p.id === 'model') continue;                                    // (a room model is not a menu: modelFrame)
      const key = `${q.slot}:${p.id}`, oi = q.info || {}, wrist = p.id === 'wrist';
      if (!wrist && !HAS_MENU) continue;
      const prev = panelsAll.get(key), cur = prev && prev.pose ? prev.pose : p.pose, k = 1 - Math.exp(-dt * 18);
      const eased = { x: cur.x + (p.pose.x - cur.x) * k, y: cur.y + (p.pose.y - cur.y) * k, h: cur.h + (p.pose.h - cur.h) * k, yaw: cur.yaw + M.util.wrap(p.pose.yaw - cur.yaw) * k, pitch: p.pose.pitch };
      if (p.pose.q) { const a = cur.q || p.pose.q, b = p.pose.q, d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1, m = a.map((v, i) => v + (b[i] * d - v) * k), l = Math.hypot(...m) || 1; eased.q = m.map((v) => v / l); }
      list.push({ key, owner: q.slot, id: p.id, pose: eased, w: wrist ? SysMenu.width(oi.sys) : MENU_W, lay: wrist ? SysMenu.layout(oi.sys) : o.menu(S.stateOf(q.slot), oi) });
      want.add(key);
    }
    for (const pn of list) pn.h = pn.w * pn.lay.h / pn.lay.w;
    if (HAS_MENU) lastMenuH = list[0].h;
    lastHandsXR = handsXR;
    panelList = list;
    // what fingertips touch (docs/WRIST-MENU-SPEC.md, "A press"): ours, the mouse's click, and the other players' (they come in the `M` packet's
    // info.touch, so that a button pressed by someone else goes down on every page)
    const touching = new Map(), mine = [], camPos = [hd[0], hd[3] + space.floorY, -hd[1]];
    const addTouch = (key, button, held, d) => { const s = M.menus.shape(held, d); if (!touching.has(key)) touching.set(key, []); touching.get(key).push({ button, top: s.top, push: s.push, held }); };
    const r = poke.update(list, tips, now);
    for (const key of r.busy) busyKeys.add(key);
    for (const t of r.touches) { addTouch(t.key, t.button, t.held, t.d); if (mine.length < 4) mine.push({ o: typeof t.owner === 'string' ? -2 : t.owner === null ? -1 : t.owner, p: t.panel, b: t.button, h: t.held ? 1 : 0, d: Math.round(t.d * 1000) }); }
    for (const pr of r.presses) { click('press', pr.key, pr.button); act(pr.owner, pr.button); }
    for (const rl of r.releases) click('release', rl.key, rl.button);
    if (flash.id) { if (now - flash.t < 250) addTouch(flash.key, flash.id, true, 0.012); else { click('release', flash.key, flash.id); flash.id = null; } }
    if (mine.length) ownInfo.touch = mine;
    const heldNow = new Set();
    for (const q of menus.others(now)) for (const t of (q.info && Array.isArray(q.info.touch) ? q.info.touch.slice(0, 4) : [])) {
      if (!t || typeof t.p !== 'string' || typeof t.b !== 'string' || !Number.isFinite(t.d) || !Number.isFinite(t.o)) continue;
      const key = t.o === -2 ? `board:${t.p}` : t.o === -1 ? `${q.slot}:${t.p}` : t.o === S.me ? `own:${t.p}` : `${t.o}:${t.p}`;
      addTouch(key, t.b, !!t.h, t.d / 1000);
      if (t.h) { const id = `${q.slot}|${key}|${t.b}`; heldNow.add(id); if (!remoteHeld.has(id)) click('press', key, t.b); }
    }
    for (const id of remoteHeld) if (!heldNow.has(id)) { const [, key, b] = id.split('|'); click('release', key, b); }
    remoteHeld = heldNow;
    const cp = Math.cos(hd[4] || 0);
    clicks.listen(camPos, [cp * Math.cos(hd[2]), Math.sin(hd[4] || 0), -cp * Math.sin(hd[2])], [0, 1, 0]);
    // the handle under our menu: a pinch that starts at it carries the menu; where it is let go is where it stays
    let handle = 'idle';
    if (HAS_MENU) for (const h of handsXR) {
      const d = M.menus.handleDist(follower.pose, list[0].h, h.at), was = handPinch.get(h.id) || false;
      handPinch.set(h.id, h.pinch);
      if (d < 0.06) { handle = 'near'; busyKeys.add('own:main'); }
      if (!drag && h.pinch && !was && d < 0.05) { const P = follower.pose; drag = { id: h.id, off: [P.x - h.at[0], P.h - h.at[1], P.y + h.at[2]] }; }
    }
    if (HAS_MENU && drag) {
      const h = handsXR.find((q) => q.id === drag.id);
      if (!h || !h.pinch) drag = null;
      else { follower.place(h.at[0] + drag.off[0], -h.at[2] + drag.off[2], h.at[1] + drag.off[1], at); handle = 'held'; busyKeys.add('own:main'); }
    }
    if ([...fists.values()].some((f) => f.what === 'menu')) { handle = 'held'; busyKeys.add('own:main'); }      // (carried by a fist)
    if (HAS_MENU && xr) follower.update(at, dt, busyKeys.has('own:main'));
    if (HAS_MENU) list[0].pose = follower.pose;
    menus.send(now, (HAS_MENU ? [{ id: 'main', pose: follower.pose }] : []).concat(wristPose ? [{ id: 'wrist', pose: wristPose }] : [],
      modelPose ? [{ id: 'model', pose: { x: modelPose.x, y: modelPose.y, h: modelPose.z + space.floorY, yaw: modelPose.yaw, pitch: 0 } }] : []), ownInfo);
    const redraw = now - redrawAt > 100;
    if (redraw) redrawAt = now;
    for (const pn of list) {
      let q = panelsAll.get(pn.key);
      if (!q) { q = { panel: new Panel(pn.w, pn.lay, { handle: pn.key === 'own:main' }) }; panelsAll.set(pn.key, q); scene.add(q.panel.mesh); }
      q.panel.setWidth(pn.w);
      if (pn.key === 'own:main') q.panel.handleLook(handle);
      Object.assign(q, { owner: pn.owner, id: pn.id, lay: pn.lay, pose: pn.pose });
      q.panel.pose(pn.pose);
      const l0 = q.panel.lay, force = !l0 || l0.folded !== pn.lay.folded || l0.w !== pn.lay.w || l0.h !== pn.lay.h;       // (a menu that unfolds changes its layout at once)
      q.panel.touch(touching.get(pn.key) || []);
      q.panel.tick(dt, camPos);
      if (redraw || force) {
        const sayNote = pn.owner === null && now - sayT < 3000 ? $('say').textContent : undefined;
        q.panel.draw(pn.lay, {
          edge: pn.owner === null || typeof pn.owner === 'string' ? null : PLAYER_COLOURS[pn.owner % PLAYER_COLOURS.length],
          note: sayNote || (typeof pn.owner === 'string' ? undefined : pn.id === 'wrist' ? (pn.owner === null ? lineup.note() : (otherNote(pn.owner) || `player ${pn.owner + 1}`)) : (pn.owner === null ? '' : `player ${pn.owner + 1}`)) });
      }
    }
    for (const [key, q] of [...panelsAll]) if (!want.has(key)) { q.panel.dispose(); panelsAll.delete(key); }
  }
  // the text windows (o.windows). They hang on a wall like the viewer, and are moved along the walls by the bar under them (pinch) or a
  // fist, by anybody: where each hangs is the document's (winspot, common frame), the same for everybody (rule 1). With no wall to hang
  // on (no room scan) they float and follow like the menu.
  function putWin(w) {
    const s = w.spot;
    if (!s) return;
    const c = space.ok ? space.toCommon([s.x, s.y, s.h]) : [s.x, s.y, s.h], yaw = space.ok ? space.yawToCommon(s.yaw) : s.yaw;
    S.emit({ k: 'winspot', id: w.id, x: +c[0].toFixed(3), y: +c[1].toFixed(3), h: +c[2].toFixed(3), yaw: +yaw.toFixed(4) });
    life(`window ${w.id} moved to (${s.x.toFixed(2)}, ${s.y.toFixed(2)}), ${s.h.toFixed(2)} m up`);
  }
  // the document's place of a window in this page's floor plan, taken when it (or this page's line-up) changes and no hand here moves it
  function docWin(w) {
    const d = S.doc.winspots && S.doc.winspots[w.id], sig = space.ok ? `${space.frame.x},${space.frame.y},${space.frame.yaw},${space.fz}` : '';
    if (!d || (d === w.docAt && sig === w.docSig) || w.drag || [...fists.values()].some((f) => f.what === `win:${w.id}`)) return;
    w.docAt = d; w.docSig = sig;
    const p = space.ok ? space.fromCommon([d.x, d.y, d.h]) : [d.x, d.y, d.h];
    w.spot = { x: p[0], y: p[1], h: p[2], yaw: space.ok ? space.yawFromCommon(d.yaw) : d.yaw };
  }
  const hasWall = () => { const r = room.local(); return !!r && M.room.walls(r).length > 0; };
  function winPose(w) {
    if (w.spot && hasWall()) return { x: w.spot.x, y: w.spot.y, h: w.spot.h + space.floorY, yaw: w.spot.yaw, pitch: 0 };
    return w.f.pose;
  }
  // (x, y, z) is where a hand wants the window (floor plan, z above the floor): on a wall, the nearest place on a wall
  function moveWin(w, x, y, z) {
    if (hasWall()) { const s = M.room.wallSpot(room.local(), { w: w.w, h: w.h }, [x, y, z]); if (s) w.spot = s; return; }
    w.f.place(x, y, z + space.floorY, { x: head[0], y: head[1], th: head[2], py: head[3] + space.floorY });
  }
  // the first place on a wall: next to the viewer's default place, the windows one after another to the right and left of it
  function firstSpot(w) {
    const r = room.local(), base = M.room.wallSpot(r, { w: w.w, h: w.h });
    if (!base) return null;
    const side = w.order % 2 === 0 ? 1 : -1, k = Math.floor(w.order / 2) + 1, tx = -Math.sin(base.yaw), ty = Math.cos(base.yaw), d = side * k * (WALL_SIZE.w / 2 + w.w / 2 + 0.1);
    return M.room.wallSpot(r, { w: w.w, h: w.h }, [base.x + tx * d, base.y + ty * d, base.h]);
  }
  function windowsFrame(now, dt, hd, handsXR) {
    const at = { x: hd[0], y: hd[1], th: hd[2], py: hd[3] + space.floorY };
    for (const w of wins) {
      if (!w.f.pose) { if (xr) w.f.snap(at); else w.f.set(w.d.desktop || { x: -0.4 + 0.5 * w.order, y: 0.4, h: 1.15, yaw: -1.3, pitch: 0.15 }); }
      if (!w.lay || now - w.layAt > 250) { w.lay = w.d.lay(app, now); w.layAt = now; w.redraw = true; }
      w.h = w.w * w.lay.h / w.lay.w;
      if (hasWall()) docWin(w);
      if (!w.spot && hasWall()) w.spot = firstSpot(w);
      const pose = winPose(w);
      let handle = 'idle', busy = false;
      for (const h of handsXR) {
        const d = M.menus.handleDist(pose, w.h, h.at), was = w.pinch.get(h.id) || false;
        w.pinch.set(h.id, h.pinch);
        if (d < 0.06) { handle = 'near'; busy = true; }
        if (!w.drag && h.pinch && !was && d < 0.05) w.drag = { id: h.id, off: [pose.x - h.at[0], pose.h - h.at[1], pose.y + h.at[2]] };
      }
      if (w.drag) {
        const h = handsXR.find((q) => q.id === w.drag.id);
        if (!h || !h.pinch) { w.drag = null; if (w.spot && hasWall()) putWin(w); }
        else { moveWin(w, h.at[0] + w.drag.off[0], -h.at[2] + w.drag.off[2], h.at[1] + w.drag.off[1] - space.floorY); handle = 'held'; busy = true; }
      }
      if ([...fists.values()].some((f) => f.what === `win:${w.id}`)) { handle = 'held'; busy = true; }
      if (xr && !(w.spot && hasWall())) w.f.update(at, dt, busy);
      if (!w.panel) { w.panel = new Panel(w.w, w.lay, { handle: true }); scene.add(w.panel.mesh); w.redraw = true; }
      w.panel.setWidth(w.w); w.panel.handleLook(handle);
      if (w.redraw) { w.panel.draw(w.lay, { hover: null, pressed: null }); w.redraw = false; }
      w.panel.pose(winPose(w));
    }
  }
  function roomText() { const r = room.info(); return r.kept ? `the server's, ${r.n} planes${r.by === null ? '' : ` from player ${r.by + 1}`}` : r.own ? `own scan, ${r.own} planes` : 'none'; }
  function status(now) {
    statusAt = now;
    $('status').textContent = [
      `${S.connected ? `player ${S.me + 1} of ${S.others + 1}` : 'alone'}${S.viewers ? `, ${S.viewers} watching` : ''}   ${lineup.note()}   room: ${roomText()}   ${o.status ? o.status() : ''}   round trip ${link.rtt ?? '-'} ms`,
      xr ? `xr: ${xr.features.join(', ')}; shared space: ${xr.shared.state}${xr.shared.uuid ? ` (${xr.shared.uuid})` : ''}; anchor: ${keeper && keeper.anchor ? (keeper.lost ? 'lost' : 'tracked') : 'none'}` : 'desktop: left button = a fingertip on the floor (with Shift: a pinch), right button turns the view, click a menu to press it',
      ...life.lines().slice(-3),
    ].join('\n');
  }
  function resize() {
    if (xr) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();
  if (o.setup) o.setup(app);
  renderer.setAnimationLoop(onFrame);
  // a page of another build reloads itself (outside mixed reality): a headset never runs an old page by accident
  setInterval(async () => { if (xr) return; try { const i = await (await fetch('/info')).json(); if (i.build && info.build && i.build !== info.build) location.reload(); } catch (e) { /* the server is away */ } }, 3000);
  window.__mumr = Object.assign(app, { link, panels: panelsAll, controls, frame: () => onFrame(performance.now(), null), press: pressed, poke: (x, y, pinchOn, fistOn, z) => { mouse = x === undefined ? null : { x, y, pinch: !!pinchOn, fist: !!fistOn, z }; } });
  return app;
}
