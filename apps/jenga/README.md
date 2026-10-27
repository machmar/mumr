# MUMR jenga

The smallest MUMR app, on `createApp`. `node tools/new-app.js MyApp` makes a copy of this folder with the name filled in.

| File | What it is |
|---|---|
| `mumr.json` | what the server needs: the title, the page, the `bodies` (things that move) and `owned` (packet types) |
| `index.html` | the page: the import map for THREE, `/mumr/all.js`, `logic.js`, `app.js`. `createApp` makes the rest of the page |
| `logic.js` | the settings (`GAME`: one set for everybody, `PLAYER`: each player's), the buttons (`press`) and the menu. No THREE, no DOM |
| `app.js` | `createApp` with the above; what is drawn (`setup`, `draw`), simulated (`step`) and the app's own actions (`onAction`) |
| `app.test.js` | the logic with two pretend headsets (`engine/test/hubfake.js`) |

Run it: `node tools/run.js <name> --http`, then two tabs: `/?name=A&frame=0,0,0` and `/?name=B&frame=1,0.5,40`. For headsets leave out `--http`.
Test it: `node --test "apps/<name>/*.test.js"`.

Next: things that move (a Body: `docs/HOWTO-NEW-APP.md` section 3), what you draw (`setup`, `draw`), a PC view (`new-app --viewer` makes one).
