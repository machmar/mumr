// The focus (focus.js): what the game asks of the room's dim. Pure numbers: the look of each phase, what tension adds, the levels of the board's
// setting, and when the host is told to ask the engine (only when the look has to change, with the fade that suits the moment).
const { test } = require('node:test');
const assert = require('node:assert');
const F = require('./focus.js');

const st = (phase, o = {}) => Object.assign({ phase, handled: null }, o);

test('the room is as it is in the lobby and at the end of the match; it recedes for a round and goes out at the fall', () => {
  assert.deepStrictEqual(F.focusLook(st('lobby'), 0, 2), { dark: 0, mute: 0 });
  assert.deepStrictEqual(F.focusLook(st('match_end'), 0, 2), { dark: 0, mute: 0 });
  const roll = F.focusLook(st('roll'), 0, 2), pull = F.focusLook(st('pull'), 0, 2), fall = F.focusLook(st('fall'), 0, 2), replay = F.focusLook(st('replay'), 0, 2), after = F.focusLook(st('aftermath'), 0, 2);
  assert.ok(roll.dark > 0 && roll.dark < pull.dark && pull.dark < replay.dark && replay.dark <= fall.dark, 'darker as it goes on');
  assert.strictEqual(fall.mute, 1, 'the freeze is grey');
  assert.ok(after.dark < replay.dark && after.dark > 0, 'it comes back after');
  assert.deepStrictEqual(F.focusLook(null, 0, 2), { dark: 0, mute: 0 }, 'no state: the lobby');
});

test('tension closes the room in while a block is pulled or put on top, and a hand holding one a little more; other phases ignore it', () => {
  const calm = F.focusLook(st('pull'), 0, 2), tense = F.focusLook(st('pull'), 1, 2), held = F.focusLook(st('pull', { handled: { i: 3 } }), 1, 2);
  assert.ok(tense.dark > calm.dark + 0.25 && tense.mute > calm.mute + 0.3, 'a tense pull is much darker and greyer');
  assert.ok(held.dark >= tense.dark && held.mute >= tense.mute);
  assert.deepStrictEqual(F.focusLook(st('place'), 0.5, 2), F.focusLook(st('pull'), 0.5, 2));
  assert.deepStrictEqual(F.focusLook(st('aftermath'), 1, 2), F.focusLook(st('aftermath'), 0, 2), 'tension means nothing after the fall');
  assert.ok(F.focusLook(st('pull', { handled: { i: 3 } }), 1, 2, true).dark <= 0.92, 'never black');
  for (let k = 0; k <= 10; k++) for (const lv of [0, 1, 2]) { const l = F.focusLook(st('pull', { handled: { i: 1 } }), k / 10, lv, true); assert.ok(l.dark <= 0.92 + 1e-9 && l.mute <= 1 && l.dark >= 0 && l.mute >= 0); }
});

test('the Room dim setting: off asks nothing of the room, gentle half of everything, full all of it', () => {
  const full = F.focusLook(st('fall'), 0, 2), gentle = F.focusLook(st('fall'), 0, 1), off = F.focusLook(st('fall'), 0, 0);
  assert.deepStrictEqual(off, { dark: 0, mute: 0 });
  assert.ok(Math.abs(gentle.dark - full.dark / 2) < 0.051 && Math.abs(gentle.mute - full.mute / 2) < 0.051);
});

test('the look comes in steps of 0.05, so that a wobbling tension does not fill the document', () => {
  for (let k = 0; k <= 100; k++) { const l = F.focusLook(st('pull'), k / 100, 2); assert.ok(Math.abs(l.dark * 20 - Math.round(l.dark * 20)) < 1e-9 && Math.abs(l.mute * 20 - Math.round(l.mute * 20)) < 1e-9, `${l.dark} ${l.mute}`); }
});

test('the first update asks for the look (the server may have kept the last host\'s); then nothing until something changes', () => {
  const f = new F.Focus();
  const first = f.update(st('lobby'), 0, 2, 0); assert.deepStrictEqual([first.dark, first.mute, first.over], [0, 0, true]);
  assert.strictEqual(f.update(st('lobby'), 0, 2, 100), null); assert.strictEqual(f.update(st('lobby'), 0, 2, 5000), null);
});

test('a phase is asked at once with its own fade: the fall in 150 ms (the freeze), the aftermath slowly', () => {
  const f = new F.Focus(); f.update(st('pull'), 0.2, 2, 0);
  const fall = f.update(st('fall'), 0.2, 2, 50);                       // (50 ms later: the phase does not wait for the pause between asks)
  assert.deepStrictEqual([fall.dark, fall.mute, fall.fade], [0.9, 1, 150]);
  const replay = f.update(st('replay'), 0, 2, 100); assert.strictEqual(replay.fade, 700);
  const after = f.update(st('aftermath'), 0, 2, 3000); assert.ok(after.fade >= 3000 && after.dark < replay.dark);
  const end = f.update(st('match_end'), 0, 2, 9000); assert.deepStrictEqual([end.dark, end.mute], [0, 0]); assert.ok(end.fade >= 5000);
});

test('inside a phase the look follows the tension, but not more than once in 700 ms', () => {
  const f = new F.Focus(); f.update(st('pull'), 0, 2, 0);
  assert.strictEqual(f.update(st('pull'), 0.6, 2, 200), null, 'too soon');
  const a = f.update(st('pull'), 0.6, 2, 800); assert.ok(a && a.dark > 0.6 && a.fade === 1500);
  assert.strictEqual(f.update(st('pull'), 0.61, 2, 5000), null, 'the same step: nothing to ask');
  const b = f.update(st('pull'), 0.1, 2, 6000); assert.ok(b && b.dark < a.dark, 'and it lets go as the tension does');
});

test('a block coming out tightens the room for a moment and lets it go slowly', () => {
  const f = new F.Focus(); f.update(st('place'), 0.3, 2, 0);
  f.pulse(1000);
  const tight = f.update(st('place'), 0.3, 2, 1050); assert.ok(tight && tight.fade === 150, 'quick in');
  const base = F.focusLook(st('place'), 0.3, 2); assert.ok(tight.dark > base.dark && tight.mute > base.mute);
  assert.strictEqual(f.update(st('place'), 0.3, 2, 1500), null, 'held for 1.2 s');
  const out = f.update(st('place'), 0.3, 2, 2300); assert.ok(out && out.fade === 2500 && out.dark === base.dark, 'then slowly back');
});

test('changing the setting is answered at once, off included', () => {
  const f = new F.Focus(); f.update(st('pull'), 0.5, 2, 0);
  const off = f.update(st('pull'), 0.5, 0, 100); assert.deepStrictEqual([off.dark, off.mute], [0, 0]);
  assert.strictEqual(off.fade, 1200, 'in 1.2 s, not the phase\'s own time');
  const on = f.update(st('pull'), 0.5, 1, 200); assert.ok(on.dark > 0);
});
