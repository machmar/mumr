# MUMR jenga

One tower of 54 wooden blocks for everybody in the room (rule 1: every player sees the same tower and can touch it with their own hands).
The blocks are twice the real size (3 x 5 x 15 cm, the tower 54 cm high) so that a tracked hand can push one and pinch it.

```bash
node tools/run.js jenga                  # headsets: https://<PC>:8443/   (Node must be on the PATH: the host simulates the tower)
node tools/run.js jenga --http           # PC rehearsal: two tabs /?name=A&frame=0,0,0 and /?name=B&frame=1,0.5,40
node --test "apps/jenga/*.test.js"
```

## Playing

- **New tower** (the menu) puts a tower half a metre in front of whoever pressed it, on the table there if the room has one, and gives
  them the first turn.
- Push a block out with a fingertip, or pinch it and pull (a pinched block turns with the hand and goes where the pinch opens). Put it on the
  top, across the level below. When everything has come to rest the move counts, and the turn goes to the next player (by slot).
- The tower has fallen when its top comes down by more than two levels, or three blocks lie on the table or the floor away from it. Every
  headset says so, with whose hand was on it last (in the last 6 s).
- Turns are advice: anybody can touch the tower at any time.

The menu shows the tower (levels, or FELL), whose turn it is and how many blocks were moved. A held block takes its holder's colour.

## How it works

| File | What it is |
|---|---|
| `jenga.js` | the plain logic (no THREE, no DOM): `Tower` (the blocks on `engine/client/physics.js`, the pinch, the hands), `judge` (a move, a fall), the packet (23), the Body adapter, the document's `jenga` (the game), the menu |
| `app.js` | the headset page on `createApp`: draws the blocks, sends the hands, the menu, says what happened |
| `host.js` | the host module: the tower simulated on the PC |
| `jenga.test.js` | the tower stands, a block comes out, a second one of a level brings it down, a move, a pinch, the packet, the host and the game |

- **The host simulates the tower.** A tower of 18 levels needs fine physics: 240 steps a second and 12 solver rounds (measured: at 72 or 144
  steps it creeps by itself and falls when a block is pushed). That is about 12 ms a frame in Node on a PC with the whole tower awake, too
  much for a Quest, so the host process (`engine/client/host.js`, started by the server) keeps the token `tower` and simulates with
  everybody's hands. The headsets send their hands (presence, as always) and draw the host's packets, carried on by each block's speed
  and glided to (a block reacts about one round trip after the finger, fine for slow careful pushes). With no host (Node not found), the
  page whose hand is on the tower takes it and simulates it as the lab's pile (slow on a Quest: the status line says SLOW).
- **Waking.** A block wakes when a block near it moves at all (`World({ wakeV: 0.01 })`): one pulled out slowly must wake what rests on it,
  or the blocks above would stay asleep in the air.
- **The packet** (23): the tower's place, then 16 numbers a block (index, position, orientation, velocity, spin, asleep, held by). While
  something moves: the blocks that are awake and six at rest in turn; at rest: all 54 (4 a second). A push wakes most of the tower, so a
  push is about 3.5 kB a packet at 45 a second (1.2 Mbit/s to each headset) while it lasts.
- **The game** is the document's `jenga` (`{ round, state, by, moves, turn, last }`), written only by whoever simulates the tower.

Not done yet: a PC view page; a check of the push and pinch with real hands on a headset (the finger spheres, the pinch reach of 2.5 cm).
