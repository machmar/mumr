// The real cameras through the real server: engine/server/serve.py on a port of its own, plain http, this PC only. A camera is an owned
// thing of the document (cam+ with a key and `own`); a viewer may own one, and a request to move it goes to the owner only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const M = require('../client/index.js');

const PORT = 8797, URL = `ws://127.0.0.1:${PORT}/ws`;
let server = null, build = 0, app = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, cond, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) assert.fail(`waited ${ms} ms for: ${what}`); await sleep(10); }
}
const CAM = { id: 'cam-1', name: 'Laptop webcam', x: 3.2, y: -3.9, z: 1.2, yaw: 2.19, pitch: -0.27, hfov: 1.0996, aspect: 1.7778 };
function page(name, role) {
  const link = M.link.connect(URL, { build, name, join: role ? { role } : undefined });
  const S = new M.session.Session(link, {});
  S.asks = []; S.on('ask', (key, m, from) => S.asks.push([key, m, from]));
  return S;
}
const cams = (S) => Object.keys(S.doc.cameras).sort();

test.before(async () => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'mumr-cams-'));
  fs.writeFileSync(path.join(app, 'index.html'), '<p>test</p>');
  fs.writeFileSync(path.join(app, 'mumr.json'), JSON.stringify({}));
  server = spawn('py', ['-3', path.join(__dirname, '..', 'server', 'serve.py'), app, String(PORT), '--http', '--no-browser', '--log=none'], { stdio: 'ignore' });
  for (let k = 0; k < 100 && !build; k++) {
    try { build = (await (await fetch(`http://127.0.0.1:${PORT}/info`)).json()).build; } catch (e) { await sleep(100); }
  }
  assert.ok(build > 0, 'the server started and says what build the pages are');
});
test.after(() => {
  if (server) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  try { fs.rmSync(app, { recursive: true, force: true }); } catch (e) { /* a file still open */ }
});

test('a webcam page (a viewer) announces its camera: a player hears it, a player who comes later has it, and when the page goes the camera goes', async () => {
  const a = page('headset'); await until('the player is in', () => a.connected);
  const v = page('webcam page', 'viewer'); await until('the viewer is in', () => v.connected);
  v.emit(M.cams.event(CAM));
  await until('the player hears the camera', () => cams(a).length === 1);
  assert.strictEqual(a.doc.cameras['cam-1'].owner, v.me, 'and who it came from');
  await until('the viewer has its own camera back', () => cams(v).length === 1);
  const b = page('late headset'); await until('the late player has the camera', () => b.connected && cams(b).length === 1);
  assert.strictEqual(b.doc.cameras['cam-1'].name, 'Laptop webcam');
  v.link.close();
  await until('the camera is taken away at both players', () => cams(a).length === 0 && cams(b).length === 0);
  const c = page('third headset'); await until('the third player is in', () => c.connected);
  assert.deepStrictEqual(cams(c), []);
  for (const p of [a, b, c]) p.link.close();
});

test('a headset asks for the camera of a webcam page to move: only that page hears it, through the real server', async () => {
  const a = page('headset'); await until('the player is in', () => a.connected);
  const b = page('other headset'); await until('the other player is in', () => b.connected);
  const v = page('webcam page', 'viewer'); await until('the viewer is in', () => v.connected);
  const w = page('second page', 'viewer'); await until('the second viewer is in', () => w.connected);
  v.emit(M.cams.event(CAM));
  await until('the camera is known to the player', () => cams(a).length === 1);
  assert.ok(a.moveCamera('cam-1', 3.25, -3.9, 1.3));
  await until('the owner hears the request', () => v.asks.length === 1);
  assert.deepStrictEqual(v.asks[0], ['cam:cam-1', { x: 3.25, y: -3.9, z: 1.3 }, a.me]);
  assert.ok(a.resetCamera('cam-1'));
  await until('and a reset', () => v.asks.length === 2);
  assert.deepStrictEqual(v.asks[1], ['cam:cam-1', { reset: true }, a.me]);
  await sleep(150);
  for (const p of [a, b, w]) assert.strictEqual(p.asks.length, 0, 'nobody else hears');
  a.moveCamera('nobody', 1, 1, 1);
  await sleep(150);
  assert.strictEqual(v.asks.length, 2, 'a camera nobody owns goes nowhere');
  v.emit(M.cams.event(Object.assign({}, CAM, { x: 3.25, z: 1.3, yaw: 2.2 })));
  await until('the other player hears the camera moved', () => b.doc.cameras['cam-1'].x === 3.25);
  for (const p of [a, b, v, w]) p.link.close();
});
