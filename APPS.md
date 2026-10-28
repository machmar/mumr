# The apps

`node tools/run.js` lists them; `node tools/new-app.js MyApp` makes a new one and adds a line here.

- **_template**: the smallest app on `createApp`, copied by `new-app`. `node tools/run.js _template --http`
- **cube**: the XR demo: one cube to push, pick up, put on a hand and point at, with a PC view, a webcam page (`/webcam.html`: the world over a webcam's picture) and a host (the host simulates the cube on Jolt). `node tools/run.js cube --http`
- **lab**: the experiments of PLAN.md 3.1 in one app (pile, island, drift), picked on the menu; the pile has any number of cubes (- and + in the Cubes box), simulated on Jolt by the host. `node tools/run.js lab`
- **jenga**: a shared Jenga tower for 2 to 4 players in three sizes (27 cm, 75 cm, 1.5 m): pinch blocks out and put them on top, a wooden die for the colour, one shared menu board (wooden plaques hanging on a stand, a lit paper panel), automatic scoring over three rounds, an instant replay when the tower falls, a PC view, a quiet zen scene lit by a paper lantern, a small garden grown into the real room round it (raked sand, stones, lamps that light the real walls, bamboo, a vase in blossom, incense), and a soundtrack you supply (30 s crossfades, swells at tense moments). The host plays the game. `node tools/run.js jenga --http` ([README](apps/jenga/README.md))
