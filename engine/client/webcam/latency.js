// How late the camera's picture is, measured from the screen: the page flips the screen black and white and the camera, which looks at it, shows each flip some time later.
// No THREE and no DOM (webcamview.js is the page: it sets the colours, and collects the camera's frames and the brightness of the screen's region in each).
//
//   schedule(rng, n = 12)             the flips to make: [{ colour, hold }] (ms; the first is the black the screen starts at, `initial`), then n flips, white first, alternating,
//                                     each held for a random time (rng() is 0..1) so that the camera's own flicker cannot lock to it
//   levels(samples, tSet, tNext)      the brightness before the flip and after it settled, from the camera's frames { t, v } (t: ms, v: mean grey of the screen's region), or null
//   seen(samples, tSet, levels)       the time of the first frame that has crossed half way after the flip set at tSet, or null (no flip seen: the picture never changed, or it had
//                                     already changed before the flip was set, which is a flicker). Two frames in a row must be past it, so one noisy frame does not count
//   verdict(list)                     the latencies of the flips (ms; null for a flip that could not be timed) -> { ok, medianMs, minMs, maxMs, n, unsteady, why }
//   frozen(samples)                   the picture hardly changed at all (not pointed at the screen, or the camera stopped)
//   frameInterval(samples)            the camera's usual time between frames, ms (the median)
// What it measures is what the overlay needs: how long after the page shows something the picture shows it. The screen's own response (about one frame) is in it.
(function (M) {
  const HOLD = [500, 1400];             // ms: how long each flip is held
  const INITIAL = 1000;                 // ms: the black the screen starts at
  const MIN_CONTRAST = 20;              // grey levels: less than this between black and white and the camera does not see the screen
  const MIN_FLIPS = 8;                  // flips that must have been timed for an answer
  const UNSTEADY = 0.4;                 // the spread (max - min) may be this much of the median
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function schedule(rng, n = 12) {
    const out = [{ colour: 'black', hold: INITIAL, initial: true }];
    for (let i = 0; i < n; i++) out.push({ colour: i % 2 === 0 ? 'white' : 'black', hold: Math.round(HOLD[0] + rng() * (HOLD[1] - HOLD[0])) });
    return out;
  }

  function levels(samples, tSet, tNext) {
    const before = samples.filter((s) => s.t >= tSet - 300 && s.t < tSet).map((s) => s.v);
    const after = samples.filter((s) => s.t >= tSet + 300 && s.t < tNext).map((s) => s.v);
    if (before.length < 3 || after.length < 3) return null;
    return { before: median(before), after: median(after) };
  }

  function seen(samples, tSet, lv) {
    if (!lv || !Number.isFinite(lv.before) || !Number.isFinite(lv.after)) return null;
    const swing = lv.after - lv.before;
    if (Math.abs(swing) < MIN_CONTRAST) return null;
    const half = (lv.before + lv.after) / 2, past = (v) => (v - half) * Math.sign(swing) >= 0;
    let k = 0;
    while (k < samples.length && samples[k].t < tSet) k++;
    if (k > 0 && past(samples[k - 1].v)) return null;                    // it had changed before the flip was set
    for (let i = k; i < samples.length - 1; i++) if (past(samples[i].v) && past(samples[i + 1].v)) return samples[i].t;
    return null;
  }

  function verdict(list) {
    const good = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
    if (good.length < MIN_FLIPS) return { ok: false, n: good.length, why: `Only ${good.length} of the flips could be timed; at least ${MIN_FLIPS} are needed. Keep the camera on the screen, still, with the screen filling much of the picture.` };
    const med = median(good), min = Math.min(...good), max = Math.max(...good);
    return { ok: true, n: good.length, medianMs: med, minMs: min, maxMs: max, unsteady: max - min > UNSTEADY * med, why: null };
  }

  function frozen(samples) {
    if (samples.length < 5) return true;
    let lo = Infinity, hi = -Infinity;
    for (const s of samples) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
    return hi - lo < MIN_CONTRAST / 2;
  }

  function frameInterval(samples) {
    const d = [];
    for (let i = 1; i < samples.length; i++) d.push(samples[i].t - samples[i - 1].t);
    return d.length ? median(d) : null;
  }

  M.latency = { schedule, levels, seen, verdict, frozen, frameInterval, HOLD, INITIAL, MIN_CONTRAST, MIN_FLIPS, UNSTEADY };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
