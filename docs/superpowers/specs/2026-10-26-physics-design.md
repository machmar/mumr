# Physics for MUMR: design

Status: proposed 2026-10-26, from a talk with Marek. **Built the same day on the hand-made module (`physics.js`), then moved to Jolt on the PC host (see "Jolt" at the end: it replaces "own solver, no library").** "Marek said" marks what he decided; "my call" marks what I chose and he has not seen.

## Why

Marek's words about the cube today: falling, sliding and "being in the same rotation all the time" feel "really stupid". The cube (`apps/cube/cube.js`) can only turn flat on the floor (a yaw), falls with a hand-tuned rule, and slides with an exponential drag. The goal behind MUMR (PLAN.md) is "a virtual physical world where all virtual objects behave as if they were physical". So this is the start of a physics layer every app gets, and the cube is its first user. Marek said: "start of all physics for the future, but don't go crazy just yet, but begin on a global implementation".

## What he wants to see (Marek said)

- A drop falls with real acceleration (g = 9.81 m/s²).
- It bounces like hard plastic on a hard floor, and tumbles: a corner or an edge hit makes it spin.
- It slides with realistic friction and stops; "very close to reality", friction and falling included.
- Its mass comes from its size (a density), so a bigger cube is heavier.
- A throw keeps the hand's speed and spin when it lets go.
- While held, it turns with the hand (it can be held at an angle, then let go).
- "Rest sounds good": the rest of my playback (rattles to rest within a second or two; other players see it tumble too; the network packet carries orientation and spin).

## Goals

