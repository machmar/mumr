// The soundtrack (music.js) with a pretend Web Audio: the director on the host (scenes, tension, the record in the document, where each track
// was left), the page that plays the record (on the server's clock, heard once it plays), the equal-power crossfade, the swells and the duck of
// a fall, the limiter, and build-manifest's track lengths.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('./spec.js');
const Mu = require('./music.js');
const BM = require('./music/build-manifest.js');

// ---- a pretend AudioContext: every AudioParam records what was scheduled on it
class Param { constructor(v = 0) { this.value = v; this.ev = []; } setValueAtTime(v, t) { this.ev.push(['set', v, t]); if (t <= this.now()) this.value = v; return this; } linearRampToValueAtTime(v, t) { this.ev.push(['lin', v, t]); return this; } exponentialRampToValueAtTime(v, t) { this.ev.push(['exp', v, t]); return this; } setTargetAtTime(v, t, k) { this.ev.push(['target', v, t, k]); this.value = v; return this; } cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e[2] < t); return this; } now() { return 0; } last() { return this.ev[this.ev.length - 1]; } }
class Node_ { constructor() { this.out = []; this.gain = new Param(1); this.frequency = new Param(440); this.Q = new Param(1); this.threshold = new Param(-24); this.knee = new Param(30); this.ratio = new Param(12); this.attack = new Param(0.003); this.release = new Param(0.25); } connect(n) { this.out.push(n); return n; } disconnect() { this.out = []; } start() {} stop() {} }
function pretend() {
  const clock = { ms: 1e6 };
  const ctx = { currentTime: 0, sampleRate: 44100, destination: new Node_(), made: [], resumed: 0, resume() { this.resumed++; },
    createGain() { const n = new Node_(); this.made.push(['gain', n]); return n; }, createBiquadFilter() { return new Node_(); }, createOscillator() { return new Node_(); },
    createDynamicsCompressor() { const n = new Node_(); this.made.push(['limiter', n]); return n; },
    createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }, createBufferSource() { return new Node_(); },
    createMediaElementSource(el) { const n = new Node_(); n.el = el; this.made.push(['src', n]); return n; } };
  const audios = [];
  const audio = () => {
    const el = { src: '', played: 0, paused: 0, loads: 0, currentTime: 0, duration: NaN, on: {}, play() { this.played++; return Promise.resolve(); }, pause() { this.paused++; },
      addEventListener(n, f) { (this.on[n] = this.on[n] || []).push(f); }, fire(n) { for (const f of this.on[n] || []) f(); }, removeAttribute(n) { if (n === 'src') this.src = ''; }, load() { this.loads++; } };
    audios.push(el); return el;
  };
  return { ctx, audio, audios, clock, now: () => clock.ms };
}
const STATE = (o = {}) => Object.assign({ phase: 'roll', size: 'normal', seed: 5, round: 1, rounds: 3, moves: 0, players: [{ slot: 0, name: 'A' }], tower: { full: 17, top: 17, topCount: 3 }, place: { x: 0, y: 0, yaw: 0 }, handled: null, ticker: [] }, o);
const towerItems = (agitate = 0, missing = 0) => {
  const items = [], L = S.layout('normal'), d = L.d;
  for (let i = 0; i < 54; i++) {
    if (i < missing * 3 && i % 3 === 1) continue;                    // a hole in the lower levels
    const h = S.blockHome(i, 'normal', L.plinth.top);
    items.push({ i, p: [h.p[0] + agitate * (Math.sin(i) * 0.01), h.p[1], h.p[2]], q: h.q, flags: 0 });
  }
  items.push({ i: 54, p: [-0.4, 0, 0.8], q: [0, 0, 0, 1], flags: 0 });
  return items;
};

