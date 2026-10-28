# MUMR working notes

A running log kept while extracting MUMR from Nudgy (`KTE/Project2`). Newest entries at the bottom of each section. Dates are absolute.
These are notes, not the design: the design is in [ARCHITECTURE.md](ARCHITECTURE.md), the plan in [PLAN.md](PLAN.md).

## 1. What the chats say (read 2026-10-22)

The Nudgy MR work was spread over about fifteen Claude sessions, 2026-10-10 to 2026-10-22. What each one added to the engine's story, in order:

| Date | Session (topic) | What it settled for the engine |
|---|---|---|
| 10-10 | First Quest Pro build | WebXR page, plain scripts that run in the browser and in Node, a local HTTPS server. **Interaction is literal and physical**: "only activate once the fingers are physically touching, don't try to be smart". |
| 10-10/11 | Panels, hand mask, `changes.txt` lines | Panel follows "on a lead" (no rotation rule), a pinch handle, ghost fingertips. Exact hand outline via the XR hand mesh as a depth-only mask; long fingers needed `tipReach` 24 mm and `maskGrow` 3 mm. Pinch = select event OR tip joints < 22 mm (15 mm never fired). |
| 10-11/12 | Rooms, palm platform, network hologram, ball | Doorways split rooms on the Quest 3. A loco can stand on a flat palm. Labels must not turn with the head, glow must not thicken lines. "The interaction between the loco and the ball needs to be always fully physically based." |
| 10-12 | First two-player build | Jerky second headset, second player cannot touch things. Marek: "make one network per game ... make everything in the game (except menus) global". |
| 10-13 | Two-player teardown and rebuild plan | "Its super janky, strip it completely." New rules: **everything shared, menus too; anyone may press any button on any menu; a menu acts for its owner**; line-up shows marks and allows fine adjustment. Decisions D1-D6 (authority follows touch, WebSocket via the PC, game vs player settings, printed sheets, room = first player's scan). |
| 10-13 | M1 line-up run | A fingertip on the floor reads 60-70 mm high on the Quest 3, ~30 mm on the Quest Pro. Fine adjustment knobs (1/20 of the hand), 10 s averaged rest. "The lining up is now perfect." |
| 10-14 | Tasks 8-11 (loco, room, menus, viewer) | Palm catch failed for the other player: their hands had no platform in our simulation (`withPlat`). The other player's menu must be drawn from **that player's** state and mode. Menus from behind: "just the menu background colour". Marked COMPLETE 10-15. |
| 10-14 | "Is it portable?" | The idea of extracting a library; the dependency map and the first extraction plan. |
| 10-14/15 | Lag, MMO question, UDP/WebRTC probe | Measured: ~130 kbit/s per headset; median round trip ~13 ms on every road; **TCP through the PC loses the tail** (31-37 % replaced, silences > 300 ms), a direct WebRTC channel does not. The Wi-Fi was the PC's own hotspot. Pages not in front get 1 Hz timers. Decision: direct lane not needed for now. |
| 10-15 | PC world feed | Viewer role, compacted document on the hub, latest-packet cache, clock offsets, `WorldFeed`, `view.html`. Rule: **a shared thing the PC cannot see is not finished**. |
| 10-15 | HoloLens / other headsets | Only `immersive-ar` + `local-floor` are required; HTC browsers lack `immersive-ar`. Meta's Shared Spaces sample (`shared` reference space) is the closest prior art. |
| 10-14/15 | Webcam overlay, camera calibration | A real camera is a **shared world object owned by the page that made it** (`cam+`/`cam-`, gone with its connection, others may only *ask* it to move). "The camera's picture is never straightened; the overlay is bent to match it." |
| 10-16 | Lumber Tycoon / feasibility | Touch authority alone is the wrong ownership model for a joystick game; needs **fixed-owner** and **host** policies, **per-object tokens**, an **entity-list packet**, and only awake objects should cost bandwidth. Hard problems named: ownership of piles (contact islands), "physical" is a spectrum, tracking drift. Proposed (not yet answered): three cheap experiments before investing (pile, drift, island). |
| 10-16 | Check spot, camera pose | Spot 3 gets the same knobs/lock/autosave. Camera offset saved with its original pose. |
| 10-16/20 | PC view textures, network on PC | The PC view drew things its own (wrong) way: **drawing code must be shared between headset and PC** (one module, tagged meshes). The PC copy of the simulation must follow the game's controller. |
| 10-20/21 | Presentation | The live MUMR view embedded in a slide (iframe of `view.html`). |
| 10-21 | Room supplier | The room came from the lowest slot and flipped when the supplier took its headset off. Now: **the first headset in supplies it, it changes hands only by a button, the server keeps the last room when the supplier leaves.** |
| 10-21/22 | Put-on drift | Taking the headset off fires 2-4 `reset` events whose transforms are **wrong** (2-12 m claimed; the room moved < 4 m with turns up to 141°); the anchor object the page holds does **not** update. What works: wait until tracking settles (2 s no reset, visible, pose stable 0.7 s), **ask for the persistent anchor again**, put the saved line-up back from it. 3 passes: within 3 cm. |
| 10-22 | Logging | Marek, angry: logging must run **all the time** while debugging and be verified before he puts the headset on. A recorder that reads the page's frame loop goes blind when the app is hidden. Now: an always-on server log, and the page posts its life lines to the server the moment they happen (`keepalive`). |

Marek's working preferences that matter for the engine's tooling: he tests on two headsets (Quest 3, Quest Pro); he cannot describe what he sees precisely, so **the data must say it** (debug snapshots, server log); he types, he does not talk back while in VR; the `live-debug` skill reads cues aloud but he finds it chatty.

## 2. Patterns that can be streamlined (found while reading the code, 2026-10-22)

Each item: what is there now in Nudgy, why it costs, what MUMR does instead. **Done** = built that way in MUMR already.

1. **The hub knows the game.** `hub.py` `_keep` lists Nudgy's event kinds (`game`, `player`, `mark+`, `mark~`, `room`, `frame`, `check`, `net`) and `_forget` knows that a room keeps its data but loses its slot, and that `game:roomFrom` is cleared. Every new shared thing meant a Python change and a "keep the two in step" comment.
   **MUMR:** events describe their own keeping: `{k, key, drop, scope, clear}`. The hub keeps the newest event per `key`, removes it on `drop`, removes all keys with a prefix on `clear`, and on a player's leave removes what that player said with `scope: 'slot'`. The hub has no list of kinds. **Done.**
2. **Cameras are a special subsystem** (180 lines across `hub.py`, `cams.js`, `session.js`, `worldfeed.js`) with its own validation twice (Python `cam_ok`, JS `clean`, "keep the two in step"), its own ownership, rate limit, cap and request message (`cam>`).
   It is really a general pattern: an **owned object** — something in the document that belongs to the connection that made it, that only it may change, that goes when it goes, and that others may only *ask* to change.
   **MUMR:** `own: true` on an event makes the key owned by the sender's connection; `{t:'ask', key, m}` is passed to the owner only. Rate limit and per-connection cap are generic. Validation of content is the app's, on the client, in one language (the hub only checks size and shape). **Done.**
3. **Two tokens with fixed names** (`BODIES = ("sim", "holo")`, `OWNED = {1: "sim", 3: "holo"}`), and session.js writes `{ sim: null, holo: null }` in four places. A game with 40 logs needs 40 tokens.
   **MUMR:** tokens are named by the app (any short string); the server is told which packet types belong to which token at start (`Hub(owned={type: token})`), and a packet for an entity list can name its token per packet (`token` field in the header, see 4). **Done** for named tokens; per-entry checks are later (PLAN phase 5).
4. **Three packet layouts have a sender clock, two do not** (`H`, `M` were timed by arrival on the PC). And each receiver had its own "drop an older packet" check (only `S` had one).
   **MUMR:** one header for every packet: `u8 type, u8 slot (server-written), u32 sender clock (ms)`; the ordering guard is in one place (`wire.Guard`). **Done.**
5. **The XR-space / common-frame conversion is written four times** with small differences: `holoshare.js` (`toCommon(f, fy, p)`, XR point with y up and z towards you), `menus.js` (`panelOut`/`wristOut` with `floorY` and `fz`), `cams.js` `toOwn`, `capture.js` `sourcesToCommon`. The rule (`x = X, y = -Z`, height above the *common* floor = `Y - floorY - frame.z`, a yaw about the vertical is the same turn in both) is easy to get wrong.
   **MUMR:** one `align.Space` object per headset (`frame`, `floorY`) with `xrToCommon`, `commonToXr`, `yawToCommon`, `quatToCommon` and their inverses. **Done.**
6. **"Are we sharing?" is decided twice, differently.** `share.js`: connected, lined up, and some other player lined up and heard from lately; `holoshare.js`: connected, lined up, and some *peer* in `doc.lined`. Both then add "or a viewer is watching" by hand.
   **MUMR:** `session.sharing()` and `session.sending()` (sharing, or watched while lined up), used by every Body. **Done.**
7. **`Share` and `HoloShare` are one pattern written twice** (claim on reach, busy while touched, send at a rate, receive only from the holder, handover counts, status). Known from the first plan.
   **MUMR:** `Body` with an adapter (`reach`, `touching`, `pack`, `apply`, `settle`) and a policy (`touch`, `owner`, `host`). **Done** (touch and owner; host needs a host client, PLAN phase 6).
8. **Validation of numbers is repeated everywhere** (`Number.isFinite` chains, `_num`, `_cnum`). Small, but a helper (`num(v, lo, hi)`) used throughout keeps checks readable. **Done** in MUMR's `util.js`.
9. **Every packet type had to be added in four places** to reach the PC: `wire.js`, `hub.py` (`OWNED`), `worldfeed.js` (`STREAM`, `MAKE`, `BLEND`, `_bin`), `view.js`.
   **MUMR:** `wire.register({type, name, pack, unpack, blend, token})`; `WorldFeed` buffers every registered stream and blends with the stream's own `blend`. A new packet reaches the PC with no change to the feed. **Done.**
10. **Debug output depends on the frame loop.** Nudgy's `events.py`/`observe.py` read snapshots that the page posts from its frame loop; they go blind when the app is hidden, which is exactly when the interesting things happen (put-on, idle drop-out). The 10-22 fix added a server log and posts life lines with `keepalive`.
    **MUMR:** the server log is part of the server (`serverlog.py`, always on), and the client has `life.js` (numbered lines, `sendBeacon`/`fetch keepalive`, a `sessionStorage` copy that survives a reload, resent if a post failed). **Done.**
11. **CRLF.** Nudgy's files are CRLF; the Edit tool writes LF and Git Bash `sed -i`/`cat >>` mix them, which cost a fix commit more than once.
    **MUMR:** LF everywhere, enforced by `.gitattributes` (`* text=auto eol=lf`). **Done.**
12. **Two servers in one.** `serve_https.py` is the static server, the TLS setup, the WebSocket, and Nudgy's PC remote relay (`/relay/state|cmd|fast`, SSE) and `/networks.json` and `/probe/log`.
    **MUMR:** `serve.py` is static + TLS + `/ws` + `/log` + build stamp, with `routes` for the app's own paths; the relay stays Nudgy's (the viewer role replaces it in new apps). **Done.**
13. **Drawing code drifted between the headset and the PC** (boxes, rugs and balls had no textures on the PC; the PC network had no wires). Not an engine module yet (it needs THREE).
    **MUMR, later:** the app's drawing of shared things lives in one module that both pages import; the engine only asks for it (HOWTO says so).
14. **The anchor dance is page code** (~150 lines in `app.js`: persistent anchor, `reset` events, settle, re-find, save/load the line-up). Every MR app needs it.
    **MUMR, later:** `anchor.js` (logic: `Resets` + a re-find state machine with injected `restore()`/`getPose()`), with the page only wiring XR calls. `align.js` already carries `Resets` and `Aligner.save/load/rebase`. PLAN phase 3.
15. **`Session._hello` asks the `sim` holder for the document.** Now that the hub keeps a compacted document (for viewers), players could take it from the hub too: one source of truth, no "who do I ask", and the document survives everyone leaving.
    **MUMR:** players get `doc` in their hello like viewers; `sync` from a peer is gone. The app's *keyframe* (a Body's full state, e.g. the network's hidden state) still comes from the holder via `syncFrom` on first join. **Done.**
16. **Silent-holder timeout = throttled-page interval.** The hub takes tokens from a holder silent for 1.0 s; a page not in front ticks at 1 Hz. That sits exactly on the line (a lead on the idle drop-out, never proven).
    **MUMR:** `SILENT` is 2.5 s by default and a parameter. Noted as a thing to measure.
17. **A quick second press was lost** (found 2026-10-22 with the counter example in two tabs: three quick `+1` counted once). A setting
    changed only when the server's echo came back, so the second press computed from the old value. Nudgy's session has the same
    behaviour (harmless there: a toggle pressed twice within ~13 ms does not happen by hand), but a game with counters or steps would lose
    presses. **MUMR:** the page's own changes are kept as *pending* until their echo comes back: shown at once, and the next press starts
    from them; the server's order still decides. **Done**, with a test.
18. **The hub's hello to a player now carries the document and the newest packets** (as a viewer's did). A joiner sees the world at once
    without asking anyone, and bodies at rest need not keep sending for a newcomer to see them. **Done.**

