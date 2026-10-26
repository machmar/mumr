// The shared document (engine/client/session.js) with pretend headsets on a pretend server (hubfake.js).
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const { Hub } = require('./hubfake.js');
const { Session } = M.session;

// a small app: two settings for the game, one per player, two buttons, and marks (a kind with a key)
const APP = {
  game: { floor: 'grid', speed: 1 },
  player: { hue: 'red' },
  actions: ['exit'],
  press: (id, st) => (id === 'floor' ? Object.assign({}, st, { floor: st.floor === 'grid' ? 'wood' : 'grid' }) : id === 'hue' ? Object.assign({}, st, { hue: 'blue' }) : null),
  init: (doc) => { doc.marks = new Map(); },
  kinds: {
    'mark+': { keep: (e) => ({ key: `mark:${e.id}` }), apply: (S, e, from) => { S.doc.marks.set(e.id, { id: e.id, x: e.x }); S.notify('marks', from); } },
    'mark-': { keep: (e) => ({ key: `mark:${e.id}`, drop: true }), apply: (S, e, from) => { S.doc.marks.delete(e.id); S.notify('marks', from); } },
    'pin+': { keep: (e) => ({ key: `pin:${e.id}`, own: true, gone: { k: 'pin-', id: e.id } }), apply: (S, e) => { S.doc.cams = Object.assign({}, S.doc.cams, { [e.id]: e.x }); } },
    'pin-': { apply: (S, e) => { const c = Object.assign({}, S.doc.cams); delete c[e.id]; S.doc.cams = c; } },
  },
};
const player = (hub, name, extra = {}) => { const s = new Session(hub.link(name), Object.assign({}, APP, extra)); s.log = []; for (const k of ['first', 'synced', 'action', 'do', 'ask', 'game']) s.on(k, (...a) => s.log.push([k, ...a])); return s; };

test('alone: the same code path, events apply at once, buttons work', () => {
  const s = new Session(null, APP);
  assert.strictEqual(s.connected, false);
  s.emit({ k: 'mark+', id: 'a', x: 1 });
  assert.deepStrictEqual([...s.doc.marks.keys()], ['a']);
  s.press(null, 'floor');
  s.press(5, 'hue');                                       // (alone, any menu is ours)
  assert.deepStrictEqual([s.doc.game.floor, s.mine.hue], ['wood', 'blue']);
  assert.strictEqual(s.holds('anything'), true);
  assert.strictEqual(s.sharing(), false);
});

test('the first one in publishes its world; a newcomer takes the server\'s', () => {
  const hub = new Hub();
  const a = new Session(null, APP);                        // (it played alone first, then connects)
  a.emit({ k: 'mark+', id: 'm1', x: 2 });
  a.press(null, 'floor');
  const la = hub.link('A');
  a.link = la; la.onOpen = (h) => a._hello(h); la.onText = (m) => a._text(m); la.onClose = (w) => a._closed(w);
  const firsts = []; a.on('first', () => firsts.push(1));
  hub.flush();
  assert.deepStrictEqual(firsts, [1]);
  a.emit({ k: 'mark+', id: 'm1', x: 2 });                    // (the app publishes its own world on 'first')
  hub.flush();
  assert.deepStrictEqual([...hub.doc.keys()].sort(), ['game:*', 'mark:m1', 'player:0:*']);
  const b = player(hub, 'B', { mine: { floor: 'grid', hue: 'green' } });
  hub.flush();
  assert.deepStrictEqual(b.log.map((l) => l[0]).filter((k) => k !== 'game'), ['synced']);
  assert.deepStrictEqual([b.doc.game.floor, [...b.doc.marks.keys()], b.stateOf(0).hue], ['wood', ['m1'], 'red']);
  assert.strictEqual(a.stateOf(1).hue, 'green', 'and the first hears who came');
});

