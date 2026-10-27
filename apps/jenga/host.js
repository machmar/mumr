// The PC host's module (engine/client/host.js runs it; the server starts it): the game itself. The referee runs the tower's physics on Jolt with
// everybody's hands, reads the game off it, replays a fall, and sends the bodies (net.js) and the shared state (the document's `jstate`);
// the headsets and PC views only draw what it sends. With no host there is no tower anywhere: the board says so.
const L = require('./logic.js');
const { Referee } = require('./referee.js');
require('./net.js');

module.exports = {
  session: { game: L.GAME, player: L.PLAYER, actions: L.ACTIONS, press: L.press, kinds: L.KINDS },
  async setup({ M, session, room, life }) {
    let Engine = null;
    try { await M.physics.jolt.load(); Engine = M.physics.JoltWorld; life('jenga host: physics on Jolt'); } catch (e) { life(`jenga host: no Jolt (${e.message}), the built-in physics`); }
    const ref = new Referee({ Engine, session, room, life, seed: (Date.now() & 0xffffff) + 1 });
    session.on('first', () => ref.joined(true));
    session.on('synced', () => ref.joined(false));
    session.on('peer', () => ref.peerChanged());
    const body = new M.body.Body(session, { token: 'jenga', type: 'jenga', policy: 'host', every: 22, adapter: {
      reach: () => false, touching: () => false, pack: () => ref.pack(), apply: () => false, settle: () => {},
      do: (what, args) => ref.command(what, args), moving: () => ref.moving(),
    } });
    let at = Date.now();
    return {
      bodies: [body],
      step(dt, t, hands) {
        ref.step(dt, t * 1000, hands);
        if (Date.now() - at >= 5000) { const st = ref.stats; life(`jenga host: ${ref.rules.phase}, ${ref.tower.moving()} bodies moving, up to ${hands.length} hands, step ${(st.ms / Math.max(1, st.steps)).toFixed(2)} ms (worst ${st.worst.toFixed(1)})`); ref.stats = { steps: 0, ms: 0, worst: 0 }; at = Date.now(); }
      },
    };
  },
};
