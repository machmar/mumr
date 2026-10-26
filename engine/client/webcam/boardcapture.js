// Taking snapshots of the marker board for the distortion fit: it watches what the detector sees of the board a few times a second and takes a snapshot when the picture has been
// steady for half a second, at a place that no earlier snapshot was taken at. No THREE and no DOM (webcamview.js feeds it). The snapshots are what lensfit.fit wants.
//
//   const cap = new BoardCapture({ ids: [...] });   ids: the ids of the board's markers (screencodes.board(...).markers)
//   cap.feed(markers, t)       markers: what markers.detect saw ([{ id, corners }], any ids: the others are ignored), t: ms -> the status
//   status                     { state: 'looking' | 'settling' | 'taken', progress (0..1), msg, count, seen, next: { n, text } | null }
//   cap.snapshots              [{ markers: [{ id, corners: [[u, v] x 4] }] }]: the average of the steady frames of each snapshot
//
// A place is told by how big the markers are (the distance), where the board is in the picture, and how much bigger the markers are on one side than the other (the lean). Two snapshots
// at the same place are of no more use than one, so the second is not taken: it says so, and asks for the next place.
(function (M) {
  const MIN_MARKERS = 12;          // markers of the board that must be seen
  const STILL_MS = 500, MIN_FRAMES = 4, JITTER_PX = 3, MOVE_PX = 25, LOST_MS = 400;
  const SAME_SCALE = 0.12, SAME_CENTRE = 0.08, SAME_LEAN = 0.06;       // two snapshots are the same place when all three agree this closely
  const MAX_SNAPSHOTS = 8;
  const PLACES = [
    'as near as the whole board still fits in the picture',
    'about twice as far away',
    'tilted so that its left side is nearer to the camera',
    'tilted so that its right side is nearer to the camera',
    'near, with the board at one side of the picture (the board may be cut off a little)',
    'far, with the board in a corner of the picture',
    'tilted so that its top is nearer to the camera',
    'tilted so that its bottom is nearer to the camera',
  ];
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const side = (m) => (Math.hypot(m.corners[1][0] - m.corners[0][0], m.corners[1][1] - m.corners[0][1]) + Math.hypot(m.corners[3][0] - m.corners[0][0], m.corners[3][1] - m.corners[0][1])) / 2;
  const centreOf = (m) => [m.corners.reduce((s, p) => s + p[0], 0) / 4, m.corners.reduce((s, p) => s + p[1], 0) / 4];
  // slope of y against x (least squares), 0 when x does not vary
  const slope = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); } return sxx > 1e-9 ? sxy / sxx : 0; };

  // the numbers of a view that decide whether two views are the same place
  function describe(markers, W, H) {
    const sides = markers.map(side), cs = markers.map(centreOf), sc = median(sides);
    return { scale: sc, centre: [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length], hlean: slope(cs.map((c) => c[0]), sides) * W / sc, vlean: slope(cs.map((c) => c[1]), sides) * H / sc };
  }

  class BoardCapture {
    constructor(opts) { this.ids = new Set(opts.ids || []); this.W = opts.W || 1280; this.H = opts.H || 720; this.reset(); }
    reset() { this.snapshots = []; this.infos = []; this.buf = []; this.state = 'looking'; this.taken = null; this.lostAt = null; this.msg = ''; this.seen = 0; this.progress = 0; this.takenMsg = ''; }
    get count() { return this.snapshots.length; }
    get full() { return this.snapshots.length >= MAX_SNAPSHOTS; }

    feed(markers, t) {
      const mine = (Array.isArray(markers) ? markers : []).filter((m) => m && this.ids.has(m.id));
      this.seen = mine.length;
      if (this.full) { this.state = 'taken'; this.msg = 'Enough snapshots'; return this.status(); }
      if (mine.length < MIN_MARKERS) {
        this.buf = []; this.progress = 0;
        if (this.state === 'taken') { if (this.lostAt === null) this.lostAt = t; else if (t - this.lostAt > LOST_MS) { this.state = 'looking'; this.lostAt = null; } }
        else this.state = 'looking';
        this.msg = mine.length === 0 ? 'Point the camera at the screen: the board must be in the picture' : `${mine.length} markers are seen, ${MIN_MARKERS} are needed: bring the camera nearer, or keep the board clear`;
        return this.status();
      }
      this.lostAt = null;
      const cur = new Map(mine.map((m) => [m.id, m.corners.map((p) => p.slice())]));
      if (this.state === 'taken') {
        if (!this._moved(cur, this.taken)) { this.msg = this.takenMsg; return this.status(); }
        this.state = 'looking';
      }
      // the frames of the last moment, the same markers in all: the oldest go while any corner of any frame is further than JITTER_PX from the average
      if (this.buf.length && !this._sameIds(this.buf[this.buf.length - 1].pts, cur)) this.buf = [];
      this.buf.push({ t, pts: cur });
      while (this.buf.length > 1 && !this._steady()) this.buf.shift();
      this.progress = Math.min(1, (t - this.buf[0].t) / STILL_MS);
      this.state = 'settling';
      this.msg = this.progress > 0 ? 'Hold it steady...' : 'Hold it steady';
      if (t - this.buf[0].t >= STILL_MS && this.buf.length >= MIN_FRAMES) this._snapshot();
      return this.status();
    }
    _sameIds(a, b) { if (a.size !== b.size) return false; for (const k of a.keys()) if (!b.has(k)) return false; return true; }
    _moved(cur, ref) { for (const [id, c] of cur) { const r = ref.get(id); if (!r) continue; for (let i = 0; i < 4; i++) if (Math.hypot(c[i][0] - r[i][0], c[i][1] - r[i][1]) > MOVE_PX) return true; } return false; }
    _mean() {
      const out = new Map(), n = this.buf.length;
      for (const id of this.buf[0].pts.keys()) out.set(id, [0, 1, 2, 3].map((i) => [this.buf.reduce((s, f) => s + f.pts.get(id)[i][0], 0) / n, this.buf.reduce((s, f) => s + f.pts.get(id)[i][1], 0) / n]));
      return out;
    }
    _steady() {
      const m = this._mean();
      for (const f of this.buf) for (const [id, c] of f.pts) for (let i = 0; i < 4; i++) if (Math.abs(c[i][0] - m.get(id)[i][0]) > JITTER_PX || Math.abs(c[i][1] - m.get(id)[i][1]) > JITTER_PX) return false;
      return true;
    }
    _same(a, b) { return Math.abs(Math.log(a.scale / b.scale)) < SAME_SCALE && Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) < SAME_CENTRE * this.W && Math.abs(a.hlean - b.hlean) < SAME_LEAN && Math.abs(a.vlean - b.vlean) < SAME_LEAN; }
    _snapshot() {
      const mean = this._mean(), markers = [...mean].map(([id, corners]) => ({ id, corners })), info = describe(markers, this.W, this.H);
      this.taken = mean; this.state = 'taken'; this.buf = []; this.progress = 1;
      if (this.infos.some((o) => this._same(o, info))) { this.takenMsg = this.msg = 'That is the same place as an earlier snapshot: move to the next place'; return; }
      this.snapshots.push({ markers }); this.infos.push(info);
      const nx = this.next();
      this.msg = `Snapshot ${this.snapshots.length} taken`;
      this.takenMsg = nx ? `Got it. Now hold it ${nx.text}` : 'Got it';
    }
    next() { return this.full ? null : { n: this.snapshots.length + 1, text: PLACES[this.snapshots.length] }; }
    status() { return { state: this.state, progress: this.progress, msg: this.msg, count: this.snapshots.length, seen: this.seen, next: this.next() }; }
  }

  M.boardcapture = { BoardCapture, PLACES, MIN_MARKERS, MAX_SNAPSHOTS, describe };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
