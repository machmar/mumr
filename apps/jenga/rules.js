// The game's rules, with no physics, no THREE and no DOM: who is playing, whose turn it is, what the die said, what a move is worth, who
// topples the tower, how a round and a match end. The host (host.js) drives it from what the tower's physics reports (tower.js) and puts
// `view()` in the shared document, so every page and every PC view reads the same state (rule 1); nothing here is kept on one page.
//
//   A match is three rounds. A round: the players take turns. A turn: roll the die, pull a block of the colour it shows from a level below
//   the highest complete one, put it on top. A clean move scores 1, and 1 more when the block came from the bottom third (levels 0 to 5).
//   Whoever's turn it is when a block other than the pulled one reaches the ground topples the tower: -3, and the round ends (a tower that
//   falls within a few seconds of a placement is the placer's: they left it like that). The highest total after three rounds wins.
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const PHASES = ['lobby', 'roll', 'pull', 'place', 'fall', 'replay', 'aftermath', 'round_end', 'match_end'];
  const RULES = { rounds: 3, clean: 1, bottom: 1, bottomLevels: 6, topple: -3, grace: 3000 };
  const TICKER = 5;

  class Rules {
    // opts: { rounds, now: () => ms, present: (slot) => bool (the host's idea of who is here) }
    constructor(opts = {}) {
      this.cfg = Object.assign({}, RULES, opts.rounds ? { rounds: opts.rounds } : {});
      this.now = opts.now || (() => Date.now());
      this.present = opts.present || (() => true);
      this.s = { v: 1, rev: 0, size: 'normal', seed: 1, place: null, phase: 'lobby', round: 0, rounds: this.cfg.rounds, players: [], turn: 0, roll: null, moves: 0, scores: {}, ticker: [], handled: null, fall: null, winner: null, last: null };
      this.lastPlacedAt = -1e9;
    }
    get phase() { return this.s.phase; }
    get player() { return this.s.players[this.s.turn] || null; }
    // the state as the document keeps it: a plain object (a copy)
    view() { return JSON.parse(JSON.stringify(this.s)); }
    _touch() { this.s.rev++; return this.s; }
    say(text) { this.s.ticker.push(text); if (this.s.ticker.length > TICKER) this.s.ticker.shift(); }
    name(slot) { const p = this.s.players.find((q) => q.slot === slot); return p ? p.name : `Player ${slot + 1}`; }

    // ---- setting up
    setSize(size) { this.s.size = size; this._touch(); }
    setPlace(place) { this.s.place = place; this._touch(); }
    // the players who are here and not yet in the match join it; slots in turn order
    _join(here) {
      for (const slot of [...here].sort((a, b) => a - b)) if (!this.s.players.some((p) => p.slot === slot)) this.s.players.push({ slot, name: `Player ${slot + 1}` });
      for (const p of this.s.players) if (!this.s.scores[p.slot]) this.s.scores[p.slot] = [];
    }
    // a new match: here = the slots of the players who are here, seed = the tower's
    startMatch(here, seed) {
      Object.assign(this.s, { players: [], scores: {}, round: 0, winner: null, last: null });
      this._join(here);
      this.s.seed = seed >>> 0;
      return this.startRound(seed);
    }
    startRound(seed, here) {
      const s = this.s;
      if (here) this._join(here);
      if (seed !== undefined) s.seed = seed >>> 0;
      s.round++; s.phase = 'roll'; s.roll = null; s.moves = 0; s.handled = null; s.fall = null; s.last = null;
      s.turn = (s.round - 1) % Math.max(1, s.players.length);
      this._skipAbsent();
      for (const p of s.players) while (s.scores[p.slot].length < s.round) s.scores[p.slot].push(0);
      this.lastPlacedAt = -1e9;
      this.say(`Round ${s.round}: ${this.name(this.player.slot)} rolls first`);
      this._touch();
      return s;
    }
    // move on to a player who is here (or stay, if nobody is)
    _skipAbsent() {
      const s = this.s, n = s.players.length;
      for (let k = 0; k < n && !this.present(s.players[s.turn].slot); k++) s.turn = (s.turn + 1) % n;
    }
    // a player left: if it was their turn, their turn passes (unless a move is under way, which the block in their hand has to finish)
    playerLeft() {
      const s = this.s;
      if (!['roll', 'pull'].includes(s.phase) || !s.players.length || this.present(this.player.slot)) return false;
      s.roll = null; s.phase = 'roll'; this._skipAbsent();
      this.say(`${this.name(this.player.slot)} is up`); this._touch();
      return true;
    }

    // ---- a turn
    // the die has been thrown and lies still: colour (0..5), or null for a die that is not flat or fell off the tray
    rolled(colour) {
      const s = this.s;
      if (s.phase !== 'roll') return false;
      s.roll = colour; s.phase = 'pull';
      this.say(`${this.name(this.player.slot)} rolled ${colour === null ? 'nothing' : S.COLOURS[colour].label}`);
      this._touch();
      return true;
    }
    // the roll cannot be played (no block of that colour can be taken): the same player rolls again
    reroll(why) { const s = this.s; if (!['roll', 'pull'].includes(s.phase) || s.handled) return false; s.roll = null; s.phase = 'roll'; if (why) this.say(why); this._touch(); return true; }
    // a block has been pulled out: info { i, colour, level, legal }
    pulled(info) {
      const s = this.s;
      if (!['roll', 'pull'].includes(s.phase) || s.handled) return false;
      s.handled = { i: info.i, colour: info.colour, level: info.level, legal: !!info.legal };
      s.phase = 'place';
      this._touch();
      return true;
    }
    // the pulled block lies on top: what the move was worth
    placed() {
      const s = this.s, h = s.handled;
      if (s.phase !== 'place' || !h) return null;
      const p = this.player, c = this.cfg;
      let pts = 0, note = '';
      if (s.roll === null) note = 'pulled before rolling';
      else if (!h.legal) note = 'from a level that is not allowed';
      else if (h.colour !== s.roll) note = 'the wrong colour';
      else { pts = c.clean + (h.level < c.bottomLevels ? c.bottom : 0); note = h.level < c.bottomLevels ? 'from the bottom third' : 'clean'; }
      s.scores[p.slot][s.round - 1] += pts;
      s.moves++; s.last = { slot: p.slot, pts, note };
      this.say(`${this.name(p.slot)}: ${pts > 0 ? `+${pts}` : '0'} (${note})`);
      this.lastPlacedAt = this.now();
      s.turn = (s.turn + 1) % s.players.length; this._skipAbsent();
      s.roll = null; s.handled = null; s.phase = 'roll';
      this._touch();
      return s.last;
    }
    // ---- the tower falls: info { i (the block), level }. Returns the player who is blamed.
    toppled(info) {
      const s = this.s;
      if (!['roll', 'pull', 'place'].includes(s.phase)) return null;
      const recent = s.phase === 'roll' && this.now() - this.lastPlacedAt < this.cfg.grace && s.moves > 0;
      const by = recent && s.last ? s.players.find((p) => p.slot === s.last.slot) || this.player : this.player;
      s.scores[by.slot][s.round - 1] += this.cfg.topple;
      s.fall = { i: info.i, level: info.level, by: by.slot };
      s.phase = 'fall'; s.handled = null; s.roll = null;
      this.say(`${this.name(by.slot)} toppled the tower: ${this.cfg.topple}`);
      this._touch();
      return by.slot;
    }
    setPhase(phase) {
      const s = this.s;
      if (!PHASES.includes(phase)) return false;
      s.phase = phase;
      if (phase === 'round_end' && s.round >= s.rounds) { s.phase = 'match_end'; this._decide(); }
      this._touch();
      return true;
    }
    _decide() {
      const t = this.totals(), best = Math.max(...Object.values(t));
      this.s.winner = Object.entries(t).filter(([, v]) => v === best).map(([k]) => +k);
      this.say(this.s.winner.length > 1 ? `A draw at ${best}` : `${this.name(this.s.winner[0])} wins with ${best}`);
    }
    totals() { const t = {}; for (const p of this.s.players) t[p.slot] = (this.s.scores[p.slot] || []).reduce((a, v) => a + v, 0); return t; }
    // back to the lobby (the same players, the scores cleared)
    toLobby() { Object.assign(this.s, { phase: 'lobby', round: 0, scores: {}, players: [], handled: null, fall: null, roll: null, winner: null, last: null, turn: 0 }); this._touch(); }
  }

  // ---- reading a state (a plain object from the document): used by the board, the scoreboard, the music and the tests
  // rows for the scoreboard: [{ slot, name, rounds: [n per round, null for rounds to come], total, turn (it is their turn), present }]
  function scoreboard(s, present = () => true) {
    return (s.players || []).map((p, k) => {
      const r = s.scores[p.slot] || [], rounds = Array.from({ length: s.rounds }, (_, i) => (i < r.length && i < Math.max(s.round, 0) ? r[i] : null));
      return { slot: p.slot, name: p.name, rounds, total: r.reduce((a, v) => a + v, 0), turn: ['roll', 'pull', 'place'].includes(s.phase) && s.turn === k, present: present(p.slot), winner: !!(s.winner && s.winner.includes(p.slot)) };
    });
  }
  // what the board says in its title line
  function banner(s, colourLabel) {
    const who = s.players[s.turn] ? s.players[s.turn].name : '';
    switch (s.phase) {
      case 'lobby': return 'Press Start game';
      case 'roll': return `${who}: roll the die`;
      case 'pull': return `${who}: pull a ${colourLabel(s.roll)} block, put it on top`;
      case 'place': return `${who}: put the block on top`;
      case 'fall': return 'TIMBER!';
      case 'replay': return 'Replay';
      case 'aftermath': return s.fall ? `${(s.players.find((p) => p.slot === s.fall.by) || {}).name || ''} toppled it` : 'The tower fell';
      case 'round_end': return `Round ${s.round} of ${s.rounds} is over`;
      case 'match_end': return s.winner && s.winner.length === 1 ? `${(s.players.find((p) => p.slot === s.winner[0]) || {}).name} wins` : 'A draw';
      default: return '';
    }
  }

  Object.assign(J, { Rules, RULES, PHASES, scoreboard, banner });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
