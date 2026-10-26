// The lab's host module (engine/client/host.js runs it on the PC, the server starts it): it simulates the pile and the island ALL the time
// with everybody's hands (body policy 'host'), and the headsets only show what it sends (Marek, 2026-10-26). The same World as the pages
// (boxes.js), in the common frame (the host stands in it). The experiment and the count come from the shared settings, like on the pages;
// Reset, Drop the pile and a box moved in a room model come as requests (body.ask -> request in boxes.js).
const L = require('./boxes.js');

module.exports = {
  session: { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS },
  async setup({ M, session: S, room, life }) {
    // the physics is Jolt (engine/client/physics-jolt.js); the built-in one if the package is not installed
    let Engine = null;
    try { await require('../../engine/client/physics-jolt.js').load(); Engine = M.physics.JoltWorld; life('lab host: physics on Jolt'); } catch (e) { life(`lab host: no Jolt (${e.message}), the built-in physics`); }
    const pile = new L.World(10, Engine), island = new L.World(L.ISLAND, Engine);
    island.layout('stack', L.ISLAND, [0.5, 0]);
    let mode = 'pile', count = 10, simMs = 0, steps = 0, lagged = 0, most = 0, at = Date.now();
    const id = (s) => s;
    const bodies = L.TYPES.map((t, i) => new M.body.Body(S, { token: t.token, type: t.name, policy: 'host', adapter: L.adapter(island, i, id, () => mode === 'island') }))
      .concat([new M.body.Body(S, { token: L.PILE.token, type: L.PILE.name, policy: 'host', adapter: L.pileAdapter(pile, id, () => mode === 'pile') })]);
    return {
      bodies,
      step(dt, t, hands) {
        const m = S.game('mode') || 'pile', n = S.game('n') || 10;
        if (m !== mode || n !== count) {
          mode = m; count = n;
          if (m === 'pile') pile.layout('grid', n);
          if (m === 'island') island.layout('stack', L.ISLAND, [0.5, 0]);
          life(`lab host: ${m}${m === 'pile' ? `, ${n} cubes` : ''}`);
        }
        if (m === 'drift') return;
        const w = m === 'island' ? island : pile, t0 = performance.now();
        w.room = room.local();
        w.step(dt, t, hands);
        simMs += performance.now() - t0; steps++; if (w.pw.lagged) lagged++; most = Math.max(most, hands.length);
        if (Date.now() - at >= 5000) {
          life(`lab host: ${m === 'pile' ? `pile of ${pile.boxes.length}` : 'island'}: simulation ${(simMs / steps).toFixed(2)} ms a step, ${steps} steps in ${((Date.now() - at) / 1000).toFixed(1)} s, ${w.movingCount()} moving, up to ${most} hands, cut short in ${lagged}`);
          simMs = 0; steps = 0; lagged = 0; most = 0; at = Date.now();
        }
      },
    };
  },
};
