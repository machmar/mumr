// How Jenga looks: the same module for the headset page and the PC view (rule 1: the drawing of a shared thing lives in one place). An ES module; THREE
// is handed in. Everything is drawn from the shared state (the document's `jstate`) and the bodies the host sends (`snap`, net.js), in the COMMON frame:
// `parent` is a group that holds the page's line-up (the page moves it), and inside it a point (x, y, z) of the floor plan is THREE (x, z, -y).
//
// The zen look (Marek's choice): pale pine blocks stained in six colours, each with a shape stamped on its ends; a plinth of raked sand in a dark wood
// frame; a low console with the die's felt tray, a paper lantern and a scoreboard like a hanging scroll of washi paper.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ATLAS, woodAtlas, sandTexture, darkWood, feltTexture, drawShape, washi } from './textures.js';

const S = window.JENGA;
const toV = (p) => [p[0], p[2], -p[1]];
const FONT_HEAD = '"Hiragino Mincho ProN", "Yu Mincho", ui-serif, Georgia, "Times New Roman", serif', FONT_BODY = 'system-ui, "Helvetica Neue", Arial, sans-serif';
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

export function createScene({ THREE, parent, playerColours = [0xf2c14e, 0x4ea1ff, 0xff6b6b, 0x7bd88f], boardAspect = 0.59 }) {
  const root = new THREE.Group(); parent.add(root);
  const furniture = new THREE.Group(); root.add(furniture);               // in the game frame: moved to `place` and turned by its yaw
  const bodies = new THREE.Group(); root.add(bodies);                    // blocks and die: common frame
  const overlay = new THREE.Group(); root.add(overlay);                   // rings, banner, trail: common frame
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };

  // ---- materials
  const dark = darkWood(THREE, 8), sand = sandTexture(THREE, 4), felt = feltTexture(THREE, 12);
  const matDark = own(new THREE.MeshStandardMaterial({ map: dark.map, normalMap: dark.normal, roughness: 0.7 }));
  const matSand = own(new THREE.MeshStandardMaterial({ map: sand.map, normalMap: sand.normal, roughness: 0.95, normalScale: new THREE.Vector2(0.9, 0.9) }));
  const matFelt = own(new THREE.MeshStandardMaterial({ map: felt.map, normalMap: felt.normal, roughness: 1 }));
  const matPaper = own(new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffa33a, emissiveIntensity: 0.9, roughness: 0.9, transparent: true, opacity: 0.96 }));
  const atlases = new Map(), mats = new Map();
  const blockMat = (colour, variant) => {
    const k = `${colour}:${variant}`;
    let m = mats.get(k);
    if (!m) {
      const c = S.COLOURS[colour], a = woodAtlas(THREE, { colour: c.hex, shape: c.shape, seed: 31 * colour + 7 * variant + 1 });
      atlases.set(k, a);
      m = own(new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.64, metalness: 0 }));
      mats.set(k, m);
    }
    return m;
  };
  // a block's geometry: a rounded box (long along THREE x, flat along y) whose faces use the atlas: the two ends the right third, the rest the left two thirds
  function blockGeometry(d) {
    const g = own(new RoundedBoxGeometry(d.L, d.H, d.W, 2, Math.min(0.0016 * d.k * 2.2, d.H * 0.18)));
    const uv = g.attributes.uv, per = uv.count / 6;
    for (let side = 0; side < 6; side++) {
      const [u0, u1] = side < 2 ? ATLAS.endU : ATLAS.longU;
      for (let i = side * per; i < (side + 1) * per; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), uv.getY(i));
    }
    uv.needsUpdate = true;
    return g;
  }
  // the die: six coloured faces, each with its shape
  function dieMaterials() {
    const face = (ci) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), col = S.COLOURS[ci];
      g.fillStyle = hex(col.hex); g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(255,240,210,0.16)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 30, 1);
      g.strokeStyle = 'rgba(255,245,225,0.9)'; g.lineWidth = 7; g.strokeRect(10, 10, 108, 108);
      g.fillStyle = 'rgba(255,245,225,0.95)'; g.strokeStyle = 'rgba(255,245,225,0.95)'; drawShape(g, col.shape, 64, 64, 30);
      const t = own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
    };
    const D = S.DIE_COLOURS;                                        // (physics faces +x -x +y -y +z -z; THREE order: right left top bottom front back)
    return [D[0], D[1], D[4], D[5], D[3], D[2]].map(face);
  }

  // ---- the blocks and the die
  let size = null, geo = null, dieMesh = null;
  const blocks = [];
  function buildBodies(sz) {
    for (const m of blocks) bodies.remove(m);
    blocks.length = 0;
    if (dieMesh) bodies.remove(dieMesh);
    const d = S.dims(sz), L = S.layout(sz);
    geo = blockGeometry(d);
    for (let i = 0; i < S.BLOCKS; i++) { const m = new THREE.Mesh(geo, blockMat(0, 0)); m.visible = false; m.userData.i = i; bodies.add(m); blocks.push(m); }
    dieMesh = new THREE.Mesh(own(new RoundedBoxGeometry(L.die.size, L.die.size, L.die.size, 3, L.die.size * 0.14)), dieMaterials());
    dieMesh.visible = false; bodies.add(dieMesh);
    size = sz;
  }
  let seedUsed = null;
  function paintBlocks(seed) {
    const col = S.colourOrder(seed);
    blocks.forEach((m, i) => { m.material = blockMat(col[i], i % 2); });
    seedUsed = seed;
  }

  // ---- the furniture (game frame), rebuilt when the size or the place changes
  let furnKey = null, boardFrame = null, scoreTex = null, scoreCtx = null, scoreCanvas = null, lanternGlow = null;
  function disposeGroup(g) { while (g.children.length) { const c = g.children.pop(); if (c.geometry && c.userData.own) c.geometry.dispose(); } }
  // (a box's faces each get the wood's grain at one scale: the texture repeats every TILE metres)
  const TILE = 0.3;
  function boxGeo(w, h, dp) {
    const g = new THREE.BoxGeometry(w, h, dp), uv = g.attributes.uv, per = uv.count / 6, sc = [[dp, h], [dp, h], [w, dp], [w, dp], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = f * per; i < (f + 1) * per; i++) uv.setXY(i, uv.getX(i) * sc[f][0] / TILE, uv.getY(i) * sc[f][1] / TILE);
    return g;
  }
  const box = (w, h, dp, mat, x, y, z, parentG = furniture) => { const m = new THREE.Mesh(mat === matDark ? boxGeo(w, h, dp) : new THREE.BoxGeometry(w, h, dp), mat); m.position.set(x, y, z); m.userData.own = true; parentG.add(m); return m; };
  const at = (gx, gy, gz) => [gx, gz, -gy];                     // game frame floor plan -> THREE inside the furniture group
  function buildFurniture(sz) {
    disposeGroup(furniture);
    const L = S.layout(sz), d = L.d, h = L.plinth.half, top = L.plinth.top;
    // the plinth: a dark wood body, raked sand on top in a low frame
    box(2 * h, top, 2 * h, matDark, 0, top / 2, 0);
    const tile = 0.45 * Math.max(1, d.k), rep = (2 * h * 0.97) / tile;
    sand.map.repeat.set(rep, rep); sand.normal.repeat.set(rep, rep);
    const top3 = new THREE.Mesh(new THREE.PlaneGeometry(2 * h * 0.97, 2 * h * 0.97), matSand); top3.rotation.x = -Math.PI / 2; top3.position.set(0, top + 0.0012, 0); top3.userData.own = true; furniture.add(top3);
    const fw = 0.02 * Math.max(1, d.k * 0.6), fh = 0.014 * Math.max(1, d.k * 0.6);
    for (const [x, z, w, dp] of [[0, -h + fw / 2, 2 * h, fw], [0, h - fw / 2, 2 * h, fw], [-h + fw / 2, 0, fw, 2 * h], [h - fw / 2, 0, fw, 2 * h]]) box(w, fh, dp, matDark, x, top + fh / 2, z);
    // the console: a low table with four legs; the die's tray on it
    const c = L.console, cx = c.c[0], cy = c.c[1], tt = 0.04;
    box(2 * c.half[0], tt, 2 * c.half[1], matDark, ...at(cx, cy, c.top - tt / 2));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(0.05, c.top - tt, 0.05, matDark, ...at(cx + sx * (c.half[0] - 0.05), cy + sy * (c.half[1] - 0.05), (c.top - tt) / 2));
    const T = L.tray, tw = T.wall;
    const felt3 = new THREE.Mesh(new THREE.PlaneGeometry(2 * T.half, 2 * T.half), matFelt); felt3.rotation.x = -Math.PI / 2; felt3.position.set(...at(T.c[0], T.c[1], c.top + 0.001)); felt3.userData.own = true; furniture.add(felt3);
    for (const [x, y, w, dp] of [[T.c[0] - T.half, T.c[1], tw, 2 * T.half + tw], [T.c[0] + T.half, T.c[1], tw, 2 * T.half + tw], [T.c[0], T.c[1] - T.half, 2 * T.half + tw, tw], [T.c[0], T.c[1] + T.half, 2 * T.half + tw, tw]]) box(w, T.rim, dp, matDark, ...at(x, y, c.top + T.rim / 2));
    // the board's stand: two posts and a bezel round the shared menu (the menu itself is the engine's panel, drawn by createApp)
    const B = L.board, bh = B.w * boardAspect, bz = B.bottom + bh / 2, pitch = B.pitch, fx = Math.cos(B.yaw), fy = Math.sin(B.yaw), lx2 = -fy, ly2 = fx;   // (f: the way it faces; l: along it)
    boardFrame = new THREE.Group(); boardFrame.position.set(...at(B.c[0], B.c[1], bz)); boardFrame.rotation.y = Math.PI / 2 + B.yaw; furniture.add(boardFrame);        // (its front, +z, towards B.yaw)
    const lean = new THREE.Group(); lean.rotation.x = -pitch; boardFrame.add(lean);                                                                                // (leaning back by the board's pitch)
    const bt = 0.035;
    for (const [x, y, w, hh] of [[0, bh / 2 + bt / 2, B.w + 2 * bt, bt], [0, -bh / 2 - bt / 2, B.w + 2 * bt, bt], [-B.w / 2 - bt / 2, 0, bt, bh], [B.w / 2 + bt / 2, 0, bt, bh]]) box(w, hh, 0.05, matDark, x, y, -0.022, lean);
    box(B.w + 2 * bt, bh + 2 * bt, 0.012, matDark, 0, 0, -0.052, lean);
    for (const sx of [-1, 1]) { const post = box(0.05, bz - c.top + 0.02, 0.05, matDark, ...at(B.c[0] - fx * 0.07 + lx2 * sx * (B.w / 2 + bt), B.c[1] - fy * 0.07 + ly2 * sx * (B.w / 2 + bt), (bz - c.top) / 2 + c.top - 0.02)); post.rotation.y = Math.PI / 2 + B.yaw; }
    // the lantern: a wooden frame with paper on four sides, and a soft glow
    const lx = L.lantern[0], ly = L.lantern[1], lh = 0.36;
    box(0.2, 0.025, 0.2, matDark, ...at(lx, ly, c.top + 0.0125)); box(0.21, 0.025, 0.21, matDark, ...at(lx, ly, c.top + lh));
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.17, lh - 0.03, 0.17), matPaper); paper.position.set(...at(lx, ly, c.top + lh / 2 + 0.005)); paper.userData.own = true; furniture.add(paper);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(0.014, lh, 0.014, matDark, ...at(lx + sx * 0.088, ly + sy * 0.088, c.top + lh / 2));
    if (!lanternGlow) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const gg = cv.getContext('2d'), gr = gg.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,190,90,0.85)'); gr.addColorStop(0.4, 'rgba(255,160,60,0.25)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128);
      lanternGlow = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: own(new THREE.CanvasTexture(cv)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    }
    lanternGlow.scale.set(0.9, 0.9, 1); lanternGlow.position.set(...at(lx, ly, c.top + lh / 2)); furniture.add(lanternGlow);
    // the scoreboard: a washi scroll between two bars, hanging from a beam on two posts
    const SC = L.score, sh = SC.h, sz0 = SC.bottom + sh / 2;
    const sg = new THREE.Group(); sg.position.set(...at(SC.c[0], SC.c[1], sz0)); sg.rotation.y = Math.PI / 2 + SC.yaw; furniture.add(sg);
    if (!scoreCanvas) { scoreCanvas = document.createElement('canvas'); scoreCanvas.width = 1024; scoreCanvas.height = Math.round(1024 * SC.h / SC.w); scoreCtx = scoreCanvas.getContext('2d'); scoreTex = own(new THREE.CanvasTexture(scoreCanvas)); scoreTex.colorSpace = THREE.SRGBColorSpace; scoreTex.anisotropy = 4; }
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(SC.w, sh), own(new THREE.MeshStandardMaterial({ map: scoreTex, roughness: 0.95, emissive: 0xffffff, emissiveMap: scoreTex, emissiveIntensity: 0.25 }))); sp.userData.own = true; sg.add(sp);
    box(SC.w + 0.1, 0.035, 0.035, matDark, 0, sh / 2 + 0.018, 0.012, sg); box(SC.w + 0.06, 0.04, 0.04, matDark, 0, -sh / 2 - 0.02, 0.012, sg);
    for (const sx of [-1, 1]) box(0.045, sz0 + sh / 2 + 0.05, 0.045, matDark, sx * (SC.w / 2 + 0.07), -(sz0 + sh / 2 + 0.05) / 2 + sh / 2 + 0.05, 0.0, sg);
    sg.userData.scoreH = sh; furniture.userData.sg = sg;
    limit.line.position.set(0, 0, 0);
    furnKey = sz;
  }
  // the line above which a block may not be taken: a thin gold frame round the tower at the bottom of the highest complete level
  const limit = (() => {
    const g = new THREE.BufferGeometry(), line = new THREE.LineLoop(g, own(new THREE.LineBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.8, depthTest: false })));
    line.renderOrder = 5; furniture.add(line); line.visible = false; return { line, g };
  })();
  const rolling = (() => { const m = new THREE.Mesh(own(new THREE.RingGeometry(0.17, 0.19, 48)), own(new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }))); m.rotation.x = -Math.PI / 2; m.visible = false; furniture.add(m); return m; })();

  // ---- overlays: the markers of the pulled block, the block that toppled the tower, the one a hand holds; the replay banner and trail; a ring when it falls
  const shells = {};
  for (const [k, colour] of [['handled', 0xf2c14e], ['culprit', 0xff4a2a], ['held', 0xffffff]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), own(new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
    m.visible = false; overlay.add(m); shells[k] = m;
  }
  const trailLine = new THREE.Line(new THREE.BufferGeometry(), own(new THREE.LineBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.9, depthTest: false }))); trailLine.visible = false; trailLine.renderOrder = 6; overlay.add(trailLine);
  const bannerCv = document.createElement('canvas'); bannerCv.width = 1024; bannerCv.height = 256;
  const bannerTex = own(new THREE.CanvasTexture(bannerCv)); bannerTex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: bannerTex, transparent: true, depthTest: false, depthWrite: false }))); banner.renderOrder = 7; banner.visible = false; overlay.add(banner);
  const wave = new THREE.Mesh(own(new THREE.RingGeometry(0.95, 1, 64)), own(new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))); wave.rotation.x = -Math.PI / 2; wave.visible = false; overlay.add(wave);
  let bannerText = null, waveAt = -1e9, trailKey = null, scoreKey = null, lastPhase = null;
  function drawBanner(lines) {
    const g = bannerCv.getContext('2d'); g.clearRect(0, 0, 1024, 256);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach((l, i) => {
      g.font = `${l.weight || 800} ${l.size}px ${l.font || FONT_HEAD}`; g.lineWidth = l.size * 0.14; g.strokeStyle = 'rgba(25,12,8,0.9)'; g.fillStyle = l.colour || '#fff3d6';
      g.strokeText(l.text, 512, l.y); g.fillText(l.text, 512, l.y);
    });
    bannerTex.needsUpdate = true;
  }

  // ---- the scoreboard (washi paper, ink, a red seal for whose turn it is)
  function drawScore(state) {
    const g = scoreCtx, W = scoreCanvas.width, H = scoreCanvas.height;
    washi(g, W, H, 3);
    g.fillStyle = '#2a211b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 120px ${FONT_HEAD}`; g.fillText('SCORE', W / 2, 120);
    g.font = `500 44px ${FONT_BODY}`; g.fillStyle = '#6a5a4b';
    g.fillText(state.round ? `round ${state.round} of ${state.rounds}` : 'three rounds make a match', W / 2, 205);
    g.strokeStyle = '#2a211b'; g.lineWidth = 5; g.beginPath(); g.moveTo(70, 250); g.lineTo(W - 70, 250); g.stroke();
    const rows = S.scoreboard(state);
    const rowH = 190, y0 = 290;
    g.textAlign = 'left';
    rows.forEach((r, k) => {
      const y = y0 + k * rowH, colour = hex(playerColours[r.slot % playerColours.length]);
      g.globalAlpha = r.present ? 1 : 0.45;
      g.fillStyle = colour; g.beginPath(); g.arc(120, y + 50, 38, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a211b'; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#2a211b'; g.font = `700 56px ${FONT_HEAD}`; g.fillText(r.name, 180, y + 38);
      g.font = `500 40px ${FONT_BODY}`; g.fillStyle = '#6a5a4b';
      const cells = r.rounds.map((v) => (v === null ? '-' : v > 0 ? `+${v}` : `${v}`)).join('   ');
      g.fillText(cells, 182, y + 100);
      g.textAlign = 'right'; g.fillStyle = r.winner ? '#b8861b' : '#2a211b'; g.font = `800 96px ${FONT_HEAD}`; g.fillText(String(r.total), W - 90, y + 62); g.textAlign = 'left';
      if (r.turn) { g.fillStyle = '#c0301f'; g.beginPath(); g.arc(W - 250, y + 62, 34, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff3d6'; g.font = `700 36px ${FONT_BODY}`; g.textAlign = 'center'; g.fillText('turn', W - 250, y + 63); g.textAlign = 'left'; }
      if (r.winner) { g.fillStyle = '#b8861b'; g.font = `700 36px ${FONT_BODY}`; g.fillText('winner', 182, y + 150); }
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(42,33,27,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(70, y + rowH - 14); g.lineTo(W - 70, y + rowH - 14); g.stroke();
    });
    if (!rows.length) { g.textAlign = 'center'; g.fillStyle = '#8a7a6b'; g.font = `500 52px ${FONT_BODY}`; g.fillText('press Start game on the board', W / 2, 520); }
    // the last words of the referee
    g.textAlign = 'left'; g.fillStyle = '#4a3b2e'; g.font = `500 38px ${FONT_BODY}`;
    (state.ticker || []).slice(-3).forEach((t, i, a) => { g.globalAlpha = 0.55 + 0.45 * (i + 1) / a.length; g.fillText(t.length > 38 ? `${t.slice(0, 37)}…` : t, 80, H - 150 + i * 48); });
    g.globalAlpha = 1;
    scoreTex.needsUpdate = true;
  }

  // ---- every frame
  const q3 = new THREE.Quaternion();
  function update({ state, snap, now = performance.now(), camera }) {
    if (!state) return;
    if (size !== state.size || !blocks.length) buildBodies(state.size);
    if (furnKey !== state.size) buildFurniture(state.size);
    if (seedUsed !== state.seed) paintBlocks(state.seed);
    const pl = state.place || { x: 0, y: 0, yaw: 0 }, L = S.layout(state.size), d = L.d;
    furniture.position.set(pl.x, 0, -pl.y); furniture.rotation.set(0, pl.yaw, 0);
    // the scoreboard is drawn when the state changes
    const key = state.rev; if (key !== scoreKey) { scoreKey = key; drawScore(state); }
    // blocks and die from the host's bodies
    const playing = ['roll', 'pull', 'place'].includes(state.phase);
    if (snap) {
      for (const it of snap.items) {
        const m = it.i === S.DIE ? dieMesh : blocks[it.i];
        if (!m) continue;
        const p = toV(it.p); m.position.set(p[0], p[1], p[2]); m.quaternion.set(it.q[0], it.q[2], -it.q[1], it.q[3]); m.visible = true;
      }
    } else { for (const m of blocks) m.visible = false; if (dieMesh) dieMesh.visible = false; }
    // markers
    const mark = (k, it, scale = 1) => {
      const s = shells[k];
      if (!it || !snap) { s.visible = false; return; }
      s.visible = true; s.position.copy(blocks[it.i] ? blocks[it.i].position : dieMesh.position); s.quaternion.copy(blocks[it.i] ? blocks[it.i].quaternion : dieMesh.quaternion);
      s.scale.set(d.L * 1.08 * scale, d.H * 1.3 * scale, d.W * 1.14 * scale);
    };
    let handled = null, culprit = null, held = null;
    if (snap) for (const it of snap.items) { if (it.i === S.DIE) continue; if (it.flags & S.F.handled) handled = it; if (it.flags & S.F.culprit) culprit = it; if ((it.flags & S.F.held) && !held) held = it; }
    mark('handled', playing ? handled : null);
    const pulse = 0.5 + 0.5 * Math.sin(now / 130);
    mark('culprit', culprit, 1 + 0.12 * pulse); shells.culprit.material.opacity = 0.3 + 0.35 * pulse;
    mark('held', held && !handled ? held : null); shells.held.material.opacity = 0.18;
    // the line of the allowed levels
    const full = state.tower ? state.tower.full : 17, T = L.plinth.top, hx = d.L * 0.62, y = T + (full + 0) * d.H + 0.0015;
    limit.line.visible = playing && full >= 0 && full < 22;
    if (limit.line.visible) {
      limit.g.setFromPoints([[-hx, y, -hx], [hx, y, -hx], [hx, y, hx], [-hx, y, hx]].map((p) => new THREE.Vector3(...p)));
      limit.line.material.opacity = 0.55 + 0.25 * Math.sin(now / 400);
    }
    // the ring on the tray while it is time to roll
    rolling.visible = state.phase === 'roll';
    if (rolling.visible) { rolling.position.set(...at(L.tray.c[0], L.tray.c[1], L.console.top + 0.004)); rolling.scale.setScalar(0.85 + 0.12 * Math.sin(now / 260)); rolling.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(now / 260)); }
    if (lanternGlow) lanternGlow.material.opacity = 0.8 + 0.12 * Math.sin(now / 700) + 0.05 * Math.sin(now / 130);
    // the fall: a ring spreads out from the tower, the banner says what is going on, the trail of the block that did it
    const towerAt = (() => { const c = S.toCommon(pl, [0, 0, 0]); return toV([c[0], c[1], T]); })();
    if (state.phase !== lastPhase) { if (state.phase === 'fall') waveAt = now; lastPhase = state.phase; }
    const wa = (now - waveAt) / 1100;
    wave.visible = wa >= 0 && wa < 1;
    if (wave.visible) { wave.position.set(towerAt[0], towerAt[1] + 0.004, towerAt[2]); wave.scale.setScalar((0.2 + 2.6 * wa) * Math.max(1, d.k) * 0.5); wave.material.opacity = 0.8 * (1 - wa); }
    const mode = snap ? snap.mode : 0, fall = ['fall', 'replay'].includes(state.phase);
    let text = null;
    if (state.phase === 'fall') text = 'fall';
    else if (state.phase === 'replay') text = mode === 2 ? 'rewind' : 'slow';
    else if (state.phase === 'aftermath') text = 'aftermath';
    banner.visible = !!text;
    if (text) {
      const who = state.fall ? (state.players.find((p) => p.slot === state.fall.by) || {}).name || '' : '';
      const tk = `${text}|${who}|${Math.round((snap ? snap.progress : 0) * 20)}`;
      if (tk !== bannerText) {
        bannerText = tk;
        if (text === 'fall') drawBanner([{ text: 'TIMBER!', size: 190, y: 120, colour: '#ffcf8a' }, { text: who ? `${who} toppled it` : '', size: 60, y: 215, weight: 600, font: FONT_BODY }]);
        else if (text === 'aftermath') drawBanner([{ text: who ? `${who} toppled it` : 'The tower fell', size: 84, y: 128, colour: '#ffe2b0' }, { text: `${state.fall ? state.fall.level >= 0 ? 'level ' + (state.fall.level + 1) : '' : ''}`, size: 50, y: 214, weight: 500, font: FONT_BODY }]);
        else drawBanner([{ text: text === 'rewind' ? 'REWIND' : 'REPLAY', size: 120, y: 105, colour: text === 'rewind' ? '#9fd0ff' : '#ffcf8a' }, { text: `${'▮'.repeat(Math.round((snap ? snap.progress : 0) * 12)).padEnd(12, '▯')}   ${text === 'rewind' ? '◂◂' : '0.3x'}`, size: 54, y: 205, weight: 600, font: FONT_BODY }]);
      }
      const h = d.height + 0.35 * Math.max(0.6, d.k * 0.6), s = 0.9 * Math.max(0.7, d.k * 0.8);
      banner.position.set(towerAt[0], towerAt[1] + h, towerAt[2]); banner.scale.set(s, s / 4, 1);
    }
    const trail = fall && state.fall && state.fall.trail;
    trailLine.visible = !!trail && trail.length > 1;
    if (trailLine.visible) {
      const tk = `${state.rev}|${trail.length}`;
      if (tk !== trailKey) { trailKey = tk; trailLine.geometry.setFromPoints(trail.map((p) => new THREE.Vector3(...toV(p)))); }
    }
  }

  // where the board and the scoreboard are (common frame): for createApp's boards and for the PC view's panel
  function boardPose(state) {
    if (!state || !state.place) return null;
    const L = S.layout(state.size), B = L.board, bh = B.w * boardAspect, c = S.toCommon(state.place, [B.c[0] + Math.cos(B.yaw) * 0.012, B.c[1] + Math.sin(B.yaw) * 0.012, 0]);
    return { x: c[0], y: c[1], h: B.bottom + bh / 2, yaw: state.place.yaw + B.yaw, pitch: B.pitch };
  }
  function dispose() { for (const o of disposables) if (o && o.dispose) o.dispose(); parent.remove(root); }
  return { root, update, boardPose, dispose, group: { furniture, bodies, overlay } };
}