19. **The redirect from `/` lost the page's query** (found 2026-10-22 rehearsing the cube: `?name=A&frame=0,0,0` never arrived).
    Fixed in `serve.py`, with a test.
20. **The demo app is longer than the plan's 150 lines** (235 lines plus 155 for the cube). The parts every app writes again: the
    desktop rehearsal (mouse as a fingertip, clicks on panels), keeping a `Panel` per menu in step with `menus.others()`, easing the
    other players' panels, the frame loop's order (input, line-up, presence, bodies, menus, draw). A small `xr/app.js` helper could
    carry them. **Done** (2026-10-22, after the two-headset runs): `createApp` in `client/xr/app.js` (about 290 lines) holds all of
    it; the app hands in its settings, its menu layout, its bodies and four hooks (`step`, `draw`, `onAction`, `ghostColour`). The cube
    page is 34 lines. An app that needs another frame order or a second floating menu does not fit yet: add a hook when one does.
21. **A menu is a function of its owner's state and info**, for this player's menu, another player's and the PC view alike
    (`cube.menu(state, info)`): one layout, drawn three ways. That is the generic form of Nudgy's M4 rule.

22. **A texture keeps the size of its first upload** (first headset run, 2026-10-22: the line-up menu only stretched). A canvas that
    changes size needs a new texture: `panel3d.js` makes one. **Done.**