test('tension: nothing in the lobby; a quiet whole tower is calm; holes, a leaning top and moving blocks raise it; it comes down slowly', () => {
  const t = new Mu.Tension();
  for (let k = 0; k < 90; k++) t.update(STATE({ phase: 'lobby' }), towerItems(), 1 / 30);
  assert.ok(t.v < 0.05);
  for (let k = 0; k < 90; k++) t.update(STATE(), towerItems(), 1 / 30);
  const calm = t.v; assert.ok(calm < 0.35, `a whole, still tower: ${calm}`);
  const holey = new Mu.Tension(); for (let k = 0; k < 90; k++) holey.update(STATE({ moves: 12 }), towerItems(0, 6), 1 / 30);
  assert.ok(holey.parts.holes > 0.3 && holey.v > calm + 0.1, `holes ${holey.parts.holes}, ${holey.v}`);
  const shaky = new Mu.Tension(); for (let k = 0; k < 60; k++) shaky.update(STATE({ phase: 'place' }), towerItems(k % 2 ? 1 : -1, 0), 1 / 30);
  assert.ok(shaky.parts.agit > 0.2 && shaky.v > calm + 0.1, `agitation ${shaky.parts.agit}`);
  const before = shaky.v; for (let k = 0; k < 30; k++) shaky.update(STATE({ phase: 'roll' }), towerItems(), 1 / 30);
  assert.ok(shaky.v < before && shaky.v > 0.2 * before, 'it comes down, but not at once');
});

test('scenes: by phase, then by how far the game has got and how tense it is; a scene lasts a while, and is left lower than it is entered', () => {
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'lobby' }), 0, null, 0), 'calm');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 1 }), 0.1, null, 0), 'build');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.2, null, 0), 'tense');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.8, null, 0), 'danger');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'fall' }), 0.1, 'danger', 0), 'finale'); assert.strictEqual(Mu.sceneFor(STATE({ phase: 'replay' }), 0, 'tense', 0), 'finale');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'aftermath' }), 0, 'finale', 0), 'calm'); assert.strictEqual(Mu.sceneFor(STATE({ phase: 'match_end' }), 0, 'calm', 0), 'win');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.1, 'danger', 5), 'danger', 'it does not flap');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.8, 'tense', 3), 'danger', 'a tenser scene is wanted at once (the director waits a moment)');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.1, 'danger', 5, 0), 'tense', 'with no dwell it drops at once');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.1, 'danger', 40), 'tense', 'after a while it may come down');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'fall' }), 0, 'danger', 1), 'finale', 'a fall changes it at once');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 2 }), 0.6, 'danger', 40), 'danger', 'danger is entered above 0.72 and left below 0.55');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 2 }), 0.6, 'tense', 40), 'tense', 'but 0.6 is not enough to enter it');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 2 }), 0.3, 'tense', 40), 'tense', 'tense is entered above 0.36 and left below 0.26');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 2 }), 0.3, 'build', 40), 'build');
});

test('the moments between two states', () => {
  const m = (a, b) => Mu.momentsBetween(a && STATE(a), STATE(b));
  assert.deepStrictEqual(m({ phase: 'roll' }, { phase: 'pull' }), ['rolled']);
  assert.deepStrictEqual(m({ phase: 'pull' }, { phase: 'place' }), ['pulled']);
  assert.deepStrictEqual(m({ phase: 'place', moves: 0 }, { phase: 'roll', moves: 1, last: { pts: 2 } }), ['placedWell']);
  assert.deepStrictEqual(m({ phase: 'place', moves: 0 }, { phase: 'roll', moves: 1, last: { pts: 1 } }), ['placed']);
  assert.deepStrictEqual(m({ phase: 'place', moves: 0 }, { phase: 'roll', moves: 1, last: { pts: 0 } }), ['placedBad']);
  assert.deepStrictEqual(m({ phase: 'pull' }, { phase: 'fall' }), ['fall']);
  assert.deepStrictEqual(m({ phase: 'fall' }, { phase: 'replay' }), ['replay']);
  assert.deepStrictEqual(m({ phase: 'lobby', round: 0 }, { phase: 'roll', round: 1 }), ['start']);
  assert.deepStrictEqual(m({ phase: 'roll', moves: 2 }, { phase: 'roll', moves: 2 }), [], 'nothing happened');
  assert.deepStrictEqual(Mu.momentsBetween(null, STATE()), [], 'a page that comes in late hears nothing of the past');
});

test('the same scene picks the same track, and a pool is used evenly; a scene with no tracks takes the nearest one\'s', () => {
  const pool = ['a.mp3', 'b.mp3', 'c.mp3'];
  assert.strictEqual(Mu.pickTrack(pool, 5, 'tense', 1), Mu.pickTrack(pool, 5, 'tense', 1));
  const seen = new Set(); for (let r = 0; r < 40; r++) seen.add(Mu.pickTrack(pool, r, 'build', r)); assert.strictEqual(seen.size, 3);
  assert.strictEqual(Mu.pickTrack([], 1, 'x', 1), null);
  assert.deepStrictEqual(Mu.poolFor({ scenes: { build: ['b.mp3'], tense: [] } }, 'danger'), ['b.mp3'], 'danger has none: tense has none either, build has');
  assert.strictEqual(Mu.poolFor({ scenes: {} }, 'calm'), null);
});

