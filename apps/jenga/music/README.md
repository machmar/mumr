# The soundtrack

**You supply the music; the game plays it.** Put ambient tracks in the folders below, run

```bash
node apps/jenga/music/build-manifest.js        # writes tracks.json from what is in the folders (and each track's length)
```

and reload the pages (the host reads tracks.json again by itself). Tracks are streamed from the PC (mp3, ogg, m4a, wav, flac, opus: mp3 or ogg of 5 to 15 MB each is easiest on the headsets' memory and Wi-Fi; they are not
decoded into memory). They are **not committed** (`.gitignore`): they are yours.

## How it plays

- **The host directs it.** The PC host decides the scene, the track and where in it, and puts that in the document (`jmusic`, on the server's clock). Every headset and PC view
  plays that record at the same place in the same track, also one that comes in late: it is the room's music. A page that drifts more than 2 s (a stalled stream) is put back.
- The game is always in one **scene**. When the scene changes, the next scene's track starts **under** the old one and the old one fades away: an equal-power crossfade. A
  **tenser** scene (build, tense, danger) comes once the tension has lasted 1.5 s, and fades in over **9 s** (`tracks.json` `rise`); a **calmer** one only after the scene has lasted
  22 s, over **30 s** (`crossfade`); the fall and the end of the match at once, over 6 s and 12 s (`fades`). A scene is entered higher than it is left (danger above a tension of
  0.62, out below 0.45; tense above 0.32, out below 0.22), so a tension that wavers does not flip it.
- The new track is heard from when it actually plays (a slow stream leaves no gap: the old one plays on until then).
- A scene the music **comes back to carries on where it was left**. A track that is about to end is followed by the next track of its scene, or by itself again if the scene has
  only one. A scene with no tracks keeps the music of the nearest one; with no tracks at all a quiet generated pad plays.
- **A track does not have to start at its beginning.** The ambient scenes (`calm`, `build`, `tense`, `danger`) bring a new track in at some point in the track (another place each round, the
  same place on every headset), so a long track is not always heard from the same first minute. It keeps at least two crossfades (about a minute) of music to play, so a track shorter
  than about 61 s starts at its beginning. The `finale` and `win` are shaped from their first second and always start at the beginning. To change which scenes may start anywhere, add
  `"anywhere": ["calm", "build", "tense", "danger"]` to `tracks.json` (an empty list starts everything at the beginning, and a scene the music comes back to then starts
  again at the beginning too; `build-manifest.js` keeps the line). A track that follows itself comes in somewhere else each time.
- **Swells**: the music is not changed, only shaped. As the tower gets tense (missing blocks, a leaning top, blocks moving) it gets up to 32% louder and brighter (a filter opens), and a
  low generated drone comes in under it. One-shot moments make a short swell of their own: a die rolled, a block pulled out (a 4 s swell and a quiet riser), a block put on top (a bell, two or
  four for a good move), the **fall** (the music ducks to a whisper in a quarter of a second, a deep boom), the **replay** (a riser, and the music comes back over 7 s, louder than before),
  the end of the match (bells and a long swell). The tension and the moments shape the music separately, so the fall's duck holds through the whole freeze. Block clacks,
  the die's thumps and these bells are generated; nothing else is needed. A limiter at the end keeps the swells and the sounds together from clipping.
- So master the tracks with **headroom** (peaks at -3 dB or lower, about -18 LUFS), with **no silence or fade at the start and end** (and nothing that must be heard from the beginning: a track can be entered anywhere), and nothing that jumps out: the game adds the drama.
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
