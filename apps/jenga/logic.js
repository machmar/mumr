// What the pages, the host and the tests share about the app's session: the settings, the document's kind, the shared menu (the board) and
// the music's volume and the room's dim. No THREE, no DOM. (Everything else is in spec.js, rules.js, tower.js, net.js, replay.js, referee.js.)
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec'), { scoreboard, banner } = need('rules');

  const GAME = { music: 2, dim: 2, garden: 2 };  // the music's volume, 0..4, how far the game dims the real room, 0..2 (focus.js), the room's garden, 0..2 (deco.js): one setting for everybody (it is the room's)
  const PLAYER = { ghost: true };               // whether this player's ghost fingers are shown (what a player carries)
  const ACTIONS = [];
  const VOL = ['off', 'low', 'medium', 'high', 'full'], DIM = ['off', 'gentle', 'full'], GARDEN = ['none', 'sparse', 'full'];
  // the settings buttons of the board
  function press(id, st) {
    if (id === 'musicUp') return Object.assign({}, st, { music: Math.min(4, (st.music === undefined ? 2 : st.music) + 1) });
    if (id === 'musicDown') return Object.assign({}, st, { music: Math.max(0, (st.music === undefined ? 2 : st.music) - 1) });
    if (id === 'dimUp') return Object.assign({}, st, { dim: Math.min(2, (st.dim === undefined ? 2 : st.dim) + 1) });
    if (id === 'dimDown') return Object.assign({}, st, { dim: Math.max(0, (st.dim === undefined ? 2 : st.dim) - 1) });
    if (id === 'ghost') return Object.assign({}, st, { ghost: !st.ghost });
    if (id === 'garden') return Object.assign({}, st, { garden: ((st.garden === undefined ? 2 : st.garden) + 2) % 3 });       // (full, sparse, none, full ...)
    return null;
  }
  // the one event: the whole game state, kept by the server under one key (a newcomer has it at once)
  const KINDS = { jstate: {
    keep: () => ({ key: 'jenga:state' }),
    apply(sess, e) { if (e.s && typeof e.s === 'object' && Array.isArray(e.s.players) && typeof e.s.phase === 'string') { sess.doc.jenga = e.s; sess.notify('jenga', e.s); } },
  },
  // the room's garden (deco.js): what the host placed in the real room, kept like the state (a newcomer grows the same garden)
  jdeco: {
    keep: () => ({ key: 'jenga:deco' }),
    apply(sess, e) { if (e.d && typeof e.d === 'object' && Array.isArray(e.d.items)) { sess.doc.jdeco = e.d; sess.notify('jdeco', e.d); } },
  },
  // who is marking the room's ceiling lights (the board's Lights; shades.js): one player at a time, everybody sees where they point
  jmark: {
    keep: () => ({ key: 'jenga:mark' }),
    apply(sess, e) { if (e.slot === null || Number.isInteger(e.slot)) { sess.doc.jmark = { slot: e.slot }; sess.notify('jmark', sess.doc.jmark); } },
  } };

  const colourLabel = (c) => (c === null || c === undefined ? '?' : S.COLOURS[c].label);
  // The board: ONE menu for everybody, drawn from the shared state (s: the game state, g: the shared settings, mine: this player's, here: how many players).
  // It is not a grid of buttons: it is a stand of wood (stand.js) with a lit paper panel that says what is going on, and wooden plaques hanging on cords
  // that are pressed with a fingertip (the engine's board presses: menus.hit on these rectangles, in pixels of a BOARD.px x BOARD.py canvas).
  // A button that cannot be pressed now is `off` (its plaque hangs turned round). kind: 'ema' (a plaque), 'token' (a small round one), 'tag' (a
  // plaque that only says something).
  const BOARD = { w: 0.72, px: 1200, py: 780, status: { x: 50, y: 22, w: 1100, h: 262 }, rails: [318, 592] };
  function board(s, info = {}) {
    const ph = s.phase, noHost = info.host === false, g = info.game || GAME, mine = info.mine || PLAYER, here = info.here || 0, midRound = ['roll', 'pull', 'place', 'fall', 'replay', 'aftermath'].includes(ph);
    const turnP = s.players[s.turn], size = S.SIZES[s.size] || S.SIZES.normal, tw = s.tower || { full: 17 };
    // the plaque in the middle: what can be done now
    let main;
    if (noHost) main = { label: 'Waiting', value: 'for the PC host', off: true };
    else if (ph === 'lobby') main = { id: 'start', label: 'Start game', value: here ? `${here} ${here === 1 ? 'player' : 'players'} here` : 'nobody here', active: true, off: !here };
    else if (ph === 'roll' || ph === 'pull') main = { id: 'reroll', label: 'Roll again', value: 'the die back on the tray', off: !!s.handled };
    else if (ph === 'place') main = { id: 'back', label: 'Block lost?', value: 'back on the plinth' };
    else if (ph === 'fall' || ph === 'replay') main = { id: 'skip', label: 'Skip replay', value: 'let it fall', active: true };
    else if (ph === 'round_end') main = { id: 'round', label: `Round ${s.round + 1}`, value: `of ${s.rounds}: build it again`, active: true };
    else if (ph === 'match_end') main = { id: 'lobby', label: 'New match', value: 'back to the start', active: true };
    else main = { label: '', value: '', off: true };
    // (mark: who marks the ceiling lights, { slot, mine, name, n (lights shaded) }; info.mark is worked out by the page)
    const mk = info.mark || { slot: null, n: 0 }, marking = mk.slot !== null && mk.slot !== undefined;
    const vol = g.music === undefined ? 2 : g.music, dim = g.dim === undefined ? 2 : g.dim, gdn = g.garden === undefined ? 2 : g.garden, R1 = 340, R2 = 612;
    const b = (o, x, y, w, h, kind) => Object.assign({ value: '', active: false, off: false }, o, { x, y, w, h, kind });
    const buttons = [
      b({ id: 'size', label: 'Size', value: `${size.name} · ${size.note.replace(' tower', '')}`, off: ph !== 'lobby' || noHost }, 80, R1 + 14, 260, 196, 'ema'),
      b(main, 400, R1, 400, 224, 'ema'),
      b({ id: 'place', label: 'Move here', value: 'the game, in front of me', off: midRound || noHost }, 860, R1 + 14, 260, 196, 'ema'),
      b({ id: 'musicDown', label: '-', off: vol <= 0 }, 50, R2 + 20, 76, 76, 'token'),
      b({ label: 'Music', value: VOL[vol], level: vol / 4 }, 134, R2, 128, 118, 'tag'),
      b({ id: 'musicUp', label: '+', off: vol >= 4 }, 270, R2 + 20, 76, 76, 'token'),
      b({ id: 'dimDown', label: '-', off: dim <= 0 }, 380, R2 + 20, 76, 76, 'token'),
      b({ label: 'Room dim', value: DIM[dim], level: dim / 2 }, 464, R2, 128, 118, 'tag'),
      b({ id: 'dimUp', label: '+', off: dim >= 2 }, 600, R2 + 20, 76, 76, 'token'),
      b({ id: 'garden', label: 'Garden', value: GARDEN[gdn], active: gdn > 0 }, 700, R2, 136, 118, 'ema'),
      b({ id: 'lights', label: mk.mine ? 'Done' : 'Lights', value: mk.mine ? 'marking' : marking ? `${mk.name} marks` : mk.n ? `${mk.n} shaded` : 'shade them', active: !!mk.mine || mk.n > 0, off: midRound && !mk.mine }, 850, R2, 136, 118, 'ema'),
      b({ id: 'ghost', label: 'Ghosts', value: mine.ghost === false ? 'fingers hidden' : 'fingers shown', active: mine.ghost !== false }, 1000, R2, 136, 118, 'ema'),
    ];
    // the paper panel: a headline, a line under it, the die's colour, the round
    let head = banner(s, colourLabel), sub = '';
    if (noHost) { head = 'Waiting for the host'; sub = 'start the server on the PC: node tools/run.js jenga'; }
    else if (ph === 'lobby') { head = 'Jenga'; sub = here ? 'gather round the tower, then press Start game' : 'nobody is here yet'; }
    else if (ph === 'roll') { head = turnP ? turnP.name : ''; sub = 'roll the die on the tray'; }
    else if (ph === 'pull') { const c = colourLabel(s.roll); head = turnP ? turnP.name : ''; sub = `pull ${/^[aeiou]/.test(c) ? 'an' : 'a'} ${c} block from below level ${tw.full + 1}`; }
    else if (ph === 'place') { head = turnP ? turnP.name : ''; sub = 'now put it on top'; }
    else if (ph === 'fall') { head = 'Timber'; sub = s.fall ? `${(s.players.find((p) => p.slot === s.fall.by) || {}).name || ''} toppled it` : ''; }
    else if (ph === 'replay') { head = 'Replay'; sub = 'once more, slowly'; }
    else if (ph === 'aftermath') sub = 'three points lost';
    else if (ph === 'round_end') sub = s.ticker && s.ticker.length ? s.ticker[s.ticker.length - 1] : '';
    else if (ph === 'match_end') sub = 'the match is over';
    if (marking && !midRound && !noHost) { head = mk.name; sub = 'point at a ceiling light and pinch · along a tube, pinch and draw'; }
    const status = { head, sub, phase: ph, noHost, roll: ['pull', 'place'].includes(ph) ? s.roll : null, round: s.round, rounds: s.rounds, turn: ph === 'match_end' ? (s.winner && s.winner.length === 1 ? s.winner[0] : null) : turnP ? turnP.slot : null };
    return { w: BOARD.px, h: BOARD.py, title: { text: 'JENGA', note: s.tower ? `take from below level ${tw.full + 1}` : '', h: 0 }, status, buttons };
  }

  // what a page shows before the host has said anything: the lobby, in the default place
  const waiting = () => ({ v: 1, rev: 0, size: 'normal', seed: 1, place: { x: 1.6, y: 0.6, yaw: 0 }, phase: 'lobby', round: 0, rounds: 3, players: [], turn: 0, roll: null, moves: 0, scores: {}, ticker: [], handled: null, fall: null, winner: null, last: null, tower: { full: 17, top: 17, topCount: 3 } });

  Object.assign(J, { GAME, PLAYER, ACTIONS, VOL, DIM, GARDEN, press, KINDS, BOARD, board, colourLabel, scoreboard, banner, waiting });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
