// The real server (engine/server/serve.py, plain http on this PC) with real links: what hubfake.js pretends, checked against hub.py.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const M = require('../client/index.js');
const W = M.wire;

const PORT = 8798, URL = `ws://127.0.0.1:${PORT}/ws`;
let server = null, build = 0, app = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, cond, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) assert.fail(`waited ${ms} ms for: ${what}`); await sleep(10); }
}
W.register({ type: 16, name: 'puck', token: 'puck', pack: (o) => new Uint8Array([o.v]), unpack: (d) => ({ v: d.getUint8(0) }) });
const KINDS = { 'mark+': { keep: (e) => ({ key: `mark:${e.id}` }), apply: (S, e) => { S.doc.marks[e.id] = e.x; } },
  'pin+': { keep: (e) => ({ key: `pin:${e.id}`, own: true, gone: { k: 'pin-', id: e.id } }), apply: (S, e) => { S.doc.cams[e.id] = e.x; } },
  'pin-': { apply: (S, e) => { delete S.doc.cams[e.id]; } } };
const OPTS = { kinds: KINDS, init: (d) => { d.marks = {}; d.cams = {}; }, game: { floor: 'grid' }, player: { hue: 'red' } };
function player(name) {
  const link = M.link.connect(URL, { build, name });
  const s = new M.session.Session(link, OPTS);
  s.bins = []; link.onBin = (b) => s.bins.push(W.decode(new Uint8Array(b)));
  return s;
}

test.before(async () => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'mumr-net-'));
  fs.writeFileSync(path.join(app, 'index.html'), '<p>test</p>');
  fs.writeFileSync(path.join(app, 'mumr.json'), JSON.stringify({ bodies: ['puck'], owned: { 16: 'puck' } }));
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

test('two players and a viewer through the real hub: the kept document, owned things, tokens, motion only from the holder', async () => {
  const a = player('A');
  await until('A in', () => a.connected);
  a.emit({ k: 'mark+', id: 'm1', x: 1 });
  a.emit({ k: 'pin+', id: 'w', x: 7 });
  a.setLined({ dist: 3 });
  await until('A has its events back', () => a.doc.marks.m1 === 1 && a.doc.cams.w === 7);
  const b = player('B');
  await until('B in, with the world', () => b.connected && b.doc.marks.m1 === 1);
  assert.deepStrictEqual([b.doc.cams, b.ownerOf('pin:w'), b.lined(0), b.stateOf(0).hue, b.holder('puck')], [{ w: 7 }, 0, { dist: 3, how: 'points' }, 'red', 0]);
  b.setLined({ dist: 3 });
  await until('both share', () => a.sharing() && b.sharing());

  a.link.sendBin(W.encode('puck', { v: 5 }, 1));
  b.link.sendBin(W.encode('puck', { v: 9 }, 1));
  b.link.sendBin(W.encode('presence', { head: [0, 0, 0, 1, 0], sources: [] }, 1));
  await until('motion', () => b.bins.length >= 1 && a.bins.length >= 1);
  await sleep(50);
  assert.deepStrictEqual(b.bins.map((p) => [p.name, p.slot, p.data.v]), [['puck', 0, 5]]);
  assert.deepStrictEqual(a.bins.map((p) => [p.name, p.slot]), [['presence', 1]], 'B\'s state never arrived: B does not hold the puck');

  b.claim('puck', 0);
  await until('B holds the puck', () => b.holds('puck') && a.holder('puck') === 1);
  b.setBusy('puck', true); await sleep(30);
  a.claim('puck', 0); await sleep(80);
  assert.strictEqual(b.holds('puck'), true, 'a hand is on it');

  const feed = M.worldfeed.WorldFeed.connect(URL, { build, session: OPTS });
  await until('the viewer is in', () => feed.ready);
  assert.deepStrictEqual([feed.doc.marks, feed.doc.cams, feed.players().length], [{ m1: 1 }, { w: 7 }, 2]);
  assert.ok(feed.sample('presence', 1), 'the newest presence came with the hello');
  await until('the players know they are watched', () => a.viewers === 1 && b.viewers === 1);

  a.link.close();
  await until('A\'s camera went with it, the puck stays with B, the mark stays', () => !('w' in b.doc.cams) && !('w' in feed.doc.cams));
  assert.deepStrictEqual([b.holds('puck'), b.doc.marks, b.others], [true, { m1: 1 }, 0]);
  b.link.close(); feed.session.link.close();
});

test('a page of another build is refused and does not keep trying', async () => {
  const link = M.link.connect(URL, { build: 1, name: 'old' });
  const closes = []; link.onClose = (w) => closes.push(w);
  await until('refused', () => link.why === 'version');
  await sleep(1300);
  assert.strictEqual(link.open, false);
  link.close();
});

test('the engine and the app are served side by side', async () => {
  const r1 = await fetch(`http://127.0.0.1:${PORT}/mumr/session.js`), r2 = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.deepStrictEqual([r1.status, r2.status, await r2.text()], [200, 200, '<p>test</p>']);
  assert.ok((await r1.text()).includes('class Session'));
});

test('a player whose connection drops comes back to its place; the other never sees it leave', async () => {
  const a = player('A'), b = player('B');
  await until('both in', () => a.connected && b.connected);
  const slot = a.me, peerEvents = [];
  b.on('peer', (s, on) => peerEvents.push([s, on]));
  a.link.drop();
  await until('A back', () => a.link.open && a.link.resumed, 6000);
  assert.strictEqual(a.me, slot);
  await sleep(100);
  assert.deepStrictEqual(peerEvents, [], 'B was not told A left');
  assert.ok(b.peers.has(slot));
  a.link.close(); b.link.close();
});
