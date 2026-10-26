// A rehearsal of the camera calibration mode without a camera, a screen or a laptop pointed at it: this script stands in for the camera. Open
//   http://localhost:8769/webcam.html     (the server: node tools/run.js cube 8769 --http --no-browser)
// and in the page's console (or a javascript_tool call):
//   await import('/mumr/webcam/rehearsal.js');            // or add it with a <script src> tag
//   await calRehearsal.start({ lens: { a1: -0.12, a2: 0.01 }, delay: 80 });
//   calRehearsal.run('distortion')    -> opens the mode and chooses; resolves with the result when it is over ('distortion' or 'latency')
//
// What it does: the page's "camera" is a canvas that is painted 15 times a second with what a camera would see of the screen that the mode shows (the corner markers in the aim step,
// the board in the board step, black and white in the latency step), through a lens (`lens`) and, for the latency, `delay` milliseconds late. The board is shown in a few poses in turn.
// It also puts in a stand-in for video.requestVideoFrameCallback, because a page in the browser pane gets no compositor frames; the delay it then measures is the painted delay
// plus the stand-in's and the painting's own (about 40 to 60 ms), which is the same for every delay, so differences are right.
(function () {
  const M = window.MUMR, SC = M.screencodes, MK = M.markers, WC = M.webcam, W = 1280, H = 720, SW = 1920, SH = 1080;
  const R = { lens: { a1: 0, a2: 0 }, delay: 0, pose: 0, quad: [[260, 140], [1060, 170], [1020, 600], [290, 570]],
    poses: [{ d: 0.34, tilt: 0, yaw: 0 }, { d: 0.6, tilt: 0, yaw: 0 }, { d: 0.45, tilt: 0, yaw: 35 }, { d: 0.45, tilt: 0, yaw: -35 }, { d: 0.5, tilt: 35, yaw: 0, left: 0.05, up: 0.03 }, { d: 0.4, tilt: -25, yaw: 10, left: -0.04, up: -0.02 }, { d: 0.38, tilt: 0, yaw: 20, up: 0.05 }, { d: 0.7, tilt: 25, yaw: -20, left: 0.05 }], boardMs: 3500 };
  const mixed = () => window.mixed;

  function paint(g) {
    g.fillStyle = '#4a4036'; g.fillRect(0, 0, W, H);
    const step = mixed().WCV.calibration.state.step, poly = (cs, fill) => { g.beginPath(); cs.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = fill; g.fill(); };
    if (step === 'board') {
      const board = mixed().WCV.calBoard; if (!board) return;
      const SIM = M.webcamsim, tiles = [], cells = [];
      for (const m of board.markers) {
        const q = m.side / 6, t = SC.tile(m), cs = MK.cellsOf(SC.CODES[m.id]);
        tiles.push({ id: m.id, x: t.x, y: t.y, side: t.w });
        for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (cs[r * 6 + c]) cells.push({ id: m.id * 100 + r * 6 + c, x: m.x + c * q, y: m.y + r * q, side: q });
      }
      const opts = { board: { markers: tiles }, W, H, noise: 0, screen: { w: board.w, h: board.h } }, pose = R.poses[Math.min(R.pose, R.poses.length - 1)];
      for (const t of SIM.boardCorners(pose, R.lens, opts)) poly(t.corners, '#fff');
      for (const c of SIM.boardCorners(pose, R.lens, Object.assign({}, opts, { board: { markers: cells } }))) poly(c.corners, '#000');
      return;
    }
    const Hm = WC.homography([[0, 0], [SW, 0], [SW, SH], [0, SH]], R.quad);
    const face = (pts, fill) => poly(pts.map((p) => WC.applyH(Hm, p[0], p[1])), fill);
    if (step === 'latency') {
      const t = performance.now() - R.delay; let colour = 'black'; for (const e of mixed().WCV.screenLog) if (e.t <= t) colour = e.colour;
      face([[0, 0], [SW, 0], [SW, SH], [0, SH]], colour === 'white' ? '#fff' : '#000'); return;
    }
    face([[0, 0], [SW, 0], [SW, SH], [0, SH]], '#000');
    for (const m of SC.corners({ w: SW, h: SH })) {
      const t = SC.tile(m), q = m.side / 6, cs = MK.cellsOf(SC.CODES[m.id]);
      face([[t.x, t.y], [t.x + t.w, t.y], [t.x + t.w, t.y + t.h], [t.x, t.y + t.h]], '#fff');
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (cs[r * 6 + c]) face([[m.x + c * q, m.y + r * q], [m.x + (c + 1) * q, m.y + r * q], [m.x + (c + 1) * q, m.y + (r + 1) * q], [m.x + c * q, m.y + (r + 1) * q]], '#000');
    }
  }

  async function start(opts = {}) {
    Object.assign(R, opts);
    if (!M.webcamsim) await new Promise((res) => { const s = document.createElement('script'); s.src = '/mumr/webcam/webcamsim.js'; s.onload = res; document.head.appendChild(s); });
    let id = 0; const pending = new Map();
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (cb) { pending.set(++id, cb); return id; };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = function (i) { pending.delete(i); };
    clearInterval(R.rv); R.rv = setInterval(() => { const t = performance.now(), items = [...pending]; pending.clear(); for (const [, cb] of items) { try { cb(t, {}); } catch (e) { console.error(e); } } }, 16);
    clearInterval(R.drive); R.drive = setInterval(() => window.view.frame(), 16);
    mixed().WCV.useStill(W, H, paint, { fps: 15 });
    await new Promise((r) => setTimeout(r, 1500));
    return 'ready';
  }
  // opens the mode, chooses `kind` ('distortion' or 'latency'), moves through the board poses, and resolves with the result's numbers (or the step it stopped at)
  async function run(kind, limitMs = 150000) {
    const WCV = mixed().WCV; WCV.closeCalibration(); await new Promise((r) => setTimeout(r, 300));
    WCV.openCalibration(); document.getElementById(kind === 'latency' ? 'calPickLat' : 'calPickDist').click();
    const t0 = performance.now(); let tb = null;
    while (performance.now() - t0 < limitMs) {
      await new Promise((r) => setTimeout(r, 250));
      const s = WCV.calibration.state;
      if (s.step === 'board') { if (tb === null) tb = performance.now(); R.pose = Math.floor((performance.now() - tb) / R.boardMs); } else tb = null;
      if (s.step === 'result') break;
    }
    return { step: WCV.calibration.state.step, result: WCV.calibration.resultOf({ sheetFovDeg: 70 }), msg: document.getElementById('calMsg').textContent };
  }
  function stop() { clearInterval(R.rv); clearInterval(R.drive); }
  // ---- a painted floor seen through a lens: the three spots as red dots, a grid, and the three clicks made at the dots. The page's document is told that a player is lined up
  // with the spots 1.5 m apart and has a check mark at (0.6, -1.2) (no headset is needed). Resolves with the camera the page has solved.
  const CAM = { x: 3.2, y: -3.9, z: 1.2, yaw: Math.atan2(3.5, -2.5), pitch: -0.27 }, SPOTS = [[0, 0, 0], [1.5, 0, 0], [0.6, -1.2, 0]];
  async function floor(opts = {}) {
    const lens = Object.assign({ a1: 0, a2: 0 }, opts.lens), L = { a1: lens.a1, a2: lens.a2, W, H }, LN = M.lens, hfov = (opts.hfovDeg || 70) * Math.PI / 180;
    mixed().feed.doc.lined[0] = { dist: 1.5, how: 'points' }; mixed().feed.doc.checks[0] = [0.6, -1.2];
    const seen = (p) => { const q = WC.project(CAM, hfov, W, H, p); return q[2] > 0.05 ? LN.toPicture(L, q[0], q[1]) : null; };
    R.seen = seen;
    const line = (g, a, b) => { let first = true; for (let t = 0; t <= 1.0001; t += 0.02) { const q = seen([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]); if (!q) { first = true; continue; } first ? g.moveTo(q[0], q[1]) : g.lineTo(q[0], q[1]); first = false; } };
    mixed().WCV.useStill(W, H, (g) => {
      g.fillStyle = '#5b4d3c'; g.fillRect(0, 0, W, H); g.strokeStyle = '#9a8a72'; g.lineWidth = 1.5; g.beginPath();
      for (let x = -3; x <= 5; x += 0.5) line(g, [x, -5], [x, 3]);
      for (let y = -5; y <= 3; y += 0.5) line(g, [-3, y], [5, y]);
      g.stroke();
      SPOTS.forEach((p) => { const q = seen(p); g.fillStyle = '#e03030'; g.beginPath(); g.arc(q[0], q[1], 5, 0, 7); g.fill(); });
    }, { fps: 5 });
    await new Promise((r) => setTimeout(r, 1500));
    const c = mixed().calib; c.setFov(opts.hfovDeg || 70); if (lens.a1 || lens.a2) c.setLens(lens.a1, lens.a2); else c.clearLens();
    SPOTS.forEach((p, i) => c.setClick(i, seen(p)));
    for (let i = 0; i < 4; i++) { window.view.frame(); await new Promise((r) => setTimeout(r, 150)); }
    const P = mixed().WCV.pose();
    return { pose: P && [P.x, P.y, P.z].map((v) => +v.toFixed(3)), distort: mixed().lensPass.plan.distort };
  }
  // where the rings that the PC view draws on spots 1 and 2 are on the canvas (read back from the GL buffer) against where the picture has the spots, in canvas pixels
  function discs() {
    const cv = window.view.renderer.domElement, gl = window.view.renderer.getContext();
    window.view.frame();
    const cw = cv.width, ch = cv.height, buf = new Uint8Array(cw * ch * 4); gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const px = (x, y) => { const i = ((ch - 1 - y) * cw + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
    const out = SPOTS.slice(0, 2).map((p, k) => {
      const e = R.seen(p), ex = e[0] * cw / W, ey = e[1] * ch / H; let sx = 0, sy = 0, n = 0;
      for (let y = Math.round(ey) - 14; y <= Math.round(ey) + 14; y++) for (let x = Math.round(ex) - 14; x <= Math.round(ex) + 14; x++) { const c = px(x, y); if (c[0] > 235 && c[1] > 235 && c[2] > 235) { sx += x; sy += y; n++; } }
      return { spot: k + 1, expected: [+ex.toFixed(1), +ey.toFixed(1)], found: n ? [+(sx / n).toFixed(1), +(sy / n).toFixed(1)] : null, off: n ? +Math.hypot(sx / n - ex, sy / n - ey).toFixed(2) : null, pixels: n };
    });
    return { canvas: [cw, ch], discs: out, empty: px(Math.round(cw * 0.1), Math.round(ch * 0.12)) };
  }
  window.calRehearsal = { start, run, stop, floor, discs, config: R };
})();
