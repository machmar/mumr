// What the webcam page knows about one camera: where the player clicked the floor spots in its picture, its field of
// view, and what is kept for it between sessions. No THREE and no DOM (webcamview.js is the page, webcam.js the geometry).
//
// Spots are in the common floor frame (align.js): spot 1 is the origin, spot 2 is on the x axis, `dist` away, z = 0 (the
// sheets lie on the floor; heights in the common frame are measured from the plane the headsets agree on). The page gets
// them from the world feed (worldfeed.js), so they are the same for every player and survive a headset restarting.
(function (M) {
  const WC = M.webcam, MK = M.markers;
  const D2R = Math.PI / 180;
  const DEF_DELAY = 60;                      // ms: how far in the past the world is drawn until the address or a measured latency says otherwise
  const DEF_FOV = 70;                        // degrees, horizontal: what most webcams have, until one is measured
  // The four-click fallback for measuring the field of view: the distance between the centres of sheet 4's markers 1 and 2 (w) and 1 and 4 (h), in
  // metres, from the sheet's layout (markers.js SHEET, which make_align_sheets.py repeats; a test keeps them in step).
  const FOV_SHEET = { w: (MK.SHEET.pos[1][0] - MK.SHEET.pos[0][0]) / 1000, h: (MK.SHEET.pos[3][1] - MK.SHEET.pos[0][1]) / 1000 };
  const KEEP_SHOTS = 5;
  const LIB_KEY = 'mumr.webcam.fovlib';                   // the named field-of-view calibrations of the first version (read when there are no profiles, never written)
  const PROFILE_KEY = 'mumr.webcam.profiles';             // the camera profiles (version 2), shared by all cameras
  const NAME_MAX = 40;
  const SHEET_KEY = 'mumr.webcam.sheetbars';             // how big sheet 4 is shown (the two 100 mm bars, as measured on the screen): one setting for all cameras
  const BAR_MM = 100;                                         // what each bar is on the printed sheet
  // a bar length typed in (a number, or text such as ' 28.5 '): millimetres from 5 to 1000, or null
  const barNum = (v) => { const x = typeof v === 'string' ? (v.trim() === '' ? NaN : +v.trim()) : v; return typeof x === 'number' && Number.isFinite(x) && x >= 5 && x <= 1000 ? x : null; };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const r3 = (v) => +v.toFixed(3);
  const LENS_MAX = 0.5;                                       // |a1| and |a2| (lens.js): more than that is not a lens
  const lensOk = (a1, a2) => typeof a1 === 'number' && typeof a2 === 'number' && Number.isFinite(a1) && Number.isFinite(a2) && Math.abs(a1) < LENS_MAX && Math.abs(a2) < LENS_MAX;
  const latencyOk = (ms) => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= 2000;

  // The spots the headsets took, from the world feed's document (`feed.doc`): { pts: [spot 1, spot 2, check spot | null] }, or
  // null while nobody is lined up. Every lined-up player measured the distance between the crosses itself, and every player
  // that placed a check mark has one: the mean of each is used (they differ by the headsets' own errors).
  function spotsFromDoc(doc) {
    const dists = Object.values((doc && doc.lined) || {}).map((l) => l && l.dist).filter((d) => Number.isFinite(d) && d > 0);
    if (!dists.length) return null;
    const checks = Object.values((doc && doc.checks) || {}).filter((c) => Array.isArray(c) && (c.length === 2 || c.length === 3) && c.every(Number.isFinite));
    const check = checks.length ? [r3(mean(checks.map((c) => c[0]))), r3(mean(checks.map((c) => c[1]))), r3(mean(checks.map((c) => c[2] || 0)))] : null;
    return { pts: [[0, 0, 0], [r3(mean(dists)), 0, 0], check] };
  }

  // How far in the past the world is drawn (ms): what the address says (?delay=100), else the latency measured for this camera, else 60. -> { ms, from: 'address' | 'profile' | 'default' }
  function delayFor(search, latencyMs) {
    const raw = typeof search === 'string' ? new URLSearchParams(search).get('delay') : null, a = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(a) && a >= 0 && a <= 2000) return { ms: a, from: 'address' };
    if (latencyOk(latencyMs)) return { ms: Math.round(latencyMs), from: 'profile' };
    return { ms: DEF_DELAY, from: 'default' };
  }

  class Calib {
    // store: { get(key, default), set(key, value) } (the page's localStorage wrapper)
    constructor(store) {
      this.store = store || { get: (k, d) => d, set() {} };
      this.key = ''; this.W = 0; this.H = 0;
      this.clicks = [null, null, null];      // [u, v] in the picture: spot 1, spot 2, check spot
      this.shots = [];                       // field-of-view measurements, degrees
      this.choice = 0;                       // 0: the best fit; 1, 2..: another place that fits almost as well
      this.known = {};                       // { x, y, z } of the lens when it is known (a fingertip on the lens, later)
      this.fovId = null;                     // the profile applied to this camera, or null: measured or typed here, or assumed
      this._a1 = null; this._a2 = null;      // how its lens bends straight lines (lens.js), or null: not measured
      this._latency = null;                  // how late its picture is, ms, or null: not measured
      this._cache = null;
    }
    get fovDeg() { return this.shots.length ? median(this.shots) : DEF_FOV; }
    get fovMeasured() { return this.shots.length > 0; }
    // Which camera, and how big its picture is now: what was kept for that camera at that size comes back.
    use(id, W, H) {
      this.key = `mumr.webcam.${id}.${W}x${H}`; this.W = W; this.H = H;
      this.clicks = [null, null, null]; this.shots = []; this.choice = 0; this.fovId = null; this._a1 = null; this._a2 = null; this._latency = null; this._cache = null;
      const d = this.store.get(this.key, null);
      if (d && (d.v === 1 || d.v === 2)) {
        const ok = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && c[0] >= 0 && c[0] <= W && c[1] >= 0 && c[1] <= H;
        if (Array.isArray(d.clicks)) this.clicks = [0, 1, 2].map((i) => (ok(d.clicks[i]) ? d.clicks[i].slice() : null));
        if (Array.isArray(d.shots)) this.shots = d.shots.filter((s) => Number.isFinite(s) && s > 20 && s < 140).slice(-KEEP_SHOTS);
        if (Number.isInteger(d.choice) && d.choice >= 0 && d.choice < 4) this.choice = d.choice;
        const pid = d.v === 2 ? d.profileId : d.fovId;
        // a camera that uses a profile has what the profile has now (the profile may have been filled in since, from another camera or another session)
        const prof = typeof pid === 'string' ? this.profiles().find((e) => e.id === pid) : null;
        if (prof) { this.shots = prof.fovDeg === null ? [] : [prof.fovDeg]; this._a1 = null; this._a2 = null; this._latency = null; this.fovId = pid; }
        if (this.fovId !== null) { const p = this.profiles().find((e) => e.id === this.fovId); this._a1 = p.a1; this._a2 = p.a2; this._latency = p.latencyMs; }
        else if (d.v === 2) { if (lensOk(d.a1, d.a2)) { this._a1 = d.a1; this._a2 = d.a2; } if (latencyOk(d.latencyMs)) this._latency = d.latencyMs; }
      }
    }
    _save() { this._cache = null; if (this.key) this.store.set(this.key, { v: 2, clicks: this.clicks, shots: this.shots, choice: this.choice, profileId: this.fovId, a1: this._a1, a2: this._a2, latencyMs: this._latency }); }
    setClick(i, uv) { this.clicks[i] = [uv[0], uv[1]]; this.choice = 0; this._save(); }
    // the lens of this camera as lens.js has it, and the clicks as the ideal (pinhole) picture has them: the solver works in that picture, the clicks stay as they were clicked
    get lens() { return { a1: this.a1, a2: this.a2, W: this.W, H: this.H }; }
    _ideal(uv) { const l = this.lens; return M.lens && !M.lens.isNone(l) ? M.lens.toIdeal(l, uv[0], uv[1]) : uv; }
    idealClicks() { return this.clicks.map((c) => (c ? this._ideal(c) : null)); }
    clearClicks() { this.clicks = [null, null, null]; this.choice = 0; this._save(); }
    setChoice(c) { this.choice = c; this._save(); }
    // A measurement of the field of view from the printed frame: its four corner marks in the picture, in the order of
    // their numbers. -> degrees, or null when the picture says nothing (the sheet faces the lens, or the clicks are not a quadrilateral)
    addFovShot(corners) {
      const s = this.sheetScale, f = WC.fovFromRect(corners.map((c) => this._ideal(c)), FOV_SHEET.w * s.sx, FOV_SHEET.h * s.sy, this.W, this.H);
      const deg = f === null ? NaN : f / D2R;
      if (!(deg > 20 && deg < 140)) return null;
      this.shots.push(deg); this.shots = this.shots.slice(-KEEP_SHOTS); this.fovId = null; this._save();
      return deg;
    }
    // A field of view measured elsewhere (the automatic measurement from the printed markers): kept as one more shot. -> degrees, or null when it is not one
    addFovDeg(deg) {
      if (!(deg > 20 && deg < 140)) return null;
      this.shots.push(deg); this.shots = this.shots.slice(-KEEP_SHOTS); this.fovId = null; this._save();
      return deg;
    }
    setFov(deg) { this.shots = Number.isFinite(deg) && deg > 20 && deg < 140 ? [deg] : []; this.fovId = null; this._save(); }
    clearFov() { this.shots = []; this.fovId = null; this._save(); }

    // ---- the sheet as it is shown. A phone shows sheet 4 small (and maybe a little stretched): the player measures the two 100 mm bars on the screen, between their end
    // lines, and enters the lengths. h: the horizontal bar, v: the vertical one; either may be missing. The field of view does not depend on the size, only on the
    // shape (so a shown sheet that is not stretched needs no number), but the guide outline and the distances it suggests do, and a stretched picture needs both.
    sheetBars() {
      const d = this.store.get(SHEET_KEY, null);
      return d && d.v === 1 ? { h: barNum(d.h), v: barNum(d.vert) } : { h: null, v: null };
    }
    setSheetBars(h, v) { this.store.set(SHEET_KEY, { v: 1, h: barNum(h), vert: barNum(v) }); this._cache = null; }
    clearSheetBars() { this.store.set(SHEET_KEY, { v: 1, h: null, vert: null }); this._cache = null; }
    // how much bigger the shown sheet is than the printed one, across and down: { sx, sy } (one bar given: the same both ways; none: the printed size)
    get sheetScale() {
      const b = this.sheetBars(), h = b.h === null ? null : b.h / BAR_MM, v = b.v === null ? null : b.v / BAR_MM;
      if (h === null && v === null) return { sx: 1, sy: 1 };
      return { sx: h === null ? v : h, sy: v === null ? h : v };
    }

    // ---- camera profiles: what has been measured about a camera (field of view, how its lens bends straight lines, how late its picture is) saved under a name, to pick
    // again later (any camera, any picture size). One key (version 2) holds them all; before the first save the old list of named field-of-view calibrations
    // (LIB_KEY, version 1) is read as the same thing without a lens and without a latency, and it is never written. A profile may lack the lens or the latency (null).
    // -> [{ id, name, fovDeg, a1, a2, latencyMs }] (a record that is damaged gives an empty list; entries that are not whole are left out)
    profiles() {
      const d2 = this.store.get(PROFILE_KEY, null), d1 = d2 && d2.v === 2 && Array.isArray(d2.list) ? null : this.store.get(LIB_KEY, null);
      const list = d2 && d2.v === 2 && Array.isArray(d2.list) ? d2.list : d1 && d1.v === 1 && Array.isArray(d1.list) ? d1.list : [];
      return list.filter((e) => e && typeof e.id === 'string' && e.id && typeof e.name === 'string' && e.name && (e.fovDeg === null || (Number.isFinite(e.fovDeg) && e.fovDeg > 20 && e.fovDeg < 140)))
        .map((e) => { const ok = lensOk(e.a1, e.a2); return { id: e.id, name: e.name, fovDeg: e.fovDeg, a1: ok ? e.a1 : null, a2: ok ? e.a2 : null, latencyMs: latencyOk(e.latencyMs) ? e.latencyMs : null }; });
    }
    get profileId() { return this.fovId; }
    get profileName() { const e = this.fovId ? this.profiles().find((x) => x.id === this.fovId) : null; return e ? e.name : null; }
    _saveProfiles(list) { this.store.set(PROFILE_KEY, { v: 2, list }); this._cache = null; }
    // the name as it will be kept (trimmed, spaces squeezed), or { why } when it cannot be used; `except`: an id that may already have this name
    _name(name, list, except) {
      const n = String(name === null || name === undefined ? '' : name).trim().replace(/\s+/g, ' ');
      if (!n) return { why: 'Give it a name' };
      if (n.length > NAME_MAX) return { why: `The name is longer than ${NAME_MAX} characters` };
      if (list.some((e) => e.id !== except && e.name.toLowerCase() === n.toLowerCase())) return { why: `There is already a calibration called ${n}` };
      return { n };
    }
    // keep what this camera has now under a name; at least one of the three must have been measured (or typed): the assumed values are not worth saving
    // -> { ok: true, entry } | { ok: false, why }
    saveProfile(name) {
      if (!this.fovMeasured && !this.lensMeasured && !this.latencyMeasured) return { ok: false, why: 'Measure or type a field of view first (or measure the lens or the latency): the assumed one is not worth saving' };
      const list = this.profiles(), r = this._name(name, list, null);
      if (r.why) return { ok: false, why: r.why };
      const top = list.reduce((m, e) => Math.max(m, +String(e.id).replace(/\D/g, '') || 0), 0);
      const entry = { id: `f${top + 1}`, name: r.n, fovDeg: +this.fovDeg.toFixed(2), a1: this.lensMeasured ? this.a1 : null, a2: this.lensMeasured ? this.a2 : null, latencyMs: this.latencyMeasured ? this.latencyMs : null };
      this._saveProfiles(list.concat([entry]));
      this.fovId = entry.id; this._save();
      return { ok: true, entry };
    }
    renameProfile(id, name) {
      const list = this.profiles(), e = list.find((x) => x.id === id);
      if (!e) return { ok: false, why: 'No such calibration' };
      const r = this._name(name, list, id);
      if (r.why) return { ok: false, why: r.why };
      e.name = r.n; this._saveProfiles(list);
      return { ok: true, entry: e };
    }
    // forget a profile; a camera that was using it keeps the numbers, without the name
    deleteProfile(id) {
      const list = this.profiles();
      if (!list.some((x) => x.id === id)) return false;
      this._saveProfiles(list.filter((x) => x.id !== id));
      if (this.fovId === id) { this.fovId = null; this._save(); }
      return true;
    }
    // apply a profile to this camera -> the entry, or null
    useProfile(id) {
      const e = this.profiles().find((x) => x.id === id);
      if (!e) return null;
      this.shots = e.fovDeg === null ? [] : [e.fovDeg]; this._a1 = e.a1; this._a2 = e.a2; this._latency = e.latencyMs; this.fovId = id; this._save();
      return e;
    }
    // A new profile with nothing measured in it (fovDeg null: the field of view is assumed), which this camera then uses -> { ok, entry } | { ok: false, why }
    createProfile(name) {
      const list = this.profiles(), r = this._name(name, list, null);
      if (r.why) return { ok: false, why: r.why };
      const top = list.reduce((m, e) => Math.max(m, +String(e.id).replace(/\D/g, '') || 0), 0);
      const entry = { id: `f${top + 1}`, name: r.n, fovDeg: null, a1: null, a2: null, latencyMs: null };
      this._saveProfiles(list.concat([entry]));
      this.useProfile(entry.id);
      return { ok: true, entry };
    }
    // What a calibration found goes into the profile it was made for. patch: any of { fovDeg: number | null (null: assumed again), lens: { a1, a2 } | null, latencyMs: number | null };
    // what is not in it stays. A value that is not valid is left out (the answer says so). opts.use: this camera takes the profile as it is now. -> { ok, entry, skipped } | { ok: false, why }
    updateProfile(id, patch, opts = {}) {
      const list = this.profiles(), e = list.find((x) => x.id === id), skipped = [];
      if (!e) return { ok: false, why: 'No such profile' };
      if (patch && 'fovDeg' in patch) { const v = patch.fovDeg; if (v === null || (Number.isFinite(v) && v > 20 && v < 140)) e.fovDeg = v === null ? null : +v.toFixed(2); else skipped.push('fovDeg'); }
      if (patch && 'lens' in patch) { const l = patch.lens; if (l === null) { e.a1 = null; e.a2 = null; } else if (l && lensOk(l.a1, l.a2)) { e.a1 = l.a1; e.a2 = l.a2; } else skipped.push('lens'); }
      if (patch && 'latencyMs' in patch) { const v = patch.latencyMs; if (v === null || latencyOk(v)) e.latencyMs = v; else skipped.push('latencyMs'); }
      this._saveProfiles(list);
      if (opts.use || this.fovId === id) this.useProfile(id);
      return { ok: true, entry: e, skipped };
    }
    // forget a profile for good: a camera that was using it goes back to the assumed field of view, no lens, no latency (deleteProfile keeps its numbers) -> bool
    removeProfile(id) {
      const list = this.profiles();
      if (!list.some((x) => x.id === id)) return false;
      const using = this.fovId === id;
      this._saveProfiles(list.filter((x) => x.id !== id));
      if (using) { this.shots = []; this._a1 = null; this._a2 = null; this._latency = null; this.fovId = null; this._save(); }
      return true;
    }
    // (the names of the first version, when only the field of view was kept)
    fovLib() { return this.profiles(); }
    get fovName() { return this.profileName; }
    saveFov(name) { return this.saveProfile(name); }
    renameFov(id, name) { return this.renameProfile(id, name); }
    deleteFov(id) { return this.deleteProfile(id); }
    useFov(id) { return this.useProfile(id); }

    // ---- the lens and the latency of this camera (lens.js, latency.js): measured by the calibration mode, or null
    get a1() { return this._a1 === null ? 0 : this._a1; }
    get a2() { return this._a2 === null ? 0 : this._a2; }
    get lensMeasured() { return this._a1 !== null && this._a2 !== null; }
    get latencyMs() { return this._latency; }
    get latencyMeasured() { return this._latency !== null; }
    // -> true when taken (the limits of lens.js: both within 0.5 either way)
    setLens(a1, a2) { if (!lensOk(a1, a2)) return false; this._a1 = a1; this._a2 = a2; this.fovId = null; this._save(); return true; }
    clearLens() { this._a1 = null; this._a2 = null; this.fovId = null; this._save(); }
    setLatency(ms) { if (!latencyOk(ms)) return false; this._latency = ms; this.fovId = null; this._save(); return true; }
    clearLatency() { this._latency = null; this.fovId = null; this._save(); }

    // The camera from the clicks and the spots the headset has now: { ok: true, cam, rms, per, idx, alts, choice } or
    // { ok: false, why }. The answer is kept until the spots, the clicks or the field of view change.
    result(spots) {
      const key = JSON.stringify([spots, this.clicks, this.fovDeg, this.choice, this.known, this.W, this.H, this.a1, this.a2]);
      if (this._cache && this._cache.key === key) return this._cache.value;
      const value = this._compute(spots);
      this._cache = { key, value };
      return value;
    }
    _compute(spots) {
      if (!this.W) return { ok: false, why: 'The camera is not running' };
      if (!spots || !spots.pts || !spots.pts[0] || !spots.pts[1]) return { ok: false, why: 'No player is lined up yet: the two spots are not known' };
      const idx = [0, 1, 2].filter((i) => this.clicks[i] && spots.pts[i]), ideal = this.idealClicks();
      if (idx.length < 2) return { ok: false, why: 'Click spot 1 and spot 2 in the picture' };
      if (idx.length < 3 && this.known.z === undefined && !('x' in this.known)) {
        return { ok: false, why: !spots.pts[2] ? 'No player has placed the check spot yet (headset panel: Line up again, then a fingertip on sheet 3)' : 'Click the check spot in the picture too' };
      }
      const r = WC.solve(idx.map((i) => spots.pts[i]), idx.map((i) => ideal[i]), { hfov: this.fovDeg * D2R, W: this.W, H: this.H, known: this.known });
      if (!r.ok) return r;
      const all = [r].concat(r.alts), at = Math.min(this.choice, all.length - 1), pick = all[at];
      return { ok: true, cam: pick.cam, rms: pick.rms, per: pick.per, idx, alts: r.alts.length, choice: at };
    }
  }

  M.webcamcal = { Calib, spotsFromDoc, delayFor, FOV_SHEET, DEF_FOV, DEF_DELAY, BAR_MM };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
