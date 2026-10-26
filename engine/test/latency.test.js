// Timing the flips of the screen (latency.js): the schedule, finding the frame that shows a flip, and the answer.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../client/webcam/index.js');
const L = M.latency;

// a simple repeatable random generator
const rng = (seed) => { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
// the camera's frames of one flip: every `dt` ms, from t0; the screen changed from `lo` to `hi` at `tChange` (a frame is the new level once it was captured after that)
function frames(t0, t1, dt, tChange, lo, hi, noise, r) { const out = []; for (let t = t0; t < t1; t += dt) out.push({ t, v: (t >= tChange ? hi : lo) + (r() - 0.5) * 2 * noise }); return out; }

test('schedule: a black start, then n flips, white first, alternating, held between 500 and 1400 ms, the same for the same random numbers', () => {
  const s = L.schedule(rng(7), 12);
  assert.strictEqual(s.length, 13); assert.deepStrictEqual(s[0], { colour: 'black', hold: 1000, initial: true });
  assert.deepStrictEqual(s.slice(1).map((e) => e.colour), Array.from({ length: 12 }, (_, i) => (i % 2 ? 'black' : 'white')));
  for (const e of s.slice(1)) assert.ok(e.hold >= 500 && e.hold <= 1400, String(e.hold));
  assert.deepStrictEqual(L.schedule(rng(7), 12), s); assert.notDeepStrictEqual(L.schedule(rng(8), 12), s);
  assert.ok(new Set(s.slice(1).map((e) => e.hold)).size > 6, 'the holds are not all alike');
  assert.strictEqual(L.schedule(rng(1)).length, 13); assert.strictEqual(L.schedule(rng(1), 0).length, 1);
});

test('seen: the first frame past half way after the flip is the one that shows it; its time minus the time of the flip is the latency', () => {
  const r = rng(3);
  for (const [delay, dt] of [[85, 33.3], [30, 33.3], [150, 33.3], [60, 16.7], [200, 66.7]]) {
    const tSet = 1000, tChange = tSet + delay, s = frames(500, 3000, dt, tChange, 30, 220, 0, r), lv = L.levels(s, tSet, 2000);
    assert.deepStrictEqual([lv.before, lv.after], [30, 220]);
    const t = L.seen(s, tSet, lv);
    assert.ok(t - tSet >= delay && t - tSet < delay + dt + 1e-9, `delay ${delay} at ${dt} ms frames: ${t - tSet}`);
  }
  // a flip to black (the other direction) is found the same way
  const s = frames(500, 3000, 33.3, 1090, 220, 30, 0, r); const t = L.seen(s, 1000, L.levels(s, 1000, 2000));
  assert.ok(t - 1000 >= 90 && t - 1000 < 90 + 34);
});

test('seen: noise at a tenth of the swing and a single stray frame do not move it', () => {
  const r = rng(11);
  for (let k = 0; k < 20; k++) {
    const tSet = 1000, delay = 40 + 10 * k, s = frames(500, 3000, 33.3, tSet + delay, 40, 200, 16, r), lv = L.levels(s, tSet, 2000);
    const t = L.seen(s, tSet, lv);
    assert.ok(t !== null && t - tSet >= delay - 34 && t - tSet < delay + 70, `k ${k}: ${t - tSet} for ${delay}`);
  }
  const s = frames(500, 3000, 33.3, 1200, 40, 200, 0, rng(1)); s[Math.floor((1000 - 500) / 33.3) + 1].v = 200;          // one bright frame just after the flip was set, 150 ms too early
  const t = L.seen(s, 1000, L.levels(s, 1000, 2000)); assert.ok(t - 1000 >= 200 && t - 1000 < 240, `the stray frame is ignored: ${t - 1000}`);
});

test('seen: nothing when the picture never changes, when the contrast is too low, or when it had changed before the flip was set', () => {
  const flat = frames(500, 3000, 33.3, 1e9, 100, 100, 3, rng(2));
  assert.strictEqual(L.seen(flat, 1000, L.levels(flat, 1000, 2000)), null, 'a picture that does not change');
  const dim = frames(500, 3000, 33.3, 1100, 100, 112, 0, rng(2));
  assert.strictEqual(L.seen(dim, 1000, L.levels(dim, 1000, 2000)), null, '12 grey levels are not a screen');
  const early = frames(500, 3000, 33.3, 700, 30, 220, 0, rng(2)), lv = { before: 30, after: 220 };
  assert.strictEqual(L.seen(early, 1000, lv), null, 'it was already bright when the flip was set: a flicker, or the previous flip');
  assert.strictEqual(L.seen([], 1000, lv), null); assert.strictEqual(L.seen(flat, 1000, null), null); assert.strictEqual(L.seen(flat, 1000, { before: NaN, after: 5 }), null);
  const late = frames(500, 3000, 33.3, 5000, 30, 220, 0, rng(2)); assert.strictEqual(L.seen(late, 1000, lv), null, 'the change never came in the time given');
});

test('levels: the medians before and after, and nothing when there are too few frames', () => {
  const s = frames(0, 3000, 33.3, 1100, 20, 180, 0, rng(1));
  assert.deepStrictEqual(L.levels(s, 1000, 2000), { before: 20, after: 180 });
  assert.strictEqual(L.levels(s.slice(0, 5), 1000, 2000), null); assert.strictEqual(L.levels(s, 1000, 1200), null, 'a flip held for 200 ms has no settled level');
});

test('verdict: the median of the flips that could be timed, at least 8 of them; the spread says when it is unsteady', () => {
  const v = L.verdict([80, 90, 85, 88, 82, null, 86, 84, 87, 83]);
  assert.strictEqual(v.ok, true); assert.strictEqual(v.n, 9); assert.strictEqual(v.medianMs, 85); assert.strictEqual(v.minMs, 80); assert.strictEqual(v.maxMs, 90); assert.strictEqual(v.unsteady, false);
  assert.strictEqual(L.verdict([80, 90, 85, 88, 82, 86, 84, 87]).medianMs, 85.5, 'an even count: the middle two');
  const bad = L.verdict([80, 90, 85, 88, 82, 86, 84]); assert.strictEqual(bad.ok, false); assert.match(bad.why, /Only 7 of the flips/); assert.strictEqual(bad.n, 7);
  assert.strictEqual(L.verdict([60, 61, 62, 63, 64, 160, 61, 62]).unsteady, true); assert.strictEqual(L.verdict([60, 61, 62, 63, 64, 66, 61, 62]).unsteady, false);
  for (const nope of [null, undefined, [], 'x', [NaN, -4, 'a', null]]) assert.strictEqual(L.verdict(nope).ok, false);
});

test('frozen and frame interval', () => {
  assert.strictEqual(L.frozen(frames(0, 3000, 33.3, 1e9, 100, 100, 2, rng(1))), true);
  assert.strictEqual(L.frozen(frames(0, 3000, 33.3, 1500, 30, 200, 2, rng(1))), false);
  assert.strictEqual(L.frozen([]), true);
  assert.ok(Math.abs(L.frameInterval(frames(0, 3000, 33.3, 1500, 30, 200, 0, rng(1))) - 33.3) < 1e-6);
  assert.strictEqual(L.frameInterval([]), null);
});