23. **Watchers were not told who holds a body when its token was handed out on a player's join** (the PC view said nobody
    simulated the cube). The hub now sends the token to everyone. **Done**, with a test.
24. **A body could be applied before the page was lined up** and crashed it (`Space` without a frame): `Body.receive` now takes
    state only while sharing, as Nudgy's `Share` did. **Done**, with a test.
25. **A page nobody looks at held the cube** (a background tab: its timers still ping, so the hub's silence rule never fires, but it
    draws no frames, so nobody saw the cube move). Rule: a hidden page, a headset taken off (XR visibility `hidden`) or a page whose
    frame loop has stopped for a second releases its bodies; the hub gives a released body to the earliest other player. **Done.**
26. **A Wi-Fi stall of 4 s made the headset reconnect as a new player** (first run, 18:11:27), so its tokens and slot changed. Not
    fixed then. **Done** (2026-10-22, Marek chose it next): the hub keeps a dropped player's place for 10 s (slot, settings, line-up,
    owned things; its tokens go at once so nothing waits), the link rejoins with `{ resume: { slot, key } }` from its last hello (kept
    in sessionStorage, so a reload comes back too), and the others are never told it left. A page that closes on purpose says `bye`
    and is gone at once. Tested in the hub, the link and against the real server; not yet on a headset.

