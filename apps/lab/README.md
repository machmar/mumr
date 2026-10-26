# MUMR lab

The experiments of [docs/PLAN.md](../../docs/PLAN.md) section 3.1 in one app. The menu's **Experiment** button picks one (every player
sees the same). Everything it measures goes to the life log, so `mumr-server.log` has the numbers after the run.

```bash
node tools/run.js lab                  # headsets: https://<PC>:8443/   (check that apps/lab/mumr-server.log grows before anyone puts one on)
node tools/run.js lab --http           # PC rehearsal: two tabs /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40   (&room=demo for a room)
node --test "apps/lab/*.test.js"
```

| Experiment | What to do | What is logged | Pass (PLAN.md) |
|---|---|---|---|
| **pile** | Pick 10, 20, 30, 50 cubes (button *Cubes*), press *Drop the pile*, poke it, leave it | every 5 s: fps, frame time p50/p95 (ms), simulation ms per frame, how many cubes are moving | p95 under 13.9 ms (72 Hz) at 30 cubes; the pile comes to rest |
| **island** | Two headsets. *Reset* builds a stack of 5 (each cube has its own token, today's rule). One player pushes the bottom, the other lifts the top. A cube's colour is the player who simulates it | every second something happened: token hand-overs, jumps of a cube (> 2 cm), stack together or BROKEN | this is the baseline: it shows today's failure. Phase 5's islands pass when the stack moves as one with no jumps |
| **drift** | Mark a cross on the floor (a printed one). Line up, press *Start drift*, touch the cross with the index finger (rest it there 1.5 s) when the page says so: once a minute, ten times. Two players: both touch the same cross | every touch: mm from the first touch (dx, dy), the largest so far, and mm from the other player's touch of the same round; a missed round says so | under 2 cm after 10 minutes; if not, the anchor keeper needs a re-check timer (`engine/client/anchor.js`) |

Pile cubes are not shared (every page simulates its own, as before phase 5). The island's are shared with a body each (packet types 17-21).

## The screens

Three windows on the room's longest wall, side by side: the **hand window** (the engine's: every hand and its gesture), **Data** (the
numbers of the running experiment, with the pass line) and **About** (what the experiment is for, what to try, what passes: the table
above). Each is moved along the walls by its bar (pinch), by a fist on it, or in the room model (the menu's **Room model** button: the
model is mainly for rearranging the windows). Data and About are this player's own; with no room scan they
float and follow you like the menu. The menu's **Room model** button opens the room rearranger: move the cubes (or the viewer) in a
small copy of the room; **Show hand IRL** shows your hand full size where it reaches in.

## What it is and is not

- Boxes are 12 cm and on the engine's **physics** (`engine/client/physics.js`, since 2026-10-26): they fall, bounce like hard plastic, tumble,
  slide with friction, rest on each other (a stack of five stands; a heap comes to rest and sleeps), topple, and are knocked by a thrown box.
  Hands push, pinch and fist-grab them as the cube's do (a held box turns with the hand; a throw keeps its speed). No flat-hand platform,
  no kicking. The room's walls and tables work (`room.js`). The island's packets (17-21) carry orientation and spin (56 bytes).
- **Cost:** a heap of 30 boxes costs about 19 ms per frame in Node while it falls and 5 ms while it settles, then nothing (they sleep), so
  on a Quest the pile will be slow. The physics stops stepping once a frame has used 6 ms of it, and the world runs slow for that frame;
  the log line counts those frames ("physics cut short in N frames"). That count and the frame times are the pile's result now.
- The simulation is in the common frame, so every page's boxes are turned the same way whatever its line-up. Alone, or before lining up,
  the common frame is the page's own.
- Not here: `tools/stress.js` (PLAN.md 3.1, Node only, no headset) and the camera row.

| File | What it is |
|---|---|
| `mumr.json` | five bodies (`b1`..`b5`, packets 17-21) for the island |
| `index.html` | the page |
| `boxes.js` | the logic: `World` (boxes on the physics module), `Watch` (island numbers), `Drift`, `Perf`, the island's Body adapter, the menu. No THREE, no DOM |
| `app.js` | `createApp`, the drawing, the log lines |
| `app.test.js` | the logic in Node, with two pretend headsets |
