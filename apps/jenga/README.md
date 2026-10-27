# MUMR Jenga

A shared Jenga tower in the room, for two to four players (and a PC that watches). The 54 wooden blocks are on the engine's physics, you pull
them out with a pinch (or push with a finger) and put them on top; a wooden die decides which colour. The PC host plays the game: it keeps the
score, spots the block that was pulled and the one that fell, and when the tower comes down it freezes the moment and replays it.

```bash
node tools/run.js jenga                  # headsets: https://<PC>:8443/      (the server starts the host; it needs Node and `npm install` for Jolt)
node tools/run.js jenga --http           # PC rehearsal: two tabs /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40, and the PC view /view.html
node --test "apps/jenga/*.test.js"
```

## How to play

1. **Move the game here** (on the board, in front of you), choose the **Size**, press **Start game**. Everybody who is in the room plays; a match is three rounds.
2. **Roll the die** on the tray of the console (pinch it and let go; a die that lands cocked, or when no block of its colour can be taken, is rolled again).
3. **Pull a block of that colour** from a level below the highest complete one (the gold line round the tower is the limit), and **put it on top**. A clean move scores
   1, 2 if the block came from the bottom third (levels 1 to 6). A block of the wrong colour, or from a level that is not allowed, scores nothing.
4. The player on turn when a block other than the pulled one reaches the ground **topples the tower: -3**, and the round is over (if it falls within three seconds of a
   placement it is the placer's). The highest total after three rounds wins.
5. **The replay.** When the first block hits the ground everything freezes where it is (the block that did it glows, TIMBER!), rewinds two seconds, plays them again
   at 0.3x, and the collapse finishes in real time. Anybody can **Skip the replay** on the board.

| Size | Tower | The block | Stands on |
|---|---|---|---|
| Normal | 27 cm | 15 x 25 x 75 mm, a real one | a plinth 72 cm high (a table's height) |
| Huge | 75 cm | 42 x 69 x 208 mm | a plinth 40 cm high |
| Giant | 1.5 m | 83 x 139 x 417 mm | a plinth 6 cm high (it grows as the game goes on: stand on the floor) |

## One menu for everybody (the board)

There is no menu of your own: the board standing on the console is **one thing for everybody** (engine `boards`, `createApp({ menu: false })`; the wrist menu is the
engine's and is untouched). It faces the player who put the game down; everybody can press it and everybody sees a button go down. Its buttons: Start game / Next round /
New match, Roll the die again, Block lost? (puts the pulled block back on the plinth), Skip the replay, Size, Move the game here, Music - +, Room dim - +, My ghost fingers. The scoreboard
is a scroll next to it: names, the points of each round, the total, whose turn it is.

## Rule 1

Everything is shared and physical. The tower, the die and the replay are bodies the host simulates and sends (packet 23, all 55 bodies, 22 bytes each, 45 a second while
anything moves); the state (phase, turn, roll, scores, the pulled block, the allowed level, the fall and its trail) is one kept event of the document (`jstate`);
the console, plinth, tray, board and scoreboard are worked out on every page from that state (`spec.js layout`); the furniture is also in the host's physics
(`spec.js furniture` adds it to the room's planes), so the die rolls on the same tray everybody sees. No page simulates anything. The one thing that is not a thing in
the room is the sound: each headset plays the music itself, from the same shared state (the same scene, the same track), and the volume is a shared setting.

## The soundtrack

You supply the tracks (ambient). Put them in `music/<scene>/`, run `node apps/jenga/music/build-manifest.js`, and the pages crossfade between them over 30 s, with swells
at tense moments. What belongs in which scene: [music/README.md](music/README.md).

## The room's focus

The engine can darken and grey the real room for everybody (`engine/client/dim.js`: the passthrough on every headset, the picture on every webcam page, the same look at the same
moment; the virtual world is drawn over it at full strength). Jenga uses it as a focus: the room recedes for the die, closes in with the tension of a pull, goes out **at the moment
the tower falls** (the freeze: the room grey and nearly black, the tower in colour) and comes back slowly after. [focus.js](focus.js) has the look of each phase and what tension adds;
the host asks for it (it sees every phase and block; ten times a second it reads the tension off the tower, the same `Tension` the music uses) and asks only when the look changes by a
step of 0.05, so the document is not a stream.

| Moment | Dark | Grey | Takes |
|---|---|---|---|
| lobby, end of the match | 0 | 0 | 2.5 s / 5 s |
| die | 0.30 | 0.20 | 2.5 s |
| pull / put on top | 0.45 to 0.80, more with the tension (a hand holding a half pulled block a little more) | 0.30 to 0.75 | 1.5 s |
| a block comes out | a quick extra +0.12 for 1.2 s | +0.10 | 0.15 s in, 2.5 s out |
| the fall | 0.90 | 1 | 0.15 s |
| the replay | 0.85 | 1 | 0.7 s |
| after the fall, round end | 0.35, then 0.15 | 0.5, then 0.1 | 3.5 s, 3 s |

The board's **Room dim** (off, gentle = half of everything, full) is a shared setting like the music, since the room is one for everybody. Real hands are dimmed with the room
(`over: true`; ghost fingers show the hands). It never goes fully black (0.92). A host that goes away must not leave a dark room (the server keeps the dim): any page with no host for
4 s lets it go. The PC view has no real room, so it only lists the look in its corner.

## What is where

| File | What it is |
|---|---|
| `mumr.json` | the host, the body (`jenga`, packet 23) |
| `spec.js` | sizes, colours, which block is which (seeded), the layout, the furniture as room planes, the tuning of the physics for each size |
| `tower.js` | the physics world: 54 blocks and the die on Jolt, pinch grips of limited strength, the pulled block, the placed block, the first block on the ground, the die |
| `rules.js` | turns, the die, scoring, who topples it, rounds, the match: a state machine with no physics (it is tested alone) |
| `replay.js` | the recorder (30 poses a second, 4 s) and the player (freeze, rewind, slow motion) |
| `referee.js` | the host's game: tower + rules + replay + the board's commands (`start`, `round`, `lobby`, `size`, `place`, `reroll`, `skip`, `back`) |
| `net.js` | the wire packet, the page's smoothing buffer (60 ms in the past), the body adapter of a page |
| `logic.js` | settings (`music`, `ghost`), the `jstate` kind, the board's layout |
| `host.js` | the host module (engine `host.js` runs it); logs every grab and release, and the step time every 5 s |
| `textures.js`, `draw.js` | the zen scene: wood grain and its normal map, stains, stamps, sand, felt, washi; the blocks, the die, the furniture, the markers, the replay banner (one module for the page and the PC view) |
| `app.js`, `index.html` | the page on `createApp` |
| `view.js`, `view.html` | the PC view (a watcher; keys 1 2 3 4 move the camera, M the music) |
| `focus.js` | the room's dim: the look of each phase, what tension adds, the Room dim setting; asked by the referee through `session.dim` |
| `music.js`, `music/` | the soundtrack: the director (scene, tension, moments), the crossfades, the swells, the generated bells, boom, riser and block clacks; the folders for your tracks |
| `*.test.js` | `rules`, `net` (and replay), `tower`, `referee`, `app` (the whole app with pretend headsets and a pretend host), `music` |

## How the physics was tuned (so that it feels like a real tower)

Found with a pretend hand that pulls blocks out of a tower under its own weight (`tower.test.js`, and a soak that pulled each of the 51 pullable blocks of a fresh tower):

- A **velocity motor** (the engine's old hold) does not pull a block from under a load: friction cancels it inside the solver step. A **kinematic grip** pulls it but is infinitely
  stiff, so it carries the whole load and takes the tower out with it. What works is a **grip of limited strength** (`hold(b, target, { force, omega })`, engine
  `physics-jolt.js`): a critically damped spring to the hand with its force capped at 4 N x scale^3, applied inside every substep. A stuck block lags behind the hand and then
  gives, as in life. The grip's point is smoothed (30 ms), and it lets go when the block is 1.5 blocks' lengths behind the hand.
- The solver needs **20 velocity and 6 position steps** at 1/240 s for a tower to stand and to take a pulled block without rocking (with the defaults 5 of 18 single pulls
  brought it down; with these none), and the slop, the sleep speed and the movement cap scale with the block (`spec.js tuning`). The physics is the same at all three sizes: the
  same blocks come out cleanly or bring the tower down at 27 cm, 75 cm and 1.5 m.
- Pine (520 kg/m3), friction 0.4, restitution 0.08. Each block is 0.1 mm (scaled) thicker or thinner than its neighbours, so some carry more of the load than others: one block in a
  level pulls out easily and one is tight, as in a real tower.
- Result on a fresh tower at 3.5 cm/s: 45 of 51 blocks come out with the rest of the tower moving under 2 mm; the other six are tight blocks in the upper levels that drag the stack out
  with them and bring it down. At 15 cm/s 46 come out. A grip a third as strong leaves 12 blocks stuck.

## Not yet tried

Everything here ran on the PC: Node tests (physics with pretend hands, the whole app with pretend headsets) and browser tabs through the real server and host (a full turn:
Start, the die thrown by a pinch, a block pulled and put on top, scored; the fall with the replay). **Not yet on a headset**: how a real pinch finds a 15 mm block at the normal size
(huge and giant should be easier), the feel of the lag of a tight block, the board at arm's length, the audio on the Quest browser (it plays after the first tap: the Enter button),
the soundtrack with real tracks, and a four-player round. And the room's dim on a real passthrough: the numbers in the table above are a first guess (how dark a living room can get before the hands and the way to the wall are lost, how the grey reads against the lantern).
