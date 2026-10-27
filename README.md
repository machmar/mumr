<p align="center"><img src="docs/brand/mumr-logo.svg" width="140" alt="MUMR logo"></p>

# MUMR: multi-user mixed reality

An engine for shared mixed-reality worlds in the browser: two to four people in one room wear headsets (Quest 3, Quest Pro; a WebXR page,
nothing installed), see the same virtual things in the same real places, and touch them with their hands. A PC on the same network serves
the pages and keeps the shared state; PC pages can watch the whole world live.

Extracted from **Nudgy** (KTE Project2, a toy loco tried out in mixed reality), where it ran on two headsets from 2026-10-13 to 2026-10-22.
**Status 2026-10-22:** the core, everyone's menus, the XR parts (hands, line-up, anchor keeper, ghost hands, panels) and the cube demo
are built and tested (70 Node tests, 39 Python tests); the template app and the cube were rehearsed in browser tabs with the PC view. **Nothing
of MUMR has run on a headset yet**: the cube is ready for that ([apps/cube/README.md](apps/cube/README.md)).
See [docs/PLAN.md](docs/PLAN.md).

## The idea

| Kind | What | Example |
|---|---|---|
| **Document** | numbered JSON events; the server keeps the newest of each thing; a newcomer gets it all | settings, marks, the room, who is lined up |
| **Body** | simulated on every page with everybody's hands; one page (the token holder) sends the state; a touch takes the token at once | a ball, a loco |
| **Presence** | a stream only its owner writes | head and hands, where the menus float |

One common floor frame from two touched floor spots; everything is sent in it. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Try it

```bash
npm install
node tools/run.js _template --http
```

`npm install` fetches the one dependency, [Jolt Physics](https://github.com/jrouwe/JoltPhysics) (`jolt-physics`, MIT, the C++ engine built to WebAssembly). Only the PC's host process
uses it, to simulate what nobody is touching (the cube, the lab's cubes); the headset pages and the server load nothing. Without it the host falls back to the
built-in physics (`engine/client/physics.js`), which is slower and has no stacking to speak of.

Open `http://localhost:8766/?name=A&frame=0,0,0` and `/?name=B&frame=1,0.5,40` in two tabs. Press Count in one and watch the other. For headsets, leave out `--http` and open the printed
`https://` address on each (accept the certificate once).

## Layout

```
engine/server/    ws.py  hub.py  serverlog.py  serve.py        Python 3, standard library only
engine/client/    util link align wire session presence body worldfeed life hands follow menus anchor lineup   plain scripts, no build step
           all.js (one tag for the browser), index.js (Node), physics-jolt.js (Node only: the physics on Jolt, used by the host)
engine/client/xr/ session input ghost players3d panel3d   ES modules for WebXR, THREE handed in
engine/test/      Node tests (hubfake.js: a pretend server for several pretend headsets in one process)
engine/server/tests/   Python tests
apps/      _template (the smallest app; tools/new-app.js copies it), cube (the XR demo, with a PC view), lab (experiments: a pile of any number of cubes, a stack, drift), jenga (a game: a shared tower, one shared menu, scoring, a replay, a soundtrack)
tools/     new-app.js (make an app), run.js (run one by name)
docs/      ARCHITECTURE.md  HOWTO-NEW-APP.md  PLAN.md  NOTES.md (what was learnt, and what was streamlined)
```

## Tests

```bash
node --test
py -3 -m unittest discover -s engine/server/tests -p "test_*.py"
```

`engine/test/net.test.js` starts the real server on port 8798 (plain http, this PC only).

## Rules for apps

Everything in the world is shared (every player sees it and can touch it, every PC view shows it); send in the common frame through
`align.Space`; interaction is physical (a touch is a touch); logging runs all the time. How to build one: [docs/HOWTO-NEW-APP.md](docs/HOWTO-NEW-APP.md).

Line endings are LF (`.gitattributes`). There is no login on the server: anyone on the network can open the pages. MIT licence (LICENSE).
