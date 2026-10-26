// The host (engine/server/hub.py role 'host', engine/client/host.js, body.js giving a body back at rest): with the pretend server, then the real one.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const M = require('../client/index.js');
require('../client/physics-jolt.js');                // (as engine/client/host.js does: the host modules then run their physics on Jolt, as on the PC)
const C = require('../../apps/cube/cube.js');
const { Hub } = require('./hubfake.js');
const HOSTMOD = require('../../apps/cube/host.js');

function player(hub, name, frame) {
  const S = new M.session.Session(hub.link(name), HOSTMOD.session);
  const sp = new M.align.Space(frame, 0), cube = new C.Cube(), body = new M.body.Body(S, { token: 'cube', type: 'cube', adapter: C.adapter(cube, sp), restMs: 300 });
  S.link.onBin = (b) => body.receive(M.wire.decode(b), 0);
  return { S, sp, cube, body };
}
async function host(hub) {
  const S = new M.session.Session(hub.link('host', 'host'), HOSTMOD.session);
  const space = new M.align.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0);
  S.setLined({ dist: 0, how: 'host' });
  const presence = new M.presence.Presence(S, space);
  const w = await HOSTMOD.setup({ M, session: S, space, presence });
  S.link.onBin = (b) => { const p = M.wire.decode(b); if (p.name === 'presence') presence.receive(p, 0); else w.bodies[0].receive(p, 0); };
  return { S, w, cube: null };
}
const finger = (id, x, y, z) => ({ id, points: [{ name: 'index', x, y, z }] });

test('the host holds the cube; a touch takes it at once; at rest and untouched it goes back; the host is not a player', async () => {
  const hub = new Hub({ bodies: ['cube'], owned: { 16: 'cube' } });
  const h = await host(hub); hub.flush();
  const a = player(hub, 'A', { x: 1, y: 0.5, yaw: 0.7, z: 0 }); hub.flush();
  a.S.setLined({ dist: 3 }); hub.flush();
  assert.deepStrictEqual([h.S.isHost, h.S.holds('cube'), a.S.holder('cube'), a.S.others, a.S.hostHere, a.S.sharing()], [true, true, 15, 0, true, true]);
  // A pushes the cube: it takes it
  const p0 = a.sp.fromCommon([0.5, 0]); a.cube.place(p0[0], p0[1]);
  let t = 0;
  for (let k = 0; k < 30; k++) {
    t += 1000 / 60;
    const tip = a.sp.fromCommon([0.38 + k * 0.006, 0, 0.05]), own = [finger('right', tip[0], tip[1], tip[2])];
    a.body.frame(t, own); hub.flush();
    a.cube.step(1 / 60, t / 1000, own); a.body.send(t); hub.flush();
  }
  assert.strictEqual(a.body.mine, true, 'the toucher took it');
  // hand away, the cube slides to a stop, and is given back
  for (let k = 0; k < 400 && a.body.mine; k++) { t += 1000 / 60; a.body.frame(t, []); a.cube.step(1 / 60, t / 1000, []); a.body.send(t); hub.flush(); }
  assert.strictEqual(a.S.holder('cube'), 15, 'back with the host');
  assert.strictEqual(a.body.stats.returned, 1);
  // the host's copy is where A left it (it followed A's state while A held it)
  hub.leave(a.S.me); hub.flush();
  assert.strictEqual(h.S.holds('cube'), true);
});

test('a holder that leaves gives the cube to the host, not to the next player; without the host the earliest player has it', async () => {
  const hub = new Hub({ bodies: ['cube'], owned: { 16: 'cube' } });
  const a = player(hub, 'A', { x: 0, y: 0, yaw: 0, z: 0 }), b = player(hub, 'B', { x: 0, y: 0, yaw: 0, z: 0 }); hub.flush();
  assert.strictEqual(a.S.holder('cube'), 0);
  const h = await host(hub); hub.flush();
  assert.strictEqual(a.S.holder('cube'), 0, 'a host that comes later does not take what a player holds');
  hub.leave(0); hub.flush();
  assert.strictEqual(b.S.holder('cube'), 15);
  hub.leave(15); hub.flush();
  assert.strictEqual(b.S.holder('cube'), 1);
  void h;
});

test('the real server starts the host by itself, and the host keeps the cube for a player that comes later', async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mumr-host-'));
  for (const f of ['cube.js', 'host.js', 'index.html']) fs.copyFileSync(path.join(__dirname, '..', '..', 'apps', 'cube', f), path.join(app, f));
  fs.writeFileSync(path.join(app, 'mumr.json'), JSON.stringify({ bodies: ['cube'], owned: { 16: 'cube' }, host: 'host.js' }));
  // (the copied host module needs the engine: it is found next to the server)
  fs.writeFileSync(path.join(app, 'cube.js'), fs.readFileSync(path.join(app, 'cube.js'), 'utf8').replace("require('../../engine/client/index.js')", `require(${JSON.stringify(path.join(__dirname, '..', 'client', 'index.js'))})`));
  const PORT = 8797, server = spawn('py', ['-3', path.join(__dirname, '..', 'server', 'serve.py'), app, String(PORT), '--http', '--no-browser', '--log=none'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let build = 0;
    let hostUp = false;
    for (let k = 0; k < 150 && !hostUp; k++) { try { const i = await (await fetch(`http://127.0.0.1:${PORT}/info`)).json(); build = i.build; hostUp = i.host; } catch (e) { /* not up yet */ } if (!hostUp) await sleep(100); }
    assert.ok(hostUp, 'the server started the host');
    const link = M.link.connect(`ws://127.0.0.1:${PORT}/ws`, { build, name: 'late', store: null });
    const S = new M.session.Session(link, HOSTMOD.session);
    let ok = false;
    for (let k = 0; k < 100 && !ok; k++) { await sleep(100); ok = S.connected && S.hostHere && S.holder('cube') === 15; }
    assert.ok(ok, `the host is there and holds the cube (connected ${S.connected}, host ${S.hostHere}, holder ${S.holder('cube')})`);
    assert.strictEqual(S.others, 0, 'and it is not counted as a player');
    link.close();
  } finally {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    try { fs.rmSync(app, { recursive: true, force: true }); } catch (e) { /* still open */ }
  }
});

test('the cube host runs its cube on Jolt, and steps it with and without a fingertip', async () => {
  const hub = new Hub({ bodies: ['cube'], owned: { 16: 'cube' } });
  const S = new M.session.Session(hub.link('host', 'host'), HOSTMOD.session), space = new M.align.Space({ x: 0, y: 0, yaw: 0, z: 0 }, 0);
  S.setLined({ dist: 0, how: 'host' });
  const lines = [], w = await HOSTMOD.setup({ M, session: S, space, presence: new M.presence.Presence(S, space), room: { local: () => null }, life: (s) => lines.push(s) });
  assert.ok(lines.some((s) => /physics on Jolt/.test(s)), lines.join(' | '));
  const dt = 1 / 90;
  for (let k = 0; k < 90 * 2; k++) w.step(dt, k * dt, k > 90 ? [finger('h', 0.2 + (k - 90) * 0.003, 0, 0.06)] : []);
  hub.flush();
});
