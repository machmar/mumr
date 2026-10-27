# The apps

`node tools/run.js` lists them; `node tools/new-app.js MyApp` makes a new one and adds a line here.

- **_template**: the smallest app on `createApp`, copied by `new-app`. `node tools/run.js _template --http`
- **cube**: the XR demo: one cube to push, pick up, put on a hand and point at, with a PC view and a host. `node tools/run.js cube --http`
- **lab**: the experiments of PLAN.md 3.1 in one app (pile, island, drift), picked on the menu. `node tools/run.js lab`
- **jenga**: one tower of 54 blocks for everybody, turns, the tower falls; simulated by the host on the PC. `node tools/run.js jenga`