// ---- the director: on the host, one record in the document
const MAN = { crossfade: 30, rise: 9, fades: { finale: 6, win: 12 }, scenes: { calm: ['c.mp3'], build: ['b1.mp3', 'b2.mp3'], tense: ['t.mp3'], danger: ['d.mp3'], finale: ['f.mp3'], win: ['w.mp3'] },
  lengths: { 'c.mp3': 300, 'b1.mp3': 200, 'b2.mp3': 240, 't.mp3': 400, 'd.mp3': 300, 'f.mp3': 120, 'w.mp3': 200 } };
function director(man = MAN) {
  const clock = { ms: 5e6 }, d = new Mu.Director({ now: () => clock.ms, manifest: man }), recs = [];
  // secs of host steps of 0.1 s at tension k: the records it made
  const run = (state, secs, k) => { const out = []; for (let s = 0; s < secs - 1e-9; s += 0.1) { clock.ms += 100; const r = d.step(state, null, 0.1, k); if (r) { out.push(r); recs.push(r); } } return out; };
  return { d, clock, run, recs };
}

test('the host decides the music: one record in the document (the scene, the track, where in it, on the server\'s clock), only when it changes', () => {
  const { d, clock, run } = director();
  const [r] = run(STATE({ phase: 'lobby' }), 0.1, 0), half = Math.round(Mu.startFraction(5, 'calm', 1, 'c.mp3') * (300 - 61) * 100) / 100;
  assert.deepStrictEqual({ scene: r.scene, track: r.track, pos: r.pos, at: r.at, fade: r.fade }, { scene: 'calm', track: 'c.mp3', pos: half, at: clock.ms, fade: 30 });
  assert.ok(Number.isFinite(r.n));
  assert.strictEqual(run(STATE({ phase: 'lobby' }), 5, 0).length, 0, 'nothing new: nothing sent');
  const [b] = run(STATE({ moves: 1 }), 0.1, 0.1);
  assert.strictEqual(b.scene, 'build'); assert.notStrictEqual(b.n, r.n); assert.strictEqual(d.scene, 'build');
});

test('a tenser scene comes once the tension has lasted 1.5 s, and in 9 s; a calmer one after 22 s, in 30 s; a knock is not enough', () => {
  const { run } = director();
  run(STATE({ phase: 'lobby' }), 1, 0);
  const [b] = run(STATE({ moves: 1 }), 0.1, 0.1); assert.strictEqual(b.fade, 9, 'the game starts: up, quickly');
  run(STATE({ moves: 1 }), 30, 0.1);
  assert.strictEqual(run(STATE({ moves: 1 }), 1, 0.8).length, 0, 'a knock of a second changes nothing');
  run(STATE({ moves: 1 }), 2, 0.1);
  const up = run(STATE({ moves: 1 }), 2, 0.8); assert.strictEqual(up.length, 1); assert.strictEqual(up[0].scene, 'danger'); assert.strictEqual(up[0].fade, 9);
  assert.strictEqual(run(STATE({ moves: 1 }), 60, 0.6).length, 0, 'danger holds at 0.6 (it is left below 0.55)');
  const down = run(STATE({ moves: 1 }), 1, 0.1); assert.strictEqual(down.length, 1); assert.strictEqual(down[0].scene, 'build'); assert.strictEqual(down[0].fade, 30, 'down, slowly');
  const fall = run(STATE({ phase: 'fall' }), 0.1, 0.1); assert.strictEqual(fall[0].scene, 'finale'); assert.strictEqual(fall[0].fade, 6, 'the fall: at once, in 6 s');
});

