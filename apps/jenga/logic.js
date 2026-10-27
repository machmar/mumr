// The app's plain logic: its settings, what its buttons do, its menu. No THREE, no DOM, so Node tests it (app.test.js) and the page loads it
// as window.APP. Copy this folder (tools/new-app.js does) and change it.
(function (A) {
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const COLOURS = ['tomato', 'gold', 'mediumseagreen', 'deepskyblue', 'orchid'];

  const GAME = { count: 0 };                  // one set for everybody
  const PLAYER = { colour: 0 };               // each player's own: what their menu shows
  const ACTIONS = ['hello'];                  // buttons that happen at the menu owner's headset (app.js onAction)

  // What a settings button does: the state after it (null: not a settings button). `st` is the game's, or the player's, state.
  function press(id, st) {
    if (id === 'plus') return Object.assign({}, st, { count: st.count + 1 });
    if (id === 'colour') return Object.assign({}, st, { colour: (st.colour + 1) % COLOURS.length });
    return null;
  }

  // The app's floating menu: for this player, for the others' and for the PC view. st = that player's state, info = what its owner says about it.
  function menu(st, info) {
    info = info || {};
    return M.menus.grid({ w: 1024, title: 'MUMR jenga', note: info.note || '',
      rows: [[{ id: 'plus', label: 'Count', value: String(st.count) }, { id: 'colour', label: 'My colour', value: COLOURS[st.colour % COLOURS.length], active: true }, { id: 'hello', label: 'Say hello', value: 'at my headset' }]] });
  }

  Object.assign(A, { COLOURS, GAME, PLAYER, ACTIONS, press, menu });
})(typeof module !== 'undefined' ? module.exports : (globalThis.APP = {}));
