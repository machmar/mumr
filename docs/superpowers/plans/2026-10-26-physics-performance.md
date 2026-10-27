# Physics Performance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A heap of 30-50 boxes that the Quest can afford. Part A makes `engine/client/physics.js` several times cheaper without changing what it does. Part B moves the simulation to the PC (the host) by default, and the hub decides which contact group each Quest simulates and how many.

**Architecture:** Part A stays inside `physics.js`: the same API, the same tests and the same behaviour, with no allocation in the solver's inner loop, a broadphase in place of every-pair loops, and friction set up once per substep. Part B builds on the hub's tokens (`engine/server/hub.py`) and the host (`engine/client/host.js`). It needs a design doc of its own before any code (Task B0).

**Tech Stack:** Plain JS (UMD, no build), `node --test`, Python 3 standard library for the hub. No WebAssembly and no outside library (see "Why not WebAssembly").

**Spec:** `docs/superpowers/specs/2026-10-26-physics-design.md` (the module). Part B's spec is still to be written (Task B0).

**Rule 1 (CLAUDE.md) holds throughout:** everything is shared. Since `02dffe3` the lab's pile is one shared body (token `pile`, packet 22 with every box), simulated by the page whose hand is on it. So today one Quest simulates the whole heap for everybody, and Part B is what splits that work.

## Where we start (measured 2026-10-26, branch `physics`, Node on the dev PC)

A heap dropped as `apps/lab/boxes.js` drops it (`layout('pile')`), stepped at 72 Hz for 4 s, with no room and no hands:

| Boxes | Lab settings (`b3d77a2`): mean / p95 / max | Cube's settings (1/240 s, 5 mm): mean / p95 / max |
|---|---|---|
| 10 | 0.5 / 2.4 / 9 ms | 1.6 / 7 / 14 ms |
| 30 | 2.1 / 9.5 / 23 ms | 6 / 30 / 61 ms |
| 50 | 5.4 / 21 / 36 ms | 15 / 63 / 134 ms |

The Quest is several times slower than this PC, and its whole frame is 13.9 ms (72 Hz). The pile experiment's pass (p95 under 13.9 ms at 30 cubes) is out of reach today while the heap falls.

A CPU profile of the lab's run (self time):

| Where | Share | Why |
|---|---|---|
| `_sub` (the solver loop) | 22% | rounds × contacts; friction direction and its effective mass computed again in every round |
| `invI` | 14% | allocates arrays; called through `_eff` and `_apply` in every round |
| `add`, `cross`, `mulv`, `dot`, `sub` | 28% | each returns a new array, thousands of times per substep |
| garbage collector | 10% | the arrays above |
| `reach` | 6% | every pair, 2-3 times per substep, with `Math.hypot(...spread)` |
| `_boxBox`, `contacts`, `corners`, rest | < 5% each | |

So about 40% is allocation and GC, and most of the rest is the solver repeating work it could do once per substep.

## Why not WebAssembly

The hot code is plain arithmetic, which the JS engine compiles well once it stops allocating. A hand-written port to WASM would gain mostly what Part A gains, and it would cost a build step, a second copy of the solver for the host and the tests, and copying the hands and the room into WASM memory every frame. If Part A and Part B are not enough, the fallback is Rapier (`@dimforge/rapier3d-compat`, one JS file with the WASM inside, kept in the repo), at the cost of rebuilding the room's colliders, the hands, the plate and the hold motor on it.

## Global Constraints

- `physics.js` keeps its API (`makeBox`, `World` with `add/remove/setRoom/setHands/hold/release/step/contacts`, `quat`, `corners`, `handSpheres`, `plate`, `handQuat`, `registerPacket`), and body fields keep their names and types (`p`, `q`, `v`, `w` stay plain arrays: the cube, the lab, the packets and the tests read them).
- Every test passes after every task (`node --test` from the repo root), with no test changed in what it checks. Numbers may change only where a test pins an iteration-order detail, and the commit says why.
- Same results within float noise: the benchmark (Task A0) also prints a checksum of the rest state, which stays within 1 mm and 1° per box of the baseline.
- No build step, no dependency, UMD style, no THREE or DOM in `physics.js`.

---

## Part A: the solver, without changing what it does

### Results (2026-10-26, not yet on a headset)

A0-A3 are built, A4 in part, A5 step 1 checked; nothing is committed (git was set aside that day). Measured with `tools/physbench.js`, the old
`physics.js` and the new one run one after the other (`--module`) in the same minute, on a dev PC that was busy (load ~18), so the absolute
numbers are high and only the comparison counts:

