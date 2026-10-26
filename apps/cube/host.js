// The cube's host module (engine/client/host.js runs it on the PC): the same cube as the headsets simulate, held by the host while nobody
// touches it, so it stays where it was left when everybody has gone.
const C = require('./cube.js');

module.exports = {
  session: { game: C.GAME, player: C.PLAYER, actions: C.ACTIONS, press: C.press },
  async setup({ M, session, space, room, life }) {
    // the physics is Jolt (engine/client/physics-jolt.js, which engine/client/host.js loads); the built-in one if the package is not installed
    let Engine = null;
    try { await M.physics.jolt.load(); Engine = M.physics.JoltWorld; if (life) life('cube host: physics on Jolt'); } catch (e) { if (life) life(`cube host: no Jolt (${e.message}), the built-in physics`); }
    const cube = new C.Cube({}, Engine);
    const body = new M.body.Body(session, { token: 'cube', type: 'cube', adapter: C.adapter(cube, space) });
    return { bodies: [body], step: (dt, t, hands) => { cube.room = room ? room.local() : null; cube.step(dt, t, hands); } };
  },
};
