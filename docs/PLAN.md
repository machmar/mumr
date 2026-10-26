# MUMR: extraction plan (refreshed 2026-10-22, status 2026-10-25)

**For the session that continues the extraction.** Read [NOTES.md](NOTES.md) first (what the Nudgy chats decided, what was
streamlined, and items 29-34 for what the headset runs of 10-22/23 found), then [ARCHITECTURE.md](ARCHITECTURE.md). The first plan was
written inside Nudgy on 2026-10-15 (`KTE/Project2/docs/superpowers/plans/2026-10-15-mr-multiplayer-extraction.md`); this file replaces it.

**Why:** Marek wants more multi-user mixed-reality projects without rebuilding Nudgy's each time: "a virtual physical world where it is
easy to make these types of experiences, where all virtual objects behave as if they were physical" (2026-10-16). The realistic scope
named then, and kept here: **2-4 co-located players, tens of rigid objects, authority by touch, a PC on the LAN, a browser and no
install on the headsets.**

## 1. What changed since the 2026-10-15 plan

| 2026-10-15 plan | Now | Why |
|---|---|---|
| Make Nudgy's files generic **in place** (phase 1), then move them | The engine is written **fresh in its own repo** from Nudgy's files; Nudgy is untouched until a migration phase | Nudgy works and was tested on two headsets; Marek could not test then. A fresh copy let the API be cleaned (self-describing events, owned things, one packet header) without breaking it. Migration is one deliberate step (phase 7). |
| Name `mrmp` (to be chosen) | **MUMR** (Marek's name for it), repo `machmar/mumr`, **public under MIT** since 2026-10-22 | |
| Hub keeps Nudgy's kinds; `Hub(build, bodies, owned)` | The hub keeps **any** app's document: events carry `key/drop/clear/scope/own` | NOTES 2.1 |
| Cameras were not in the map (built later, 10-15) | **Owned things** are a general feature (`own`, `gone`, `ask`) | NOTES 2.2 |
| The PC feed (viewer role, compacted document, clocks) was a separate plan | It is part of the engine (`WorldFeed`, viewer role); the unused `feed` role is dropped | Built and proven in Nudgy 10-15 |
| Players sync from the `sim` holder | Players get the document from the hub (like viewers); a body's full state comes from its holder (`keyframe`) | NOTES 2.15; the document outlives everyone leaving |
| `Body` with the touch policy | Policies `touch` and `owner`, and the `host` role | Lumber Tycoon discussion, 10-16 |
| Example: one cube | First example is a **counter** (no XR, two tabs); the cube follows with XR | A page that loads the engine from `/mumr/` had to be proven first |
| Not planned | Always-on server log and page life log are engine features | Debugging lessons of 10-21/22 |
| Interaction "physical and literal, no gesture guessing" | Still the rule for buttons (a fingertip through them). Grabbing and moving use a small set of engine **gestures** (pinch, fist, point, flat hand) that every app gets the same | Marek asked for each of them, 2026-10-22/23 (NOTES 30-34) |

## 2. Status

States: **done** = built, tested in Node, rehearsed on the PC and used on a headset; **built** = built and tested, not yet (fully) on a
headset (section 4 says what is missing); **not started**. Rows are in the order they were done; section 3 says what comes next.

| Phase | What | State |
|---|---|---|
| 0 | Repo, notes, refreshed plan | **done** 2026-10-22 |
| - | App structure: engine under engine/, apps in apps/, apps/_template, tools/new-app.js and tools/run.js, APPS.md (docs/superpowers/plans/2026-10-25-app-structure.md) | **done** 2026-10-25 (checked in browser tabs; the cube after the move is not yet run on headsets) |
| 1 | Core without THREE (now under `engine/`): server (`ws`, `hub`, `serverlog`, `serve`), client (`util`, `link`, `align`, `wire`, `session`, `presence`, `body`, `worldfeed`, `life`), tests, the counter, since folded into `apps/_template` (counter folder removed 2026-10-25) | **done** 2026-10-22 (the counter itself never ran on a headset; everything it proves runs under the cube) |
| 2 | Everyone's menus: panel poses through `Space`, the `M` stream, the other player's menu drawn from that player's state and mode, a press on anyone's menu | **done** 2026-10-22 (two-headset run) |
| 3 | XR glue (`xr/`): session start, hand sources from the 25 joints, pinch rule, line-up on `Aligner`, persistent anchor + reset handling, ghost hands of others, build-stamp self-reload, **hand cutouts** (`xr/handmask.js`, Nudgy's depth-only hand model with its 24 mm tip reach, ported 10-23) | **done** (cutouts: "work good", 10-23) |
| 4 | `apps/cube`: one cube (a Body), a menu, both players' hands; PC rehearsal, then headsets | **done** 2026-10-22; two-headset run worked; faults fixed (NOTES 22-28) |
| 4c | Coming back after a Wi-Fi drop (the hub keeps a dropped player's place for 10 s) | **done**: seen on the headsets ("came back to its place" in the logs of 10-22/23) |
| 6 | Host role: a Node process on the PC holds the bodies nobody touches, the server starts and restarts it | **done**: the headsets saw the cube "simulated by host" and the hand-over both ways |
| 6b | `xr/app.js` `createApp({...})`: the page wiring every app repeated | **done**; the cube page is the cube only |
| 6c | The engine's wrist menu (`sysmenu.js`): Line up, Room setup, Exit; folds after 5 s hidden | **done** 2026-10-22 (Marek's rules, NOTES log) |
| 6d | The wrist menu as designed (`docs/WRIST-MENU-SPEC.md`): six fixed places, blocks that lift / snap into a pit / follow the finger, fold arrow and unfold ripple, two clicks, touches shared in `M` | **built** 2026-10-25, rehearsed on the desktop; **not yet on a headset** (the feel of the depths, the clicks by ear, the release distance) |
| 4b | The line-up menu's other rows, as in Nudgy: **Room** and **Camera** | **Room done**: the server's room (`room.js`, NOTES 29), uploaded once by the first headset or by Upload; a scan with several rooms is split and picked on a map (NOTES 33). **Camera** not started: waits for a webcam page |
| 9 | Cube physics against the room (NOTES 30): springy hold, 1 cm steps (nothing passes a wall), footprint support, tables with space under them, solid objects | **done** (10-22 run; one-finger push broke and was fixed, see section 4) |
| 10 | Engine gestures (`grab.js`, NOTES 31, 34): pinch, fist, point (a ray and `pointAt`: the app's boxes and the room), flat hand as a platform (palm up or down); the fist moves the room model, the menu and the viewer; `noHold` | **built**: pointing works on the headset; the platform, the fist grab of the cube and the fist moves are untested |
| 11 | Hand wall (`xr/handwall.js`): a window on a wall with every hand and its gesture numbers; solid tube hands, every frame (NOTES 34) | **built**: the first version ran on the headset; the tube hands are untested |
| 12 | Room model (`model.js`, `xr/roommodel3d.js`, NOTES 32-33): move the cube and the viewer in a small copy of the room; carry, turn and scale handles; Show hand IRL; shared like a menu | **done** for one and two players ("works pretty good", "that works well", two-player test 10-23); the enlarged hand's fix of 10-23 is untested |
| 13 | Feet as shoes from body tracking (`feet: 'off' \| 'show' \| 'kick'`), legs removed | **built**: off by default and in the cube; the other modes never ran (Marek: "pretty sure those work") |
| 14 | **Physics** (`engine/client/physics.js`, design `docs/superpowers/specs/2026-10-26-physics-design.md`): the cube falls, bounces like hard plastic, tumbles, slides with friction, comes to rest on a face, turns with the hand that holds it and is thrown with the hand's speed; hands are kinematic spheres and a plate; packet 16 carries orientation and spin | **built** 2026-10-26: Node tests against the numbers (bounce height, slide distance, slope angle, no tunnelling) and a browser rehearsal on the PC; **not yet on a headset** (section 4) |
| 5 | **Many bodies**: an entity-list packet with a per-entry token check on the hub; sleeping bodies; contact islands (one token for a touching group); cube-to-cube contact | **not started**: the experiment pages of section 3.1 come first and decide its shape |
| 7 | Nudgy on MUMR (section 5) | **not now** (Marek, 2026-10-22) |
| 8 | Direct lane between headsets (WebRTC behind `link`) | not needed so far (Nudgy probe 10-15: same median, no long silences) |
| - | Automatic line-up from the `shared` reference space | not usable yet: granted on both headsets but never got a UUID (2026-10-22); the touched spots stay |

Open, measured but not fixed: the PC view felt about 300 ms late (10-22); its log line says how late each stream arrives, to be read
after a run in which the PC view is open (section 4).

## 3. Next, in this order

1. **One headset session for section 4** (about 15 minutes, one headset is enough for most of it; the list says which items need two). Also check the cube still loads and plays after the engine/ move.
2. **The experiment pages (3.1)**, then Marek runs them: they decide phase 5.
3. **Phase 5, many bodies (3.2)**, shaped by what the experiments measured.
4. **Camera row** of the line-up menu, when a webcam page is wanted.
5. **Phase 7** only when Marek says so.

### 3.1 Experiment and stress pages (to build)

Each is an app in `apps/` built on `createApp`, with its numbers in the life log (so `mumr-server.log` has them after the run, with
nothing to copy off the headset) and on its menu. Every page has a rehearsal mode on the PC (`?name=A&frame=...&room=demo`) and a Node
test of its logic with pretend headsets, as the cube has. Start the server and check that the log grows before anyone puts a headset on.

| Page | What it measures | How it is built | How it is run, and what passes |
|---|---|---|---|
| `apps/pile` (?n=10/20/30/50) | Quest frame time with N bodies simulated; later, hand-over jitter | N cubes on the floor in a grid, a button that drops them into one pile. **Needs cube-to-cube contact first** (cube.js only knows hands and the room): boxes as turned squares, support from the highest box under the footprint (as the room's `support`, NOTES 30), push-out between boxes in the same 1 cm steps. Before phase 5 every cube is simulated on every page with no sharing (the measurement is the page's own cost). The page logs every 5 s: frames per second, frame time p50/p95 (ms), simulation time per frame (ms), N, how many cubes are moving | One headset: run n = 10, 20, 30, 50; poke the pile. Pass: frame time p95 under 13.9 ms (72 Hz) at 30 cubes, the pile comes to rest. The result says how many bodies one page can simulate, and so whether sleeping bodies (phase 5) are needed or only nice |
| `apps/drift` | How far the line-up drifts over 10 minutes: one headset against the room, two headsets against each other | Uses the line-up's check mark (spot 3) as it is: a printed cross, a timer that every minute says "touch the cross", and on the touch logs where the fingertip is against where the line-up says the cross is (mm, and the mm between the two players when both touch). Ten rows in the log; a menu shows the last and the largest | Alone: line up, then 10 minutes walking about, touching the cross each minute. Two: both do it on the same cross. Pass: under 2 cm after 10 minutes; if not, the anchor keeper needs a re-check timer (anchor.js) |
| `apps/island` (after `pile` has contact) | What happens to a stack when two players touch it at once | A stack of 3-5 cubes; one player pushes the bottom while the other lifts the top. With today's one token per body each cube changes hands on touch; the page logs token hand-overs per second, jumps of a cube (> 2 cm between two drawn frames) and whether the stack stayed together | Two headsets. First run shows today's failure (the baseline). Phase 5's islands (one token for a touching group) pass when the stack moves as one with no jumps |
| `tools/stress.js` (Node, no headset) | Hub and network load for many players and bodies | Starts N pretend players (`tools/standin.js` does one) that send presence at 45/s and own M moving bodies each, against the real server; logs packets/s in and out, the hub's CPU, and the delay from send to receive | PC only: 4 players x 30 bodies. Pass: no queue growth, delay under 30 ms on localhost. Run again over Wi-Fi with two machines when phase 5 has its packet |

### 3.2 Phase 5 (when the experiments are in)

A packet `E` = list of `(id u16, state)`, the holder implied by the hub's table: the hub checks each entry against its token and drops
the ones the sender does not hold (today it checks whole packets by type). Only moving entries are sent; the hub keeps the newest per id
for newcomers; a body at rest is asleep (kept by the hub and the host, not sent, not simulated until something touches it). Bodies
resting on a carrier move with it. Contact islands: bodies that touch form a group with one token, so two players touching one stack do
not tear it apart. Test with two pretend headsets in Node first (a stack handed over, a sleeping body woken by a far player's hand), then
`pile` and `island` on headsets.

### 3.3 Camera row (4b)

As in Nudgy: real webcams as owned things (`own`, `gone`) from a webcam page on the PC, three knobs in front of each to place it, and
Reset. Test: one webcam, two tabs, then a headset placing it.

## 4. Untested (2026-10-25)

From the server logs of 10-22/23 and Marek's answers of 10-25. Each line says how to test it. One headset is enough unless it says two.

| What | Since | How to test it | Marek's answer 10-25 |
|---|---|---|---|
| A cube put on a flat hand (palm up and back of the hand up), carried, falling off when the hand tilts | 10-23 | Make the hand flat, put the cube on it with the other hand; walk; turn the hand over; tilt it past about 45 degrees | **10-25 ran**: carried, glued to the hand; tilted past 45 degrees it drops through the hand (good enough for now); the cube's collision and rotation are poor |
| One finger pushes the cube (the fix for "I can't push it with one finger") | 10-23 | Point and push the cube along the floor with the index | **10-25 works well** |
| Grabbing the cube with a fist; the finger colours (green pinch, orange fist) | 10-22 | Make a fist at the cube, carry it, open; watch the colours | **10-25 works well** (log: held by player 1 for 24 s, then back to the host) |
| Another player pressing your room picker's map | 10-23 | Two headsets: A presses Upload with a two-room scan; B picks a room on A's wrist menu and presses Import | not tried |
| The PC view during a headset run (models, hand wall, pointing rays, the 300 ms lag line) | 10-23 | Open `view.html` on the PC during any run; afterwards read the "late by their stamps" lines in the log | not tried |
| The fist moves the room model, your menu and the viewer (the viewer along the walls) | 10-23 | Fist inside the model, carry; fist on the menu, carry; fist on the hand wall, slide it to another wall; check the cube is not grabbed by that fist | **10-25 works as expected**: the fist only grabs whole things |
| The hand wall's tube hands, redrawn every frame (and the frame rate with it on) | 10-25 | Look at the hand wall while making each gesture | **10-25 works** (tube hands redraw, rate fine) |
| Show hand IRL in a model scaled way down: the whole hand, as thick as it is long | 10-23 | Scale the model down with the pill, reach in | **10-25 works** |
| The scan log spam fix: one "scan has N planes" line, not thousands | 10-25 | After any run, count those lines in `mumr-server.log` | **10-25 seen not fixed** (the line repeated every few seconds); changed the same day to log only when the plane count changes, untested on a headset |
| Physics: drop the cube from head height and from a table; it bounces, tumbles and rests on a face | 10-26 | Pick the cube up with a pinch, let go; drop it from a table; watch the other headset |  not tried |
| Physics: a one-finger push, a fist hold at an angle (it turns with the hand), a throw (it keeps the hand's speed and spin) | 10-26 | Push with the index; fist-grab and turn the wrist; swing and open the hand | not tried |
| Physics: a flat hand carries the cube if the hand speeds up smoothly and slips it off when tilted past about 24 degrees | 10-26 | Put the cube on a flat hand, walk, tilt | not tried |
| Physics: frame rate with the cube moving; two headsets see the same tumble | 10-26 | Look at the frame rate while it rattles; watch it from the other headset | not tried |
| Feet `show` and `kick` | 10-22 | Set `feet: 'show'` in the cube's `app.js`, look down; then `'kick'` and kick the cube | "pretty sure those work" (never ran) |

Found on 2026-10-25 (one headset): the Quest's floor level had drifted about 40 cm (head read 130 cm, then 165 cm after a restart); a restart plus deleting the old saved rooms in Quest settings fixed it, and a bad scan then had two nested rooms. Resets now log their height (`xr: reset height`) and the head height is logged every 4 s (`xr: head`). The room picker presses the smallest room first (a small room inside a big one can be picked). Still open: the session ended a few seconds after Room setup three times (the page tells the player to leave and come back, since the browser allows Room setup once per session, so it may have been Marek leaving; the log now says `xr: the Exit button ended the session` when Exit does it, and the visibility state when the session ends, so the next run tells them apart); the PC view lag line (no PC view was open); the two-headset rows.
Tested and working on the headset (for the record): pointing, rays and signs (10-23); hand cutouts; the room model with two players;
the room picker (one player); the scale pill and Show hand IRL; the cube held from the model; the room upload rules; collisions with
the room; rejoining after a drop; the host; the wrist menu; lining up.

## 5. Nudgy on MUMR (phase 7, when Marek says so)

What changes in Nudgy, so the size of it is known:

| Nudgy | Becomes |
|---|---|
| `mr/link.js`, `mr/align.js`, `mr/ws.py` | MUMR's (same behaviour; `Space` replaces the conversions in `holoshare.js`, `menus.js`, `cams.js`, `capture.js`) |
| `mr/wire.js` | MUMR's registry; Nudgy registers `S` (1) and `H` (3). `P` and `S` are byte-identical (their clock already sits in bytes 2-5); `H` and `M` gain the 4-byte clock |
| `mr/session.js` | MUMR's `Session` with Nudgy's kinds: `mark+`/`mark-`/`mark~`, `net`, `cam+`/`cam-` (owned), `game`/`player` (field `key` -> `name`); the room is MUMR's (`room.js`) |
| `mr/hub.py` | MUMR's hub with `bodies: ["sim", "holo"]`, `owned: {1: "sim", 3: "holo"}`; `_keep`, `_forget`, the camera code and `cam>` go (owned things, `ask`) |
| `mr/share.js`, `mr/holoshare.js`, `mr/replica.js` | two `Body` adapters (the loco with the balls, the viewer); `Replica`'s smoothing stays Nudgy's (or becomes a helper) |
| `mr/worldfeed.js` | MUMR's `WorldFeed` with Nudgy's kinds and types; `view.js` reads `sample('loco')` etc. as before |
| `serve_https.py` | a start script that calls `serve.run(app, routes={...})` with `/relay/*`, `/networks.json`, `/probe/log` |
| `app.js` | `createApp`; the anchor dance, hand sources, menus, wrist card, hand masks and feet are the engine's; the palm platform is `grab.js` |

Check after the move: all of Nudgy's tests (497 Node, 72 Python on 2026-10-22) that are not now MUMR's, two tabs, then one two-headset
session with the server log running first (loco, balls, marks, room, settings, menus, viewer, cameras, take-off/put-on).

## 6. Definition of done (for the extraction as a whole)

- The engine works on its own: its tests pass without Nudgy's files. **(done: 101 Node, 48 Python on 2026-10-25)**
- `apps/cube` runs with two tabs and on two headsets. **(done 2026-10-22/23)**
- The experiments of 3.1 have been run and phase 5 is built or decided against.
- Nothing in section 4 is left untested.
- Nudgy runs on MUMR with its tests green and one two-headset session as before, **or** Marek decided it stays as it is.
- ARCHITECTURE.md and HOWTO-NEW-APP.md are current, and Nudgy's `CLAUDE.md` points at them.
