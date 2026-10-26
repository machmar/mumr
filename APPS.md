# The apps

`node tools/run.js` lists them; `node tools/new-app.js MyApp` makes a new one and adds a line here.

- **_template**: the smallest app on `createApp`, copied by `new-app`. `node tools/run.js _template --http`
- **cube**: the XR demo: one cube to push, pick up, put on a hand and point at, with a PC view, a webcam page (`/webcam.html`: the world over a webcam's picture) and a host (the host simulates the cube on Jolt). `node tools/run.js cube --http`
- **lab**: the experiments of PLAN.md 3.1 in one app (pile, island, drift), picked on the menu; the pile has any number of cubes (- and + in the Cubes box), simulated on Jolt by the host. `node tools/run.js lab`