test('a scene the music comes back to carries on where it was left; the fall and the win start from the top', () => {
  const { d, run } = director();
  d.heads['b1.mp3'] = d.heads['b2.mp3'] = 10;                                   // (both build tracks were left at 10 s before)
  const [b] = run(STATE({ moves: 1 }), 0.1, 0.1); assert.strictEqual(b.pos, 10, 'it comes in where it was left');
  run(STATE({ moves: 1 }), 50, 0.1);
  const [up] = run(STATE({ moves: 1 }), 2, 0.8); assert.strictEqual(up.scene, 'danger');
  const left = d.heads[b.track]; assert.ok(Math.abs(left - (10 + 50 + 1.5 + 9)) < 0.3, `left at ${left} s (with the 9 s it fades out over)`);
  run(STATE({ moves: 1 }), 25, 0.8);
  const [back] = run(STATE({ moves: 1 }), 0.2, 0.1); assert.strictEqual(back.track, b.track); assert.ok(Math.abs(back.pos - left) < 0.01, `back at ${back.pos}`);
  run(STATE({ phase: 'fall' }), 30, 0); run(STATE({ phase: 'aftermath' }), 10, 0);
  assert.ok(d.heads['f.mp3'] > 20, 'the finale was left part of the way through');
  const [f] = run(STATE({ phase: 'fall' }), 0.1, 0); assert.strictEqual(f.pos, 0, 'but it starts from the top every time');
  const near = director(); near.d.heads['c.mp3'] = 280; const [c] = near.run(STATE({ phase: 'lobby' }), 0.1, 0); assert.strictEqual(c.pos, 0, 'a track left near its end starts again from the top');
});

test('a track near its end is followed by the next of its scene (or itself again, somewhere else), over 30 s; one whose length is not known loops', () => {
  const { run } = director();
  const [c] = run(STATE({ phase: 'lobby' }), 0.1, 0), due = 300 - 31 - c.pos;
  assert.strictEqual(run(STATE({ phase: 'lobby' }), due - 1, 0).length, 0);
  const [again] = run(STATE({ phase: 'lobby' }), 2, 0); assert.strictEqual(again.track, 'c.mp3'); assert.strictEqual(again.fade, 30);
  assert.ok(Math.abs((again.at - c.at) / 1000 - due) < 0.15, `at ${(again.at - c.at) / 1000} s: 30 s before its end`);
  assert.strictEqual(again.pos, Math.round(Mu.startFraction(5, 'calm', 1, 'c.mp3', 1) * 239 * 100) / 100, 'itself again: in at another place'); assert.notStrictEqual(again.pos, c.pos);
  const two = director(); const [b] = two.run(STATE({ moves: 1 }), 0.1, 0.1);
  const [next] = two.run(STATE({ moves: 1 }), 260, 0.1); assert.ok(next && next.track !== b.track, 'the other track of the scene');
  const blind = director(Object.assign({}, MAN, { lengths: {} })); blind.run(STATE({ phase: 'lobby' }), 0.1, 0);
  assert.strictEqual(blind.run(STATE({ phase: 'lobby' }), 400, 0).length, 0, 'no length: the pages loop it');
  const none = director({ scenes: {} }); const [r] = none.run(STATE({ phase: 'lobby' }), 0.1, 0); assert.strictEqual(r.track, null, 'no tracks at all: the record says so (the pages play the pad)');
});

test('a host that starts again carries on the music that is in the document', () => {
  const one = director(); const [r] = one.run(STATE({ phase: 'lobby' }), 0.1, 0);
  const two = director(); two.clock.ms = one.clock.ms + 10000; two.d.adopt(r);
  assert.strictEqual(two.run(STATE({ phase: 'lobby' }), 1, 0).length, 0, 'the same scene: nothing new');
  const [b] = two.run(STATE({ moves: 1 }), 0.1, 0.1); assert.notStrictEqual(b.n, r.n); assert.ok(Math.abs(two.d.heads['c.mp3'] - (r.pos + 11.1 + 9)) < 0.3, 'it knows where the old track was');
});

test('a track heard for the first time comes in half way: another place each round, never so late that it has no time to be heard; the finale from the top', () => {
  const first = (state, man = MAN) => director(man).run(state, 0.1, 0)[0];
  const room = 300 - 61, a = first(STATE({ phase: 'lobby' }));
  assert.ok(a.pos > 0 && a.pos <= room, `somewhere in the first ${room} s (${a.pos})`);
  assert.strictEqual(first(STATE({ phase: 'lobby' })).pos, a.pos, 'the same state, the same place');
  const places = new Set(); for (let r = 1; r <= 8; r++) places.add(first(STATE({ phase: 'lobby', round: r })).pos);
  assert.ok(places.size >= 6, `another round, another place (${places.size} of 8)`);
  const len = (l) => Object.assign({}, MAN, { lengths: { 'c.mp3': l } });
  assert.ok(first(STATE({ phase: 'lobby' }), len(90)).pos <= 29, 'a short track keeps two crossfades to play');
  assert.strictEqual(first(STATE({ phase: 'lobby' }), len(60)).pos, 0, 'one too short for that: from the start');
  assert.strictEqual(first(STATE({ phase: 'lobby' }), Object.assign({}, MAN, { lengths: {} })).pos, 0, 'one whose length is not known: from the start');
  assert.strictEqual(first(STATE({ phase: 'fall' })).pos, 0, 'the finale is shaped from its first second');
  assert.strictEqual(first(STATE({ phase: 'lobby' }), Object.assign({}, MAN, { anywhere: [] })).pos, 0, 'tracks.json can ask for the beginning everywhere');
  assert.ok(first(STATE({ phase: 'fall' }), Object.assign({}, MAN, { anywhere: ['finale'] })).pos > 0, 'or for another scene to start anywhere');
});

