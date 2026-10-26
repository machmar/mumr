// The HOST: a Node process on the PC that holds the bodies nobody touches (engine/server/hub.py role 'host'). It runs the app's own plain
// simulation (the same file the headsets run) with everybody's hands, in the common frame, and sends the state while it holds a body. A
// touch takes a body from it at once; a body at rest that nobody touches comes back to it (body.js). The world keeps going, and stays
// where it was left, when every headset has gone.
//
//   node engine/client/host.js <ws(s)://host:port/ws> <the app's host module>
// The server starts it by itself when the app's mumr.json says { "host": "host.js" } (engine/server/serve.py), and starts it again when it ends.
// It ends when the pages' build changes (so that it runs the new code) or when the server refuses it.
//
// The app's host module exports:
//   session        the Session's options (the same as the pages': game, player, kinds ...)
//   setup({ M, session, space, presence, room, life }) -> { bodies: [Body], step(dt (s), t (s), hands), receive(p, nowMs) (optional) }
//   (room: room.js Room; room.local() is the room in the common frame, once a headset has supplied one)
// `space` is the common frame itself (the host stands in it): positions in and out need no turning.
const path = require('node:path');
const M = require('./index.js');

const [url, modPath] = process.argv.slice(2);
if (!url || !modPath) { console.error('usage: node engine/client/host.js <ws url> <host module>'); process.exit(2); }
const http = url.replace(/^ws/, 'http').replace(/\/ws$/, '');
const app = require(path.resolve(modPath));

(async () => {
  let info = null;
  for (let k = 0; k < 50 && !info; k++) { try { info = await (await fetch(`${http}/info`)).json(); } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }
  if (!info) { console.error('host: the server does not answer'); process.exit(4); }
  const life = M.life.make({ url: `${http}/log`, name: 'host', storage: null });
  const say = (t) => { console.log(t); life(t); };
  const link = M.link.connect(url, { build: info.build, name: 'host', join: { role: 'host' }, store: null });
  link.onNote = (n) => { say(`link: ${n}`); if (/^refused/.test(n)) process.exit(3); };
  const session = new M.session.Session(link, app.session || {});
  const space = new M.align.Space({ x: 0, y: 0, yaw: 0, z: 0, dist: 0, how: 'host' }, 0);
  session.setLined({ dist: 0, how: 'host' });                      // (the host stands in the common frame: it is lined up by being the frame)
  const presence = new M.presence.Presence(session, space);
  const room = new M.room.Room(session, space, { life: say });
  const world = app.setup({ M, session, space, presence, room, life: say });
  const bodies = world.bodies || [];
  session.on('token', (t, mine) => say(`${t}: ${mine ? 'held by the host' : `held by player ${(session.holder(t) ?? -1) + 1}`}`));
  link.onBin = (b) => {
    const p = M.wire.decode(b), now = performance.now();
    if (!p) return;
    if (p.name === 'presence') presence.receive(p, now);
    else { for (const body of bodies) body.receive(p, now); if (world.receive) world.receive(p, now); }
  };
  let last = performance.now(), netAt = performance.now();
  const who = (s) => `player ${s + 1}`;
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    session.tick(now);
    // every 5 s: the players' hand packets as the host gets them (how many a second, the longest gap, how old)
    if (now - netAt > 5000) { netAt = now; life(M.presence.netLine(link.rtt, presence.report(now), [], who)); }
    for (const body of bodies) body.frame(now, []);
    world.step(dt, now / 1000, presence.hands([], now));
    for (const body of bodies) body.send(now);
  }, 11);
  // a new build of the pages: end, so that the server starts a host that runs the new code
  setInterval(async () => { try { const i = await (await fetch(`${http}/info`)).json(); if (i.build && i.build !== info.build) { say('host: the build changed, ending'); setTimeout(() => process.exit(0), 200); } } catch (e) { /* the server is away */ } }, 3000);
  say(`host: started for ${path.basename(path.dirname(path.resolve(modPath)))}`);
})();
