// The rules (rules.js) with no physics: turns, the die, what a move is worth, who topples the tower, rounds and the match.
const { test } = require('node:test');
const assert = require('node:assert');
const { Rules, scoreboard, banner } = require('./rules.js');
const S = require('./spec.js');

const game = (here = [0, 1, 2], o = {}) => { const r = new Rules(o); r.startMatch(here, 7); return r; };
const move = (r, { roll = 1, colour = roll, level = 8, legal = true } = {}) => { r.rolled(roll); r.pulled({ i: 5, colour, level, legal }); return r.placed(); };

test('a match starts at round 1 with the first player to roll; the first roll rotates with the round', () => {
  const r = game();
  assert.strictEqual(r.phase, 'roll'); assert.strictEqual(r.s.round, 1); assert.strictEqual(r.player.slot, 0);
  r.toppled({ i: 20, level: 6 }); r.setPhase('round_end'); r.startRound(8);
  assert.strictEqual(r.s.round, 2); assert.strictEqual(r.player.slot, 1, 'round 2 starts with the second player');
});

test('a clean move scores 1, from the bottom third 2; the wrong colour, a level that is not allowed, or no roll at all score nothing; turns go round', () => {
  const r = game();
  assert.deepStrictEqual(move(r, { level: 8 }), { slot: 0, pts: 1, note: 'clean' });
  assert.strictEqual(r.player.slot, 1);
  assert.deepStrictEqual(move(r, { level: 2 }), { slot: 1, pts: 2, note: 'from the bottom third' });
  assert.strictEqual(move(r, { roll: 3, colour: 4 }).pts, 0, 'wrong colour');
  assert.strictEqual(r.player.slot, 0, 'round the table again');
  assert.strictEqual(move(r, { legal: false }).pts, 0);
  r.pulled({ i: 9, colour: 0, level: 3, legal: true }); assert.strictEqual(r.placed().pts, 0, 'pulled before the die was rolled');
  assert.deepStrictEqual(r.s.scores[0], [1], 'player 0 so far: 1');
  assert.strictEqual(r.totals()[1], 2);
});

test('the phases follow one another and the wrong call does nothing', () => {
  const r = game();
  assert.strictEqual(r.placed(), null, 'nothing is pulled yet');
  assert.strictEqual(r.pulled({ i: 1, colour: 1, level: 1, legal: true }), true, 'pulling before rolling is a move (without points)');
  const r2 = game();
  assert.strictEqual(r2.rolled(2), true); assert.strictEqual(r2.phase, 'pull'); assert.strictEqual(r2.rolled(3), false, 'rolled once');
  assert.strictEqual(r2.reroll('no block of that colour can be taken'), true); assert.strictEqual(r2.phase, 'roll'); assert.strictEqual(r2.s.roll, null);
  assert.ok(r2.s.ticker.at(-1).includes('no block'));
});

test('who topples it: the player whose turn it is -3, the placer when it falls within a few seconds of a placement, and the round ends', () => {
  let t = 1000;
  const r = game([0, 1], { now: () => t });
  move(r, {}); t += 1500;                                           // player 0 placed 1.5 s ago; player 1 has not touched anything
  assert.strictEqual(r.toppled({ i: 30, level: 10 }), 0, 'the placer');
  assert.strictEqual(r.phase, 'fall'); assert.strictEqual(r.s.fall.by, 0);
  assert.deepStrictEqual(r.s.scores[0], [1 - 3]);
  const q = game([0, 1], { now: () => t });
  move(q, {}); t += 5000; q.rolled(2);                              // 5 s later, player 1 is in the middle of a turn
  assert.strictEqual(q.toppled({ i: 4, level: 1 }), 1, 'the player on turn');
  assert.strictEqual(q.toppled({ i: 4, level: 1 }), null, 'only once');
});

test('three rounds make a match; the highest total wins; a draw is a draw; a new match starts clean', () => {
  const r = game([0, 1]);
  for (let round = 1; round <= 3; round++) {
    assert.strictEqual(r.s.round, round);
    move(r, { level: 1 });                                          // the first player scores 2 ...
    r.toppled({ i: 9, level: 4 });                                   // ... and the second topples it (-3) after the first's move
    r.setPhase('aftermath'); r.setPhase('round_end');
    if (round < 3) { assert.strictEqual(r.phase, 'round_end'); r.startRound(round + 10); }
  }
  assert.strictEqual(r.phase, 'match_end');
  assert.ok(r.s.winner.length >= 1);
  const t = r.totals(); assert.strictEqual(Math.max(...Object.values(t)), t[r.s.winner[0]]);
  const d = game([0, 1]);
  d.s.scores = { 0: [2, 1], 1: [1, 2] }; d.s.round = 3; d.setPhase('round_end');
  assert.deepStrictEqual(d.s.winner, [0, 1], 'a draw');
  d.toLobby(); assert.strictEqual(d.phase, 'lobby'); assert.deepStrictEqual(d.s.players, []);
});

test('a player who leaves loses their turn; one who is not here is skipped; a latecomer joins at the next round', () => {
  const here = new Set([0, 1, 2]);
  const r = game([0, 1, 2], { present: (s) => here.has(s) });
  move(r, {});                                                        // player 0 done, player 1 up
  here.delete(1);
  assert.strictEqual(r.playerLeft(), true); assert.strictEqual(r.player.slot, 2, 'player 1 left: player 2 is up');
  move(r, {}); assert.strictEqual(r.player.slot, 0, 'player 1 is skipped');
  here.add(3); r.toppled({ i: 1, level: 3 }); r.setPhase('round_end'); r.startRound(9, [0, 1, 2, 3]);
  assert.deepStrictEqual(r.s.players.map((p) => p.slot), [0, 1, 2, 3]);
  assert.strictEqual(r.s.scores[3].length, 2, 'the latecomer has a zero for the round that was before them');
});

test('the scoreboard and the banner are read from the state alone (what a page has from the document)', () => {
  const r = game([0, 1]);
  move(r, { level: 1 });
  const rows = scoreboard(r.view(), (s) => s !== 1);
  assert.deepStrictEqual(rows.map((x) => [x.slot, x.total, x.turn, x.present]), [[0, 2, false, true], [1, 0, true, false]]);
  assert.deepStrictEqual(rows[0].rounds, [2, null, null]);
  assert.strictEqual(banner(r.view(), (c) => S.COLOURS[c].label), 'Player 2: roll the die');
  r.rolled(4); assert.strictEqual(banner(r.view(), (c) => S.COLOURS[c].label), 'Player 2: pull a pink block, put it on top');
  assert.strictEqual(JSON.stringify(r.view()), JSON.stringify(JSON.parse(JSON.stringify(r.view()))), 'plain data');
});
