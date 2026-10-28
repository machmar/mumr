// The ceiling lights' shades: who marks them is one thing for everybody (the document's jmark), the board's Lights plaque says what it does, and
// the lights themselves are the engine's (room.js: the scan's lamps and the marked ones, in the common frame).
const t = require('node:test'), assert = require('node:assert');
const M = require('../../engine/client/index.js');
const L = require('./logic.js');

const lobby = () => L.waiting();
const plaque = (lay) => lay.buttons.find((b) => b.id === 'lights');

t.test('the board\'s Lights: shade them, then how many are shaded; Done for the one marking; another\'s name for the rest', () => {
  assert.strictEqual(plaque(L.board(lobby(), {})).value, 'shade them');
  assert.strictEqual(plaque(L.board(lobby(), { mark: { slot: null, n: 2 } })).value, '2 shaded');
  const mine = L.board(lobby(), { mark: { slot: 0, mine: true, name: 'Anna', n: 2 } });
  assert.strictEqual(plaque(mine).label, 'Done'); assert.ok(plaque(mine).active);
  assert.strictEqual(mine.status.head, 'Anna', 'the panel says who marks and how');
  assert.ok(/pinch/.test(mine.status.sub));
  const theirs = L.board(lobby(), { mark: { slot: 1, mine: false, name: 'Ben', n: 0 } });
  assert.strictEqual(plaque(theirs).label, 'Lights'); assert.strictEqual(plaque(theirs).value, 'Ben marks');
  // (in the middle of a round it cannot be started: a pinch at the ceiling is not for then)
  const pull = Object.assign(lobby(), { phase: 'pull', players: [{ slot: 0, name: 'Anna' }], roll: 2 });
  assert.ok(plaque(L.board(pull, { mark: { slot: null, n: 0 } })).off);
  assert.ok(!plaque(L.board(pull, { mark: { slot: 0, mine: true, name: 'Anna', n: 0 } })).off, 'but whoever is marking can always say Done');
});

t.test('the board\'s plaques do not overlap', () => {
  const bs = L.board(lobby(), {}).buttons;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j], apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.id || a.label} and ${b.id || b.label}`);
  }
  for (const b of bs) assert.ok(b.x >= 0 && b.x + b.w <= L.BOARD.px, `${b.id || b.label} on the board`);
});

t.test('who marks is kept by the document: a slot, or nobody; nonsense is not kept', () => {
  const S = { doc: {}, notify() {} }, K = L.KINDS.jmark;
  assert.deepStrictEqual(K.keep({ slot: 1 }), { key: 'jenga:mark' });
  K.apply(S, { k: 'jmark', slot: 1 }); assert.deepStrictEqual(S.doc.jmark, { slot: 1 });
  K.apply(S, { k: 'jmark', slot: 'x' }); assert.deepStrictEqual(S.doc.jmark, { slot: 1 });
  K.apply(S, { k: 'jmark', slot: null }); assert.deepStrictEqual(S.doc.jmark, { slot: null });
});

t.test('a fluorescent tube marked by a drag is a long panel\'s light; a tap a round one (the engine\'s list the shades are built from)', () => {
  const R = M.room, list = R.lights(null, { t1: { a: [1, 1], b: [2.2, 1], h: 2.4, w: R.STRIP_W }, r1: { a: [0, 0], b: [0, 0], h: 2.4, w: R.ROUND_W } });
  const tube = list.find((l) => l.id === 't1'), disc = list.find((l) => l.id === 'r1');
  assert.ok(!tube.round && Math.abs(tube.len - 1.2) < 1e-9); assert.ok(disc.round && disc.len === 0);
});
