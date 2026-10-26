# MUMR architecture

MUMR (multi-user mixed reality) is the shared-world part of Nudgy's mixed-reality app, made into an engine. Two to four people in one room
wear headsets (Quest 3, Quest Pro: a WebXR `immersive-ar` page in the browser, nothing installed); a PC on the same network serves the
pages and runs the hub; any number of PC pages may watch. Everything in the world is shared: every player sees it and every player can
touch it.

## 1. Three kinds of shared thing

Every shared thing is one of these. An app is these three plus its own drawing and simulation.

| Kind | What it is | Examples (Nudgy) | How it travels | Module |
|---|---|---|---|---|
| **Document** | State that must be the same for everyone, in the same order | settings, each player's settings, marks, the room, who is lined up, check marks, the loaded network, real cameras | JSON events over the WebSocket; the hub numbers them, sends each to everyone (the sender too) and keeps the newest of each thing | `session.js`, `hub.py` |
| **Body** | A thing that moves under physics or hands | the loco and the balls, the network hologram | every page simulates it with **everybody's** hands; the holder of its token sends the state (binary, latest wins, 45/s while moving); a hand that reaches for it takes the token at once | `body.js` |
| **Presence** | A stream only its owner writes | head and hands (45/s), where the menus float (10/s) | one binary type each; no token | `presence.js`, `wire.js` |

Inside the Document, an **owned thing** belongs to the connection that made it (a camera that a webcam page aligned): only the owner
changes it, others may only *ask*, and it goes when the owner goes.

## 2. One frame for everyone

Each headset has its own floor frame (origin and heading wherever it started). A **line-up** makes a common frame: the player rests a
fingertip on two printed crosses on the floor for 10 s each (`align.js` `Aligner`); the common origin is cross 1 and its x axis points at
cross 2, for every player, so nobody needs anybody else's numbers. A third cross checks it. Heights are above the **common** floor (the
plane where the fingertips rested; a Quest 3 reads it 6-7 cm above its own floor, a Quest Pro about 3 cm).

**Everything sent is in the common frame; everything received is turned into the page's own.** One object does it: `align.Space`
(`toCommon`, `fromCommon`, `xrToCommon`, `commonToXr`, `quatToCommon` ...). A line-up is kept against a persistent anchor so it
survives a reload, and is put back from the anchor after the headset was taken off (the reset events' transforms are not to be trusted:
NOTES 1, 2026-10-22).

## 3. The pieces

```
  headset page (WebXR)                                 PC                                   PC page (viewer)
 ┌──────────────────────────┐   WebSocket /ws   ┌────────────────────────────┐   /ws    ┌──────────────────────┐
 │ app: drawing, simulation │ ─── events ─────► │ serve.py                   │ ───────► │ WorldFeed            │
 │ Session  (document)      │ ◄── numbered ──── │  hub.py: slots, the kept   │          │  = Session (viewer)  │
 │ Body x n (touch/owner)   │ ─── motion ─────► │  document, tokens, newest  │ ───────► │  + streams by        │
 │ Presence                 │ ◄── others' ───── │  packets, Outbox per conn. │          │    server time       │
 │ Space, Aligner (align)   │                   │  serverlog.py (always on)  │ ◄─ /log ─│ life.js              │
 │ link.js, life.js ────────┼── POST /log ────► │  static: app + /mumr/      │          └──────────────────────┘
 └──────────────────────────┘                   └────────────────────────────┘
```

