// The soundtrack: ambient tracks that Marek supplies (apps/jenga/music/), slowly crossfaded, with swells when the game gets tense.
// No THREE and no DOM of its own (the page hands in the audio it needs; the Node tests hand in a pretend one).
//
//  1. THE DIRECTOR (pure, on the PC host): from the game state and the host's own bodies it decides the SCENE (calm, build, tense, danger,
//     finale, win), the track, and where in it, and puts that in the document as ONE record (`jmusic`: { n, scene, track, pos, at, fade }, `at`
//     on the server's clock). Every headset plays that record, at the same place in the same track: the music is one thing for the room.
//     A tenser scene comes once the tension has lasted 1.5 s, in 9 s; a calmer one after 22 s, in 30 s. A scene the music comes back to carries
//     on where it was left; a track heard for the first time comes in half way (another place each round), so a long track is not always
//     heard from the same first minute (the fall and the win start from the top); a track that is about to end is followed by the next of its scene.
//  2. THE SOUND (Web Audio, on every page): a track is a streamed <audio> element (a decoded 10-minute track would be 200 MB), started at the
//     record's place and heard once it actually plays: then an equal-power crossfade of the record's `fade` seconds. Tension opens a filter and
//     raises the music a little (a swell, slow in, slower out) on a stage of its own; the moments (a die rolled, a block pulled or put on top,
//     the fall's duck, the replay) on another, so neither undoes the other. Moments come from the shared state, the same on every page; a
//     generated drone, bells, a low boom and a riser (no sample files) carry them. A limiter guards the end. With no tracks a soft pad plays.
//  apps/jenga/music/README.md says what kind of track belongs to which scene.
(function (J) {
  const need = (n) => (typeof module !== 'undefined' ? require(`./${n}.js`) : J);
  const S = need('spec');
  const SCENES = ['calm', 'build', 'tense', 'danger', 'finale', 'win'];
  const CFG = { crossfade: 30, rise: 9, fades: { finale: 6, win: 12 }, volumes: [0, 0.22, 0.45, 0.72, 1], swellMax: 0.32, minScene: 22, sustain: 1.5,     // seconds, gain per volume step, how much louder a tense moment is, s before the scene may drop, s a tenser one must last
    enter: { tense: 0.32, danger: 0.62 }, leave: { tense: 0.22, danger: 0.45 }, anywhere: ['calm', 'build', 'tense', 'danger'], drift: 2, giveUp: 15 };          // tension thresholds; the scenes whose tracks may be entered half way (or where they were left); s a page may drift; s a track has to start playing

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const manifestOf = (m) => { const o = Object.assign({ crossfade: CFG.crossfade, rise: CFG.rise, fades: CFG.fades, scenes: {}, lengths: {} }, m || {}); o.scenes = o.scenes || {}; o.lengths = o.lengths || {}; return o; };

  // ---- the director -----------------------------------------------------------------------------------------------------------------
  // How tense the tower is, from the bodies. update(state, snapshotItems, dt) every frame -> 0..1 (smoothed: quick up, slow down).
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
        this.prev = new Map(items.map((it) => [it.i, it.p.slice()]));
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

  // The clacks of wood on wood and on the plinth, found in the bodies the page already has (nothing extra is sent): a body that was moving and is
  // suddenly much slower, or turned back, has hit something. update(items, dt, k) -> [{ i, p, strength 0..1 }]; k is the size's scale (a giant block's
  // speeds are those of a small one times sqrt(k), for the same fall).
  class Impacts {
    constructor() { this.prev = new Map(); this.cool = new Map(); this.t = 0; }
    update(items, dt, k = 1) {
      this.t += dt;
      const out = [], r = Math.sqrt(Math.max(1, k));
      if (!(dt > 0) || !items) { this.prev.clear(); return out; }
      const seen = new Set();
      for (const it of items) {
        seen.add(it.i);
        const o = this.prev.get(it.i), v = o ? [(it.p[0] - o.p[0]) / dt, (it.p[1] - o.p[1]) / dt, (it.p[2] - o.p[2]) / dt] : null;
        this.prev.set(it.i, { p: it.p.slice(), v });
        if (!o || !o.v || !v || (it.flags & 1)) continue;                                    // (a block a hand holds is not hitting anything)
        const s0 = Math.hypot(...o.v), s1 = Math.hypot(...v), dv = Math.hypot(v[0] - o.v[0], v[1] - o.v[1], v[2] - o.v[2]);
        if (s0 > 0.22 * r && dv > 0.45 * s0 && dv > 0.2 * r && this.t - (this.cool.get(it.i) || -1) > 0.05) { this.cool.set(it.i, this.t); out.push({ i: it.i, p: it.p, strength: clamp01(dv / (2.2 * r)) }); }
      }
      for (const i of [...this.prev.keys()]) if (!seen.has(i)) this.prev.delete(i);
      return out;
    }
  }

  // which scene is wanted: by phase, and while the game is on by how far it has got and how tense it is. `held` is how long the scene has lasted (s).
  const RANK = { calm: 0, build: 1, tense: 2, danger: 3 }, GAME = ['build', 'tense', 'danger'];
  function sceneFor(state, tension, cur, held, dwell = CFG.minScene) {
    const ph = state ? state.phase : 'lobby';
    if (ph === 'fall' || ph === 'replay') return 'finale';
    if (ph === 'match_end') return 'win';
    if (ph === 'aftermath' || ph === 'round_end' || ph === 'lobby' || !state) return 'calm';
    const moves = state.moves || 0, inDanger = cur === 'danger', inTense = inDanger || cur === 'tense';
    // (a scene is entered higher than it is left: a tension that wavers about a threshold does not flip it)
    let want = tension > (inDanger ? CFG.leave.danger : CFG.enter.danger) ? 'danger' : moves >= 5 || tension > (inTense ? CFG.leave.tense : CFG.enter.tense) ? 'tense' : 'build';
    // (no flapping: a scene lasts a while before it may drop to a calmer one)
    if (cur && want !== cur && held < dwell && RANK[cur] !== undefined && RANK[want] < RANK[cur]) want = cur;
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
  // the track for a scene: a hash of the tower's seed, the scene and the round
  function pickTrack(pool, seed, scene, round) { return pool && pool.length ? pool[hash(`${seed}|${scene}|${round || 0}`) % pool.length] : null; }
  // where in a track it comes in, as a fraction of the room it has (0 to 1): a hash like the pick, so another place each round;
  // `n` is how many tracks have followed one another since the scene began (a track that follows itself comes in somewhere else each time)
  function startFraction(seed, scene, round, file, n = 0) { return (hash(`${seed}|${scene}|${round || 0}|${file}|${n}`) % 1000) / 1000; }
  // a scene's tracks, or those of the nearest scene that has some (a scene with none keeps the music of another); null when there are none at all
  function poolFor(manifest, scene) {
    const sc = (manifest && manifest.scenes) || {}, has = (s) => sc[s] && sc[s].length;
    if (has(scene)) return sc[scene];
    const order = { calm: ['build', 'tense', 'win', 'danger', 'finale'], build: ['calm', 'tense', 'danger'], tense: ['build', 'danger', 'calm'], danger: ['tense', 'finale', 'build'], finale: ['danger', 'tense', 'calm'], win: ['calm', 'build'] }[scene] || [];
    for (const s of order) if (has(s)) return sc[s];
    return null;
  }

  // The director, on the PC host. opts: { now () -> ms on the server's clock, manifest (tracks.json), log }.
  // step(state, items, dt[, tension]) every host step -> the new record for the document, or null when nothing has changed.
  class Director {
    constructor(opts = {}) {
      this.now = opts.now || (() => Date.now()); this.log = opts.log || (() => {});
      this.manifest = manifestOf(opts.manifest); this.tension = new Tension();
      this.scene = null; this.t = 0; this.since = 0; this.pending = null; this.cur = null; this.heads = {}; this.n = 0; this.follows = 0; this.seed = 1; this.round = 0;
    }
    load(manifest) { this.manifest = manifestOf(manifest); }
    // may the tracks of a scene come in half way, or where they were left? (ambient ones need not start at the beginning; the finale and the
    // win are shaped from their first second). tracks.json `anywhere` overrides the list.
    startsAnywhere(scene) { const a = this.manifest.anywhere; return (Array.isArray(a) ? a : CFG.anywhere).includes(scene); }
    get tracks() { return Object.values(this.manifest.scenes).reduce((a, p) => a + (p ? p.length : 0), 0); }
    // a host that starts again takes the record that is in the document, and carries on from it
    adopt(rec) {
      if (!rec || typeof rec.scene !== 'string' || !SCENES.includes(rec.scene)) return;
      this.cur = Object.assign({}, rec); this.scene = rec.scene; this.since = this.t; this.n = Math.max(this.n, rec.n || 0);
    }
    // where the current track is now (s)
    posNow(ms = this.now()) { return this.cur ? this.cur.pos + (ms - this.cur.at) / 1000 : 0; }
    step(state, items, dt, k = this.tension.update(state, items, dt)) {
      this.t += dt;
      if (state) { this.seed = state.seed; this.round = state.round; }
      const was = this.scene, sc = this._want(state, k);
      if (sc !== was) {
        this.scene = sc; this.since = this.t; this.follows = 0;
        const up = RANK[sc] !== undefined && RANK[was] !== undefined && RANK[sc] > RANK[was], f = this.manifest.fades && this.manifest.fades[sc];
        const fade = Number.isFinite(f) ? f : up ? this.manifest.rise : this.manifest.crossfade;
        return this._go(pickTrack(poolFor(this.manifest, sc), state && state.seed, sc, state && state.round), fade, true);
      }
      // a track that is about to end: the next of its scene (or itself again, somewhere else)
      const c = this.cur, len = c && c.track ? this.manifest.lengths[c.track] : null;
      if (len && this.posNow() >= len - this.manifest.crossfade - 1) {
        const pool = poolFor(this.manifest, this.scene) || [c.track], next = pool[(pool.indexOf(c.track) + 1) % pool.length] || c.track;
        this.heads[c.track] = 0; this.follows++;
        return this._go(next, this.manifest.crossfade, false);
      }
      return null;
    }
    // the scene, held back a moment when it is the tension that wants a tenser one (a knock on the tower is not a new scene)
    _want(state, k) {
      const want = sceneFor(state, k, this.scene, this.t - this.since);
      if (want === this.scene || !(GAME.includes(this.scene) && RANK[want] > RANK[this.scene])) { this.pending = null; return want; }
      if (!this.pending) this.pending = this.t;
      return this.t - this.pending >= CFG.sustain - 1e-9 ? ((this.pending = null), want) : this.scene;
    }
    _go(track, fade, newScene) {
      const ms = Math.round(this.now()), c = this.cur;
      if (c && c.track && track === c.track && newScene) {                    // (the new scene keeps the same track: it plays on where it is)
        this.cur = Object.assign({}, c, { scene: this.scene, pos: +this.posNow(ms).toFixed(2), at: ms, fade, n: this._n(ms) });
        return Object.assign({}, this.cur);
      }
      if (c && c.track && track !== c.track) this.heads[c.track] = +(this.posNow(ms) + fade).toFixed(2);       // (it fades out over `fade` s more)
      // where it comes in: where it was left; or, the first time, somewhere in it that keeps two crossfades (and a second) to play (a hash, so
      // another place each round); a short track, one whose length is not known, the finale and the win from the beginning
      const len = track ? this.manifest.lengths[track] : null, room = len ? len - (2 * this.manifest.crossfade + 1) : 0;
      let pos = 0;
      if (track && this.startsAnywhere(this.scene)) pos = this.heads[track] || (room >= 1 ? Math.round(startFraction(this.seed, this.scene, this.round, track, this.follows) * room * 100) / 100 : 0);
      if (len && pos > len - this.manifest.crossfade - 20) pos = 0;
      this.cur = { n: this._n(ms), scene: this.scene, track: track || null, pos, at: ms, fade };
      this.log(`music: ${this.scene}: ${track || '(no tracks)'}${pos ? ` from ${pos.toFixed(0)} s` : ''}, in ${fade} s`);
      return Object.assign({}, this.cur);
    }
    _n(ms) { this.n = Math.max(this.n + 1, ms); return this.n; }               // (a new number every time, also after the host started again)
  }

  // ---- the sound ---------------------------------------------------------------------------------------------------------------------
  // io: { ctx (an AudioContext, or made on start()), audio () -> an <audio>-like element, now () -> ms on the server's clock, base (the URL of the music folder), log }
  class Music {
    constructor(io = {}) {
      this.io = io; this.cfg = Object.assign({}, CFG); this.base = io.base || 'music/'; this.now = io.now || (() => Date.now());
      this.manifest = manifestOf(null);
      this.ctx = null; this.decks = []; this.scene = null; this.track = null; this.recN = null; this.vol = 2; this.tension = 0; this.ducked = false;
      this.log = io.log || (() => {});
    }
    load(manifest) { this.manifest = manifestOf(manifest); }
    get tracks() { return Object.values(this.manifest.scenes).reduce((a, p) => a + (p ? p.length : 0), 0); }
    // call from a user's click or touch (a page may make no sound before one)
    start() {
      if (this.ctx) { if (this.ctx.resume) this.ctx.resume(); return true; }
      const ctx = this.ctx = this.io.ctx || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (ctx.resume) ctx.resume();
      // tracks, pad, drone -> master (the volume) -> tension stage (gain, filter) -> moments stage (gain, filter) -> limiter -> out;
      // the one-shot sounds -> sfx -> limiter. Each stage is driven by one thing only (an AudioParam driven by two undoes one of them).
      const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; }, F = (hz) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = hz; f.Q.value = 0.4; return f; };
      this.out = ctx.destination;
      this.limiter = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : G(1);
      if (this.limiter.threshold) { this.limiter.threshold.value = -3; this.limiter.knee.value = 3; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.25; }
      this.master = G(0); this.tenseGain = G(1); this.tenseFilter = F(9000); this.momentGain = G(1); this.momentFilter = F(20000);
      this.master.connect(this.tenseGain); this.tenseGain.connect(this.momentGain); this.momentGain.connect(this.tenseFilter); this.tenseFilter.connect(this.momentFilter); this.momentFilter.connect(this.limiter);
      this.limiter.connect(this.out);
      this.sfx = G(0.9); this.sfx.connect(this.limiter);
      this.tracksBus = G(1); this.tracksBus.connect(this.master);
      this._makeDrone(); this._makePad();
      this.setVolume(this.vol);
      return true;
    }
    setVolume(v) {
      this.vol = Math.max(0, Math.min(4, v | 0));
      if (!this.ctx) return;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setTargetAtTime(this.cfg.volumes[this.vol], this.ctx.currentTime, 0.4);
    }
    // ---- the record from the document (the host's director): play its track from its place, on the server's clock
    follow(rec) {
      if (!this.ctx || !rec || rec.n === this.recN || !SCENES.includes(rec.scene)) return false;
      this.recN = rec.n; this.scene = rec.scene; this._padTo(rec.scene);
      const fade = Number.isFinite(rec.fade) ? rec.fade : this.manifest.crossfade;
      for (const d of this.decks) if (!d.started && !d.dying) this._stop(d);                         // (one that never got going: a newer record replaces it)
      this.decks = this.decks.filter((d) => !d.gone);
      const live = this.decks.find((d) => !d.dying);
      if (!rec.track) { for (const d of this.decks) if (!d.dying) this._fadeOut(d, this.ctx.currentTime, fade); this.track = null; return true; }
      // the same track, where it already is: it plays on (a new scene that kept its track)
      if (live && live.file === rec.track && Math.abs(this._off(live, rec)) < this.cfg.drift + 1) { live.sync = rec; this.track = rec.track; return true; }
      this.track = rec.track;
      this._deck(rec.track, rec, live ? fade : Math.min(fade, 6));                                  // (the first track of a visit comes in over 6 s at most)
      return true;
    }
    // where a deck's track should be now (s), from the record: the track loops, so the place wraps round it
    _pos(sync, dur) { const p = sync.pos + (Number.isFinite(sync.at) ? (this.now() - sync.at) / 1000 : 0); return Number.isFinite(dur) && dur > 0 ? ((p % dur) + dur) % dur : Math.max(0, p); }
    // how far a deck is from where the record says it should be (s, + ahead), the short way round a looping track
    _off(d, sync = d.sync) { const dur = d.el.duration; let o = d.el.currentTime - this._pos(sync, dur); if (Number.isFinite(dur) && dur > 0) o = ((o + dur / 2) % dur + dur) % dur - dur / 2; return o; }
    _deck(file, sync, fade) {
      const ctx = this.ctx, el = this.io.audio ? this.io.audio() : new Audio();
      el.preload = 'auto'; el.loop = true; el.crossOrigin = 'anonymous'; el.volume = 1;
      el.src = `${this.base}${file.split('/').map(encodeURIComponent).join('/')}#t=${this._pos(sync, NaN).toFixed(2)}`;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const src = ctx.createMediaElementSource(el); src.connect(gain); gain.connect(this.tracksBus);
      const d = { file, el, gain, src, sync, fade, born: ctx.currentTime, started: false, dying: false, stopAt: null, syncedAt: -Infinity };
      const on = (n, f) => (el.addEventListener ? el.addEventListener(n, f) : (el[`on${n}`] = f));
      on('loadedmetadata', () => { if (!d.dying && Math.abs(this._off(d)) > 0.5) el.currentTime = this._pos(d.sync, el.duration); });
      on('playing', () => this._begin(d));
      const p = el.play(); if (p && p.catch) p.catch((e) => this.log(`music: ${file} would not play (${e && e.message ? e.message : e})`));
      this.decks.push(d);
      return d;
    }
    // the new track plays: now the crossfade (the old one went on until here, so a slow stream leaves no gap)
    _begin(d) {
      if (d.started || d.dying) return;
      d.started = true;
      const now = this.ctx.currentTime;
      for (const o of this.decks) if (o !== d && !o.dying) this._fadeOut(o, now, d.fade);
      ramp(d.gain.gain, 0, 1, now, d.fade);
      this.log(`music: ${d.file} (${this.scene}) from ${d.el.currentTime.toFixed(0)} s, crossfade ${d.fade.toFixed(0)} s${now - d.born > 1 ? ` (${(now - d.born).toFixed(1)} s to start)` : ''}`);
    }
    _fadeOut(d, now, secs) {
      d.dying = true; const g = d.gain.gain;
      hold(g, now); ramp(g, g.value, 0, now, secs);
      d.stopAt = now + secs + 0.3;
    }
    // a deck that is done: stopped, and its stream let go of (a paused element with a src keeps its connection and its buffer)
    _stop(d) {
      d.dying = true; d.gone = true;
      try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); d.src.disconnect(); d.gain.disconnect(); } catch (e) { /* gone */ }
    }
    // every second or so: a faded-out track is stopped, one that never started is given up, one that has drifted from the record is put back
    tick() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const d of this.decks) {
        if (d.dying) { if (d.stopAt !== null && now >= d.stopAt) this._stop(d); continue; }
        if (!d.started) { if (now - d.born > this.cfg.giveUp) { this.log(`music: ${d.file} did not start in ${this.cfg.giveUp} s: the music stays as it is`); this._stop(d); } continue; }
        if (Math.abs(this._off(d)) > this.cfg.drift && now - d.syncedAt > 15 && !d.el.seeking) { d.syncedAt = now; this.log(`music: ${d.file} was ${this._off(d).toFixed(1)} s off: put back`); d.el.currentTime = this._pos(d.sync, d.el.duration); }
      }
      this.decks = this.decks.filter((d) => !d.gone);
    }
    // ---- tension: every frame; the music rises a little and brightens, the drone comes in (the tension stage only)
    update(tension, dt) {
      if (!this.ctx) return;
      this.tension += (tension - this.tension) * Math.min(1, dt * 3);
      const t = this.ctx.currentTime, k = this.tension;
      this.tenseFilter.frequency.setTargetAtTime(2200 + 9000 * Math.pow(k, 0.7), t, 0.6);
      this.tenseGain.gain.setTargetAtTime(1 + this.cfg.swellMax * Math.pow(k, 1.4), t, 0.8);
      this.droneGain.gain.setTargetAtTime(0.05 * Math.pow(k, 2) * this._droneOn, t, 0.8);
      this.droneLfo.gain.setTargetAtTime(0.4 * k, t, 1);
    }
    // ---- one-shot moments: a short swell of the music (the moments stage only), and a sound of their own
    moment(what) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, g = this.momentGain.gain;
      const swell = (peak, attack, release) => { if (this.ducked) return; hold(g, t); g.linearRampToValueAtTime(peak, t + attack); g.linearRampToValueAtTime(1, t + attack + release); };
      if (what === 'rolled') { this.bell(392, 0.18); swell(1.08, 0.6, 3); }
      else if (what === 'pulled') { swell(1.15, 1.2, 4); this.riser(1.6, 0.05); }
      else if (what === 'placed') { this.bell(523.25, 0.22); this.bell(659.25, 0.14, 0.12); swell(1.06, 0.5, 3); }
      else if (what === 'placedWell') { this.bell(523.25, 0.24); this.bell(659.25, 0.18, 0.12); this.bell(783.99, 0.16, 0.26); this.bell(1046.5, 0.1, 0.4); swell(1.1, 0.5, 3.5); }
      else if (what === 'placedBad') { this.bell(311.13, 0.16); }
      else if (what === 'fall') { this._duck(); this.boom(); }
      else if (what === 'replay') { this.riser(2.2, 0.16); this._rise(7); }
      else if (what === 'aftermath') { if (this.ducked) this._rise(4); this.bell(196, 0.2); this.bell(293.66, 0.12, 0.3); }
      else if (what === 'roundEnd') { if (this.ducked) this._rise(4); this.bell(261.63, 0.18); }
      else if (what === 'matchEnd') { if (this.ducked) this._rise(4); for (const [i, f] of [392, 493.88, 587.33, 783.99].entries()) this.bell(f, 0.2, i * 0.35); swell(1.25, 2, 8); }
      else if (what === 'start') { if (this.ducked) this._rise(4); this.bell(293.66, 0.2); this.bell(440, 0.14, 0.2); }
    }
    // the freeze: the music all but stops and dulls, and stays so; the replay (or, skipped, what comes after) brings it back over seconds, louder than before
    _duck() { const t = this.ctx.currentTime, g = this.momentGain.gain, f = this.momentFilter.frequency; this.ducked = true; hold(g, t); g.linearRampToValueAtTime(0.12, t + 0.25); hold(f, t); f.setTargetAtTime(380, t, 0.12); }
    _rise(secs) { const t = this.ctx.currentTime, g = this.momentGain.gain, f = this.momentFilter.frequency; this.ducked = false; hold(g, t); g.linearRampToValueAtTime(1.35, t + Math.min(2.5, secs / 2)); g.linearRampToValueAtTime(1, t + secs); hold(f, t); f.setTargetAtTime(20000, t, 1.2); }
    // ---- generated sounds (no sample files)
    // wood on wood: a bright click and a short body, higher for a small block; pan -1..1 (left to right), near 0..1 (how close it is)
    clack(strength, pan = 0, near = 1, pitch = 1) {
      const ctx = this.ctx, t = ctx.currentTime, gain = 0.05 + 0.5 * strength * strength, att = 0.25 + 0.75 * near;
      const n = this._noiseSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = (1500 + 1800 * Math.random()) * pitch; f.Q.value = 2.5;
      g.gain.setValueAtTime(gain * att, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035 + 0.05 * strength);
      o.type = 'triangle'; o.frequency.setValueAtTime((260 + 120 * Math.random()) * pitch, t); o.frequency.exponentialRampToValueAtTime(110 * pitch, t + 0.09);
      og.gain.setValueAtTime(gain * att * 0.7, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      let out = this.sfx;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(this.sfx); out = p; }
      n.connect(f); f.connect(g); g.connect(out); o.connect(og); og.connect(out); n.start(t); n.stop(t + 0.12); o.start(t); o.stop(t + 0.14);
    }
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
    dispose() { for (const d of this.decks) this._stop(d); this.decks = []; this.recN = null; if (this.ctx && this.ctx.close && !this.io.ctx) this.ctx.close(); this.ctx = null; }
  }
  // An equal-power fade of an AudioParam from a to b over secs from t0 (piecewise linear ramps along the square root: two tracks fading against each
  // other, one in and one out, then keep the same loudness: a plain linear fade dips 3 dB in the middle). a is the value it has now.
  function ramp(param, a, b, t0, secs, n = 24) {
    param.setValueAtTime(a, t0);
    for (let i = 1; i <= n; i++) { const f = i / n, e = b >= a ? Math.sqrt(f) : 1 - Math.sqrt(1 - f); param.linearRampToValueAtTime(a + (b - a) * e, t0 + secs * f); }
  }
  // an AudioParam kept where it is at t, and what was scheduled after dropped (where cancelAndHoldAtTime is missing: its value now)
  function hold(param, t) {
    if (param.cancelAndHoldAtTime) { param.cancelAndHoldAtTime(t); return; }
    const v = Number.isFinite(param.value) ? param.value : 1; param.cancelScheduledValues(t); param.setValueAtTime(v, t);
  }

  // The page's whole music in one object: fed the shared state, the bodies and the director's record every frame.
  class Soundtrack {
    constructor(io = {}) { this.music = new Music(io); this.tension = new Tension(); this.impacts = new Impacts(); this.state = null; this.t = 0; }
    get scene() { return this.music.scene; }
    // listener: { x, y, yaw } in the common frame, where the ears are (the clacks are panned and softened by it); rec: the document's `jmusic`
    update(state, items, dt, volume, listener, rec) {
      this.t += dt;
      const m = this.music;
      if (volume !== undefined && volume !== m.vol) m.setVolume(volume);
      if (rec) m.follow(rec);
      const k = this.tension.update(state, items, dt);
      if (state) { for (const w of momentsBetween(this.state, state)) m.moment(w); this.state = state; }
      m.update(k, dt);
      if (state && items) {
        const size = S.dims(state.size), hits = this.impacts.update(items, dt, size.k).sort((a, b) => b.strength - a.strength).slice(0, 5);
        for (const h of hits) {
          let pan = 0, near = 1;
          if (listener) { const dx = h.p[0] - listener.x, dy = h.p[1] - listener.y, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx) - listener.yaw; pan = -Math.sin(a) * Math.min(1, d / 0.6); near = 1 / (1 + 0.8 * d); }
          m.clack(h.strength, pan, near, 1 / Math.pow(Math.max(1, size.k), 0.28));
        }
      }
      return k;
    }
  }

  Object.assign(J, { Tension, Impacts, sceneFor, momentsBetween, pickTrack, startFraction, poolFor, Director, Music, Soundtrack, MUSIC: CFG, SCENES });
})(typeof module !== 'undefined' ? module.exports : (globalThis.JENGA = globalThis.JENGA || {}));
