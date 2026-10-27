// Jenga's host module (engine/client/host.js runs it on the PC): the tower is simulated here, for everybody, whenever the host is there (a
// headset cannot do 54 blocks at 240 steps a second in a frame). The headsets send their hands and draw what it sends.
const J = require('./jenga.js');

module.exports = {
  session: J.SESSION,
  setup({ M, session, room }) {
    const tower = new J.Tower();
    J.wire(tower, session);
    const body = new M.body.Body(session, { token: J.TOKEN, type: J.PACKET.name, adapter: J.adapter(tower, session, (s) => s) });
    return { bodies: [body], step: (dt, t, hands) => { tower.room = room.local(); J.frame(tower, session, dt, t, hands); } };
  },
};