| File | What it does | Depends on |
|---|---|---|
| `engine/server/ws.py` | WebSocket frames (RFC 6455), standard library | - |
| `engine/server/hub.py` | roles (player 0-3, viewer 100+), version check, numbered events, the kept document (`key/drop/clear/scope/own/gone`), `ask`, tokens (`bodies` and tokens made by a claim; busy, release, silence), motion with the slot byte written by the hub and owned types checked, newest packets for newcomers, `Outbox` | - |
| `engine/server/serverlog.py` | the always-on log: pages fetched, sockets (why they ended), tokens, the pages' life lines | - |
| `engine/server/serve.py` | https with a self-signed certificate (`~/.mumr/cert`), the app's folder and `/mumr/`, `/ws`, `/log`, `/info`, build stamp, the app's routes, `mumr.json` | hub, ws, serverlog |
| `engine/client/util.js` | `num`, `wrap`, `clone`, `Emitter` | - |
| `engine/client/link.js` | the WebSocket: join, reconnect with back-off, watchdog (4 s, ignoring a paused page), ping and round trip, the server's clock, close codes | - |
| `engine/client/align.js` | frames, `Space`, `Aligner` (the line-up with knobs, locks, save/load against an anchor, `rebase`), `Resets` | - |
| `engine/client/wire.js` | the packet registry, the common header, presence (`P`), JSON types (`M`), `Guard` | - |
| `engine/client/session.js` | the Document: kinds, built-in settings/players/frame/check/do, press routing, owned things and `request`, tokens, keyframes, pending own changes | util, link (handed in) |
| `engine/client/presence.js` | head and hands out (common frame) and in (own frame), everybody's hands for the simulation | session, wire, align |
| `engine/client/body.js` | a Body: claim on reach, busy while touching, send at a rate (slow when still), take only the holder's, `ask`/`do`, keyframes; policies `touch` and `owner` | session, wire |
| `engine/client/worldfeed.js` | a viewer: the document (a Session) plus every stream by server time, interpolated | session, wire, link |
| `engine/client/life.js` | the page's life log: numbered lines to `/log` at once (keepalive), resent, last lines in sessionStorage | - |
| `engine/client/hands.js` | a hand's 25 joints as a source on the floor plan, the pinch (select event, or tips < 22 mm, let go at 35 mm), fingertips for the line-up | - |
| `engine/client/follow.js` | where this player's menu floats: it stays while you are near and follows you on a lead when you walk away | - |
| `engine/client/menus.js` | menu layouts (`grid`), the hit test, panel axes, `Poke` (a fingertip arms a button from above, presses it at 1 cm, holds it until it is back up; `shape`: how far down it is), `Menus` (everyone's panel poses and info through `M`) | session, wire, align |
| `engine/client/anchor.js` | `Keeper`: the persistent anchor, reset events, settle, found again by its handle (the 10-22 fix) | util, align |
| `engine/client/lineup.js` | `LineUp`: Aligner + keeper + session + saving, its buttons (`lineUp`, `p1create` ...), rows and info for the menu, marks to draw | align, session, anchor |
| `engine/client/room.js` | the room: a headset's planes on its floor plan, the server's room in the common frame (uploaded once by the first headset when the server has none, or by the Upload button); `kind` (table, solid, wall ...), `support`, `ceiling` and `pushOut` for an app's physics | session, align |
| `engine/client/grab.js` | the gestures of a hand, for any app: a pinch and a fist (grips), pointing (a ray, and what it hits: `pointAt`), a flat hand as a platform (palm up or down), from anybody's hand sources | hands, room |
| `engine/client/model.js` | the room model: a small copy of the room to move things in (scale, the way between the room and the model, its handles, this page's hands at every open model) | grab, util |
| `engine/client/sysmenu.js` | the engine's own menu on the inside of the left wrist (folded: a 2 x 2 cm logo button; open: a card of six places, Home / Line up / Spot / Exit asks again, under a fold arrow; docs/WRIST-MENU-SPEC.md), shared like every menu (panel `wrist`, state in the menus' info.sys) | lineup, menus, follow |
| `engine/client/clicks.js` | the menu's two clicks (press, release), made on the fly with Web Audio and played from the button's place | - |
| `engine/client/host.js` | the host process (Node): the app's own simulation on the PC, holding what nobody touches | everything plain |
| `engine/client/all.js` | the browser's one-tag loader for all of the above | - |
| `engine/client/xr/*.js` | ES modules, THREE handed in: `session.js` (enter MR, resets, the `shared` probe, the anchor's XR calls), `input.js` (hands and controllers from the frame), `ghost.js` (ghost fingers), `players3d.js` (the others' hands, heads and feet, line-up marks and knobs), `panel3d.js` (a menu panel drawn from a grid), `room3d.js` (the room's outlines), `feet3d.js` (shoes), `handmask.js` (the hand cutouts), `handwall.js` (the hand window on a wall), `pointer3d.js` (pointing rays), `roommodel3d.js` (the room model), `app.js` (createApp) | the plain files |

## 4. The packets

Every binary packet: `u8 type, u8 sender slot (written by the hub), u32 sender clock (ms)`, then the body. Built in: `P` (2, presence:
head + up to 8 sources, a hand as 25 joints in mm; byte for byte Nudgy's), `M` (4, JSON). An app registers its own with
`wire.register({ type, name, pack, unpack, blend, token })`; a type that belongs to a token is named in the server's `owned` so that only
the holder is heard. Every receiver drops a packet older than the newest from the same sender (`Guard`).

The cube's packet (16, pps/cube/cube.js) is 56 bytes: x, y, z, the orientation as a quaternion, the velocity, the spin, flags (14 float32, the common frame); lend slerps the orientation.

### 4a. Physics (engine/client/physics.js, 2026-10-26)

Rigid boxes with a position, a quaternion, a velocity and a spin; M.physics.World steps them in fixed substeps (1/240 s, at most 5 mm of movement per substep, so a throw at 10 m/s cannot pass a table or a wall). A body touches the room by its corners against the floor, levels, walls and blocks (oom.js: tables and solid objects) and by the blocks' edges (sampled every 3 cm) against its faces. Sequential impulses give restitution (0.45, hard plastic) and Coulomb friction (0.45 static, 0.4 kinetic); mass is density (1050) times volume; a little angular damping and rolling resistance let it come to rest on a face; a body sleeps after 0.5 s of calm. Hands are kinematic: spheres (handSpheres) and a plate for a flat hand (plate), with the speed they had in the last frame (clamped to 4 m/s). World.hold is a motor towards a pose (a pinch or fist hold: it turns with the hand), elease keeps the speed and spin (a throw). Only the holder of a body's token simulates it; the others draw its packets (the network state wins). The design is docs/superpowers/specs/2026-10-26-physics-design.md.

Measured in Nudgy (2026-10-15): head and two full hands 325 B at 45/s, the loco's state 268 B at 45/s; about 130 kbit/s a headset. Round
trip through the PC about 12 ms; the problem is not the median but stalls on Wi-Fi (TCP waits for a lost packet).

## 5. The document's events

An event is `{ k, ...the app's fields, key?, drop?, clear?, scope?, own?, gone? }`. The kind (registered with the Session) says what it
does (`apply`) and how it is kept (`keep`, which adds the hub's fields before it is sent). The hub never reads the app's fields. Rules:

- An event with a key **says all of the thing** (send the whole mark again to change it). The hub keeps the newest per key, in order.
- `scope: 'slot'` things go when their player leaves; everything else stays (the room stays when its supplier leaves: Nudgy 2026-10-21).
- `own: true` makes it the sender connection's; `gone` is what everyone is told when that connection goes.
- A newcomer gets the kept events in `hello.doc` and applies them in order: the server's world is the world. The first player into an
  empty server publishes its own (`first`).
- Alone (no link), `emit` applies at once: the same code path.

## 6. Who simulates (tokens)

`bodies` (in `mumr.json`) always have a holder while anyone is here: the earliest player, then whoever reaches. Other tokens are made by
their first claim and fall to nobody when the holder leaves. A holder that says nothing for 2.5 s while someone else is alive loses its
tokens (a page that is not in front ticks once a second). `busy` (a hand is on it) blocks claims; the toucher never waits for the network:
it simulates locally with everybody's hands from the frame it touches, and the holder's state corrects small differences afterwards.

## 6a. The host

An app may have a host (`mumr.json` `"host": "host.js"`): the server starts `node engine/client/host.js` with the app's host module and starts
it again when it ends. The host joins in slot 15 with role `host`: not a player (not counted, no hands, no menu, marked `host` in hello and
`peer`), lined up by being the common frame. It runs the app's own plain simulation with everybody's hands. Bodies go to it first: when
their holder releases them (a body at rest that nobody of that page touches is released after 0.6 s), leaves or goes silent. A touch
still takes a body from it at once. So the world goes on, and stays where it was left, when every headset has gone.

## 6b. Coming back after a drop

A player's hello carries a `key`. When its connection goes (a Wi-Fi stall: the page gives up after 4 s; a reload), the hub keeps its
place for 10 s: the slot, its settings, line-up and owned things stay and the others are not told it left; only its tokens go to others
at once. The link rejoins with `{ resume: { slot, key } }` and gets the same slot back (`hello.resumed`), also while the hub still holds
the old connection (that one is closed). A page that closes on purpose sends `bye` and is gone at once.

## 7. Invariants

1. Everything in the world is shared: every player sees it and can interact with it; every PC viewer sees it.
2. Send in the common frame through `Space`; never a headset's own coordinates; never trust the slot byte.
3. Interaction is physical and literal: a touch is a touch, no gesture guessing.
4. A newcomer gets the current state; a leaver leaves nothing half there.
5. Alone, the same code path.
6. A page of another build is refused (and reloads itself): a headset running an old page explains most "half of it works" reports.
7. Logging runs all the time and does not depend on the frame loop.
8. Test with two pretend headsets in Node (`engine/test/hubfake.js`), then two tabs, then two headsets with the server log running first.
