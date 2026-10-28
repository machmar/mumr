// The room's dim (engine/client/dim.js) and its place in the shared document (session.js kind 'dim').
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/index.js');
const { Hub } = require('./hubfake.js');
const D = M.dim;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

test('no dim: the room as it is, hands dimmed with it', () => {
  assert.deepStrictEqual(D.level(null, 0), { dark: 0, mute: 0, over: true });
  assert.deepStrictEqual(D.layer(D.level(null, 0)), { a: 0, c: 0 });
});

test('a fade eases from the look it started at, on the given clock', () => {
  const d = D.clean(D.event(null, { dark: 0.8, fade: 1000 }, 5000));
  near(D.level(d, 5000).dark, 0, 'start');
  near(D.level(d, 5500).dark, 0.4, 'middle');
  near(D.level(d, 6000).dark, 0.8, 'end');
  near(D.level(d, 9000).dark, 0.8, 'after');
  // lighten again from wherever it is: half way into the dark fade the new one starts at 0.4
  const back = D.clean(D.event(d, { dark: 0, fade: 4000 }, 5500));
  near(back.from.dark, 0.4, 'from');
  near(D.level(back, 9500).dark, 0, 'lit again');
  assert.strictEqual(back.mute, 0);
});

test('a value left out stays as asked; over follows the last ask', () => {
  const a = D.clean(D.event(null, { dark: 0.5, mute: 0.3, over: false }, 0));
  const b = D.clean(D.event(a, { mute: 1 }, 10));
  assert.deepStrictEqual([b.dark, b.mute, b.over], [0.5, 1, false]);
});

test('a time from another clock never leaves it stuck at the start', () => {
  const d = D.clean(D.event(null, { dark: 1, fade: 2000 }, 1e9));
  assert.strictEqual(D.level(d, 1234).dark, 1);
  assert.strictEqual(D.level(D.clean(Object.assign({}, d, { at: null })), 1e9).dark, 1);
});

test('clean keeps numbers in range and throws nothing away it needs', () => {
  const d = D.clean({ k: 'dim', dark: 7, mute: -2, fade: 'x', at: 'y', from: { dark: 'no' } });
  assert.deepStrictEqual(d, { dark: 1, mute: 0, over: true, fade: 0, at: null, from: { dark: 1, mute: 0 } });
  assert.strictEqual(D.clean(null), null);
});

test('the layer: dark makes it black, mute grey, both darken the grey too', () => {
  assert.deepStrictEqual(D.layer({ dark: 1, mute: 0 }), { a: 1, c: 0 });
  const g = D.layer({ dark: 0, mute: 1 });
  near(g.a, 1, 'mute alpha'); near(g.c, D.GREY, 'mute grey');
  const h = D.layer({ dark: 0.5, mute: 0.5 });
  // room 1 (white): 0.5 dark -> 0.5, half way to the grey -> 0.25 + 0.5 * 0.5 * GREY
  near(h.c + 1 * (1 - h.a), 0.25 + 0.25 * D.GREY, 'white room');
});

test('shared: one asks, everybody has the same dim, and a newcomer gets it', () => {
  const hub = new Hub();
  const a = new M.session.Session(hub.link('A')), b = new M.session.Session(hub.link('B'));
  hub.flush();
  const heard = [];
  b.on('dim', (d) => heard.push(d.dark));
  a.dim({ dark: 0.7, fade: 300 });
  hub.flush();
  assert.ok(a.doc.dim && a.doc.dim.dark === 0.7);
  assert.deepStrictEqual(a.doc.dim, b.doc.dim);
  assert.deepStrictEqual(heard, [0.7]);
  const c = new M.session.Session(hub.link('C'));
  hub.flush();
  assert.deepStrictEqual(c.doc.dim, a.doc.dim);
});

test('alone: the dim applies at once', () => {
  const s = new M.session.Session(null);
  s.dim({ dark: 0.2, mute: 0.4 });
  assert.deepStrictEqual([s.doc.dim.dark, s.doc.dim.mute], [0.2, 0.4]);
});

test('relight: a light takes the dim back off the real room near it, less further away, none past its range', () => {
  const l = D.layer({ dark: 0.9, mute: 1 });
  near(D.reach(0, 2, 1, 1), 1, 'at the light, facing it');
  assert.ok(D.reach(0.5, 2, 1, 1) > D.reach(1, 2, 1, 1), 'nearer is stronger');
  assert.strictEqual(D.reach(2, 2, 1, 1), 0, 'none at its range');
  assert.ok(D.reach(0.5, 2, 1, 0) < D.reach(0.5, 2, 1, 1) && D.reach(0.5, 2, 1, 0) > 0, 'a surface edge-on to it gets some');
  near(D.reach(0.5, 2, 1, -1), D.reach(0.5, 2, 1, 1), 'either side of a surface');
  const lit = D.relit(l, 0.5, 0.1);
  near(lit.a, l.a * 0.5, 'half the dim taken off'); near(lit.c, l.c * 0.5 + 0.1, 'its grey too, and the light\'s colour laid on');
  near(D.relit(l, 3).a, l.a * (1 - D.RELIT_MAX), 'never all of it');
  assert.deepStrictEqual(D.relit(l, 0), l, 'no light: the dim as it is');
});

test('a light that shines one way: full inside its cone, none outside, soft between (a shade lights the floor, not the ceiling round it)', () => {
  const D = M.dim;
  assert.strictEqual(D.spot(1, 0.2), 1);
  assert.strictEqual(D.spot(-0.5, 0.2), 0, 'up at the ceiling: nothing');
  const mid = D.spot(0.3, 0.2); assert.ok(mid > 0 && mid < 1, 'soft at the edge');
  assert.strictEqual(D.reach(1, 3, 0.5, 1, 0), 0);
  assert.strictEqual(D.reach(1, 3, 0.5, 1, 1), D.reach(1, 3, 0.5, 1));
});
