// What the pages, the host and the tests share about the app's session: the settings, the document's kind, the shared menu (the board) and
// the music's volume and the room's dim. No THREE, no DOM. (Everything else is in spec.js, rules.js, tower.js, net.js, replay.js, referee.js.)
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec'), { scoreboard, banner } = need('rules');
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;

  const GAME = { music: 2, dim: 2 };            // the music's volume, 0..4, and how far the game dims the real room, 0..2 (focus.js): one setting for everybody (it is the room's)
  const PLAYER = { ghost: true };               // whether this player's ghost fingers are shown (what a player carries)
  const ACTIONS = [];
  const VOL = ['off', 'low', 'medium', 'high', 'full'], DIM = ['off', 'gentle', 'full'];
  // the settings buttons of the board
  function press(id, st) {
    if (id === 'musicUp') return Object.assign({}, st, { music: Math.min(4, (st.music === undefined ? 2 : st.music) + 1) });
    if (id === 'musicDown') return Object.assign({}, st, { music: Math.max(0, (st.music === undefined ? 2 : st.music) - 1) });
    if (id === 'dimUp') return Object.assign({}, st, { dim: Math.min(2, (st.dim === undefined ? 2 : st.dim) + 1) });
    if (id === 'dimDown') return Object.assign({}, st, { dim: Math.max(0, (st.dim === undefined ? 2 : st.dim) - 1) });
    if (id === 'ghost') return Object.assign({}, st, { ghost: !st.ghost });
    return null;
  }
  // the one event: the whole game state, kept by the server under one key (a newcomer has it at once)
  const KINDS = { jstate: {
    keep: () => ({ key: 'jenga:state' }),
    apply(sess, e) { if (e.s && typeof e.s === 'object' && Array.isArray(e.s.players) && typeof e.s.phase === 'string') { sess.doc.jenga = e.s; sess.notify('jenga', e.s); } },
  } };

  const colourLabel = (c) => (c === null || c === undefined ? '?' : S.COLOURS[c].label);
  // The board: ONE menu for everybody, drawn from the shared state (s: the game state, g: the shared settings, mine: this player's, here: how many players).
  // The buttons that cannot be pressed now are off.
  function board(s, info = {}) {
    const ph = s.phase, noHost = info.host === false, g = info.game || GAME, mine = info.mine || PLAYER, here = info.here || 0, midRound = ['roll', 'pull', 'place', 'fall', 'replay', 'aftermath'].includes(ph);
    const turn = s.players[s.turn] ? s.players[s.turn].name : '-', size = S.SIZES[s.size] || S.SIZES.normal, tw = s.tower || { full: 17 };
    const main = [];
    if (noHost) main.push({ plate: true, label: 'Waiting for the PC host', value: 'start the server on the PC: node tools/run.js jenga', span: 3 });
    else if (ph === 'lobby') main.push({ id: 'start', label: 'Start game', value: here ? `${here} ${here === 1 ? 'player' : 'players'} here` : 'nobody here', span: 3, active: true, off: !here });
    else if (ph === 'roll' || ph === 'pull') main.push({ id: 'reroll', label: 'Roll the die again', value: 'puts it back on the tray', span: 3, off: !!s.handled });
    else if (ph === 'place') main.push({ id: 'back', label: 'Block lost?', value: 'puts it back on the plinth', span: 3 });
    else if (ph === 'fall' || ph === 'replay') main.push({ id: 'skip', label: 'Skip the replay', value: 'the tower finishes falling', span: 3, active: true });
    else if (ph === 'round_end') main.push({ id: 'round', label: `Round ${s.round + 1} of ${s.rounds}`, value: 'build the tower again', span: 3, active: true });
    else if (ph === 'match_end') main.push({ id: 'lobby', label: 'New match', value: 'back to the start', span: 3, active: true });
    else main.push({ label: banner(s, colourLabel), span: 3 });
    const vol = g.music === undefined ? 2 : g.music, dim = g.dim === undefined ? 2 : g.dim;
    return M.menus.grid({ w: 1024, title: 'JENGA', note: s.tower ? `take from below level ${tw.full + 1}` : '', rowH: 92,
      rows: [
        [{ plate: true, span: 3, label: noHost ? 'No host' : banner(s, colourLabel), value: noHost ? 'the tower is built by the PC host' : s.ticker && s.ticker.length ? s.ticker[s.ticker.length - 1] : '' }],
        [{ plate: true, label: ph === 'lobby' ? 'Tower' : `Round ${s.round} of ${s.rounds}`, value: ph === 'lobby' ? `${size.name}, ${size.note}` : `${s.moves} ${s.moves === 1 ? 'move' : 'moves'}` }, { plate: true, label: 'On turn', value: ph === 'lobby' ? '-' : turn }, { plate: true, label: 'Die', value: s.roll === null || s.roll === undefined ? 'not rolled' : `${S.COLOURS[s.roll].name} (${S.COLOURS[s.roll].label})` }],
        main,
        [{ id: 'size', label: 'Size', value: `${size.name}: ${size.note}`, off: ph !== 'lobby' }, { id: 'place', label: 'Move the game here', value: 'in front of me', off: midRound }, { plate: true, label: 'Music', value: VOL[vol], sub: [{ id: 'musicDown', label: '-', off: vol <= 0 }, { id: 'musicUp', label: '+', off: vol >= 4 }] }],
        [{ plate: true, label: 'Room dim', value: DIM[dim], sub: [{ id: 'dimDown', label: '-', off: dim <= 0 }, { id: 'dimUp', label: '+', off: dim >= 2 }] }, { id: 'ghost', label: 'My ghost fingers', value: mine.ghost === false ? 'hidden' : 'shown', active: mine.ghost !== false, span: 2 }],
      ] });
  }

  // what a page shows before the host has said anything: the lobby, in the default place
  const waiting = () => ({ v: 1, rev: 0, size: 'normal', seed: 1, place: { x: 1.6, y: 0.6, yaw: 0 }, phase: 'lobby', round: 0, rounds: 3, players: [], turn: 0, roll: null, moves: 0, scores: {}, ticker: [], handled: null, fall: null, winner: null, last: null, tower: { full: 17, top: 17, topCount: 3 } });

  Object.assign(J, { GAME, PLAYER, ACTIONS, VOL, DIM, press, KINDS, board, colourLabel, scoreboard, banner, waiting });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