test('two quick presses before the first one came back count twice; the order of the server still decides', () => {
  const hub = new Hub();
  const a = new Session(hub.link('A'), Object.assign({}, APP, { game: { n: 0 }, press: (id, st) => Object.assign({}, st, { n: st.n + 1 }) }));
  const b = new Session(hub.link('B'), Object.assign({}, APP, { game: { n: 0 } }));
  hub.flush();
  a.press(null, 'plus'); a.press(null, 'plus');
  assert.deepStrictEqual([a.game('n'), a.stateOf(null).n, a.doc.game.n], [2, 2, 0], 'shown at once, not in the document yet');
  hub.flush();
  assert.deepStrictEqual([a.game('n'), a.doc.game.n, b.doc.game.n, a._pend.game.size], [2, 2, 2, 0]);
  a.setMine('hue', 'blue');
  assert.strictEqual(a.stateOf(null).hue, 'blue');
  hub.leave(0);
  assert.deepStrictEqual([a.mine.hue, a.connected], ['blue', false], 'a change that never came back is ours when alone');
});

test('a button on another player\'s menu acts for that player, and an action happens at its owner', () => {
  const hub = new Hub();
  const a = player(hub, 'A'), b = player(hub, 'B');
  hub.flush();
  b.press(0, 'hue');                                       // B presses on A's menu
  hub.flush();
  assert.deepStrictEqual([a.mine.hue, b.mine.hue, b.stateOf(0).hue], ['blue', 'red', 'blue']);
  b.press(0, 'floor');
  hub.flush();
  assert.deepStrictEqual([a.doc.game.floor, b.doc.game.floor], ['wood', 'wood'], 'a game setting is everybody\'s');
  b.press(0, 'exit');
  hub.flush();
  assert.deepStrictEqual(a.log.filter((l) => l[0] === 'action'), [['action', 'exit', 1]]);
  assert.deepStrictEqual(b.log.filter((l) => l[0] === 'action'), []);
});

test('lined up and sharing; a player who leaves takes its own with it, the rest stays', () => {
  const hub = new Hub();
  const a = player(hub, 'A'), b = player(hub, 'B');
  hub.flush();
  a.setLined({ dist: 3.3456 }); hub.flush();
  assert.strictEqual(a.sharing(), false, 'nobody else is lined up');
  b.setLined({ dist: 3.34 }); b.setCheck([1, 2, 0.01]); b.emit({ k: 'mark+', id: 'x', x: 0 }); hub.flush();
  assert.deepStrictEqual([a.sharing(), b.sharing(), a.lined(1).dist, a.doc.checks[1]], [true, true, 3.34, [1, 2, 0.01]]);
  hub.leave(1); hub.flush();
  assert.deepStrictEqual([a.sharing(), a.lined(1), a.doc.checks[1], [...a.doc.marks.keys()]], [false, null, undefined, ['x']]);
  assert.deepStrictEqual([...hub.doc.keys()].filter((k) => k.includes(':1')), [], 'the server forgot what was B\'s');
  const c = player(hub, 'C'); hub.flush();
  assert.deepStrictEqual([...c.doc.marks.keys()], ['x']);
});

test('an owned thing: only its owner changes it, others ask, and it goes when the owner goes', () => {
  const hub = new Hub();
  const a = player(hub, 'A'), b = player(hub, 'B');
  hub.flush();
  a.emit({ k: 'pin+', id: 'w', x: 1 }); hub.flush();
  assert.deepStrictEqual([b.doc.cams, b.ownerOf('pin:w')], [{ w: 1 }, 0]);
  b.emit({ k: 'pin+', id: 'w', x: 9 }); hub.flush();
  assert.deepStrictEqual(a.doc.cams, { w: 1 }, 'B cannot move A\'s camera');
  b.request('pin:w', { x: 5 }); hub.flush();
  assert.deepStrictEqual(a.log.filter((l) => l[0] === 'ask'), [['ask', 'pin:w', { x: 5 }, 1]]);
  hub.leave(0); hub.flush();
  assert.deepStrictEqual([b.doc.cams, b.ownerOf('pin:w')], [{}, null]);
});

