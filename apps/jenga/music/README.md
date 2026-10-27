# The soundtrack

**You supply the music; the game plays it.** Put ambient tracks in the folders below, run

```bash
node apps/jenga/music/build-manifest.js        # writes tracks.json from what is in the folders
```

and reload the pages. Tracks are streamed from the PC (mp3, ogg, m4a, wav, flac, opus: mp3 or ogg of 5 to 15 MB each is easiest on the headsets' memory and Wi-Fi; they are not
decoded into memory). They are **not committed** (`.gitignore`): they are yours.

## How it plays

- The game is always in one **scene**. When the scene changes, the next scene's track starts **under** the old one and the old one fades away: an equal-power crossfade of **30 s**
  (the fall and the end of the match fade in faster: 6 s and 12 s; `tracks.json` `fades`). A track that is about to end is followed the same way by the next track of its
  scene, or by itself again if the scene has only one. A scene with no tracks keeps the music of the nearest one; with no tracks at all a quiet generated pad plays.
- Every headset is in the same scene at the same time and picks the same track (a hash of the tower's seed): it is the room's music.
- **Swells**: the music is not changed, only shaped. As the tower gets tense (missing blocks, a leaning top, blocks moving) it gets up to 32% louder and brighter (a filter opens), and a
  low generated drone comes in under it. One-shot moments make a short swell of their own: a die rolled, a block pulled out (a 4 s swell and a quiet riser), a block put on top (a bell, two or
  four for a good move), the **fall** (the music ducks to a whisper in a quarter of a second, a deep boom), the **replay** (a riser, and the music comes back over 7 s, louder than before),
  the end of the match (bells and a long swell). Block clacks, the die's thumps and these bells are generated; nothing else is needed.
- So master the tracks with **headroom** (peaks at -3 dB or lower, about -18 LUFS), with **no silence or fade at the start and end**, and nothing that jumps out: the game adds the drama.
  Long is good (3 to 10 minutes): with 30 s crossfades a long track is a long stay.

## Which kind of track goes where

| Folder | When | What it wants |
|---|---|---|
| `calm/` | the lobby, between rounds, the quiet after a fall | Weightless and warm. Long pads, a soft piano or koto or singing bowls, no pulse. Open fifths, major or lydian. Slow breathing. |
| `build/` | the first moves, a whole tower, easy pulls | Curious and light, still quiet. Airy pads with small plucked motifs (kalimba, harp, glass), a little movement, nothing urgent. Bright but low in level. |
| `tense/` | the middle of the game: holes in the tower, every pull matters | Darker and suspended. Minor or modal harmony that does not resolve, low cello or bowed drones, slow filter movement, a few high bells far apart. |
| `danger/` | the tower is loose, the top leans, a hand is on a tight block | Held breath. Low sustained drones and sub, a very slow swell, shimmering dissonance, no melody and no beat (at most a heartbeat so slow that it is felt). Keep the level moderate: the game raises it. |
| `finale/` | the fall and the replay (about 12 s) | A cinematic aftermath: huge reverb tails, reversed textures, one deep long note that opens up. It fades in over only 6 s, so it should work from its first second. |
| `win/` | the end of the match | Resolution. Warm major, bells or a soft choir, a feeling of an exhale. Fades in over 12 s. |

`music/*/` hold `.gitkeep` files only. An empty folder is fine.
