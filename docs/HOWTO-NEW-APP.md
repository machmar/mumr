# Making a new MUMR app

**Rule 1 ([ARCHITECTURE.md](ARCHITECTURE.md#rule-1-everything-is-shared-and-physical)): everything is shared and physical.** Whatever one
player sees, every player sees in the same place; whatever one player can touch, every player can. No thing lives on one page only, not
even in a test mode: a moving thing is a Body, a placed thing is in the Document, and geometry is worked out in the common frame.

The quick way:

```bash
node tools/new-app.js MyApp           # makes apps/my-app from apps/_template (--viewer adds a PC view page)
node tools/run.js my-app --http       # then two tabs: /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40
node --test "apps/my-app/*.test.js"
```

You get a working app on `createApp` (section 3b): a shared count, each player's colour, an action button and a menu. Change `logic.js`
(settings, buttons, menu) and `app.js` (what is drawn and simulated); [`apps/_template/README.md`](../apps/_template/README.md) lists the
files. [`apps/cube`](../apps/cube) is the full example. Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The rest of this page is what is
behind it.

## 1. A folder and the server

```
apps/myapp/
  mumr.json        {"title": "My app", "index": "index.html", "bodies": ["ball"], "owned": {"16": "ball"}}
  index.html       loads /mumr/*.js, then the app's scripts
  app.js
```

```bash
node tools/run.js myapp               # or: py -3 engine/server/serve.py apps/myapp
```

It prints the address for the headsets (`https://<PC>:8443/`), writes `mumr-server.log` in the app's folder, and serves the engine at
`/mumr/`. For plain http on the PC only (rehearsals): `... 8766 --http --no-browser`. An app that needs its own routes writes a start
script that calls `serve.run(app, routes={"GET /x.json": fn})`.

## 2. The document: settings, buttons, kinds

```js
const S = new MUMR.session.Session(link, {
  game: { speed: 1 },                    // one set for everyone
  player: { hue: 'red' },                // each player's own (what their menu shows)
  actions: ['exit'],                     // buttons that happen at the menu owner's headset ('action' event)
  press: (id, st) => ...,                // what a settings button does: the state after it
  init: (doc) => { doc.marks = new Map(); },
  kinds: {
    'mark+': { keep: (e) => ({ key: `mark:${e.id}` }), apply: (S, e, from) => { S.doc.marks.set(e.id, e); S.notify('marks'); } },
    'mark-': { keep: (e) => ({ key: `mark:${e.id}`, drop: true }), apply: (S, e) => { S.doc.marks.delete(e.id); S.notify('marks'); } },
  },
});
S.on('first', () => { /* the first one here: publish this page's own world (S.emit(...) for each mark) */ });
S.on('synced', () => { /* the server's world was taken: redraw everything */ });
```

- An event with a key says **all** of the thing. To change a mark, send the whole mark again with the same key.
- A thing that belongs to one page (a camera, a note): `keep: (e) => ({ key, own: true, gone: { k: 'thing-', id } })`; others use
  `S.request(key, m)` and the owner hears `S.on('ask', ...)`.
- A thing that belongs to one player and must go with them: `scope: 'slot'`.
- A button on someone else's menu: `S.press(owner, id)`. It acts for the owner.

## 3. Things that move: register a packet, make a Body

```js
MUMR.wire.register({ type: 16, name: 'ball', token: 'ball', pack: (o) => bytes, unpack: (dataView) => o, blend: (a, b, f) => ... });
const ball = new MUMR.body.Body(S, { token: 'ball', type: 'ball', adapter: {
  reach: (hands) => ..., touching: (hands) => ..., pack: () => stateInCommonFrame, apply: (data, info) => ...,
  settle: (mine) => ..., do: (what, args, from) => ..., moving: () => ... } });
// every frame:
const hands = presence.hands(ownHands, now);   // everybody's hands, in this page's coordinates
ball.frame(now, ownHands); simulate(hands); ball.send(now); presence.send(now, head, ownHands);
link.onBin = (b) => { const p = MUMR.wire.decode(b); if (p.name === 'presence') presence.receive(p, now); else ball.receive(p, now); };
```

- Gestures: `createApp` gives `app.gestures` every frame (or `new MUMR.grab.Grips().update(hands)` yourself): each hand's grip
  (`pinch` or `fist`, `start`, `end`, `at`), `point` (a ray; `MUMR.grab.pointAt(ray, boxes, room)` says what it hits), `palm` (a flat
  hand to put things on, `face` up or down) and `gesture`, from everybody's sources; the app decides what they do. Options of
  `createApp`: `feet` ('off', 'show', 'kick'), `handMask` (the hand cutouts, on), `handWall` (the hand window on a wall, off),
  `ghostColour: 'grips'`, `roomModel` (a small copy of the room in which the app's things and the viewer can be moved: see the
  cube's `app.js`; open and the full-size hand are two player settings the app's menu toggles). The room: `app.room.local()`, and
  `MUMR.room.support / ceiling / pushOut` for physics (move in steps shorter than the thing's radius and pass `from`: nothing goes
  through a wall). `apps/cube/cube.js` uses all of it.
- The room's dim: `app.dim({ dark, mute, over, fade })` (`session.dim` without createApp) darkens (`dark` 0..1) and greys (`mute`
  0..1) the real room, the passthrough on every headset and the picture on every webcam page, at the same moment for everybody; the
  virtual world stays at full strength over it, so a thing the app makes glow stands out. `over` (default true) dims the real hands
  too; false keeps the hand cutouts bright. `fade` ms eases from the look as it is now; a value left out stays as asked before. A
  dip and a slow return is two calls: `app.dim({ dark: 0.8, fade: 150 })`, then `app.dim({ dark: 0, fade: 4000 })`. It is in the
  document (`doc.dim`, `engine/client/dim.js`): let one page ask (the one that sees the piece fall: the host, the holder).
  `app.dimLevel()` says the look now.
- Every page simulates every body with **everybody's** hands, including what is derived from them (Nudgy's palm platform: the other
  player's hand had none, so a loco dropped on it fell through).
- Requests from a page that does not hold the body: `ball.ask('place', { x, y })` in the common frame.
- Packet types 1-255; 2 and 4 are the engine's.

## 3b. Menus, lining up, XR

The short way: `createApp` from `/mumr/xr/app.js` does all of this section (and the desktop rehearsal, the status line, giving
bodies up while nobody looks at the page, reloading on a new build). [`apps/cube/app.js`](../apps/cube/app.js) is the whole
cube page on it:

```js
const app = await createApp({ THREE, OrbitControls, anchorKey: 'myapp.anchor',
  session: { game, player, actions, press },               // the app's own; the engine adds the wrist menu's actions
  menu: (state, info) => layout,                            // the app's floating menu, for every player
  bodies: ({ space }) => [{ token: 'ball', type: 'ball', adapter }],
  setup: ({ world }) => world.add(ballMesh),                // once; `world` is the floor (THREE (x, z, -y))
  step: (dt, t, hands) => simulate(hands), draw: (app) => drawBall(), onAction: (id, from) => ..., status: () => 'ball: ...' });
```

The page needs `#view`, `#enter`, `#xrNote`, `#say` and `#status` (copy the cube's `index.html`). What `createApp` wires, piece by
piece, for an app that needs something else:

- **One menu for everybody** (`boards`, `menu: false`; apps/jenga): a board is a menu panel standing in the room, where the app's shared data puts
  it (`pose(app, now)` in the common frame), drawn from shared data (`lay(app, now)`) and pressed by anybody's fingertip (or the mouse on the
  desktop); `press(id, app)` runs on the page whose player pressed it and asks the shared world (`body.ask`, `session.emit`). Its press, and how
  deep a fingertip is in a button, are shown on every page. `menu: false` leaves out each player's own floating menu (and its handle); the wrist
  menu stays. A board is not a player's thing, so it is not sent in the `M` stream: every page works out the same one from the document.
  A board with `panel: false` is drawn by the app (apps/jenga `stand.js`: a stand with hanging plaques): the engine still presses it (its layout is any
  `{ w, h, buttons: [{ id, x, y, w, h, off }] }` in pixels over the board's width, `menus.hit`), sends everybody's fingertips at it and plays the clicks, and
  `app.boardTouches(id)` gives this frame's fingertips at its buttons (`{ button, top, push, held }`) for the app's own drawing of the press.
- **An app with its own light**: `app.lights` is the engine's two lights (`{ hemi, sun }`); an app that lights its scene itself hides them (`visible = false`:
  a light at intensity 0 still costs every pixel).
- **Lights that light the real room** (`app.relight`; apps/jenga's lantern): give the engine this frame's lights of your world, `app.relight([{ at:
  THREE.Vector3 (world), colour, range (m), power (0..1) }])` (at most 8, the strongest), every frame or when they change. Round each one the room's
  dim lifts off the real walls, floor and table tops of the room scan and they take a little of its colour, so a lantern by a wall seems to throw its
  light on the real wall, the same on every headset (the room is the server's, the lights come from your shared state) and on a webcam page whose
  view hands them over as `window.view.relights()`. With no scan only a floor round the player is lit; with no dim only the warm colour is laid on.
- The engine's menu is on the wrist: `new MUMR.sysmenu.SysMenu(session, lineup, { exit, roomSetup, roomUsed })`; add `SysMenu.ACTIONS`
  to the session's `actions` and call `sys.press(id)` first from the `action` listener; draw it at `sys.place(head, leftHandJoints,
  floorY)` with `SysMenu.layout(sys.info())`, and send it as panel `wrist` with `{ sys: sys.info() }` in the menus' info. The app's own
  menu holds only the app's items.
- `new MUMR.lineup.LineUp(session, space, { store: localStorage, say, life })` (the wrist menu presses it); when mixed reality starts, `lineup.restart()` and
  `lineup.setKeeper(new MUMR.anchor.Keeper(xr.anchorIO('myapp.anchor')))`, and `keeper.update()` every XR frame.
- `enterXR({ renderer, life, onReset: (F) => keeper.reset(F), onEnd })` (`/mumr/xr/session.js`), then every frame
  `xr.frame = frame` and `readInput(xr, frame, space, pinch)` (`/mumr/xr/input.js`) for the sources and the fingertips.
- A menu is a layout function of **its owner's state and info**: `layout(session.stateOf(slot), info)`. This page sends its own panel
  poses and info with `menus.send(now, panels, Object.assign(lineup.info(), ...))`; the others' come from `menus.others(now)`.
  Test the fingertips against all of them with one `Poke`, and press with `session.press(owner, id)`.
- Draw with `makePanels(THREE, renderer)`, `createPlayers({ THREE, world, scene, GhostHand })`, `makeGhost(THREE)`.
- On the desktop, a pretend line-up `lineup.given({ x, y, yaw })` lets two tabs share a world.

## 4. Coordinates

Make one `new MUMR.align.Space(frame, floorY)` per page and update it when the line-up or the floor changes. Use it for everything that is
sent or received. Never write the conversion again by hand (NOTES 2.5 says why).

## 5. The PC can see it

A PC page: `MUMR.worldfeed.WorldFeed.connect(url, { build, session: sameOptionsAsThePlayers })`; `feed.doc` is the document,
`feed.sample('ball', null, feed.serverNow() - delay)` a stream. **The drawing of a shared thing lives in one module that the headset page
and the PC page both use** (Nudgy drew boxes, rugs and balls differently on the PC, and nobody noticed for days).

### 5a. The PC view as a webcam page

Any PC view built on THREE can also be the webcam page (docs/ARCHITECTURE.md section 6c, [`apps/cube/webcam.html`](../apps/cube/webcam.html)). The view sets

```js
window.view = { feed, scene, camera, renderer, orbit: controls, setDelay: (ms) => { DELAY = ms; }, camMarks, parts: { hands, head, floor, grid, marks, cameras, menus } };
```

(`camMarks = createCameraMarks({ THREE, group: world })` from `/mumr/xr/cammark3d.js`, updated every frame with `Object.values(feed.session.doc.cameras)`; `parts`:
what the Show menu may hide, each `() => [objects]`, or `{ objects, static: true }` for things the view never shows or hides itself; `controls.update()` is called once a frame
just before `renderer.render`; size the canvas from `canvas.clientWidth`). The page is the view's page plus `/mumr/webcam/all.js` in the head and
`<script type="module" src="/mumr/webcam/start.js">` after the view's script.

## 6. Logging

```js
const life = MUMR.life.make({ name: 'Quest 3' });
life('entered mixed reality');  // goes to mumr-server.log at once, also while the page is hidden
link.onNote = (n) => life(`link: ${n}`);
```

Write a life line for everything that happens to the page itself (visibility, XR session start and end, tracking resets, anchors, the
link). Check that `mumr-server.log` grows **before** anyone puts a headset on.

## 7. Testing

1. Logic in plain scripts (no THREE, no DOM), tested in Node with two pretend headsets: `engine/test/hubfake.js` (`hub.link('A')`,
   `hub.flush()`). See `engine/test/session.test.js` and `engine/test/body.test.js`.
2. Two browser tabs on the PC (`--http`), each with a pretend line-up.
3. Two headsets, with the server (and its log) started first. Before reporting a two-headset fault, check in the log that both headsets
   fetched the page after the last change.

```bash
node --test
```
