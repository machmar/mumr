// The soundtrack: ambient tracks that Marek supplies (apps/jenga/music/), slowly crossfaded, with swells when the game gets tense.
// No THREE and no DOM of its own (the page hands in the audio it needs; the Node tests hand in a pretend one).
//
//  1. THE DIRECTOR (pure): from the shared game state (and how the tower is behaving) it decides the SCENE (calm, build, tense, danger, finale,
//     win), how TENSE the moment is (0..1), and which one-shot moments just happened (a die rolled, a block pulled, put on top, the tower
//     falling, the replay, the end of a round, the end of the match). Everybody's page reads the same shared state, so everybody is in the same
//     scene at the same time, and each scene picks the same track on every headset (a hash of the seed): the music is one thing for the room.
//  2. THE SOUND (Web Audio): a track is a streamed <audio> element (a decoded 10-minute track would be 200 MB). A scene change starts the next
//     track under the old one: an equal-power crossfade of `crossfade` seconds (30), and a track that is about to end is followed by the next
//     of its scene in the same way. Tension opens a filter and raises the music a little (a swell, slow in, slower out); one-shot moments
//     make a short swell; a generated drone, bells, a low boom and a riser (no sample files) carry the moments the tracks do not know about.
//     With no tracks at all a soft generated pad plays, so that the game is never silent.
//  apps/jenga/music/README.md says what kind of track belongs to which scene.
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const SCENES = ['calm', 'build', 'tense', 'danger', 'finale', 'win'];
  const CFG = { crossfade: 30, fades: { finale: 6, win: 12 }, volumes: [0, 0.22, 0.45, 0.72, 1], swellMax: 0.32, minScene: 22 };      // seconds, gain per volume step, how much louder a tense moment is, s before the scene may drop

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---- the director -----------------------------------------------------------------------------------------------------------------
  // How tense the tower is, from the pages' own view of it. update(state, snapshotItems, dt) every frame -> 0..1 (smoothed: quick up, slow down).
  //   holes     the share of the lower levels that have a block missing        lean   how far the top of the tower is from over its base
  //   agitation how much the blocks other than the pulled one are moving       height how many levels the tower has grown past 18
  class Tension {
    constructor() { this.v = 0; this.prev = null; this.agit = 0; this.lean = 0; this.parts = {}; }
    update(state, items, dt) {
      if (!state || !['roll', 'pull', 'place'].includes(state.phase)) { this.v += (0 - this.v) * (1 - Math.exp(-dt / 2.5)); this.prev = null; return this.v; }
      const tw = state.tower || { top: 17, topCount: 3 }, top = tw.top;
      let holes = 0, agit = 0, lean = 0;
      if (items && items.length) {
        const d = S.dims(state.size), L = S.layout(state.size), place = state.place || { x: 0, y: 0, yaw: 0 }, handled = state.handled ? state.handled.i : -1;
        if (this.prev && dt > 0) for (const it of items) { if (it.i >= S.BLOCKS || it.i === handled) continue; const p = this.prev.get(it.i); if (p) agit += Math.hypot(it.p[0] - p[0], it.p[1] - p[1], it.p[2] - p[2]) / dt; }
        this.prev = new Map(items.map((it) => [it.i, it.p]));
        agit = clamp01(agit / (0.35 * Math.sqrt(d.k)));
        // the blocks in the tower's column, level by level (in the tower's own frame): how many are missing below the top, and where the top is
        const loc = items.filter((it) => it.i < S.BLOCKS).map((it) => ({ i: it.i, p: S.fromCommon(place, it.p) })), counts = [];
        for (const q of loc) { if (q.i === handled || Math.abs(q.p[0]) > 0.62 * d.L || Math.abs(q.p[1]) > 0.62 * d.L) continue; const lv = Math.round((q.p[2] - L.plinth.top - d.H / 2) / d.H); if (lv >= 0 && lv < 40) counts[lv] = (counts[lv] || 0) + 1; }
        let topL = -1; counts.forEach((n, l) => { if (n > 0) topL = l; });
        if (topL > 0) { let missing = 0; for (let l = 0; l < topL; l++) missing += 3 - Math.min(3, counts[l] || 0); holes = clamp01((missing / (3 * topL)) * 3); }
        const hi = loc.filter((q) => q.i !== handled).sort((a, b2) => b2.p[2] - a.p[2]).slice(0, 6);
        if (hi.length) lean = clamp01((Math.hypot(hi.reduce((a, q) => a + q.p[0], 0) / hi.length, hi.reduce((a, q) => a + q.p[1], 0) / hi.length) / d.W - 0.4) / 1.4);
      }
      this.agit += (agit - this.agit) * (1 - Math.exp(-dt / 0.25)); this.lean += (lean - this.lean) * (1 - Math.exp(-dt / 0.5));
      const height = clamp01((top - 17) / 8), act = state.phase === 'place' ? 1 : state.phase === 'pull' ? 0.7 : 0.35;
      this.parts = { holes, lean: this.lean, agit: this.agit, height };
      const target = clamp01(0.08 + 0.38 * holes + 0.25 * this.lean + 0.7 * this.agit + 0.2 * height + 0.18 * act * (0.4 + holes) + (state.handled ? 0.1 : 0));
      this.v += (target - this.v) * (1 - Math.exp(-dt / (target > this.v ? 0.35 : 2.2)));
      return this.v;
    }
  }

  // which scene is playing: by phase, and while the game is on by how far it has got and how tense it is. `held` is how long the scene has lasted (s).
  function sceneFor(state, tension, cur, held) {
    const ph = state ? state.phase : 'lobby';
    if (ph === 'fall' || ph === 'replay') return 'finale';
    if (ph === 'match_end') return 'win';
    if (ph === 'aftermath' || ph === 'round_end' || ph === 'lobby' || !state) return 'calm';
    const moves = state.moves || 0;
    let want = tension > 0.62 ? 'danger' : moves >= 5 || tension > 0.32 ? 'tense' : 'build';
    if (cur && want !== cur && held < CFG.minScene && !['finale', 'win', 'calm'].includes(cur)) want = cur;               // (no flapping: a scene lasts a while)
    return want;
  }
  // the one-shot moments between two states: ['rolled', 'pulled', 'placed', 'fall', 'replay', 'aftermath', 'roundEnd', 'matchEnd', 'start']
  function momentsBetween(a, b) {
    const out = [];
    if (!b || !a) return out;                                          // (a page that comes into a game in progress hears none of its past)
    const pa = a.phase, pb = b.phase;
    if (pb === 'pull' && pa === 'roll') out.push('rolled');
    if (pb === 'place' && pa !== 'place') out.push('pulled');
    if (pa === 'place' && pb === 'roll' && b.moves > (a.moves || 0)) out.push(b.last && b.last.pts > 1 ? 'placedWell' : b.last && b.last.pts > 0 ? 'placed' : 'placedBad');
    if (pb === 'fall' && pa !== 'fall') out.push('fall');
    if (pb === 'replay' && pa !== 'replay') out.push('replay');
    if (pb === 'aftermath' && pa !== 'aftermath') out.push('aftermath');
    if (pb === 'round_end' && pa !== 'round_end') out.push('roundEnd');
    if (pb === 'match_end' && pa !== 'match_end') out.push('matchEnd');
    if (pb === 'roll' && (pa === 'lobby' || pa === 'round_end' || pa === 'match_end') && (a.round !== b.round || pa === 'lobby')) out.push('start');
    return out;
  }
  // the same track on every headset for a scene: a hash of the tower's seed, the scene and the round
  function pickTrack(pool, seed, scene, round) { return pool && pool.length ? pool[hash(`${seed}|${scene}|${round || 0}`) % pool.length] : null; }

  // ---- the sound ---------------------------------------------------------------------------------------------------------------------
  // io: { ctx (an AudioContext, or made on start() by ioNew), audio () -> an <audio>-like element, rand }, manifest: { crossfade, scenes: { name: [file] } }, base (the URL of the music folder)
  class Music {
    constructor(io = {}) {
      this.io = io; this.cfg = Object.assign({}, CFG); this.base = io.base || 'music/';
      this.manifest = { crossfade: CFG.crossfade, fades: CFG.fades, scenes: {} };
      this.ctx = null; this.decks = []; this.scene = null; this.sceneAt = 0; this.track = null; this.vol = 2; this.tension = 0; this.seed = 1; this.round = 0;
      this.log = io.log || (() => {});
    }
    load(manifest) { this.manifest = Object.assign({ crossfade: CFG.crossfade, fades: CFG.fades, scenes: {} }, manifest || {}); this.manifest.scenes = this.manifest.scenes || {}; }
    // how long the crossfade into a scene takes: 30 s, except for the scenes that are short (the fall, the end of the match: tracks.json `fades`)
    fadeFor(scene) { const f = this.manifest.fades && this.manifest.fades[scene]; return Number.isFinite(f) ? f : this.manifest.crossfade; }
    get tracks() { return Object.values(this.manifest.scenes).reduce((a, p) => a + (p ? p.length : 0), 0); }
    // call from a user's click or touch (a page may make no sound before one)
    start() {
      if (this.ctx) { if (this.ctx.resume) this.ctx.resume(); return true; }
      const ctx = this.ctx = this.io.ctx || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (ctx.resume) ctx.resume();
      // master -> swell filter -> out; the tracks, the pad and the drone go into master; the one-shot sounds go straight to out
      this.out = ctx.destination;
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.swellGain = ctx.createGain(); this.swellGain.gain.value = 1;
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 9000; this.filter.Q.value = 0.4;
      this.master.connect(this.swellGain); this.swellGain.connect(this.filter); this.filter.connect(this.out);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.out);
      this.tracksBus = ctx.createGain(); this.tracksBus.connect(this.master);
      this._makeDrone(); this._makePad();
      this.setVolume(this.vol);
      return true;
    }
    setVolume(v) {
      this.vol = Math.max(0, Math.min(4, v | 0));
      if (!this.ctx) return;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setTargetAtTime(this.cfg.volumes[this.vol], this.ctx.currentTime, 0.4);
    }
    // ---- the scene: pick the track and crossfade into it
    setScene(scene, seed, round) {
      if (!SCENES.includes(scene) || !this.ctx) return false;
      const changed = scene !== this.scene;
      this.seed = seed; this.round = round;
      if (changed) { this.scene = scene; this.sceneAt = this.ctx.currentTime; }
      this._padTo(scene);
      let pool = this.manifest.scenes[scene];
      if (!pool || !pool.length) pool = this._fallbackPool();
      const want = pickTrack(pool, seed, scene, round);
      if (want && (changed || !this.track) && want !== this.track) { this._crossfadeTo(want, this.fadeFor(scene)); return true; }
      return changed;
    }
    // the nearest scene that has tracks (a scene with none keeps the music of another)
    _fallbackPool() {
      const order = { calm: ['build', 'tense', 'win', 'danger', 'finale'], build: ['calm', 'tense', 'danger'], tense: ['build', 'danger', 'calm'], danger: ['tense', 'finale', 'build'], finale: ['danger', 'tense', 'calm'], win: ['calm', 'build'] }[this.scene] || [];
      for (const s of order) if (this.manifest.scenes[s] && this.manifest.scenes[s].length) return this.manifest.scenes[s];
      return null;
    }
    _crossfadeTo(file, secs) {
      const ctx = this.ctx, now = ctx.currentTime, first = !this.decks.some((x) => !x.dying), d = this._deck(file);
      const fade = first ? Math.min(secs, 6) : secs;                       // (the first track of a visit comes in over 6 s at most)
      for (const o of this.decks) if (o !== d && !o.dying) this._fadeOut(o, now, fade);
      ramp(d.gain.gain, 0, 1, now, fade);
      d.fadeEnd = now + fade; this.track = file;
      this.log(`music: ${file} (${this.scene}), crossfade ${fade.toFixed(0)} s`);
    }
    _fadeOut(d, now, secs) {
      d.dying = true; const g = d.gain.gain, from = Number.isFinite(g.value) ? g.value : 1;
      g.cancelScheduledValues(now); g.setValueAtTime(from, now);
      ramp(g, from, 0, now, secs);
      d.stopAt = now + secs + 0.3;
    }
    _deck(file) {
      const ctx = this.ctx, el = this.io.audio ? this.io.audio() : new Audio();
      el.src = this.base + file; el.preload = 'auto'; el.loop = false; el.crossOrigin = 'anonymous'; el.volume = 1;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const src = ctx.createMediaElementSource(el); src.connect(gain); gain.connect(this.tracksBus);
      const p = el.play(); if (p && p.catch) p.catch((e) => this.log(`music: ${file} would not play (${e && e.message ? e.message : e})`));
      const d = { file, el, gain, src, dying: false, stopAt: null, fadeEnd: 0, followed: false };
      this.decks.push(d);
      return d;
    }
    // every second or so: a track that is about to end is followed by the next of the scene's tracks, a faded-out one is stopped
    tick() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const d of this.decks.slice()) {
        if (d.dying && d.stopAt !== null && now >= d.stopAt) { try { d.el.pause(); d.src.disconnect(); d.gain.disconnect(); } catch (e) { /* gone */ } this.decks.splice(this.decks.indexOf(d), 1); continue; }
        const dur = d.el.duration;
        if (!d.dying && !d.followed && Number.isFinite(dur) && dur > 0 && dur - d.el.currentTime <= this.manifest.crossfade + 1) {
          d.followed = true;
          const pool = this.manifest.scenes[this.scene] && this.manifest.scenes[this.scene].length ? this.manifest.scenes[this.scene] : this._fallbackPool() || [d.file], next = pool[(pool.indexOf(d.file) + 1) % pool.length] || d.file;
          this._crossfadeTo(next, this.manifest.crossfade);
        }
      }
    }
    // ---- tension: every frame; the music rises a little and brightens, the drone comes in
    update(tension, dt) {
      if (!this.ctx) return;
      this.tension += (tension - this.tension) * Math.min(1, dt * 3);
      const t = this.ctx.currentTime, k = this.tension;
      this.filter.frequency.setTargetAtTime(2200 + 9000 * Math.pow(k, 0.7), t, 0.6);
      this.swellGain.gain.setTargetAtTime(1 + this.cfg.swellMax * Math.pow(k, 1.4), t, 0.8);
      this.droneGain.gain.setTargetAtTime(0.05 * Math.pow(k, 2) * this._droneOn, t, 0.8);
      this.droneLfo.gain.setTargetAtTime(0.4 * k, t, 1);
    }
    // ---- one-shot moments: a short swell of the music, and a sound of their own
    moment(what) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, g = this.swellGain.gain;
      const swell = (peak, attack, release) => { g.cancelScheduledValues(t); g.setValueAtTime(g.value || 1, t); g.linearRampToValueAtTime(peak, t + attack); g.linearRampToValueAtTime(1 + this.cfg.swellMax * Math.pow(this.tension, 1.4), t + attack + release); };
      if (what === 'rolled') { this.bell(392, 0.18); swell(1.12, 0.6, 3); }
      else if (what === 'pulled') { swell(1.2, 1.2, 4); this.riser(1.6, 0.05); }
      else if (what === 'placed') { this.bell(523.25, 0.22); this.bell(659.25, 0.14, 0.12); swell(1.08, 0.5, 3); }
      else if (what === 'placedWell') { this.bell(523.25, 0.24); this.bell(659.25, 0.18, 0.12); this.bell(783.99, 0.16, 0.26); this.bell(1046.5, 0.1, 0.4); swell(1.12, 0.5, 3.5); }
      else if (what === 'placedBad') { this.bell(311.13, 0.16); }
      else if (what === 'fall') { this._duck(); this.boom(); }
      else if (what === 'replay') { this.riser(2.2, 0.16); this._rise(7); }
      else if (what === 'aftermath') { this.bell(196, 0.2); this.bell(293.66, 0.12, 0.3); }
      else if (what === 'roundEnd') { this.bell(261.63, 0.18); }
      else if (what === 'matchEnd') { for (const [i, f] of [392, 493.88, 587.33, 783.99].entries()) this.bell(f, 0.2, i * 0.35); swell(1.3, 2, 8); }
      else if (what === 'start') { this.bell(293.66, 0.2); this.bell(440, 0.14, 0.2); }
    }
    // the freeze: the music all but stops and dulls; the replay brings it back over seconds, louder than before
    _duck() { const t = this.ctx.currentTime, g = this.swellGain.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value || 1, t); g.linearRampToValueAtTime(0.12, t + 0.25); this.filter.frequency.cancelScheduledValues(t); this.filter.frequency.setTargetAtTime(380, t, 0.12); }
    _rise(secs) { const t = this.ctx.currentTime, g = this.swellGain.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value || 0.12, t); g.linearRampToValueAtTime(1.45, t + 2.5); g.linearRampToValueAtTime(1, t + secs); this.filter.frequency.cancelScheduledValues(t); this.filter.frequency.setTargetAtTime(11000, t, 1.2); }
    // ---- generated sounds (no sample files)
    bell(freq, gain = 0.2, delay = 0) {
      const ctx = this.ctx, t = ctx.currentTime + delay;
      for (const [r, a, d] of [[1, 1, 5], [2.76, 0.45, 3], [5.4, 0.2, 1.6], [8.93, 0.08, 0.8]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq * r;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + d + 0.1);
      }
    }
    boom() {
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(78, t); o.frequency.exponentialRampToValueAtTime(34, t + 1.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 2.7);
      this._noise(0.9, 0.25, 700);
    }
    riser(secs, gain = 0.12) {
      const ctx = this.ctx, t = ctx.currentTime, n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5200, t + secs);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + secs * 0.9); g.gain.linearRampToValueAtTime(0, t + secs + 0.15);
      n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + secs + 0.2);
    }
    _noiseSource() {
      const ctx = this.ctx, len = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 2)), b = ctx.createBuffer(1, len, ctx.sampleRate || 44100), d = b.getChannelData ? b.getChannelData(0) : null;
      if (d) for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s;
    }
    _noise(secs, gain, cutoff) {
      const ctx = this.ctx, t = ctx.currentTime, n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
      n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + secs + 0.1);
    }
    // a deep two-note drone under tense moments: two detuned sines (D2, A2) with a slow beat, through the master (so it follows the volume)
    _makeDrone() {
      const ctx = this.ctx; this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0; this._droneOn = 1;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.9; lg.gain.value = 0; this.droneLfo = lg;
      lfo.connect(lg); lg.connect(this.droneGain.gain); lfo.start();
      for (const [f, d] of [[73.42, 0], [73.9, 0], [110.0, 0], [110.5, 0]]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f + d; o.connect(this.droneGain); o.start(); }
      this.droneGain.connect(this.master);
    }
    // the placeholder soundtrack: a slow pad of sines whose chord follows the scene; it is silent when there are tracks
    _makePad() {
      const ctx = this.ctx; this.padGain = ctx.createGain(); this.padGain.gain.value = 0; this.padGain.connect(this.master);
      this.pad = [0, 1, 2, 3].map(() => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 146.83; g.gain.value = 0.25; o.connect(g); g.connect(this.padGain); o.start(); return o; });
    }
    _padTo(scene) {
      if (!this.pad) return;
      const chords = { calm: [146.83, 220, 293.66, 329.63], build: [146.83, 220, 293.66, 369.99], tense: [146.83, 174.61, 220, 293.66], danger: [138.59, 164.81, 207.65, 277.18], finale: [130.81, 196, 233.08, 311.13], win: [196, 246.94, 293.66, 392] }[scene] || [];
      const t = this.ctx.currentTime;
      this.pad.forEach((o, i) => o.frequency.setTargetAtTime(chords[i] || 146.83, t, 3));
      this.padGain.gain.setTargetAtTime(this.tracks ? 0 : 0.07, t, 2);
    }
    dispose() { for (const d of this.decks) { try { d.el.pause(); } catch (e) { /* gone */ } } this.decks = []; if (this.ctx && this.ctx.close && !this.io.ctx) this.ctx.close(); this.ctx = null; }
  }
  // An equal-power fade of an AudioParam from a to b over secs from t0 (piecewise linear ramps along the square root: two tracks fading against each
  // other, one in and one out, then keep the same loudness: a plain linear fade dips 3 dB in the middle). a is the value it has now.
  function ramp(param, a, b, t0, secs, n = 24) {
    param.setValueAtTime(a, t0);
    for (let i = 1; i <= n; i++) { const f = i / n, e = b >= a ? Math.sqrt(f) : 1 - Math.sqrt(1 - f); param.linearRampToValueAtTime(a + (b - a) * e, t0 + secs * f); }
  }
  const curve = (inn, n = 64) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { const f = i / (n - 1); o[i] = Math.sqrt(inn ? f : 1 - f); } return o; };

  // The page's whole music in one object: the director plus the sound, fed the shared state and the bodies every frame.
  class Soundtrack {
    constructor(io = {}) { this.music = new Music(io); this.tension = new Tension(); this.state = null; this.scene = null; this.sceneSince = 0; this.t = 0; this.last = null; }
    update(state, items, dt, volume) {
      this.t += dt;
      const m = this.music;
      if (volume !== undefined && volume !== m.vol) m.setVolume(volume);
      const k = this.tension.update(state, items, dt);
      if (state) {
        for (const w of momentsBetween(this.state, state)) m.moment(w);
        const sc = sceneFor(state, k, this.scene, this.t - this.sceneSince);
        if (sc !== this.scene) { this.scene = sc; this.sceneSince = this.t; }
        m.setScene(this.scene, state.seed, state.round);
        this.state = state;
      }
      m.update(k, dt);
      return k;
    }
  }

  Object.assign(J, { Tension, sceneFor, momentsBetween, pickTrack, Music, Soundtrack, MUSIC: CFG, SCENES, musicCurve: curve });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