27. **Two pages that nobody looks at handed the cube to each other for ever** (first two-headset run: about 4800 hand-overs in the
    4 minutes after both left mixed reality). The hub no longer gives a released body to a player that released the same body in
    the last 5 s (it stays where it is), and the page releases at most once in 5 s. **Done**, with a test.
28. **A reset 0.1 s after the start sent the keeper looking for an anchor it had just made** (the second headset; asking by the
    handle failed: "Anchor creation failed"). An anchor made new in this session less than 10 s ago is kept as the reset moved it.
    **Done**, with a test.
29. **The room is the server's** (Marek, 2026-10-22, replacing Nudgy's supplier rule that he had first asked to keep): the server
    keeps the last room it was given and everybody uses it. It is given one only when it has none (the first lined-up headset that
    connects with a scan uploads its own, once) or when a player presses Upload in the line-up menu's Room row (that headset's scan,
    once). No supplier, no updates by themselves, nothing happens when a headset leaves. This also removed the per-player "who
    supplies" thing from the document: `room` is one kept event `{ data, by, at }`. `client/room.js`; tests in `test/room.test.js`.
30. **First room run** (Marek, 2026-10-22, one headset). Faults: a held cube pushed into a wall snapped through it and stayed on the
    other side; it seemed to fall through gaps narrower than itself; it got behind a bed and slid under it; a pinch had to be made at
    its edge because the closing fingers pushed it away; the room preview did not tell tables from objects. **Done:** the hold is a
    spring (it follows the hand at most 5 m/s, stops at whatever is in the way, lets go when the hand is 30 cm off); every move goes in
    1 cm steps and a wall keeps a thing on the side it came from, so nothing passes anything; support is the highest point under nine
    points of the footprint (a narrower gap carries it; hanging over an edge it slides off); room.js kind(): tables have space under
    them (a 4 cm slab), every other raised level surface (bed, couch, storage, other) is a block down to the floor; a hand that is
    closing on the cube, or touches it on two sides, does not push it. The engine has grips now (`client/grab.js`: pinch and fist,
    for every app); the ghost fingers keep one colour unless the app asks (`ghostColour: 'grips'`, which the cube does).
