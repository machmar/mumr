// The soundtrack (music.js) with a pretend Web Audio: the director's scenes and tension, the 30 s equal-power crossfade, a track followed by the
// next one, the swells and the duck of a fall.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('./spec.js');
const Mu = require('./music.js');

// ---- a pretend AudioContext: every AudioParam records what was scheduled on it
class Param { constructor(v = 0) { this.value = v; this.ev = []; } setValueAtTime(v, t) { this.ev.push(['set', v, t]); if (t <= this.now()) this.value = v; return this; } linearRampToValueAtTime(v, t) { this.ev.push(['lin', v, t]); return this; } exponentialRampToValueAtTime(v, t) { this.ev.push(['exp', v, t]); return this; } setTargetAtTime(v, t, k) { this.ev.push(['target', v, t, k]); this.value = v; return this; } cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e[2] < t); return this; } now() { return 0; } last() { return this.ev[this.ev.length - 1]; } }
class Node_ { constructor() { this.out = []; this.gain = new Param(1); this.frequency = new Param(440); this.Q = new Param(1); } connect(n) { this.out.push(n); return n; } disconnect() { this.out = []; } start() {} stop() {} }
function pretend() {
  const ctx = { currentTime: 0, sampleRate: 44100, destination: new Node_(), made: [], resumed: 0, resume() { this.resumed++; },
    createGain() { const n = new Node_(); this.made.push(['gain', n]); return n; }, createBiquadFilter() { return new Node_(); }, createOscillator() { return new Node_(); },
    createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }, createBufferSource() { return new Node_(); },
    createMediaElementSource(el) { const n = new Node_(); n.el = el; this.made.push(['src', n]); return n; } };
  const audios = [];
  const audio = () => { const el = { src: '', played: 0, paused: 0, currentTime: 0, duration: NaN, play() { this.played++; return Promise.resolve(); }, pause() { this.paused++; } }; audios.push(el); return el; };
  return { ctx, audio, audios };
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

test('scenes: by phase, then by how far the game has got and how tense it is, and a scene lasts a while', () => {
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'lobby' }), 0, null, 0), 'calm');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 1 }), 0.1, null, 0), 'build');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.2, null, 0), 'tense');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.8, null, 0), 'danger');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'fall' }), 0.1, 'danger', 0), 'finale'); assert.strictEqual(Mu.sceneFor(STATE({ phase: 'replay' }), 0, 'tense', 0), 'finale');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'aftermath' }), 0, 'finale', 0), 'calm'); assert.strictEqual(Mu.sceneFor(STATE({ phase: 'match_end' }), 0, 'calm', 0), 'win');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.1, 'danger', 5), 'danger', 'it does not flap');
  assert.strictEqual(Mu.sceneFor(STATE({ moves: 7 }), 0.1, 'danger', 40), 'tense', 'after a while it may come down');
  assert.strictEqual(Mu.sceneFor(STATE({ phase: 'fall' }), 0, 'danger', 1), 'finale', 'a fall changes it at once');
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

test('the same scene picks the same track on every headset, and a pool is used evenly', () => {
  const pool = ['a.mp3', 'b.mp3', 'c.mp3'];
  assert.strictEqual(Mu.pickTrack(pool, 5, 'tense', 1), Mu.pickTrack(pool, 5, 'tense', 1));
  const seen = new Set(); for (let r = 0; r < 40; r++) seen.add(Mu.pickTrack(pool, r, 'build', r)); assert.strictEqual(seen.size, 3);
  assert.strictEqual(Mu.pickTrack([], 1, 'x', 1), null);
});

test('a scene change crossfades over 30 s, equal power: the new track in as the square root, the old one out as the square root of what is left', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio });
  m.load({ crossfade: 30, scenes: { build: ['a.mp3'], tense: ['b.mp3'] } });
  m.start(); assert.ok(p.ctx.resumed >= 1);
  m.setScene('build', 5, 1);
  assert.strictEqual(p.audios.length, 1); assert.strictEqual(p.audios[0].src, 'music/a.mp3'); assert.strictEqual(p.audios[0].played, 1);
  const first = m.decks[0].gain.gain, end = first.ev[first.ev.length - 1];
  assert.ok(end[1] === 1 && end[2] <= 6.01, 'the first track comes in over 6 s at most');
  p.ctx.currentTime = 100; m.decks[0].gain.gain.value = 1;                  // (a real AudioParam has reached 1 by now; the pretend one does not run its automation)
  m.setScene('tense', 5, 1);
  assert.strictEqual(m.decks.length, 2); assert.strictEqual(p.audios[1].src, 'music/b.mp3');
  const inn = m.decks[1].gain.gain.ev, out = m.decks[0].gain.gain.ev;
  assert.strictEqual(inn[inn.length - 1][2], 130, 'in over 30 s'); assert.strictEqual(out[out.length - 1][2], 130, 'out over 30 s');
  assert.strictEqual(inn[inn.length - 1][1], 1); assert.strictEqual(out[out.length - 1][1], 0);
  const half = (ev) => ev.find((e) => e[0] === 'lin' && Math.abs(e[2] - 115) < 0.7);
  assert.ok(Math.abs(half(inn)[1] ** 2 + half(out)[1] ** 2 - 1) < 0.08, 'at the middle the powers add up to 1');
  assert.strictEqual(m.setScene('tense', 5, 1), false, 'the same scene again does nothing'); assert.strictEqual(m.decks.length, 2);
  p.ctx.currentTime = 131; m.tick(); assert.strictEqual(m.decks.length, 1, 'the faded-out track is stopped'); assert.strictEqual(p.audios[0].paused, 1);
});