// ---- the page: it plays the record
function page() { const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio, now: p.now }); m.load(MAN); m.start(); return { p, m }; }
const REC = (o) => Object.assign({ n: 1, scene: 'build', track: 'b1.mp3', pos: 0, fade: 9 }, o);

test('a page plays the record: the track at the record\'s place on the server\'s clock, heard once it actually plays', () => {
  const { p, m } = page();
  m.follow(REC({ pos: 12, at: p.clock.ms - 3000 }));
  assert.strictEqual(p.audios.length, 1); assert.strictEqual(p.audios[0].src, 'music/b1.mp3#t=15.00', 'asked for from 15 s'); assert.strictEqual(p.audios[0].loop, true);
  const g = m.decks[0].gain.gain; assert.ok(!g.ev.some((e) => e[1] === 1), 'nothing yet: it is still loading');
  p.clock.ms += 2000; p.audios[0].duration = 200; p.audios[0].fire('loadedmetadata'); assert.ok(Math.abs(p.audios[0].currentTime - 17) < 0.01, 'loaded 2 s later: put at 17 s');
  p.ctx.currentTime = 2; p.audios[0].fire('playing');
  assert.deepStrictEqual(g.last().slice(1), [1, 8], 'heard from when it plays: the first track of a visit in 6 s at most');
  assert.strictEqual(m.follow(REC({ pos: 12, at: p.clock.ms - 3000 })), false, 'the same record again does nothing');
  const odd = page(); odd.m.follow(REC({ track: 'calm/A # B [x].mp3' })); assert.strictEqual(odd.p.audios[0].src, 'music/calm/A%20%23%20B%20%5Bx%5D.mp3#t=0.00', 'a file name is escaped');
});

test('a new track crossfades in, equal power, once it plays; the old one plays on until then, and is let go of after', () => {
  const { p, m } = page();
  m.follow(REC({ at: p.clock.ms })); p.audios[0].duration = 200; p.audios[0].fire('playing');
  p.ctx.currentTime = 100; p.clock.ms += 100e3; m.decks[0].gain.gain.value = 1;
  m.follow(REC({ n: 2, scene: 'tense', track: 't.mp3', pos: 40, at: p.clock.ms, fade: 30 }));
  assert.strictEqual(m.decks.length, 2); assert.strictEqual(m.decks[0].dying, false, 'the old one plays on while the new one loads');
  p.ctx.currentTime = 101; p.audios[1].fire('playing');
  const inn = m.decks[1].gain.gain.ev, out = m.decks[0].gain.gain.ev;
  assert.strictEqual(inn.at(-1)[2], 131, 'in over 30 s'); assert.strictEqual(out.at(-1)[2], 131, 'out over 30 s'); assert.strictEqual(inn.at(-1)[1], 1); assert.strictEqual(out.at(-1)[1], 0);
  const half = (ev) => ev.find((e) => e[0] === 'lin' && Math.abs(e[2] - 116) < 0.7);
  assert.ok(Math.abs(half(inn)[1] ** 2 + half(out)[1] ** 2 - 1) < 0.08, 'at the middle the powers add up to 1');
  p.ctx.currentTime = 132; m.tick();
  assert.strictEqual(m.decks.length, 1, 'the faded-out track is stopped'); assert.strictEqual(p.audios[0].paused, 1);
  assert.strictEqual(p.audios[0].src, ''); assert.strictEqual(p.audios[0].loads, 1, 'and its stream let go of');
});