test('do goes to the holder of the token; tokens made by a claim; busy keeps it', () => {
  const hub = new Hub({ bodies: ['sim'] });
  const a = player(hub, 'A'), b = player(hub, 'B');
  hub.flush();
  assert.deepStrictEqual([a.holds('sim'), b.holds('sim'), b.holder('sim')], [true, false, 0]);
  b.emit({ k: 'do', token: 'sim', what: 'place', args: { x: 1 } }); hub.flush();
  assert.deepStrictEqual([a.log.filter((l) => l[0] === 'do'), b.log.filter((l) => l[0] === 'do')], [[['do', 'sim', 'place', { x: 1 }, 1]], []]);
  b.claim('cube', 1000); hub.flush();
  assert.deepStrictEqual([b.holds('cube'), a.holder('cube')], [true, 1]);
  b.setBusy('cube', true); a.claim('cube', 1000); hub.flush();
  assert.strictEqual(b.holds('cube'), true);
  assert.strictEqual(a.claim('cube', 1050), false, 'not again so soon');
  b.release('cube'); hub.flush();
  assert.deepStrictEqual([a.holder('cube'), b.holds('cube')], [null, false]);
});

test('a newcomer asks the holder of each token for its full state (keyframe)', () => {
  const hub = new Hub({ bodies: ['sim'] });
  const a = player(hub, 'A');
  a.on('keyframe?', (t) => (t === 'sim' ? { hidden: [1, 2, 3] } : undefined));
  hub.flush();
  const b = player(hub, 'B'), got = [];
  b.on('keyframe', (t, data, from) => got.push([t, data, from]));
  hub.flush();
  assert.deepStrictEqual(got, [['sim', { hidden: [1, 2, 3] }, 0]]);
});

test('a lost link: alone again, everything is ours, the document stays', () => {
  const hub = new Hub({ bodies: ['sim'] });
  const a = player(hub, 'A'), b = player(hub, 'B'), toks = [];
  hub.flush();
  b.on('token', (t, mine) => toks.push([t, mine]));
  b.emit({ k: 'mark+', id: 'q', x: 1 }); hub.flush();
  hub.leave(1);
  assert.deepStrictEqual([b.connected, b.holds('sim'), [...b.doc.marks.keys()], b.others], [false, true, ['q'], 0]);
  assert.deepStrictEqual(toks, [['sim', true]]);
});

test('a viewer replays the document and cannot change it', () => {
  const hub = new Hub();
  const a = player(hub, 'A'); hub.flush();
  a.emit({ k: 'mark+', id: 'v', x: 4 }); a.press(null, 'floor'); hub.flush();
  const v = new Session(hub.link('pc', 'viewer'), APP); hub.flush();
  assert.deepStrictEqual([v.isViewer, v.doc.game.floor, [...v.doc.marks.keys()], v.stateOf(0).hue, v.sending()], [true, 'wood', ['v'], 'red', false]);
  v.emit({ k: 'mark+', id: 'nope', x: 0 }); hub.flush();
  assert.deepStrictEqual([...a.doc.marks.keys()], ['v']);
  v.emit({ k: 'pin+', id: 'pc', x: 2 }); hub.flush();
  assert.deepStrictEqual(a.doc.cams, { pc: 2 }, 'but a viewer may own a thing (its camera)');
  assert.strictEqual(a.viewers, 1);
  assert.strictEqual(a.sending(), false, 'not lined up: nothing to send');
  a.setLined({ dist: 1 }); hub.flush();
  assert.strictEqual(a.sending(), true, 'lined up and watched');
});

test('the page\'s offset to the server clock goes out now and then', () => {
  const hub = new Hub();
  const a = player(hub, 'A'), b = player(hub, 'B'); hub.flush();
  a.link.clockOffset = 12.34;
  a.tick(10000); a.tick(10500); hub.flush();
  assert.deepStrictEqual([...b.clocks], [[0, 12.3]]);
});
