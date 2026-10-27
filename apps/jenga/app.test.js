// The app's logic (logic.js) with two pretend headsets on the pretend server.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../../engine/client/index.js');
const { Hub } = require('../../engine/test/hubfake.js');
const A = require('./logic.js');

test('a press changes the setting for everybody, and the menu shows it', () => {
  assert.deepStrictEqual(A.press('plus', { count: 2 }), { count: 3 });
  assert.strictEqual(A.press('nothing', { count: 2 }), null);
  const hub = new Hub();
  const a = hub.link('A'), b = hub.link('B');
  const mk = (link) => new M.session.Session(link, { game: A.GAME, player: A.PLAYER, actions: A.ACTIONS, press: A.press });
  const sa = mk(a), sb = mk(b);
  hub.flush();
  sa.press(null, 'plus'); hub.flush();
  assert.strictEqual(sb.game('count'), 1);
  const lay = A.menu(sb.stateOf(null), {});
  assert.ok(lay.buttons.some((x) => x.id === 'plus' && x.value === '1'));
});
