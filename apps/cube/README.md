# The MUMR cube

One 12 cm cube that every player can push with bare hands (one finger is enough), pick up (a pinch or a fist that starts at the cube;
it holds while the grip lasts, on a spring that stops at walls and objects), put on a flat hand (palm up or back up) and point at (a ray
to whatever a pointing finger points at: the cube or a part of the room); it rests on tables and solid objects in the room. A menu that
every player can press and its owner can carry by the handle under it, everybody's hands and heads (no feet here), the hand cutouts,
the hand window on the room's longest wall, lining up on the printed crosses, and a PC view.
Built on 2026-10-22; run once on one Quest Pro the same day (five faults found and fixed); not yet on two headsets.

## On two headsets

```bash
py -3 engine/server/serve.py apps/cube
```

1. Start the server first and check that `apps/cube/mumr-server.log` is being written (it is from the first line).
2. On each headset open the `https://` address the server prints, accept the certificate once, press **Enter mixed reality**.
3. Look at the inside of your left wrist: a small **MUMR** button sits there. Poke it with the right index finger to open the engine's
   menu (Line up, Room setup, Exit; "-" folds it again). Press **Line up**, rest an index fingertip on cross 1 and then cross 2
   (10 s each), Create on spot 3 and rest on cross 3 to check. Press **Done**. Do the same on the other headset (or press its Line up
   for it on its wrist: every button works from every menu). The floating menu is the cube's own (count, colour, cube here, ghost
   fingers); carry it by the bar under it.
4. Push the cube, pick it up, drop it on the floor or into the other player's hand. Press buttons on the other player's menu.
5. On the PC, open `view.html` (the link on the page) to watch.
6. Take a headset off and put it back on without leaving mixed reality: the line-up should come back from the anchor within a few
   seconds (the log says `anchor found again` and `line-up put back`).

The log also says whether the browser offered the `shared` reference space (`xr: shared space ...`). It is behind the Quest Browser flag
"WebXR experiments" (`chrome://flags`); add `?shared=1` to the address only to say it in the log, the line-up does not use it.

## On the PC (rehearsal)

```bash
py -3 engine/server/serve.py apps/cube 8766 --http --no-browser
```

Two tabs: `http://localhost:8766/?name=A&frame=0,0,0` and `http://localhost:8766/?name=B&frame=1,0.5,40` (a pretend line-up: where
the common frame lies in that tab's own floor plan, in metres and degrees). Left button on the floor = a fingertip (it pushes the cube,
and rests on a spot while lining up; with Shift it is a pinch, which picks the cube up), right button turns the view, a click on a menu
presses it (also on the other tab's menu). A tab in the background gets no animation frames and gives the cube up: `__cube.frame()`
steps it by hand. A pretend second player without a browser: `node tools/standin.js ws://localhost:8766/ws stand-in 1,0.5,40`.

## Files

| File | What |
|---|---|
| `cube.js` | the cube (a body of `engine/client/physics.js`: hands, hold, throw), its Body adapter and packet (16, 56 bytes), the menu layout and buttons; no THREE, tested in `engine/test/cube.test.js` |
| `draw.js` | how the cube looks, for both pages |
| `app.js`, `index.html` | the headset page (also the desktop rehearsal) |
| `view.js`, `view.html` | the PC view (a WorldFeed watcher) |
| `host.js` | the cube's host module: the server runs it on the PC (`engine/client/host.js`), it holds the cube while nobody touches it and simulates it on Jolt (`engine/client/physics-jolt.js`; the built-in physics if `npm install` was not run) |
| `mumr.json` | the server's settings: the token `cube` always has a holder, packet 16 belongs to it, the host module |
