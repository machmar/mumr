// The wrist menu's camera menu (sysmenu.js, Marek 2026-10-31): Cameras in the line-up menu opens it; it chooses which camera the knobs are for
// (a press takes the next), brings the chosen one in front of the player, resets it.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');

test('the camera menu: the chosen camera, the next one, Place in front of me and Reset position act on it', () => {
  const S = new M.session.Session(null, {}), sp = new M.align.Space(null, 0), L = new M.lineup.LineUp(S, sp), done = [];
  let list = [{ id: 'cam-a', name: 'Desk', x: 1, y: 2, z: 1.2, hand: false }, { id: 'cam-b', name: 'Close', x: 0.3, y: 0.1, z: 0.6, hand: true }];
  const sys = new M.sysmenu.SysMenu(S, L, { cams: () => ({ count: list.length, list }), camHere: (id) => done.push(`here ${id}`), camReset: (id) => done.push(`reset ${id}`) });
  const lay = () => M.sysmenu.SysMenu.layout(sys.info()), btn = (id) => lay().buttons.find((b) => b.id === id);
  sys.press('sysOpen'); sys.press('camMenu');
  assert.strictEqual(sys.info().camOpen, false, 'only while lining up');
  sys.press('lineUp');
  assert.ok(btn('camMenu'), 'the line-up menu has Cameras');
  sys.press('camMenu');
  assert.strictEqual(lay().title.text, 'Desk');
  assert.strictEqual(sys.camId(), 'cam-a', 'the first is chosen at first');
  assert.strictEqual(btn('camNext').label, 'Camera 1 of 2');
  sys.press('camNext');
  assert.deepStrictEqual([sys.camId(), lay().title.text, btn('camNext').label], ['cam-b', 'Close', 'Camera 2 of 2']);
  sys.press('camHere'); sys.press('camReset');
  assert.deepStrictEqual(done, ['here cam-b', 'reset cam-b']);
  sys.press('camNext'); assert.strictEqual(sys.camId(), 'cam-a', 'round again');
  assert.ok(btn('camRough') && !btn('camRough').active, 'Rough move, off at first, for a camera its clicks placed');
  sys.press('camRough'); assert.ok(sys.camRough && btn('camRough').active, 'on');
  const K = new M.camknobs.CamKnobs(), c = Object.assign({ yaw: 0, pitch: -0.2 }, list[0]);
  assert.ok(K.knobs([Object.assign({}, c, { grab: true })]).some((k) => k.axis === 'body') && !K.knobs([c]).some((k) => k.axis === 'body'), 'Rough move gives it the body knob');
  sys.press('camRough'); assert.strictEqual(sys.camRough, false);
  list = [list[1]];
  assert.strictEqual(sys.camId(), 'cam-b', 'the chosen one went: the first that is left');
  assert.ok(!btn('camNext'), 'one camera: nothing to go on to');
  sys.press('camBack'); assert.ok(btn('spot1'), 'Back: the line-up menu again');
  sys.press('camMenu'); sys.press('lineUp');
  assert.strictEqual(sys.info().camOpen, false, 'Done closes it with lining up');
  assert.strictEqual(sys.camRough, false, 'and Rough move');
});
