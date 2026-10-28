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

1. **Move here** (a plaque on the board: the game goes in front of you), choose the **Size**, press **Start game**. Everybody who is in the room plays; a match is three rounds.
2. **Roll the die** on the tray of the console (pinch it and let go; a die that lands cocked, or when no block of its colour can be taken, is rolled again).
3. **Pull a block of that colour** from a level below the highest complete one (the gold line round the tower is the limit), and **put it on top**. A clean move scores
   1, 2 if the block came from the bottom third (levels 1 to 6). A block of the wrong colour, or from a level that is not allowed, scores nothing.
4. The player on turn when a block other than the pulled one reaches the ground **topples the tower: -3**, and the round is over (if it falls within three seconds of a
   placement it is the placer's). The highest total after three rounds wins.
5. **The replay.** When the first block hits the ground everything freezes where it is (the block that did it glows, TIMBER!), rewinds two seconds, plays them again
   at 0.3x, and the collapse finishes in real time. Anybody can **Skip replay** on the board.

| Size | Tower | The block | Stands on |
|---|---|---|---|
| Normal | 27 cm | 15 x 25 x 75 mm, a real one | a plinth 72 cm high (a table's height) |
| Huge | 75 cm | 42 x 69 x 208 mm | a plinth 40 cm high |
| Giant | 1.5 m | 83 x 139 x 417 mm | a plinth 6 cm high (it grows as the game goes on: stand on the floor) |

## One menu for everybody (the board)

There is no menu of your own: the board on the console is **one thing for everybody** (engine `boards`, `createApp({ menu: false })`; the wrist menu is the engine's and is
untouched). It is not a panel of buttons but a thing of the game's own (`stand.js`; the engine is asked only to press it: `boards: [{ panel: false }]`): a walnut stand like a
small gate at the back of the table, turned a little towards the player who put the game down. Under its beam a **panel of washi lit from behind** says what is going on: whose
turn (an ensō with the player's colour), the colour the die gave (its sign and its name, Ai · indigo), what to do, and the round as a red seal. Under it **wooden plaques (ema) hang
on vermilion cords**, and small round tokens on a bamboo rod: Start game / Round 2 / New match, Roll again, Block lost? (puts the pulled block back on the plinth), Skip replay,
Size, Move here, Music - +, Room dim - +, Garden, Lights, Ghosts (your ghost fingers). A fingertip pushes a plaque back on its cord and it swings when let go; everybody's fingertips are seen on every page, so
everybody sees it swing. A plaque that cannot be pressed now **hangs turned round** (its back is plain wood, the name burnt in faintly), and one whose words change turns once on its
cord and comes back with the new words. The score is a **hanging scroll** (kakejiku) on a stand like the board's: names, the points of each round, the total, an ensō round whose
turn it is, the referee's last words.

## Where it stands in your room

The furniture is arranged for the real room (`arrange.js`). When the game is put down (**Move here**: the host gets where the player stands and the way
they look), when the size changes, and when the server's room changes between rounds, the host works out where everything goes from the server's room
(the scan a headset uploaded, in the common frame) and keeps it in the shared place (`place.arr`), so every headset, the PC view and the host's physics
have the same arrangement:

- nothing stands in a wall, on a sofa, a bed or a table, or off the room's floor; nothing stands on anything else of the game's or where the player stands;
  there is room in front of the board to press it, and room to walk round the plinth if it can be had;
- with room to spare it is the usual arrangement (the console on the player's left, the scroll at its far end, the lantern at its near end);
- in a narrow room the console goes to the other side, closer to the plinth, further along, turned across the player's way, or behind the tower; the scroll
  and the lantern go wherever is left; the tower itself may come nearer, go further, step aside or turn a little about the player, the least that fits;
- when nothing fits (a room of 2 x 2 m) the arrangement that collides least is kept, and the host's log says so (`NOTHING FITS`).

With no room scan everything stands as usual. `node --test apps/jenga/arrange.test.js` tries corridors, short rooms, a sofa and a table in the way and the
giant tower; the desktop rehearsal `/?name=A&frame=0,0,0&room=demo` uploads a pretend room with a table and a bed.

## The room's garden

Small calm things are put in the real room round the game (`deco.js` plans, `decor.js` draws). The host plans them from the server's room and the game's
arrangement whenever either changes and keeps the plan in the document (`jdeco`), so every headset and the PC view grow the same things in the same places:

| Where | What |
|---|---|
| the foot of a wall, a long free stretch | a strip of **raked sand** edged with pebbles, a few stones and moss on it, and a **paper lamp** at its end that lights the wall above it |
| the foot of a wall, a short free stretch | a few **stones** with a cushion of moss, or a lamp |
| a corner (two walls meeting) | a few stems of **bamboo**, their leaves swaying |
| the tops of a table, a side table, a shelf (0.3 to 1.5 m) | near the back corner: a **vase with a plum branch** in blossom (now and then a petal falls and lies on the table, then fades), **incense** (a glowing tip, a thread of smoke that rises straight and breaks into slow curls), a **candle** |

Never under or behind a table, never behind a sofa, a bed or a cabinet (the headset could not hide a thing behind real furniture: it would show through), never on a
sofa or a bed, never in a doorway, never in the game's way (the plinth and where its blocks fall, the console and the room in front of the board, the scroll, the
lantern, where the player stands). When the plan arrives everything **grows in**, one thing after another over a minute (stones settle, sand spreads, bamboo rises,
the branch blossoms, the flames light). The sway and the growing follow the server's clock; the petals and the smoke follow the **world's** clock, so they stop when
the tower falls and run back with the rewind. The board's **Garden** (full, sparse, none) is a shared setting: sparse keeps the first garden, lamp, stones, corner and top, full adds the rest.

**Lights that light the real room.** The lantern, the lamps and the candles lift the room's dim round them (engine `app.relight`): where the room is darkened, the
real floor and walls near a lamp stay brighter and are warmed in its colour, as if the lamp lit them. The engine draws the dim on the scanned surfaces of the
server's room (floor, walls, tables) and lets each light take some of it away by distance and by how squarely the surface faces it; the same lights and the same
room on every headset, so the pool of light is in the same real place for everybody. At the fall the lights go down with the room (`lightK`).

## Shades over the ceiling lights

A room with a big ceiling light fights the dim: the dim can only take away a share of the light, so the fitting stays the brightest thing in sight and
its glare flattens everything. Jenga hangs a shade of its own under each real ceiling light (`shades.js`), so the light seems to shine through it:

| The fitting | The shade |
|---|---|
| round (a pendant, a ceiling rose, a square panel) | an **akari**: a washi lantern on a spiral of bamboo, wider than it is tall, on a short cord close under the ceiling (its bottom kept above 2 m where the ceiling allows) |
| long and narrow (a fluorescent tube, an LED batten) | a **kumiko panel**: a long shallow box of dark wood flat under the ceiling, its underside washi behind an asanoha (hemp-leaf) lattice, a bar across every 60 cm |

It covers the bright fitting, glows the lantern's warm colour, and lights the real room below it (the engine's relight, **shining down**: as the room
darkens the floor and the walls under it stay lit and warm, the ceiling round it does not); a soft veil on the ceiling round it holds back the glare that
spills past it, only when the room is darkened, deeper as it darkens. A new shade unfolds down from the ceiling.

**Where the lights are** is the engine's (`room.js lights`): a lamp the headset's room setup found up at the ceiling counts by itself (a long one as a
tube); any other is marked once. Press **Lights** on the board, point at the light (the line from your eye through your pinching fingers meets the
ceiling) and pinch: a round fitting. For a tube, pinch at one end, draw along it and let go at the other. Pinch a shade to take it away (it glows red
when you aim at it). Press **Done** when finished. The marks are kept by the server in the common frame, the same for everybody; while one player marks,
everybody sees where they point (a thread of light from their hand to a ring on the ceiling, the outline of the panel as they draw it), worked out by
every page from that player's head and hands.

## The look

A quiet room with one warm light (`look.js`, `draw.js`, `fx.js`): the tower of pine blocks stained in the six colours, each colour's sign burnt into both ends; a plinth of charred
cedar (yakisugi) on a black foot, with a hinoki rim and sand raked in rings round the slate stone the tower stands on; the console in walnut with the die's tray in black lacquer lined
with vermilion; a paper andon on the floor at the end of the table, which is a real light. The key light throws the tower's shadows on the sand and on the real floor; the furniture has
soft contact shadows. The moments are drawn in light, never as panels: a gold band round the tower at the level a block may be taken from, a gold edge on the pulled block, the
tray breathing at the die's turn and a ring of the colour it gave, a ring of light off the top for a block put on top (gold sparks for a good move), the floor of the player on
turn lit in their colour, and at the fall the floor rippling out, a puff of sawdust, the trail of the block that did it, and **TIMBER / REWIND / REPLAY** circling above the tower in
letters of light with a ring that fills as the replay goes on. Motes of dust drift in the lantern's light on the **world's clock**: they stop when everything freezes, run back
with the rewind and slowly with the replay. Every motion (the flicker, the sway of the plaques, the turn of the words) follows the server's clock, so it is the same on every
headset. The fonts (Shippori Mincho B1, Zen Kaku Gothic New) are in `fonts/`, SIL OFL, so a headset needs no internet for them.

## Rule 1

Everything is shared and physical. The tower, the die and the replay are bodies the host simulates and sends (packet 23, all 55 bodies, 22 bytes each, 45 a second while
anything moves); the state (phase, turn, roll, scores, the pulled block, the allowed level, the fall and its trail) is one kept event of the document (`jstate`);
the console, plinth, tray, board and scoreboard are worked out on every page from that state (`spec.js layout`), and every glow, ring and swing from that state, the bodies,
everybody's fingertips at the board and the server's clock; the furniture is also in the host's physics
(`spec.js furniture` adds it to the room's planes), so the die rolls on the same tray everybody sees. No page simulates anything. The one thing that is not a thing in
the room is the sound: each headset plays the music itself, but the host decides it (the document's `jmusic`: the scene, the track and where in it, on the server's
clock), so every headset plays the same track at the same place; the volume is a shared setting.

## The soundtrack

You supply the tracks (ambient). Put them in `music/<scene>/`, run `node apps/jenga/music/build-manifest.js`, and the pages crossfade between them (9 s into a tenser scene,
30 s into a calmer one), in step on every headset, with swells at tense moments. What belongs in which scene: [music/README.md](music/README.md).

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
| `logic.js` | settings (`music`, `dim`, `garden`, `ghost`), the `jstate`, `jdeco`, `jmark` and `jmusic` kinds, the board's layout |
| `host.js` | the host module (engine `host.js` runs it): the referee and the music's director; logs every grab and release, and the step time every 5 s |
| `textures.js` | the textures, made at start: stained pine with burnt brands, yakisugi, walnut, hinoki, sand raked in rings, felt, washi, seigaiha, the ensō, glows |
| `look.js` | the fonts (`fonts/`), the reflections (a small warm room as an environment map), the lights: key light with the tower's shadows, sky light, the lantern |
| `draw.js` | the scene (one module for the page and the PC view): the blocks, the die, the plinth, the console and tray, the lantern, the scroll and its stand |
| `arrange.js` | where the furniture stands in the real room: the host's search (the console's side, distance, turn; the scroll; the lantern; the tower's place) |
| `deco.js` | the room's garden: what goes where (the free stretches at the walls' feet, the corners, the tops), planned by the host, kept as `jdeco` |
| `shades.js` | the shades over the ceiling lights: the akari, the kumiko panel, the veil on the ceiling, their light down on the real room, the marking cursor |
| `decor.js` | the garden drawn: sand, stones, moss, lamps, bamboo, the vase and its branch, incense and its smoke, the candle; how it grows in and sways; its lights for the engine's relight |
| `stand.js` | the board: the stand, the lit paper panel, the hanging plaques (swing, turn round) |
| `fx.js` | the moments: edge glows, the limit band, rings, sparks, sawdust, the words of the fall, the trail, the turn's ring, the motes on the world's clock |
| `app.js`, `index.html` | the page on `createApp` |
| `view.js`, `view.html` | the PC view (a watcher; keys 1 2 3 4 move the camera, M the music) |
| `focus.js` | the room's dim: the look of each phase, what tension adds, the Room dim setting; asked by the referee through `session.dim` |
| `music.js`, `music/` | the soundtrack: the director on the host (scene, track, where in it), the page's player (tension, moments, the crossfades, the swells, the limiter, the generated bells, boom, riser and block clacks); the folders for your tracks |
| `*.test.js` | `rules`, `net` (and replay), `tower`, `referee`, `app` (the whole app with pretend headsets and a pretend host), `music`, `focus`, `arrange`, `deco`, `shades` |

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
the soundtrack with real tracks, and a four-player round. The look (2026-10-28) was checked in a desktop browser only: whether the Quest keeps its frame rate with the
shadows and the reflections (111 draw calls with the shadow pass, the blocks instanced and the furniture merged; one 1024 shadow map), how the shadows on the real floor, the lantern's light and the letters of light read over passthrough,
and the plaques at arm's length. The shades under real ceiling lights (whether an akari hides a bright pendant from where the players stand, how a kumiko panel reads under a tube, whether the veil is enough against the glare, marking at arm's length). The garden and the relight over a real passthrough (whether the warm pools sit on the real floor where the lamps are, how much a lamp should lift); the garden's draw calls on a Quest (one mesh a material and a priority). And the room's dim on a real passthrough: the numbers in the table above are a first guess (how dark a living room can get before the hands and the way to the wall are lost, how the grey reads against the lantern).