test('the same track carrying on through a scene change is not started again; a page that has drifted is put back; a track that never plays is given up', () => {
  const { p, m } = page();
  m.follow(REC({ at: p.clock.ms })); const el = p.audios[0]; el.duration = 200; el.fire('playing');
  p.clock.ms += 20e3; el.currentTime = 20;
  m.follow(REC({ n: 2, scene: 'tense', pos: 20, at: p.clock.ms, fade: 9 })); assert.strictEqual(p.audios.length, 1, 'the same track, where it is: it plays on');
  p.clock.ms += 10e3; el.currentTime = 26; p.ctx.currentTime = 30; m.tick(); assert.ok(Math.abs(el.currentTime - 30) < 0.01, 'stalled 4 s behind: put back');
  p.clock.ms += 1e3; el.currentTime = 31.5; p.ctx.currentTime = 31; m.tick(); assert.strictEqual(el.currentTime, 31.5, 'a little off is left alone');
  p.clock.ms += 200e3; p.ctx.currentTime = 50; el.currentTime = 25; m.tick(); assert.ok(Math.abs(el.currentTime - 31) < 0.01, 'on a looping track, the place wraps round');
  m.follow(REC({ n: 3, track: 'b2.mp3', at: p.clock.ms }));
  p.ctx.currentTime = 70; m.tick();
  assert.strictEqual(m.decks.length, 1, 'it did not play in 15 s: given up'); assert.strictEqual(m.decks[0].el, el); assert.strictEqual(m.decks[0].dying, false, 'the old one plays on');
});

test('a record with no track, or a page with no tracks: the generated pad follows the scene', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio, now: p.now }); m.start();
  m.follow({ n: 1, scene: 'calm', track: null, pos: 0, at: p.clock.ms, fade: 30 });
  assert.strictEqual(p.audios.length, 0); assert.strictEqual(m.padGain.gain.last()[1], 0.07); assert.strictEqual(m.scene, 'calm');
});

test('tension and the moments shape the music through stages of their own: a fall\'s duck holds while the tension goes on, and a limiter guards the end', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio, now: p.now }); m.load({ scenes: {} }); m.start();
  for (let k = 0; k < 90; k++) m.update(0, 1 / 30);
  const dull = m.tenseFilter.frequency.last()[1], flat = m.tenseGain.gain.last()[1];
  for (let k = 0; k < 90; k++) m.update(1, 1 / 30);
  assert.ok(m.tenseFilter.frequency.last()[1] > dull * 2.5, 'brighter'); assert.ok(m.tenseGain.gain.last()[1] > flat + 0.2, 'louder');
  assert.ok(m.droneGain.gain.last()[1] > 0.03, 'the drone is in');
  assert.strictEqual(m.momentGain.gain.ev.length + m.momentFilter.frequency.ev.length, 0, 'the tension never touches the moments\' stage');
  m.moment('pulled'); assert.ok(m.momentGain.gain.ev.some((e) => e[0] === 'lin' && e[1] >= 1.15), 'a swell');
  p.ctx.currentTime = 10; m.moment('fall');
  for (let k = 0; k < 60; k++) { p.ctx.currentTime += 1 / 30; m.update(0.9, 1 / 30); }
  assert.deepStrictEqual(m.momentGain.gain.last().slice(0, 2), ['lin', 0.12], 'ducked, and still ducked 2 s on'); assert.ok(m.momentGain.gain.last()[2] <= 10.3, 'within a quarter of a second');
  assert.ok(m.momentFilter.frequency.last()[1] < 500, 'and dull');
  p.ctx.currentTime = 13; m.moment('replay'); const up = m.momentGain.gain.ev;
  assert.ok(up.some((e) => e[0] === 'lin' && e[1] > 1.3), 'back, louder than before'); assert.strictEqual(up.at(-1)[1], 1); assert.ok(m.momentFilter.frequency.last()[1] > 15000);
  p.ctx.currentTime = 30; m.moment('fall'); p.ctx.currentTime = 32; m.moment('aftermath'); assert.strictEqual(m.momentGain.gain.last()[1], 1, 'a skipped replay: the aftermath brings it back');
  const lim = p.ctx.made.find((x) => x[0] === 'limiter')[1];
  assert.ok(m.sfx.out.includes(lim) && m.momentFilter.out.includes(lim) && lim.out.includes(p.ctx.destination), 'the music and the sounds both go through the limiter');
  m.setVolume(0); assert.strictEqual(m.master.gain.last()[1], 0, 'volume off'); m.setVolume(4); assert.strictEqual(m.master.gain.last()[1], 1);
});