1. A shared rigid-body module, no THREE and no DOM (same style as the other engine files: `engine/client/physics.js`, namespace `M.physics`, runs in the headset page, the Node host process and the Node tests).
2. Boxes first (the cube), with the design leaving room for other shapes later (spheres, a second size) without changing the module's shape.
3. Full 3D state per body: position, orientation (quaternion), linear and angular velocity, mass and inertia from size and density.
4. Contact with the room (floor, table tops, walls, the room's solid objects) and with hands as moving obstacles, replacing the cube's 1 cm stepping and "round thing" wall rule.
5. The cube moved onto this module, with its hold, push, flat-hand carry and room-model steering kept working as they are today (Marek tested them on 2026-10-25; they must not get worse).
6. Tests in Node that check the physics against numbers (below), because Marek can only try it on a headset later.

## Non-goals (for now)

- Stacks of cubes, cube-to-cube contact, sleeping islands. `apps/lab/boxes.js` has a simple version for the pile experiment; the new module must not make that harder, but it does not replace it yet.
- Soft bodies, ropes, joints, fluids, rolling spheres on slopes, spinning tops.
- Sounds, haptics, particle effects.
- Moving Nudgy onto it.
- A physics library from outside (see "My calls").

## Anti-goals (a failure even if it technically works)

- A cube that tunnels through a wall or a thin table, or sinks into the floor, at throwing speed (up to about 10 m/s).
- A cube that jitters or never comes to rest.
- A cube that rests balanced on an edge or a corner, or that other players see jump when it changes hands (see "Who simulates it").
- Frame time on the Quest going up visibly: the headset runs at 72 Hz (13.9 ms per frame) and the cube is a small part of it.
- Hands that feel weaker than today: a one-finger push, a fist grab and a pinch hold must work as they do now.

## Constraints

- No build step, no install on the headsets: plain JS files in the UMD style the other engine files use (`(function (M) { ... })`).
- Runs in the same code on the page and in the host process (`apps/cube/host.js` simulates the cube while nobody touches it) and gives close answers there.
- The room is given as planes in the page's floor plan (x, y on the floor, z up): `engine/client/room.js` has `support`, `ceiling`, `pushOut`, `surfaces`, `blocks`, `walls`; the new module may add what it needs there.
- The network: one token per body that follows touch; the holder sends the state (packet 16 for the cube, today 32 bytes: x, y, z, yaw, vx, vy, vz, flags). The new packet adds orientation and angular velocity.
- Hands arrive as sources with points and joints in the floor plan, with the engine's gestures (`engine/client/grab.js`): pinch, fist, point, flat hand.

## The design

### The module (`engine/client/physics.js`)

- **Body:** `{ size [sx, sy, sz] (a box), density, mass, inertia (box formula, diagonal in body frame), p [x, y, z], q [x, y, z, w], v, w, restitution, friction, asleep }`. Mass is `density * sx * sy * sz`.
- **World step:** `step(dt)` runs fixed substeps (my call: 1/240 s; with Quest at 72 Hz that is 3 or 4 per frame) so a thrown cube moves less than a centimetre per substep. Semi-implicit Euler for velocity and position; orientation integrated from the angular velocity and renormalised.
- **Contacts:** a box against a surface is found by testing its 8 corners (and its edges where a table edge hits a face) against the room: horizontal planes (floor, table tops, objects' tops) and vertical ones (walls). A contact has a point, a normal, a depth. This is enough for one cube and tables; it is not a general convex solver.
- **Response:** sequential impulses (a few iterations per substep): the normal impulse with restitution, the tangent impulse with Coulomb friction (static and kinetic), positional correction for depth. This gives the real behaviours Marek named: bounce height from restitution, sliding distance from friction, tipping and tumbling from off-centre contacts.
- **Hands:** each hand joint or fingertip is a small sphere with a measured velocity (as `_vel` does today, clamped) that pushes a body through the same impulse code, as a kinematic body of infinite mass. A pushed cube takes the hand's velocity and spin from where it is hit. A flat hand (grab.js platform) is a thin kinematic plate, so a cube on it carries, slides and slips off naturally as it tilts (this replaces the glued carry and the "drops through at 45°" behaviour).
- **Hold:** a pinch or fist hold is a velocity motor: the body is driven towards the hand's position and orientation (the hold offset kept in the body's frame), with a limit on the speed and force, stopped by contacts (so it still stops at walls) and let go after the break-away distance as today.
- **Throw:** on release the body keeps its current velocity and angular velocity (the hold motor already makes them the hand's).
- **Rest:** a body whose linear and angular speeds stay under small thresholds for 0.5 s sleeps (no stepping, no packets) and wakes on a touch or when the surface under it changes.

### The cube (`apps/cube/cube.js`)

- A cube is a body of 12 cm (size taken from the menu if it has one), the density as below.
- Its Body adapter packs the new packet: position, quaternion, velocity, angular velocity, flags. The wire `blend` interpolates the quaternion (slerp) for other players. The drawing (`apps/cube/draw.js`) takes the full orientation.
- The existing hand code (push, closing-on, hold, flat hand, steer from the room model) is rewritten on top of the module; its tests in `engine/test/cube.test.js` are updated, not dropped.

### Who simulates it (my calls; this is today's rule, kept)

- Only one page or the host simulates a body at a time: the holder of its token (`mumr.json`: the token `cube` follows touch; the host takes it when nobody touches it). **The network state wins**: other players do not simulate the cube, they draw the holder's packets (position and orientation interpolated, the quaternion by slerp). So there is no requirement that two devices end in bit-identical rest states, and no determinism requirement across Quest and Node. The rest state is whatever the holder reaches.
- A hand-over (a touch by someone else, a release, a wake from sleep) sends the whole state (position, orientation, both velocities) to the new holder as the first packet, and the new holder continues from it. Two players touching at once: the token goes to one of them as it does today (the hub decides); the other's hands are still drawn but push nothing until the token comes.
- A sleeping body is kept by the host (or the last holder) and not sent; a touch by anyone wakes it and passes the token.

### What stays the same for hands (my calls)

`engine/test/cube.test.js` is the bar for the hand behaviours (a one-finger push moves it; a pinch within 3 cm or a fist within 8 cm holds it; a hand closing on it does not push it; a hold that is pulled 30 cm away lets go; the cube follows the room model's steering). The tests may change in their numbers, not in what they check, except two: the flat-hand carry (now a plate, so it slides off by contact) and the drag/stop distances (now friction). Kept as today: fingertip and joint reach 1.2 cm, hand speed clamp 4 m/s, the hold spring (spring 20, hold speed 5 m/s, break-away 0.3 m). A hold motor limit on force is a guess to tune on the headset.

### Room limits (my calls)

The room is what `room.js` already assumes: level planes (floor, table tops, object tops, ceiling) and upright planes (walls, object sides), in the floor plan. A plane the headset reports that is neither is ignored, as today. Fast bodies are covered by capping a body's motion per substep at 2 cm (subdividing the substep when it moves faster), so a 10 m/s throw cannot cross a 5 cm table top or a wall.

### Settling (my call)

Realistic friction and restitution alone can leave a cube balanced on an edge for a while. A small angular damping and a rolling-resistance term, both per-body settings, bring it to rest on a face; the test "dropped on a corner" checks that it ends on a face.

### Other apps in the repo (my calls)

`apps/lab/boxes.js` stays as it is. The new module is designed so that its body type could replace the lab's boxes later, but nothing in the lab changes now. The performance budget is one cube under 1 ms per frame on the Quest, measured in Node (about 1 ms in Node is far less on the Quest's frame budget of 13.9 ms) and checked on the headset afterwards; the host has one cube.

### Numbers the tests must hit (my calls, tunable)

| Check | Pass |
|---|---|
| Free fall from 1 m onto a floor | time within 1% of √(2h/g) |
| First bounce height from 1 m | e² × 1 m within 5%, with e = 0.45 |
| Slide: 2 m/s on the floor | distance within 5% of v²/(2·μ·g), with μ = 0.4 kinetic |
| Incline (a table top tilted is not in the room model; test the module with a tilted contact plane) | slips above atan(μ_static) and not below, within 1° |
| Energy | never increases in a step without a hand or a motor |
| Thrown at 10 m/s at a 5 cm table top and at a wall | no pass-through, no sinking |
| Dropped on a corner | spins after the hit, comes to rest flat within 3 s |
| Rest | asleep within 2 s of settling, with no movement of more than 1 mm afterwards |
| Same drop run twice, and on the host and in a page | the same rest state |
| One cube | the step costs well under 1 ms (measured in Node, as the pile experiment measures its own) |

## Decided by Marek vs my calls

Decided by Marek: everything under "What he wants to see"; physics is for all future apps, built globally but not gold-plated.

My calls (he has not seen them):
- **Own solver, no library.** A 3D engine (Cannon, Ammo) is far larger than the whole engine, and the headsets load pages with no build step. For boxes against flat planes a small impulse solver is enough.
- **Density 1050 kg/m³ (solid ABS-like plastic):** a 12 cm cube is about 1.8 kg. Restitution 0.45, friction 0.45 static and 0.4 kinetic. All three are per-body settings.
- **Fixed substep 1/240 s.**
- **Corner-against-plane contacts** instead of a general box-box solver.
- **The flat hand is a plate** instead of today's "glued" carry. The tilt-drops-through case then happens through the contact (the cube slides off), which is the realistic version of what Marek accepted on 2026-10-25.
- **The packet grows** from 32 to 56 bytes (quaternion and angular velocity added); the old packet 16 layout is not kept (no one else uses it).
- **Order of work:** the module and its Node tests first, then the cube on it, then the page and the host, then a headset run.

## Left to the builder

File layout inside `engine/client/` and `engine/test/`, the iteration counts and thresholds that make the checks pass, the order of the contact tests, how the host module and the page share one stepping rule, and how the room's tables and solid objects are turned into contact surfaces (reuse `surfaces` and `blocks`).

## What Marek checks on a headset afterwards

Drop the cube from head height and from a table; push it with one finger; throw it; put it on a flat hand and tilt; hold it at an angle and let go; watch it from the other headset (a tumble that rests the same way on both); the PC view.

## Jolt (Marek, 2026-10-26: "go with Jolt")

What changed, and why: the hand-made solver was too slow and too soft for piles (a heap of 30 cost 19 ms a frame while it fell), and Marek moved all the simulation to the PC ("the headsets only send finger tracking"). With the simulation in one Node process the headset constraint that ruled a library out ("no build step, no install on the headsets") is gone, so the call "own solver, no library" is replaced: Jolt Physics (MIT, C++, built to WebAssembly: the `jolt-physics` npm package) runs the bodies of the **host** (`engine/client/physics-jolt.js`, `M.physics.JoltWorld`).

What stays: the interface (`add, remove, setRoom, wake, setHands, hold, release, step`), the plain `makeBox` bodies, the packets (16 for the cube, 17-22 for the lab), the hand code in `cube.js` and `boxes.js`, the headset pages with the built-in `World` (they only draw what the host sends) and the numbers table above (`engine/test/physics-jolt.test.js` holds Jolt to the same checks, with wider tolerances: bounce within 10%, slide within 10%).

What differs (Marek has these in mind from the lab runs):
- **Hands** are kinematic bodies that move at the hand's own smoothed speed from its headset's clock (`presence.js`), never at the speed of the jumps of their position; whatever is left of the distance to the hand is closed by a silent shift (at most 2 m/s worth a call). A contact with a hand does not bounce (flesh, not plastic): a cube leaves at the hand's speed, not 1.45 times it. The first Jolt run (hand speed from position jumps, with packets arriving in bunches 170 ms apart) launched the cubes; this is the fix, and `physics-jolt.test.js` holds it ("a hand whose packets come in bunches ...").
- **Friction** is one number per body (the kinetic one, 0.4); there is no rolling resistance (a cube comes to rest by its angular damping and by Jolt's sleeping).
- **The room** is static bodies: the floor, walls as 20 cm thick slabs, tables and solid objects as the convex hull of their outline (a hollow outline is filled); rebuilt when the room's numbers change.
- **Capacity**: Jolt's limits are fixed when it is made; `JoltWorld` makes the same world again twice as big from the bodies' plain state when they come near the limit (1024 bodies to start). The lab has no limit on the number of cubes; the pile packet carries at most 64 boxes (the longest-waiting first).
- **Fallback**: with no `jolt-physics` installed the host logs "no Jolt" and runs the built-in World.

Left open: the cube on Jolt has been tested in Node only (eight of the nine cube tests pass on it unchanged; the ninth compares a heading that is undefined when the cube lands with its x axis up); a headset run decides how it feels. A hand has an infinite mass here (a cube leaves at the hand's full speed); a finite "hand weight" (a fraction of the speed) is the knob to turn if a quick swipe still sends cubes too far.