| p95 ms a frame, lab settings | before | after |
|---|---|---|
| 10 boxes | 1.3-1.8 | 0.6 |
| 30 boxes | 9.5-10.2 | 3.4-3.5 |
| 50 boxes | 23.8 | 5.6-6.0 |
| 30 boxes, room and a sweeping hand | 10.4-13.3 | 6.0 |
| 50 boxes, room and a sweeping hand | 30.8-35.2 | 12.5 |

The mean of the 50-box heap fell from 6.3 to 1.5 ms. Earlier, on the PC idle, the 50-box p95 was 5.3 ms. All tests pass (164; the two of
`net.test.js` fail on Linux as before: they start the server with `py`, the Windows launcher).

What changed in `engine/client/physics.js`, and how it differs from the steps below:

- **A0:** an exact checksum of a heap is not possible (a falling heap is chaotic: one float rounded another way gives another heap). physbench
  compares four small scenes box by box (`--save`, `--compare`: a cube dropped on a corner, a cube thrown across the table, a stack of five, a
  finger pushing a cube) and the heaps by their numbers (how many sleep, the worst overlap, the top and mean height). `--module` measures
  another copy of the file; a warm-up runs first.
- **A1:** the contacts' numbers, every body's velocity and spin and its world inverse inertia (a 3 x 3 matrix, once a substep) are in flat
  `Float64Array`s; the rounds are arithmetic on them and the bodies get their velocities back in place. All four scenes and the heaps came
  out **identical** to the old module (0.00 mm). 50 boxes: p95 25.6 -> 8.8 ms.
- **A2:** every contact has three fixed rows (the normal and two directions along the surface, the first along the way it slips when the
  substep starts), each with everything a push along it does worked out once. Friction is the pair of the two clamped to `mu J`. The
  scenes moved (the thrown cube ends 9 cm and some degrees elsewhere after a 2 m tumbling slide; it rests flat, at the same time, as
  before); every physics test passes unchanged. The heap of 50 now sleeps completely (42 of 50 before) with less overlap (0.5 mm, was 2.9).
- **A bug found on the way (fixed):** a sleeping box that was the *first* body of a box-box contact took impulses while asleep and was
  counted as movable though it did not move: a box on it was not carried, sank, was pushed out, bounced and woke its neighbours, again and
  again (with A2 four boxes of the 30-pile never slept). Now a contact is turned so that the sleeping box is the other body, which the solver
  treats as a fixed surface (`awakeFirst`). Test: `a box set on a sleeping box is carried by it, and the sleeping box is not pushed` (the old
  module fails it: the bottom box wakes and moves 0.5 mm, the top sinks 0.9 mm).
- **A3:** built with A1 (the pair loops were rewritten anyway): `_grid` puts the bodies in cells as wide as the widest reach and lists each
  body's candidates from the 27 cells around it, in index order, so the pairs come in the same order as before (the solver's result depends on
  it). Below 12 bodies it lists every one. Test: `the grid finds the same pairs, in the same order, as a loop over every pair` (5, 40, 200
  random boxes, some asleep).
- **A4:** `contacts` was 10% of the room-and-hand profile, so it was done in part: `room.js` already keeps walls and blocks per room (`prep`),
  so step 2's cache was there; new is the skip of every wall and block too far from the box for a corner to touch it (same results, it only
  skips checks that cannot give a contact; it matters with a real scan's many planes). Step 3 (corners once for both calls) was not done.
- **A5 step 1:** the lab's settings stay as they are: at today's settings 30 boxes are at 3.4-3.5 ms p95, so finer ones do not fit under 3 ms.