test('the soundtrack object: fed the shared state and the record, it plays the record, the moments and follows the volume', () => {
  const p = pretend(), st = new Mu.Soundtrack({ ctx: p.ctx, audio: p.audio, now: p.now }); st.music.load(MAN); st.music.start();
  st.update(STATE({ phase: 'lobby', round: 0 }), [], 0.03, 3, null, REC({ scene: 'calm', track: 'c.mp3', at: p.clock.ms }));
  assert.strictEqual(st.scene, 'calm'); assert.strictEqual(st.music.track, 'c.mp3'); assert.strictEqual(st.music.vol, 3);
  st.update(STATE({ phase: 'roll' }), towerItems(), 0.03, 3, null, REC({ scene: 'calm', track: 'c.mp3', at: p.clock.ms }));
  st.update(STATE({ phase: 'fall' }), towerItems(), 0.03, 3, null, REC({ n: 2, scene: 'finale', track: 'f.mp3', at: p.clock.ms, fade: 6 }));
  assert.strictEqual(st.scene, 'finale'); assert.strictEqual(st.music.track, 'f.mp3');
  assert.ok(st.music.momentGain.gain.ev.some((e) => e[1] === 0.12), 'the fall ducked the music');
});

test('impacts: a block that falls and stops clacks once, in proportion; one that is carried, or slides smoothly, does not', () => {
  const im = new Mu.Impacts(), at = (z, flags = 0) => [{ i: 3, p: [0, 0, z], flags }], hits = [];
  let z = 0.5, v = 0; const dt = 1 / 60;
  for (let k = 0; k < 120; k++) { v += 9.81 * dt; z = Math.max(0.0075, z - v * dt); if (z <= 0.0075) v = 0; hits.push(...im.update(at(z), dt, 1)); }
  assert.strictEqual(hits.length, 1, `one clack (${hits.length})`); assert.ok(hits[0].strength > 0.5, `a drop of 0.5 m is a good clack (${hits[0].strength})`);
  const q = new Mu.Impacts(), moved = []; for (let k = 0; k < 120; k++) moved.push(...q.update(at(0.3 + 0.002 * k), dt, 1)); assert.strictEqual(moved.length, 0, 'slow and steady');
  const r = new Mu.Impacts(), carried = []; let zz = 1; for (let k = 0; k < 60; k++) { zz += (k < 30 ? 0.02 : -0.04); carried.push(...r.update(at(zz, 1), dt, 1)); } assert.strictEqual(carried.length, 0, 'a held block is not hitting anything');
  const big = new Mu.Impacts(), a2 = []; for (const [zb, kk] of [[0.3, 5.5], [0.3, 5.5], [0.14, 5.5], [0.0, 5.5]]) a2.push(...big.update(at(zb), dt, kk)); assert.ok(Array.isArray(a2));
});

test('a clack is panned to where it is, quieter far away, and the soundtrack plays the loudest few a frame', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio }); m.load({}); m.start();
  const n0 = p.ctx.made.length; m.clack(0.8, -0.7, 1, 1); assert.ok(p.ctx.made.length > n0, 'a sound was made');
  const st = new Mu.Soundtrack({ ctx: p.ctx, audio: p.audio }); st.music.load({}); st.music.start(); let clacks = 0; st.music.clack = () => { clacks++; };
  const mk = (z) => Array.from({ length: 54 }, (_, i) => ({ i, p: [i * 0.01, 0, z], flags: 0 }));
  for (const z of [1, 0.9, 0.7, 0.4, 0.4, 0.4]) st.update(STATE(), mk(z), 1 / 60, 2, { x: 0, y: 1, yaw: 0 });
  assert.ok(clacks > 0 && clacks <= 5, `${clacks} clacks, at most 5 a frame`);
});

test('build-manifest: an mp3\'s length from its frames (after an ID3 tag), for the host to know when a track ends', () => {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20]), tag = Buffer.alloc(20);
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]);           // MPEG-1 layer III, 128 kb/s, 44.1 kHz, no padding: 417 bytes, 1152 samples
  const buf = Buffer.concat([id3, tag, ...Array.from({ length: 100 }, () => frame)]);
  assert.ok(Math.abs(BM.mp3Length(buf) - 100 * 1152 / 44100) < 1e-6);
  assert.strictEqual(BM.mp3Length(Buffer.from('not an mp3 at all')), null);
});
