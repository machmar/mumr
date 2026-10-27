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
    let at = Date.now(), maxHands = 0, pinches = 0, lastPinch = false;
    return {
      bodies: [body],
      step(dt, t, hands) {
        ref.step(dt, t * 1000, hands);
        { const pv = hands.some((h) => h.pinch); if (pv !== lastPinch) { lastPinch = pv; life(`jenga host: pinch ${pv} at ${hands.map((h) => h.points[0].z.toFixed(3))} t=${(t % 1000).toFixed(2)}`); } }
        maxHands = Math.max(maxHands, hands.length); if (hands.some((h) => h.pinch)) { pinches++; if (false) life(`jenga host: first pinch ${JSON.stringify(hands.map((h) => ({ id: h.id, pinch: h.pinch, p: h.points.map((q) => [q.name, +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)]) })))}; die at ${ref.tower.die.body.p.map((v) => v.toFixed(3))}`); }
        if (Date.now() - at >= 5000) { const st = ref.stats; life(`jenga host: ${ref.rules.phase}, ${ref.tower.moving()} bodies moving, up to ${maxHands} hands (${pinches} steps with a pinch), step ${(st.ms / Math.max(1, st.steps)).toFixed(2)} ms (worst ${st.worst.toFixed(1)})`); ref.stats = { steps: 0, ms: 0, worst: 0 }; maxHands = 0; pinches = 0; at = Date.now(); }
      },
    };
  },
};