test('the short scenes fade in faster than the long ones (the fall is over in 12 s)', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio }); m.load({ crossfade: 30, scenes: { build: ['a.mp3'], finale: ['f.mp3'] } }); m.start();
  m.setScene('build', 1, 1); p.ctx.currentTime = 100; m.decks[0].gain.gain.value = 1; m.setScene('finale', 1, 1);
  assert.strictEqual(m.decks[1].gain.gain.ev.at(-1)[2], 106, 'in over 6 s'); assert.strictEqual(m.fadeFor('calm'), 30);
});

test('a track that is nearly over is followed by the next one of its scene, over 30 s; a scene with no tracks keeps the music of the nearest', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio });
  m.load({ crossfade: 30, scenes: { build: ['a.mp3', 'b.mp3'] } });
  m.start(); m.setScene('build', 1, 1); const first = m.track;
  p.audios[0].duration = 300; p.audios[0].currentTime = 100; p.ctx.currentTime = 50; m.tick(); assert.strictEqual(m.decks.length, 1, 'plenty left');
  p.audios[0].currentTime = 275; p.ctx.currentTime = 60; m.tick();
  assert.strictEqual(m.decks.length, 2); assert.notStrictEqual(m.track, first, 'the next track of the scene');
  assert.strictEqual(m.decks[1].gain.gain.ev.at(-1)[2], 90);
  m.tick(); assert.strictEqual(m.decks.length, 2, 'followed only once');
  m.setScene('danger', 1, 1);
  assert.ok(m.track === 'a.mp3' || m.track === 'b.mp3', 'danger has none: it keeps the nearest (tense, then build)');
  const q = pretend(), n = new Mu.Music({ ctx: q.ctx, audio: q.audio }); n.start(); n.setScene('calm', 1, 1);
  assert.strictEqual(q.audios.length, 0, 'no tracks at all: the generated pad only'); assert.strictEqual(n.padGain.gain.last()[1], 0.07);
});

test('tension opens the filter and lifts the music; a block pulled swells it for a few seconds; a fall ducks it to a whisper and the replay brings it back louder', () => {
  const p = pretend(), m = new Mu.Music({ ctx: p.ctx, audio: p.audio }); m.load({ scenes: {} }); m.start();
  for (let k = 0; k < 90; k++) m.update(0, 1 / 30);
  const dull = m.filter.frequency.last()[1], flat = m.swellGain.gain.last()[1];
  for (let k = 0; k < 90; k++) m.update(1, 1 / 30);
  assert.ok(m.filter.frequency.last()[1] > dull * 2.5, 'brighter'); assert.ok(m.swellGain.gain.last()[1] > flat + 0.2, 'louder');
  assert.ok(m.droneGain.gain.last()[1] > 0.03, 'the drone is in');
  m.moment('pulled'); const g = m.swellGain.gain.ev; assert.ok(g.some((e) => e[0] === 'lin' && e[1] >= 1.2), 'a swell');
  p.ctx.currentTime = 10; m.moment('fall');
  const ev = m.swellGain.gain.ev; assert.ok(ev.some((e) => e[0] === 'lin' && e[1] === 0.12 && e[2] <= 10.3), 'ducked within a quarter of a second');
  assert.ok(m.filter.frequency.last()[1] < 500, 'dull');
  p.ctx.currentTime = 13; m.moment('replay'); const up = m.swellGain.gain.ev; assert.ok(up.some((e) => e[0] === 'lin' && e[1] > 1.4), 'back, louder than before');
  m.setVolume(0); assert.strictEqual(m.master.gain.last()[1], 0, 'volume off'); m.setVolume(4); assert.strictEqual(m.master.gain.last()[1], 1);
});

test('the soundtrack object: fed the shared state it picks the scenes, plays the moments and follows the volume', () => {
  const p = pretend(), st = new Mu.Soundtrack({ ctx: p.ctx, audio: p.audio }); st.music.load({ scenes: { calm: ['c.mp3'], build: ['b.mp3'], finale: ['f.mp3'] } }); st.music.start();
  st.update(STATE({ phase: 'lobby', round: 0 }), [], 0.03, 3); assert.strictEqual(st.scene, 'calm'); assert.strictEqual(st.music.track, 'c.mp3'); assert.strictEqual(st.music.vol, 3);
  p.ctx.currentTime = 40; st.update(STATE({ phase: 'roll' }), towerItems(), 0.03, 3); assert.strictEqual(st.scene, 'build');
  p.ctx.currentTime = 80; st.update(STATE({ phase: 'fall' }), towerItems(), 0.03, 3); assert.strictEqual(st.scene, 'finale'); assert.strictEqual(st.music.track, 'f.mp3');
  assert.ok(st.music.swellGain.gain.ev.some((e) => e[1] === 0.12), 'the fall ducked the music');
});
