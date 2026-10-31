// The instant replay, with no physics and no THREE: a recorder that keeps the last seconds of every body's pose, and a player that runs them
// back. When the first block touches the ground the tower goes on falling for a moment (TIMBER), then the host freezes everything where it is
// (the state is kept exactly), holds it, rewinds the whole fall so that every block flies back into the tower, plays it again with a speed
// curve (slow motion that slows down further into the moment the first block hits the ground and speeds up after it), and lets the world go
// on from the frozen state. (Marek, 2026-10-28: "the rewind before replay is not there, give some speed curves to the replay") The host sets the bodies' poses from the player and sends them in the usual packet (net.js, mode and
// progress), so every headset and PC view sees the same replay in the same place (rule 1).
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  // window: s before the first hit that are played again; follow: ms the fall goes on after it before the freeze; the curve: the replay's speed
  // (times real time) at its start, at the hit (and how wide the slow part round it is, ms of the recording), and at its end
  const CFG = { hz: 30, keepSecs: 5, window: 2.0, follow: 1200, freezeMs: 700, rewindMs: 1600, curve: { start: 0.6, hit: 0.2, width: 450, end: 1 } };
  CFG.span = CFG.window * 1000 + CFG.follow;

  class Recorder {
    constructor(opts = {}) { this.cfg = Object.assign({}, CFG, opts); this.frames = []; this.at = -1e9; }
    clear() { this.frames = []; this.at = -1e9; }
    // call every host tick with the time (ms) and the bodies [{ p, q }]; keeps hz poses a second
    push(nowMs, bodies) {
      if (nowMs - this.at < (1000 / this.cfg.hz) * 0.85) return false;          // (the host ticks every 11 ms: 3 ticks make a frame of 33 ms)
      this.at = nowMs;
      const a = new Float32Array(bodies.length * 7);
      bodies.forEach((b, i) => { a.set(b.p, i * 7); a.set(b.q, i * 7 + 3); });
      this.frames.push({ t: nowMs, a });
      const keep = this.cfg.keepSecs * 1000;
      while (this.frames.length > 2 && nowMs - this.frames[0].t > keep) this.frames.shift();
      return true;
    }
    // the frames of the last `secs` seconds (oldest first) with the exact state `now` as the last
    take(nowMs, bodies, secs = this.cfg.window) {
      const a = new Float32Array(bodies.length * 7);
      bodies.forEach((b, i) => { a.set(b.p, i * 7); a.set(b.q, i * 7 + 3); });
      const from = nowMs - secs * 1000, out = this.frames.filter((f) => f.t >= from && f.t < nowMs - 1);
      out.push({ t: nowMs, a });
      return out;
    }
  }

  // the player: frozen for freezeMs, then the frames backwards in rewindMs, then forwards at the speed of the curve. opts.hitAt: when the first block
  // hit the ground (the frames' clock; without it, `follow` before the last frame)
  class Replay {
    constructor(frames, opts = {}) {
      this.cfg = Object.assign({}, CFG, opts); this.f = frames; this.t = 0; this.done = frames.length < 2;
      this.span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
      this.hit = frames.length ? (Number.isFinite(opts.hitAt) ? opts.hitAt : frames[frames.length - 1].t - this.cfg.follow) - frames[0].t : 0;
      this.s = 0;                                                       // (ms into the recording, in the slow part)
      let ms = 0; for (let s = 0; s < this.span; s += 5) ms += 5 / this.rate(s);
      this.slowMs = ms;
    }
    // the speed (times real time) at s ms into the recording: from `start` to `end` across the hit, and down to `hit` round it
    rate(s) {
      const c = this.cfg.curve, after = s > this.hit ? Math.min(1, (s - this.hit) / Math.max(1, this.span - this.hit)) : 0, base = c.start + (c.end - c.start) * after * after;
      const near = Math.exp(-Math.pow((s - this.hit) / c.width, 2));
      return c.hit + (base - c.hit) * (1 - near);
    }
    skip() { this.done = true; }
    // dtMs of real time: -> { mode (net.js MODE), progress (0..1 through this part), pose (the bodies' poses as a Float32Array of 7 each) | null (frozen: leave as is), done }
    step(dtMs) {
      this.t += dtMs;
      const c = this.cfg, F = this.f;
      const end = () => { this.done = true; return { mode: 4, progress: 1, pose: F.length ? F[F.length - 1].a : null, done: true }; };
      if (this.done) return end();
      if (this.t < c.freezeMs) return { mode: 1, progress: this.t / c.freezeMs, pose: null, done: false };
      const u = this.t - c.freezeMs;
      if (u < c.rewindMs) { const f = u / c.rewindMs; return { mode: 2, progress: f, pose: this.at(this.span * (1 - ease(f))), done: false }; }
      // (forwards: the recording at the curve's speed, in small steps; progress is how far into the recording, which the world's clock follows: fx.js)
      let left = Math.min(dtMs, u - c.rewindMs);
      while (left > 0 && this.s < this.span) { const h = Math.min(5, left); this.s += h * this.rate(this.s); left -= h; }
      if (this.s >= this.span) return end();
      return { mode: 3, progress: this.s / this.span, pose: this.at(this.s), done: false, rate: this.rate(this.s) };
    }
    // the poses `ms` after the first frame
    at(ms) {
      const F = this.f, t0 = F[0].t + ms;
      let i = F.length - 1;
      while (i > 0 && F[i - 1].t >= t0) i--;
      const x = F[Math.max(0, i - 1)], y = F[i], f = x === y ? 0 : Math.max(0, Math.min(1, (t0 - x.t) / (y.t - x.t))), out = new Float32Array(x.a.length);
      for (let k = 0; k < x.a.length; k += 7) {
        for (let j = 0; j < 3; j++) out[k + j] = x.a[k + j] + (y.a[k + j] - x.a[k + j]) * f;
        const q = Q.slerp([x.a[k + 3], x.a[k + 4], x.a[k + 5], x.a[k + 6]], [y.a[k + 3], y.a[k + 4], y.a[k + 5], y.a[k + 6]], f);
        out.set(q, k + 3);
      }
      return out;
    }
  }
  const ease = (f) => f * f * (3 - 2 * f);

  // the path of one body over the frames: [[x, y, z], ...] (the trail drawn behind the block that toppled the tower)
  function trail(frames, i, every = 2) {
    const out = [];
    frames.forEach((f, k) => { if (k % every === 0 || k === frames.length - 1) out.push([f.a[i * 7], f.a[i * 7 + 1], f.a[i * 7 + 2]].map((v) => Math.round(v * 1000) / 1000)); });
    return out;
  }

  Object.assign(J, { Recorder, Replay, trail, REPLAY: CFG });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