What is left in the profile is the solver's own arithmetic (`_sub`, `_rowVel`, `_rowPush`: about half), `contacts` (9%), the grid (6%) and the
garbage collector (8%, from the contacts' objects). More speed now means less work, which changes behaviour: fewer points per box-box
contact (up to 8 today; 4 is usual), fewer rounds for big heaps, or not solving a group at rest at all (Part B's islands).

### Task A0: The benchmark as a tool

**Files:**
- Create: `tools/physbench.js`

- [x] **Step 1:** Write `tools/physbench.js`: arguments `--n 10,30,50`, `--settings lab|cube`, `--room` (a table and two walls from `engine/test/room.test.js`'s fixtures), `--hands` (one hand of 25 joints sweeping through the heap). For each n it drops the heap as `boxes.js` does, steps 4 s at 1/72, and prints mean / p95 / max ms, the first second's mean, how many sleep at the end, and a checksum (positions rounded to 1 mm, rotations to 1°).
- [x] **Step 2:** Run it with and without `--room`/`--hands` and paste the table into this file under "Where we start" (the room and hands cases are not measured yet).
- [ ] **Step 3:** Commit: `tools: physbench, the physics benchmark`.

### Task A1: No allocation in the solver rounds

**Files:**
- Modify: `engine/client/physics.js` (`_sub`, `_rel`, `_eff`, `_applyC`, `_apply`, `invI`)

- [x] **Step 1:** Give each contact its numbers once per substep, as plain fields: `rax, ray, raz`, `rbx, rby, rbz`, the normal `nx, ny, nz`, and `ra × n`, `invI_a(ra × n)` (and the same for b). `Kn` from those.
- [x] **Step 2:** Rewrite the round loop with scalar arithmetic only: the relative velocity, the normal impulse and applying it to `v` and `w` in place (`b.v[0] += ...`, no `add`/`mulv`). `invI` gets a version that writes into three numbers instead of returning an array.
- [x] **Step 3:** Replace `Math.hypot(...a)` everywhere in `step`, `_sub` and `setHands` with `Math.sqrt(x*x + y*y + z*z)`.
- [x] **Step 4:** Run the tests and `tools/physbench.js`. Expected: same checksum, the 50-box p95 at least 2× lower. Commit: `physics: no allocation in the solver rounds`.

### Task A2: Friction set up once per substep

**Files:**
- Modify: `engine/client/physics.js` (`_sub`)

- [x] **Step 1:** At the start of the substep, give each contact two fixed tangent directions `t1`, `t2` perpendicular to `n`, with their effective masses `Kt1`, `Kt2` (and their `ra × t`, `invI(ra × t)`). In the rounds, solve the two tangent impulses and clamp the pair to the friction cone `mu * J` (static or kinetic by the slip speed, as today).
- [x] **Step 2:** Warm start keeps `Jt` as the two numbers; turn the stored ones into the new tangents (`Jt · t1`, `Jt · t2`) when the normal moved a little.
- [x] **Step 3:** The friction tests (slide distance, incline at atan(μs), rest on a corner drop) must pass unchanged. Run physbench. Commit: `physics: two fixed friction directions per contact`.

### Task A3: A broadphase

**Files:**
- Modify: `engine/client/physics.js` (`_sub`)
- Test: `engine/test/physics.test.js`

- [x] **Step 1: Write the failing test:** `the pairs from the grid are the pairs from every-pair`: 200 random boxes (random sizes up to 0.3 m, some asleep), the list of pairs within `reach` from the new grid equals the list from the old double loop.
- [x] **Step 2:** Once per substep, put every body into a hash grid (cell = the largest body's diagonal + `MARGIN`, key from the integer cell coordinates) and list the candidate pairs from each cell and its 13 forward neighbours. Keep the pair list on the world and use it for all three loops that today go over every pair: the wake check, the box-box contacts and the position correction.
- [x] **Step 3:** Run the tests and physbench. Commit: `physics: a grid instead of every pair`.

### Task A4: Less work for the room and the hands

**Files:**
- Modify: `engine/client/physics.js` (`contacts`), maybe `engine/client/room.js` (`walls`, `blocks`)

- [x] **Step 1:** Measure first: physbench with `--room --hands`. Do this task only if `contacts` is over 10% of the profile there.
- [x] **Step 2:** Cache `walls(room)` and `blocks(room)` (and each block's `xy`) on the world when the room is set, not on every call. Skip a body's walls and blocks by a bounding-box test before the 8 corners.
- [ ] **Step 3:** In `contacts`, compute the corners and `conj(q)` once and reuse them in the second pass (`_sub` calls `contacts` twice per substep when something touches).
- [ ] **Step 4:** Tests and physbench. Commit: `physics: the room's walls and blocks once per room`.

### Task A5: Settings and the pile on the headset

**Files:**
- Modify: `apps/lab/boxes.js` (`PHYSICS`), `docs/PLAN.md`

- [x] **Step 1:** With A1-A4 in, try the lab at the cube's finer settings (substep 1/144, `maxMove` 0.01) in physbench. Keep the finest settings whose 30-box p95 is under 3 ms in Node (a guess at what leaves the Quest room for drawing; adjust after the headset run).
- [ ] **Step 2:** Run the lab's pile on a headset at 10, 20, 30 and 50 boxes (the page logs fps, frame p50/p95 and simulation ms every 5 s). Write the numbers into PLAN.md's section 3.1.
- [ ] **Step 3:** Commit: `lab: physics settings after the speed-up; pile results`.

**Part A is done when:** every test passes, physbench's checksum matches the baseline, and the 50-box p95 in Node (lab settings) is under 5 ms. If the headset still misses 13.9 ms at 30 boxes, the drawing is measured next (`Perf` gets a render time), before anything else in the physics.

---

## Part B: the PC simulates, the hub decides (phase 5)

### Task B0: Design doc first

**Files:**
- Create: `docs/superpowers/specs/2026-10-2x-many-bodies-design.md`

It answers these questions, with Marek's decisions marked as in the physics spec:

1. **The group.** Bodies that touch (or rest on each other) form a contact group, and a group has one token. Who works the groups out: the holder's physics (it has the contacts) and sends them to the hub, e.g. `{t:'groups', groups: [[ids], ...]}`. The hub today never reads an app's fields; this is a new kind of message, owned by the engine and not the app.
2. **Who simulates.** The host by default (the PC is several times faster and has no frame to keep). A Quest takes a group's token at once when a hand reaches it (today's rule: the toucher never waits) and gives it back when its hands have left and the group is still for 0.6 s (today's `restMs`).
3. **The load cap.** Each page reports its simulation ms per frame (a number in its ping). The hub gives a Quest no more than a budget (a starting guess: 3 ms) and keeps the rest of a big group on the host: what splitting a group means for the bodies at the seam is the hard question here (they push across two machines).
4. **Merging and splitting.** When a group held by one machine touches a group held by another, the hub gives the merged group to one of them (the toucher's first, then the host). The other's last state goes to it as the first packet. Pass: no jump over 2 cm (the lab's island watch).
5. **The packet.** Packet 22 already carries a whole pile; it becomes one packet per group (an entity list, `token` per packet), with nothing for sleeping bodies. Size and rate for 50 bodies over Wi-Fi.
6. **The host's physics.** The host runs the same `physics.js` and the same app module, so the host needs the room (it has it: the room is in the document) and everybody's hands (it has them: presence).

### Task B1: The host simulates everything nobody touches

- [ ] The lab's pile on the host: `apps/lab/host.js` steps the World with everybody's hands and holds the `pile` token while nobody touches it (packet 22 as it is). Pages draw what they receive; a touch takes the token as today. Measure the host's step time and the network rate with `tools/standin.js` players (packet 22 is 4 + 56 bytes a box: 2.8 kB for 50 at 45/s).

### Task B2: Groups and their tokens in the hub

- [ ] `hub.py`: tokens per group, `groups` messages from the holder, merge and split, a group goes to one holder. Python tests first (`engine/server/tests/test_hub.py`), then `engine/test/hubfake.js` with two pretend headsets: a stack handed over, a sleeping body woken by a far player's hand.

### Task B3: The load cap

- [ ] Pages report simulation ms; the hub keeps a Quest under its budget. Test: a pretend headset that reports 10 ms is given no new group.

### Task B4: The group packet

- [ ] One packet per group (generalising the lab's packet 22), its token in the header (NOTES item 4), the hub's per-entry token check. `tools/stress.js` (PLAN 3.1): 4 players × 30 bodies, no queue growth, delay under 30 ms on localhost.

### Task B5: Two headsets

- [ ] The lab's island (one pushes the bottom, one lifts the top) and a pile of 50 that both poke. Pass: the stack moves as one with no jump over 2 cm, and both Quests stay under 13.9 ms p95.

## Order and size

| Task | Depends on | Size |
|---|---|---|
| A0 benchmark | - | an hour |
| A1 no allocation | A0 | half a day |
| A2 friction | A1 | a few hours |
| A3 broadphase | A0 | a few hours |
| A4 room and hands | A0, measured need | a few hours |
| A5 settings, headset | A1-A4 | one headset session |
| B0 design | A5's numbers | a talk with Marek |
| B1-B5 | B0 | phase 5: several days |

Part A is useful alone, and it makes the host in Part B cheaper too. Part B starts only after A5's headset numbers are in, because they say how much the Quest can simulate by itself.
