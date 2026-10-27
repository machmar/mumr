// The instant replay, with no physics and no THREE: a recorder that keeps the last seconds of every body's pose, and a player that runs them
// back. When the first block touches the ground the host freezes everything where it is (the state is kept exactly), holds it for a
// moment, rewinds the last two seconds quickly, plays them again in slow motion, and lets the world go on from the frozen state: the
// collapse then finishes in real time. The host sets the bodies' poses from the player and sends them in the usual packet (net.js, mode and
// progress), so every headset and PC view sees the same replay in the same place (rule 1).
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const M = typeof module !== 'undefined' ? require('../../engine/client/index.js') : globalThis.MUMR;
  const Q = M.physics.quat;
  const CFG = { hz: 30, keepSecs: 4, window: 2.0, freezeMs: 1500, rewindMs: 800, rate: 0.3 };

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

  // the player: frozen for freezeMs, then the frames backwards in rewindMs, then forwards at `rate` of real time
  class Replay {
    constructor(frames, opts = {}) {
      this.cfg = Object.assign({}, CFG, opts); this.f = frames; this.t = 0; this.done = frames.length < 2;
      this.span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
      this.slowMs = this.span / this.cfg.rate;
      this.total = this.cfg.freezeMs + this.cfg.rewindMs + this.slowMs;
    }
    skip() { this.done = true; }
    // dtMs of real time: -> { mode (net.js MODE), progress (0..1 through this part), pose (the bodies' poses as a Float32Array of 7 each) | null (frozen: leave as is), done }
    step(dtMs) {
      this.t += dtMs;
      const c = this.cfg, F = this.f;
      if (this.done || this.t >= this.total) { this.done = true; return { mode: 4, progress: 1, pose: F.length ? F[F.length - 1].a : null, done: true }; }
      if (this.t < c.freezeMs) return { mode: 1, progress: this.t / c.freezeMs, pose: null, done: false };
      const u = this.t - c.freezeMs;
      if (u < c.rewindMs) { const f = u / c.rewindMs; return { mode: 2, progress: f, pose: this.at(this.span * (1 - ease(f))), done: false }; }
      const f = (u - c.rewindMs) / this.slowMs;
      return { mode: 3, progress: f, pose: this.at(this.span * f), done: false };
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
