// Measuring a webcam's field of view from the printed sheet 4 without clicking: it is fed what the marker detector sees (markers.js) a few times a
// second, waits until the sheet has been still for a moment, takes a snapshot (the mean of those frames, so the hand's tremor and the camera's noise
// average out), works the field of view out of it (webcam.js) and says where to put the sheet next. No THREE and no DOM.
//
//   const cap = new FovCapture({ W, H, hfovDeg });          W x H: the picture; hfovDeg: what is assumed until a shot says better
//   cap.feed(markers, nowMs) -> status                       markers: what detect() returned
//   opts.scale: how big the sheet is shown ({ sx, sy } or a function; see _s): the guide and the plane of the measurement follow it
//   status = { state: 'looking' | 'settling' | 'taken', progress (0..1: how long it has been still), seen: [ids], shots (count), fovDeg (median, or null),
//              spread (max - min of the shots, degrees), done (enough agreeing shots), msg, next: { outline, slots, text, n } | null }
//   cap.shots  [{ fovDeg, centre: [u, v], tiltDeg, azimuthDeg, pts }]
// (where a marker corner is on the sheet, and where the sheet is in front of a camera, are in markers.js: sheetPose, sheetToPicture, cornerMM)
(function (M) {
  const WC = M.webcam, MK = M.markers, D2R = Math.PI / 180, L = MK.SHEET, { sheetPose, sheetToPicture, cornerMM } = MK;
  const STILL_MS = 500;           // steady for this long: take the snapshot
  const MIN_SAMPLES = 4;          // and from at least this many frames
  const JITTER_PX = 6;            // a hand-held sheet wobbles: every corner of every frame of the last moment must be within this of where they are on average, or the oldest frames are let go
  const F_SPREAD = 0.10;          // the field of view worked out frame by frame must agree within this (the biggest less the smallest, over the median), or it is not taken
  const STEADIER_MS = 2000;       // when frames have had to be let go three times in this long: say so
  const MOVE_PX = 30;             // after a snapshot: some corner of the sheet must move this far before the next one can be taken
  const LOST_MS = 400;            // ...or be out of sight this long
  const SAME_TILT = 10, SAME_AZ = 25, SAME_CENTRE = 0.15;   // a second snapshot of the same place is not wanted: degrees, degrees, fraction of the width
  const DONE_SHOTS = 3, DONE_SPREAD = 0.03;                  // three shots that agree within 3 %: enough
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin((a - b) * D2R), Math.cos((a - b) * D2R))) / D2R;

  // the places the sheet is asked for, one after the other: each is a pose in front of the camera (the first is the easiest)
  const TARGETS = [
    { d: 0.55, tilt: 50, yaw: 0, roll: 0, left: 0, up: 0, say: 'in the middle, leaning back about 50 degrees (the top edge away from you)' },
    { d: 0.60, tilt: 50, yaw: 40, roll: 0, left: 0.13, up: 0, say: 'on the left of the picture, turned so that its left edge is away from you, leaning back' },
    { d: 0.60, tilt: 50, yaw: -40, roll: 0, left: -0.13, up: 0, say: 'on the right of the picture, turned so that its right edge is away from you, leaning back' },
    { d: 0.50, tilt: 55, yaw: 0, roll: 90, left: 0, up: 0, say: 'in the middle, turned sideways (the long edge across), leaning back' },
    { d: 0.65, tilt: 45, yaw: 15, roll: -25, left: 0.02, up: -0.06, say: 'a little low in the picture, turned about 25 degrees to one side, leaning back' },
  ];

  // the plane's tilt (degrees off facing the lens) and the direction it leans (degrees, in picture axes) from its homography and the focal length
  function planeAngles(Hm, f) {
    const a = [Hm[0] / f, Hm[3] / f, Hm[6]], b = [Hm[1] / f, Hm[4] / f, Hm[7]], s = Math.hypot(a[0], a[1], a[2]) || 1;
    const r1 = a.map((v) => v / s), r2 = b.map((v) => v / s);
    let n = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
    if (n[2] > 0) n = n.map((v) => -v);                                  // (pointing back at the camera)
    return { tiltDeg: Math.acos(Math.min(1, Math.abs(n[2]))) / D2R, azimuthDeg: Math.atan2(n[1], n[0]) / D2R };
  }
  // the numbers of a view of the sheet that decide whether two views are "the same place"
  function describe(pairs, W, H, fpx) {
    const Hm = WC.homography(pairs.map((p) => [p[0], p[1]]), pairs.map((p) => [p[2] - W / 2, p[3] - H / 2]));
    if (!Hm) return null;
    const ang = planeAngles(Hm, fpx);
    const cx = pairs.reduce((s, p) => s + p[2], 0) / pairs.length, cy = pairs.reduce((s, p) => s + p[3], 0) / pairs.length;
    return Object.assign({ centre: [cx, cy] }, ang);
  }

  class FovCapture {
    constructor(opts) {
      this.W = opts.W; this.H = opts.H; this.assumedDeg = opts.hfovDeg || 70;
      this._scale = opts.scale || null;      // how big the sheet is shown ({ sx, sy }, or a function that says: 1 is the printed sheet; a phone shows it at about 0.3)
      this.reset();
    }
    _s() { const s = typeof this._scale === 'function' ? this._scale() : this._scale; return s && s.sx > 0 && s.sy > 0 ? s : { sx: 1, sy: 1 }; }
    reset() { this.cursor = 0; this.shots = []; this.buf = []; this.trims = []; this.state = 'looking'; this.taken = null; this.lostAt = null; this.msg = ''; this.seen = []; this.progress = 0; this.warn = null; this.takenMsg = ''; }
    get fovDeg() { return this.shots.length ? median(this.shots.map((s) => s.fovDeg)) : null; }
    get spread() { const f = this.shots.map((s) => s.fovDeg); return f.length ? Math.max(...f) - Math.min(...f) : 0; }
    get done() { return this.shots.length >= DONE_SHOTS && this.spread / this.fovDeg < DONE_SPREAD; }

    feed(markers, t) {
      const byId = new Map(markers.map((m) => [m.id, m]));
      this.seen = [...byId.keys()].sort();
      if (byId.size < 4) {
        this.buf = []; this.progress = 0;
        if (this.state === 'taken') { if (this.lostAt === null) this.lostAt = t; else if (t - this.lostAt > LOST_MS) { this.state = 'looking'; this.lostAt = null; } }
        else this.state = 'looking';
        this.msg = byId.size === 0 ? 'Hold sheet 4 in front of the camera' : `${4 - byId.size} of the 4 markers are not seen: keep the corners clear of your fingers`;
        return this.status();
      }
      this.lostAt = null;
      const cur = [];
      for (let k = 0; k < 4; k++) for (const c of byId.get(k).corners) cur.push(c[0], c[1]);
      if (this.state === 'taken') {
        if (!this._moved(cur, this.taken.pts)) { this.msg = this.takenMsg; return this.status(); }
        this.state = 'looking';
      }
      // the frames of the last moment: the newest is added, then the oldest are let go while any corner of any frame is further than JITTER_PX from the average
      this.buf.push({ t, pts: cur });
      const had = this.buf.length;
      while (this.buf.length > 1 && !this._steady(this.buf)) this.buf.shift();
      if (had - this.buf.length >= 1 && had >= 2) { this.trims.push(t); this.trims = this.trims.filter((x) => t - x < STEADIER_MS); }
      this.progress = Math.min(1, (t - this.buf[0].t) / STILL_MS);
      if (this.warn && this._moved(cur, this.warn.pts)) this.warn = null;
      this.state = 'settling';
      this.msg = this.warn ? this.warn.text : this.trims.length >= 3 && this.progress < 0.6 ? 'Keep it a little steadier: lean it on something if you can' : this.progress > 0 ? 'Hold it steady...' : 'Hold it steady';
      if (t - this.buf[0].t >= STILL_MS && this.buf.length >= MIN_SAMPLES) this._snapshot();
      return this.status();
    }
    // two views of the sheet are "the same place" when the tilt, the direction it leans and where it is in the picture all agree
    _same(a, b) { return Math.abs(a.tiltDeg - b.tiltDeg) < SAME_TILT && angDiff(a.azimuthDeg, b.azimuthDeg) < SAME_AZ && Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) < SAME_CENTRE * this.W; }
    // has any corner of the sheet moved more than MOVE_PX from where it was in `ref` (the flat list of 32 numbers)?
    _moved(cur, ref) { for (let i = 0; i < 32; i += 2) if (Math.hypot(cur[i] - ref[i], cur[i + 1] - ref[i + 1]) > MOVE_PX) return true; return false; }
    // are all the frames within JITTER_PX of their average, every corner?
    _steady(buf) {
      const m = this._mean(buf).pts;
      for (const s of buf) for (let i = 0; i < 32; i++) if (Math.abs(s.pts[i] - m[i]) > JITTER_PX) return false;
      return true;
    }
    _mean(buf) {
      const n = buf.length, pts = new Array(buf[0].pts.length).fill(0);
      for (const s of buf) for (let i = 0; i < pts.length; i++) pts[i] += s.pts[i] / n;
      let cx = 0, cy = 0; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
      return { pts, cx: cx / (pts.length / 2), cy: cy / (pts.length / 2) };
    }
    _snapshot() {
      const mean = this._mean(this.buf);
      // the field of view of each frame of the snapshot on its own (a trembling hand moves the sheet a little from frame to frame, but every frame is a
      // valid view of it), and the median of those; the view of the sheet (its tilt, where it is) is the average of the frames
      const sc = this._s();
      const pairsOf = (pts) => { const out = []; for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) { const [X, Y] = cornerMM(k, i); out.push([X * sc.sx / 1000, Y * sc.sy / 1000, pts[(k * 4 + i) * 2], pts[(k * 4 + i) * 2 + 1]]); } return out; };
      const each = this.buf.map((s) => WC.fovFromPlane(pairsOf(s.pts), this.W, this.H)).map((f) => (f === null ? NaN : f / D2R));
      const good = each.filter((d) => d > 20 && d < 140);
      if (good.length < Math.ceil(each.length / 2)) { this.warn = { text: 'Lean the sheet further back: face on it says nothing about the field of view', pts: mean.pts }; this.msg = this.warn.text; this.buf = []; return; }
      const deg = median(good);
      if ((Math.max(...good) - Math.min(...good)) / deg > F_SPREAD) { this.buf = this.buf.slice(-2); return; }      // (the frames do not agree: wait for steadier ones)
      const pairs = pairsOf(mean.pts), f = deg * D2R;
      if (!(deg > 20 && deg < 140)) { this.warn = { text: 'Lean the sheet further back: face on it says nothing about the field of view', pts: mean.pts }; this.msg = this.warn.text; this.buf = []; return; }
      const info = describe(pairs, this.W, this.H, WC.fpx(this.W, f));
      if (!info) { this.buf = []; this.state = 'looking'; return; }
      const dup = this.shots.find((s) => this._same(s, info));
      if (dup) { this.takenMsg = this.msg = 'That is the same place as an earlier shot: move the sheet to the suggested place'; this.taken = mean; this.state = 'taken'; this.buf = []; return; }
      // the place that was suggested is used up: the next suggestion starts after it, even when the sheet was held somewhere else than the outline showed
      const suggested = this.next();
      if (suggested) this.cursor = suggested.n % TARGETS.length;
      this.shots.push(Object.assign({ fovDeg: deg, pts: mean.pts }, info));
      this.taken = mean; this.state = 'taken'; this.buf = []; this.progress = 1;
      this.msg = `Shot ${this.shots.length}: field of view ${deg.toFixed(1)} degrees`;
      this.takenMsg = 'Got it. Now move the sheet to the next place';
    }

    // The shots do not agree (a camera whose picture is bent does that: the markers at the edges of the picture are moved, and the field of view that the tilted sheet seems to
    // give is then wrong, by a lot near the edges). With the lens unknown the shots are as they were seen: look for the lens a1 (a2 = 0: one number is what three or more places can
    // tell) for which the field of view comes out the same at every place, and take the median of those. -> { a1, a2: 0, fovDeg, spread } or null (the shots agree, or there are
    // fewer than three, or no bend makes them agree)
    lensGuess() {
      const LN = M.lens;
      if (!LN || this.shots.length < 3 || this.done) return null;
      const sc = this._s();
      const fovOf = (pts, lens) => {
        const pairs = [];
        for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) { const [X, Y] = cornerMM(k, i), q = LN.toIdeal(lens, pts[(k * 4 + i) * 2], pts[(k * 4 + i) * 2 + 1]); pairs.push([X * sc.sx / 1000, Y * sc.sy / 1000, q[0], q[1]]); }
        const f = WC.fovFromPlane(pairs, this.W, this.H);
        return f === null ? NaN : f / D2R;
      };
      let best = null;
      for (let a1 = 0.3; a1 >= -0.5; a1 -= 0.0025) {
        const lens = { a1, a2: 0, W: this.W, H: this.H };
        if (!LN.valid(lens)) continue;
        const f = this.shots.map((s) => fovOf(s.pts, lens));
        if (f.some((x) => !(x > 20 && x < 140))) continue;
        const spread = Math.max(...f) - Math.min(...f);
        if (!best || spread < best.spread) best = { a1, spread, fovDeg: median(f) };
      }
      if (!best || best.spread / best.fovDeg > DONE_SPREAD || Math.abs(best.a1) < 0.01) return null;
      return { a1: +best.a1.toFixed(4), a2: 0, fovDeg: best.fovDeg, spread: best.spread };
    }

    // place n (0 to 4) of TARGETS as it would be seen with the field of view known so far: { n, of, outline, slots, text, info }, or null when it does not fit in the picture
    view(n) {
      // a smaller sheet is held nearer: everything that is a distance in the place (how far, how far to the side, how high) shrinks with the sheet, so the picture is the same
      const sc = this._s(), hfov = (this.fovDeg || this.assumedDeg) * D2R, T = TARGETS[n], M = 10;
      const pose = sheetPose(Object.assign({}, T, { d: T.d * sc.sx, left: (T.left || 0) * sc.sx, up: (T.up || 0) * sc.sx }));
      const page = [[0, 0], [L.page[0], 0], [L.page[0], L.page[1]], [0, L.page[1]]].map(([X, Y]) => sheetToPicture(pose, hfov, this.W, this.H, X, Y, sc));
      const slots = L.pos.map(([mx, my]) => [[mx, my], [mx + L.side, my], [mx + L.side, my + L.side], [mx, my + L.side]].map(([X, Y]) => sheetToPicture(pose, hfov, this.W, this.H, X, Y, sc)));
      if (slots.some((q) => q.some((p) => !(p[2] > 0) || p[0] < M || p[0] > this.W - M || p[1] < M || p[1] > this.H - M))) return null;
      const pairs = []; slots.forEach((q, k) => q.forEach((p, i) => { const [X, Y] = cornerMM(k, i); pairs.push([X * sc.sx / 1000, Y * sc.sy / 1000, p[0], p[1]]); }));
      const info = describe(pairs, this.W, this.H, WC.fpx(this.W, hfov));
      if (!info) return null;
      return { n: n + 1, of: TARGETS.length, outline: page.map((p) => [p[0], p[1]]), slots: slots.map((q) => q.map((p) => [p[0], p[1]])), text: T.say, info, dist: T.d * sc.sx };
    }
    // the next place to put the sheet: the first of TARGETS, from the one after the last that was suggested, that fits the picture and that no shot is near (so that holding the sheet
    // a little differently from the outline does not make the same outline come back); null when it is done
    next() {
      if (this.done) return null;
      for (let k = 0; k < TARGETS.length; k++) {
        const n = (this.cursor + k) % TARGETS.length, v = this.view(n);
        if (v && !this.shots.some((s) => this._same(s, v.info))) return v;
      }
      return null;
    }
    status() {
      return { state: this.state, progress: this.progress, seen: this.seen.slice(), shots: this.shots.length, fovDeg: this.fovDeg, spread: this.spread, done: this.done, msg: this.msg, next: this.next() };
    }
  }

  M.fovcapture = { FovCapture, TARGETS, planeAngles };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