31. **Hands, 2026-10-23** (Marek's list after the second room run). One finger no longer pushed the cube: a pointing hand has three
    fingers curled, so the "closing on it" rule (item 30) took it for a grip forming; a pointing hand is now excluded. **Done** with the
    rest of the list: grab.js has the POINT gesture (a ray along the index) and `pointAt` (the app's boxes and the room, room.js `cast`),
    the PALM platform (Nudgy's: a flat hand, palm up or back up, things can be put on; the cube rides on it until the hand tilts past
    46 degrees); `xr/handwall.js`, a window on the room's longest wall with every hand's skeleton and its gesture numbers (each page
    works it out from the joints, so everybody and the PC view see the same without packets); the legs are gone, only the feet as
    shoes (Nudgy's offsets), off unless the app asks (`feet: 'show' | 'kick'`); the hand cutouts are back (`xr/handmask.js`, Nudgy's
    mask with its 24 mm tip reach and 3 mm growth), on unless the app turns them off. Not yet on a headset: the gesture thresholds
    are Nudgy's or estimates, and the hand wall shows the numbers to tune them by.
32. **The room model** (Marek, 2026-10-23): from the game's menu, a small copy of the room (the longest side half a metre) with a bar
    to carry it and a ball to turn it about the vertical; in it the cube and the hand wall's viewer can be picked up (pinch) and put
    somewhere else, the viewer only onto a wall (the nearest one, at the height it is let go). "Show hand IRL": a hand that reaches into
    the model is drawn full size in the room where it would be. **Built** (`client/model.js`, `xr/roommodel3d.js`, createApp's
    `roomModel`): shared like a menu (its pose is panel 'model' of its owner's `M` packet; everybody sees every open model, may move
    the things in it, and sees its owner's full-size hand; only the owner carries and turns it); where the viewer hangs is the
    document's `wallspot` (room.js SPOT_KIND), the cube goes by a `put` request to whoever holds it. Found on the way: `[...].every(
    M.util.num)` passes the index as `num`'s lower limit (the cube's put request was refused); written out instead.
33. **First room-model run** (Marek, 2026-10-23): "works pretty good". His scan held a second room metres away; the model needed a
    scale; a cube moved in the model did not look held (here or in the model) until it was let go. **Done:** room.js `splitRooms`
    (every floor is a room, every other plane goes with each room whose floor it stands on or touches) and a room picker: Upload with
    more than one room shows a map of the rooms' floors in the line-up menu (each room a button, Cancel, Import); the first upload to
    an empty server takes the room the headset stands in. A third handle on the model, a green pill at its front left corner pointing
    at its middle, scales it (0.3 to 4 times; the scale goes in the owner's menus info). A cube moved in a model is now held by that
    hand like a held cube (cube.steer: the same spring; the moving page takes the token; white edges for everybody), and falls when
    let go, also when the hand is lost.
34. **The fist moves things** (Marek, 2026-10-23: "by default, grabbing anything anywhere with a full fist moves the whole thing").
    createApp: a fist that starts inside this player's room model, on its menu or on the viewer carries that whole thing (the viewer
    along the walls); that hand is marked noHold meanwhile, so the cube (or any app body that honours noHold) does not take it too. The
    cube itself already took a fist. Desktop: Ctrl is a fist. The hand window's hands: a 2D drawing was "turbo stupid"; he chose solid,
    lit tube hands (ghost.js `{ full, solid }`), life-size in front of the window, redrawn every frame. The enlarged hand IRL was thin
    and pointy in a small model: its finger thickness was capped at 12 cm while its length grew; it is now the whole hand with every
    joint's radius grown as much as the hand (tested: finger length to thickness 7.3 at 1x and at 40x).

## 3. Things that must not be lost (from the Nudgy build)

Kept from the first plan's section 6, plus what came after it:

- Common frame: x, y on the floor; heights above the **common** floor (each headset's floor differs by centimetres); a yaw about the vertical is the same turn in sim coordinates and in THREE's Y axis.
- Never send a headset's own coordinates; never trust the sender's slot byte (the server writes it).
- Build stamp: a page of another build is refused at join ("reload"). Without it a headset runs an old page and everything looks half-broken. When Marek reports a two-headset fault, first check that **both** headset addresses fetched the page after the last change.
- Decide the page's role before the session starts; never change it from a frame loop.
- Server hardening: a send queue per player (messages first, newest motion per kind and sender), a silent holder loses its token, TCP keepalive and no Nagle, a watchdog that ignores a paused page, timestamped leave reasons.
- Alone, the same code path: `emit` applies at once.
- Authority follows touch needs everybody's hands in every simulation (and their derived parts: the palm platform), so a push is applied in the frame it happens; a handover must not snap (`markInStep`).
- The room: first headset in supplies it, changes hands only by a button, stays when the supplier leaves.
- Tracking resets: don't trust the `reset` transform alone; re-find the persistent anchor after the tracking settles.
- Test order: Node with two pretend headsets (a fake hub), then two browser tabs, then two headsets **with the server log running first**.

## 4. Open questions for Marek

1. Repo is private (`machmar/mumr`). Public later?
2. The three experiments from 10-16 (pile of 20-30 cubes, 10-minute drift, island push) were proposed but never answered. They decide how far "everything is physical" can go. Run them on the example app?
3. Should Nudgy move onto MUMR (replace its own copies), or stay as it is and MUMR only serve new projects? The plan assumes it moves, after one headset session.
4. More than two players: the wire allows four slots; nothing above two has run.
5. `dbg.mp.sharedSpace` (does the Quest Browser offer a `shared` reference space?) was recorded in every run and never read. If yes, line-up could be automatic.

### Answers (Marek, 2026-10-22)

1. The repo becomes **public under MIT when he says so** (not before).
2. He will run the three experiments later (he is away): work around them for now.
3. Nudgy does **not** move onto MUMR now.
4. Look into the `shared` reference space, but the touched-spots line-up is good enough for now. Findings: it is behind a Quest Browser
   flag (`chrome://flags`, "WebXR experiments"), the page must list `"shared"` in `optionalFeatures` (Nudgy did, in its first try), the
   browser may give a placeholder space for a second or two and then a `reset` (none for the first headset in the room), the space has a
   UUID that is empty until it has settled, and it is per site and room-sized ([UploadVR](https://www.uploadvr.com/quest-web-browser-experimental-colocation-webxr/),
   [dmnshd.gg](https://dmnshd.gg/blog/webxr-shared-spaces)). Nudgy's answer was never written to a log (it lived only in the page's
   debug snapshot, which the relay does not keep). The MUMR XR start asks for it and writes the outcome to the server log; using it as
   the common frame is an option behind `?shared=1`, untried.

## 5. Log

- **2026-10-22** Read the MR chats (17 transcripts in the Project2 folder, user messages in full, Claude's replies cut to 500 characters;
  the Lumber Tycoon / feasibility chat in full). Refreshed the plan (PLAN.md). Created `machmar/mumr` (private, LF, no licence yet: ask).
- **2026-10-22** Extracted the core without THREE, written fresh from Nudgy's files with the streamlining above: `server/` (ws copied,
  hub/serve/serverlog generic), `client/` (link and align ported with their tests unchanged apart from the namespace; wire, session,
  presence, body, worldfeed, life new). 58 Node tests (net.test.js against the real server), 39 Python tests. The presence packet is
  byte for byte Nudgy's (checked against a packet made by Nudgy's own wire.js). `examples/counter` checked in two tabs in the browser
  pane: the second tab took the world from the server, settings and an owned note crossed, the note went with its tab; it found item 17.
- Not done then: anything with THREE or WebXR; nothing has run on a headset; Nudgy is untouched (except a pointer at the top of its old
  extraction plan).
- **2026-10-22 (later)** Marek: build the menus, the XR parts and a demo for him to try later. Built phases 2-4 (PLAN): `hands`,
  `follow`, `menus`, `anchor`, `lineup`, `all.js`, `xr/*`, `examples/cube` with a PC view. 70 Node and 39 Python tests. Rehearsed
  in the browser pane: two tabs with pretend line-ups (B pushed the cube and took the token, A saw it at the same common place:
  0.729 against 0.73 m; B pressed A's buttons; B's Line up put A into line-up mode and B saw it; A lined up with the mouse, 200 cm),
  and the PC view showed the cube, the count, both heads and both menus. Not ported: Nudgy's depth-only hand mask and the cut-out
  of the hand in front of a menu (the ghost fingers are drawn over the menus). Nothing has run on a headset.
- **2026-10-22, first headset run (Quest Pro, one headset)**, Marek: the line-up menu only stretched; legs were missing (not
  interactive, but visible); the menu had no handle; the cube grab broke his rule ("only grab if fingers are touching each other
  (index and thumb)"); the PC view (Firefox) was super laggy. From the server log: the PC view could not take its packets (10-170
  replaced every 2 s), a 4 s Wi-Fi stall made the headset reconnect, the `shared` space was granted (his flag is on) but had no UUID
  alone. Fixed: items 22-25; a handle to carry the menu; the grab is only a pinch (index and thumb touching) that starts at the
  cube, held while they touch; legs from body tracking or estimated from the head, drawn for the others and on the PC; the PC view
  draws at pixel ratio 1, redraws a menu only when it changed, falls back to the arrival time when a clock is far off, reloads
  itself on a new build and writes its frame rate and packet rate to the server log every 10 s (in Chromium here: 41-60 fps). Why
  Firefox was slow is not proven; its next log lines will say. `tools/standin.js`: a pretend player for rehearsals.
- **2026-10-22, first two-headset run** (Quest Pro 192.168.137.87, Quest 3 192.168.137.111), Marek: "it seems to have worked
  well. Even the PC was now smooth", but the PC view felt about 300 ms late (Nudgy's did not): it now draws 50 ms back instead of 80
  and logs how late each stream arrives against its stamps (unproven cause; a headset clock estimate that is off is the suspect).
  From the log: both lined up (335 cm), the cube's token went back and forth 8 times while they played, body tracking was granted on
  both, the `shared` space was granted on both but never got a UUID, even with two headsets in the room. Faults: items 27 and 28.
- **2026-10-22 (evening)** The rejoin (item 26) and then the host (PLAN 6), Marek's choice of order. The host: a hub role (slot 15,
  not a player), `client/host.js` (Node: the app's own simulation with everybody's hands, in the common frame), the server starts
  and restarts it, bodies go to it first and come back to it at rest. Rehearsed: a page pushed the cube 34 cm, it came to rest and
  went back to the host, and a page opened later found it where it was left. 78 Node, 48 Python tests. Not yet on a headset.
- **2026-10-22 (evening)** Who simulates the cube is shown on it (an outline in their colour and a label). The menu is split (Marek: "parts
  of the menu are engine-essential ... a wrist based popup that minimizes into a wrist button"): `client/sysmenu.js` is the engine's
  menu on the inside of the left wrist (Line up with its spot rows, Room setup = the headset's own room capture, Exit), shared as panel
  `wrist`; the cube's floating menu holds only the cube's items. Rehearsed in the browser and on the PC view; 79 Node tests.
- **2026-10-26: the webcam page** (Marek: "port the webcam page in its entirety from nudgy"). Everything of Nudgy's `mixedView.html` and its calibration
  mode is in `engine/client/webcam/` (about 4500 lines and their tests, from 2150 lines of Nudgy's tests). What changed in the port, and why:
  1. **Cameras are owned things**, no special subsystem (item 2): the session has built-in kinds `cam+` / `cam-` (`own`, `gone`), the hub knows no
     cameras (Nudgy's `cam_ok`, `cam>`, `CAM_RATE` and `cams` in the hello are gone), a headset moves one with `session.moveCamera` (an `ask` to the owner).
     The generic tests that used `cam+` as their example kind now use `pin+`.
  2. **The page sits on the app's PC view** (`window.view`, `parts`), not on Nudgy's `view.js`: the Show menu works through the objects the view hands over
     (`mixedshow.js` was rewritten; the old one found Nudgy's three scene groups by their order), and the occluders are built from MUMR's room planes (walls and
     blocks of `room.js`), not Nudgy's `fixed` boxes (no marks in MUMR yet, so no marked boxes).
  3. **The page builds its own panels** (`page.js`): an app only adds one script tag. The browser storage keys are `mumr.webcam.*`; the old `nudgy.mr.webcam.*` ones
     are read while a new key is empty (same origin when the PC serves both on 8443), so the camera profiles come across.
  4. The line-up's wrist menu has a **Camera** place (Reset camera) in the free slot of its Line up screen; the headset draws the real cameras and, while
     lining up, the three knobs in front of each (`xr/cammark3d.js`, `players3d.js`, `createApp`).
  5. Sheet 4 and the other line-up sheets come from `tools/make_align_sheets.py` (`docs/sheets/`), the screen codes from `tools/make_screen_codes.py`,
     the phone pictures from `tools/make_phone_test_images.py`, the painted-picture rehearsal is `engine/client/webcam/rehearsal.js`.
  Rehearsed through the real server with a painted floor seen through a lens (a1 -0.12): the camera came out at its true place, the lens pass drew the world
  over it, a second tab (a player) saw the camera, moved it (the page kept its aim: yaw 2.191 to 2.245) and reset it. 374 Node tests, 373 pass (the physics pile
  test was already failing before this work), 48 Python. Nothing has run with a real webcam or a headset.
- **2026-10-27: Jenga** (Marek: a Jenga game as a demo of the physics engine, "use the engine as if you were an external developer", build it in a branch, squash and
  merge, keep the branch). What the engine had to learn, and what was learnt about it:
  1. **A block cannot be pulled from under a load with the old hold.** The hold was a velocity set before the solver's step; with 7 N of tower on a 17 g block, friction cancelled the
     velocity inside the same step (the block moved 3 mm of an 85 mm pull and then shot out). A kinematic grip moved it but is infinitely stiff, so it carried the whole load and the
     stack above came out with it. The fix is a **grip of limited strength**: a critically damped spring (omega 80 rad/s) whose force is capped (4 N at normal size, x scale cubed),
     applied inside every substep (`hold(b, target, { force, omega })`). My first version closed the velocity error in 1/16 of a substep: stable while friction held the block, a runaway
     the moment it came free (a gain above 2 in an explicit step); found when the block shot ahead of the hand.
  2. **A tower of 54 small blocks needs the solver's knobs** (20 velocity and 6 position steps at 1/240 s; the slop, the sleeping speed and the movement cap scaled with the block):
     with Jolt's defaults 5 of 18 single pulls brought it down, with these none. The physics is scale-invariant: the same blocks come out or bring it down at 27 cm, 75 cm and 1.5 m.
  3. **A menu that is one thing for everybody** needed a new place in `createApp` (`boards`): a panel in the room that every player presses, its pose from shared data. The engine's menus were
     all somebody's (`session.press(owner, id)`); a board's owner is its key, and its press runs on the page whose player pressed it and asks the host (`body.ask`).
  4. **The game is the host's.** Policy `host` bodies need `bodies: ["jenga"]` in mumr.json (the host gets the token from the first player's page, which gives it up the next frame); a page's
     Body is made with `slowEvery: 0` so that it never sends. The state is ONE kept event (`jstate`, key `jenga:state`) that the host sends when its revision changes; a host that restarts
     takes it from the document and builds a fresh tower.
  5. **Layout mistake worth remembering**: the first layout put the console between the player and the tower with the board facing the tower, so the player who placed the game saw the back of
     their own menu. The game frame now has the console beside the plinth and the board and scoreboard face where the placing player stands.
  6. A desktop rehearsal of a hand needs patience: a scripted pinch that starts while the hand is already rising is seen by the host 7 cm up (the page runs at 19 frames a second in a headless
     browser); close the fingers first, then move. `__mumr.poke(x, y, pinch, fist, z)` takes a height since this entry.
  7. **A streamed track cannot start half way from a server that sends whole files.** The ambient tracks now come in at a place of their own (a hash of the seed, scene, round and file: the same on
     every headset) instead of always at 0:00, which needs `audio.currentTime` to jump inside a file that has not been downloaded. Python's `SimpleHTTPRequestHandler` has no byte ranges, so
     `serve.py` answers `Range: bytes=a-b` (206, 416 outside the file) since this entry; checked in Chromium (both tracks 206, entered at 0:55 and 0:24 of 3:20).
  8. **The room's dim is the host's to ask, and the server keeps what it was told.** Jenga drives `session.dim` from the referee (focus.js) instead of from a page: it is the one process that sees every phase.
     Two things follow from the dim being a kept document item. A host that restarts must say something at once (its first ask is the lobby's look, so a dim left by a host that died in a fall is
     undone), and a host that does not come back must not leave a dark room: the pages let it go after 4 s with no host. A look that follows the tension has to be asked in steps (0.05) and not
     more than every 0.7 s, or the document gets an event for every wobble. The PC view has no real room: it can only list the look.
  Rehearsed through the real server and Jolt host with two tabs: Start on the board, the die thrown by a pinch and read, a block pulled out and put on top (+1, the next player), a fall with its replay
  (TIMBER, -3, rewind, 0.3x, aftermath, round end), the PC view, and music crossfading in a desktop browser. Not yet on a headset.
- **2026-10-28: Jenga's look** (Marek: "make it feel good, very pretty, very polished ... zen-like ... re-imagine the menu, it does not have to match the wrist menu"). The scene was
  redrawn (`look.js`, `textures.js`, `draw.js`, `stand.js`, `fx.js`, apps/jenga/README.md "The look"), the board became a stand with hanging plaques, and the engine got two small
  generic things: **`boards: [{ panel: false }]`** with `app.boardTouches(id)` (the engine presses a board the app draws) and **`app.lights`**. What was learnt:
  1. **A sprite faces each viewer: words on one break rule 1** (a round glow, a mote of dust or a spark looks the same from everywhere, so those may be
     sprites; anything with a front may not). The old TIMBER banner was a sprite, so every headset saw it turned its own way. Words for everybody are now a band round the tower
     (a cylinder whose far half is not drawn, so it never reads backwards), turning on the server's clock: the same place and the same turn for everybody, readable from all sides.
  2. **Every motion on the server's clock.** The pulses of the old markers ran on each page's `performance.now()`: the same glow at different moments on two headsets. The lantern's
     flicker, the sway of the plaques, the turn of the words and the breathing of the glows now follow `session.serverNow()` (`feed.serverNow()` on the PC view). A swing after a press
     follows the shared fingertips (the `M` stream's touches), so it starts on every page together.
  3. **The dust lives on the world's clock**: the server's, stopped at the freeze, run back with the rewind and at 0.3x with the replay (from the packet's mode and progress), then
     caught up over a few seconds. The puff of sawdust of the first block on the ground is on the same clock, so the replay shows it again in slow motion.
  4. **The blocks were never painted again after a size change** (new meshes, the same seed: all of them the first colour). The meshes are painted whenever they are made since.
  5. **Lights cost every pixel even at intensity 0**: the engine's lights are hidden, not turned down. In a software renderer the scene costs about twice the old one (shadows,
     reflections, the lantern as a point light); 230 draw calls and one 1024 shadow map, with only the tower, the die and the plinth casting and only the sand and the floor round the
     tower receiving. Not yet measured on a Quest.
  6. Fonts for canvas text must be in the repo (`fonts/`, SIL OFL, loaded with `FontFace` from the app's own server): a headset on the LAN may have no internet.
  7. Rehearsing the moments in a headless browser: a screenshot waits for a frame, and with three pages on a software renderer a frame takes a second, so a whole replay goes by between two
     shots. The PC view can be given a pretend state and packet instead (only in the test's browser: `feed.sample` and `session.doc` wrapped), which shows every phase still.
  Rehearsed through the real server and Jolt host: every phase on the PC view and the desktop page (a staged game, a nudged tower falling, the replay), a mouse click on the Start
  plaque pressing it, the three sizes; 57 Jenga tests. Not yet on a headset.
- **2026-10-28 (night): Jenga arranges itself in the room** (Marek: "make sure that the room layout accommodates different room sizes and furniture placement -
  if a space is narrow, the tables rearrange to still have optimal layout that makes sense and doesn't overlap with real-world objects"). `apps/jenga/arrange.js`:
  a search on the host, from the server's room in the common frame (rule 1: worked out once, from shared data, and kept in the shared place as `place.arr`;
  never from a page's own scan). Candidates in order of how far they are from the usual arrangement (the tower nearer, further, aside or turned about the
  player; the console on either side, along or across, behind the tower; the scroll and the lantern in a few places each), outlines checked against the
  walls (segments), the things on the floor (outlines with a height) and the floor's outline; the cheapest with no collision wins, or the one that collides
  least. Learnt: a flat check is wrong for a stand whose beam passes over a table: between the game's own things only the feet count, against a wall the
  whole width. 100 to 400 ms on the host, once per Move here. The layout (`spec.js`) takes the place: the console has two axes (along it, towards its back),
  so a mirrored arrangement is the same code; an arrangement made for another size is not used. Rehearsed with `?room=demo` (the tower steps off the pretend
  table) and in `arrange.test.js` (corridors, a short room, a sofa and a table, the giant tower in 4 x 3 m). Not yet in a real room.
