// The board, as a thing in the room (an ES module; THREE is handed in): ONE menu for everybody (rule 1), drawn the same on every headset and the PC
// view from the shared state (logic.js `board`) and the fingertips the engine says are at its buttons (app.boardTouches: everybody's, so a plaque that
// somebody pushes swings on every headset).
//
// A stand of walnut on the console, like a small gate: two posts, a top beam with its ends turned up and a black lacquered cap, a tie beam. Under the beam
// a panel of washi lit from behind says what is going on (whose turn, the colour the die gave, the round). Under it hang wooden plaques (ema) on
// vermilion cords, and on a rod of bamboo small round tokens: the buttons. A fingertip pushes a plaque back on its cord, and it swings when let go.
// A plaque that cannot be pressed now hangs turned round (its back is plain wood); one whose words change turns round once and comes back with the new
// words. Every motion here follows the state, the touches and the server's clock, so it is the same on every page.
//
//   const st = createStand({ THREE, parent, mats, fonts })   parent: the common frame
//   st.update({ state, lay, touches, t (s, server), dt, colours })   every frame
//   st.pose(state) -> { x, y, h, yaw, pitch }   where the board is (common frame), for createApp's boards
import { washi, enso, drawShape, hash } from './textures.js';
import { FONT, mergeStatic } from './look.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const J = () => window.JENGA;
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;
const fit = (g, s, w) => { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(`${s}…`).width > w) s = s.slice(0, -1); return `${s}…`; };
// a line of text in `w` pixels: the font made smaller until it fits (down to `least` of its size), and cut only after that
function text(g, s, x, y, w, weight, size, family, least = 0.55) {
  let px = size;
  g.font = `${weight} ${px}px ${family}`;
  while (px > size * least && g.measureText(s).width > w) { px -= 2; g.font = `${weight} ${px}px ${family}`; }
  g.fillText(fit(g, s, w), x, y);
}
const INK = '#221a14', INK2 = '#6b5846', SHU = '#c23b22', GOLD = '#c9a25a';

export function createStand({ THREE, parent, mats }) {
  const B = J().BOARD, W = B.px, H = B.py, w = B.w, h = w * H / W;
  const root = new THREE.Group(); parent.add(root);
  const loc = (px, py) => [(px / W - 0.5) * w, (0.5 - py / H) * h];                    // canvas pixels -> metres in the board's own frame
  const m = w / W;                                                                      // metres per pixel

  // ---- the canvases: the fronts (the paper panel and the plaques' faces) and the backs
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { c, g: c.getContext('2d'), t }; };
  const front = mk(), back = mk();
  // the wood of the plaques' faces, drawn once into a canvas of its own (copied under each face's words)
  const woodC = document.createElement('canvas'); woodC.width = W; woodC.height = H;
  (() => {
    const g = woodC.getContext('2d'), img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = y / H, u = x / W, warp = Math.sin(u * 13 + Math.sin(v * 7) * 1.5) * 0.2 + hash(Math.floor(x / 40), Math.floor(y / 6), 3) * 0.05, f = ((v * 40 + warp * 3) % 1 + 1) % 1;
      const lw = f > 0.7 && f < 0.88 ? 1 - Math.abs(f - 0.79) / 0.09 : 0, k = 0.92 - lw * 0.13 + (hash(x, y, 9) - 0.5) * 0.04, o = (y * W + x) * 4;
      img.data[o] = 236 * k; img.data[o + 1] = 213 * k; img.data[o + 2] = 172 * k; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  })();

  // ---- the stand: posts, the top beam (kasagi) with its cap, the tie beam (nuki), the bamboo rod
  const stand = new THREE.Group(); root.add(stand);
  const L = () => J().layout('normal');
  const tableTop = L().console.top, below = h / 2 + (L().board.bottom - tableTop);      // from the board's middle down to the table
  const postX = w / 2 + 0.04, topY = h / 2 + 0.06;
  const own = [];
  const mesh = (geo, mat, x, y, z, parentG = stand) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parentG.add(o); own.push(geo); return o; };
  const uvScale = (g, s) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s[0], uv.getY(i) * s[1]); return g; };
  for (const sx of [-1, 1]) {
    const len = below + topY, pg = new THREE.CylinderGeometry(0.016, 0.019, len, 4, 1); pg.rotateY(Math.PI / 4);
    { const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * len / 0.36, uv.getX(i) * 0.25); }
    mesh(pg, mats.walnut, sx * postX, (topY - below) / 2, -0.012);
    mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.012, 4, 1).rotateY(Math.PI / 4), mats.lacquer, sx * postX, -below + 0.006, -0.012);          // (the posts' black feet)
  }
  // the top beam: a long box whose ends curve up
  const beam = (len, th, dp, lift) => {
    const g = uvScale(new THREE.BoxGeometry(len, th, dp, 32, 1, 1), [len / 0.3, 0.2]), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (len / 2); p.setY(i, p.getY(i) + lift * Math.pow(Math.abs(x), 3.2)); }
    g.computeVertexNormals(); return g;
  };
  mesh(beam(w + 0.24, 0.03, 0.05, 0.022), mats.walnut, 0, topY, -0.012);
  mesh(beam(w + 0.27, 0.012, 0.058, 0.025), mats.lacquer, 0, topY + 0.021, -0.012);
  const rail1 = loc(0, B.rails[0])[1], rail2 = loc(0, B.rails[1])[1];
  mesh(uvScale(new THREE.BoxGeometry(w + 0.12, 0.02, 0.026), [3, 0.2]), mats.walnut, 0, rail1, -0.012);
  const bamboo = new THREE.CylinderGeometry(0.0075, 0.0075, 2 * postX, 12, 1); bamboo.rotateZ(Math.PI / 2);
  mesh(bamboo, mats.bamboo, 0, rail2, -0.004);
  for (const nx of [-0.31, -0.08, 0.17, 0.33]) mesh(new THREE.TorusGeometry(0.0078, 0.0013, 6, 16).rotateY(Math.PI / 2), mats.bamboo, nx, rail2, -0.004);           // (its nodes)
  // the paper panel: lit from behind (an emissive face), in a thin frame
  const S = B.status, [sx0, sy0] = loc(S.x, S.y), [sx1, sy1] = loc(S.x + S.w, S.y + S.h), pw = sx1 - sx0, ph = sy0 - sy1, pcx = (sx0 + sx1) / 2, pcy = (sy0 + sy1) / 2;
  const paperGeo = new THREE.PlaneGeometry(pw, ph); { const uv = paperGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (S.x + uv.getX(i) * S.w) / W, 1 - (S.y + (1 - uv.getY(i)) * S.h) / H); }
  const paperMat = new THREE.MeshStandardMaterial({ map: front.t, emissive: 0xffffff, emissiveMap: front.t, emissiveIntensity: 0.72, roughness: 0.95 });
  const paper = mesh(paperGeo, paperMat, pcx, pcy, 0.0);
  const glowBox = mesh(new THREE.BoxGeometry(pw, ph, 0.03), mats.lampBack, pcx, pcy, -0.0155);                         // (the box behind the paper)
  const fw = 0.014;
  for (const [x, y, ww, hh] of [[pcx, sy0 + fw / 2, pw + 2 * fw, fw], [pcx, sy1 - fw / 2, pw + 2 * fw, fw], [sx0 - fw / 2, pcy, fw, ph], [sx1 + fw / 2, pcy, fw, ph]]) mesh(uvScale(new THREE.BoxGeometry(ww, hh, 0.034), [Math.max(ww, hh) / 0.3, 0.1]), mats.walnut, x, y, -0.012);

  mergeStatic(THREE, mergeGeometries, stand);

  // ---- the plaques
  const cordMat = mats.cord, backMat = new THREE.MeshStandardMaterial({ map: back.t, roughness: 0.7, envMap: mats.env, envMapIntensity: 0.4 });
  const plaques = new Map();            // id (or label for a tag) -> { node, pivot, spinG, rect, kind, front, back, mat, swing, swingV, spin, spinV, target, shown, want }
  // an ema's outline: a rectangle with a low pitched roof; a token's: a circle (in metres, round its middle)
  function outline(kind, bw, bh) {
    const s = new THREE.Shape();
    if (kind === 'token') { s.absarc(0, 0, bw / 2, 0, Math.PI * 2, false); return s; }
    const roof = kind === 'tag' ? bh * 0.14 : bh * 0.18, cr = Math.min(bw, bh) * 0.04;
    s.moveTo(-bw / 2 + cr, -bh / 2); s.lineTo(bw / 2 - cr, -bh / 2); s.quadraticCurveTo(bw / 2, -bh / 2, bw / 2, -bh / 2 + cr);
    s.lineTo(bw / 2, bh / 2 - roof); s.lineTo(0, bh / 2); s.lineTo(-bw / 2, bh / 2 - roof);
    s.lineTo(-bw / 2, -bh / 2 + cr); s.quadraticCurveTo(-bw / 2, -bh / 2, -bw / 2 + cr, -bh / 2);
    return s;
  }
  // a face (ShapeGeometry) whose uv are the plaque's rectangle in the canvas; back: turned to face the other way (it reads the right way round from behind)
  function face(shape, r, isBack) {
    const g = new THREE.ShapeGeometry(shape, 24), p = g.attributes.position, uv = g.attributes.uv, bw = r.w * m, bh = r.h * m;
    for (let i = 0; i < p.count; i++) { const u = (p.getX(i) / bw + 0.5), v = (p.getY(i) / bh + 0.5); uv.setXY(i, (r.x + u * r.w) / W, 1 - (r.y + (1 - v) * r.h) / H); }
    if (isBack) g.rotateY(Math.PI);
    return g;
  }
  function makePlaque(key, b, i) {
    const bw = b.w * m, bh = b.h * m, shape = outline(b.kind, bw, bh), thick = b.kind === 'token' ? 0.007 : 0.008;
    const railY = b.y > B.rails[1] - 10 ? B.rails[1] : B.rails[0], [cx, cy] = loc(b.x + b.w / 2, b.y + b.h / 2), [, ry] = loc(0, railY);
    const node = new THREE.Group(); node.position.set(cx, ry, 0.006); root.add(node);
    const pivot = new THREE.Group(); node.add(pivot);                             // (swings about the rail)
    const spinG = new THREE.Group(); spinG.position.set(0, cy - ry, 0); pivot.add(spinG);      // (turns about its cord)
    const body = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 24 });
    body.translate(0, 0, -thick / 2);
    const bodyM = new THREE.Mesh(body, mats.hinoki); spinG.add(bodyM);
    const mat = new THREE.MeshStandardMaterial({ map: front.t, roughness: 0.62, envMap: mats.env, envMapIntensity: 0.5, emissive: 0xffb060, emissiveIntensity: 0 });
    const fM = new THREE.Mesh(face(shape, b, false), mat); fM.position.z = thick / 2 + 0.0019; spinG.add(fM);
    const bM = new THREE.Mesh(face(shape, b, true), backMat); bM.position.z = -thick / 2 - 0.0019; spinG.add(bM);
    // the cord: two strands from the rail to a knot at the plaque's top (one mesh)
    const top = cy - ry + bh / 2 - (b.kind === 'token' ? 0 : 0.004), len = Math.max(0.004, -top), parts = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.0011, 0.0011, Math.hypot(len, 0.007), 5); g.rotateZ(sx * Math.atan2(0.007, len)); g.translate(sx * 0.0035, top / 2, 0.001); parts.push(g);
    }
    parts.push(new THREE.SphereGeometry(0.0028, 8, 6).translate(0, top, 0.002));
    const cordGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false); for (const g of parts) g.dispose();
    const cord = new THREE.Mesh(cordGeo, cordMat); pivot.add(cord);
    const p = { key, node, pivot, spinG, body, fM, bM, mat, cord, rect: b, kind: b.kind, i, swing: 0, swingV: 0, spin: 0, spinV: 0, target: 0, shown: null, sig: null, glow: 0 };
    plaques.set(key, p);
    return p;
  }
  function disposePlaque(p) { root.remove(p.node); p.body.dispose(); p.fM.geometry.dispose(); p.bM.geometry.dispose(); p.mat.dispose(); p.cord.geometry.dispose(); }

  // ---- drawing the faces
  const content = (b) => `${b.kind}|${b.label}|${b.value}|${b.active ? 1 : 0}|${b.level === undefined ? '' : b.level}`;
  function paintFace(g, b, isBack) {
    const { x, y, w: bw, h: bh } = b;
    g.save();
    g.drawImage(woodC, x, y, bw, bh, x, y, bw, bh);
    // (the roof's edge and the face's border: a faint incised line)
    g.strokeStyle = 'rgba(120,80,40,0.25)'; g.lineWidth = 2;
    if (b.kind === 'token') { g.beginPath(); g.arc(x + bw / 2, y + bh / 2, bw / 2 - 7, 0, Math.PI * 2); g.stroke(); } else g.strokeRect(x + 9, y + bh * 0.2 + 4, bw - 18, bh * 0.8 - 13);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (isBack) {                                   // the back: the plain wood, the name burnt in faintly
      g.fillStyle = 'rgba(70,40,18,0.32)'; g.font = `700 ${b.kind === 'token' ? 44 : Math.round(Math.min(46, bh * 0.22))}px ${FONT.head}`;
      if (b.label) text(g, b.label, x + bw / 2, y + bh * 0.58, bw - 30, 700, b.kind === 'token' ? 44 : Math.round(Math.min(46, bh * 0.22)), FONT.head);
      g.restore(); return;
    }
    if (b.kind === 'token') {
      g.fillStyle = INK; g.font = `700 64px ${FONT.head}`;
      g.fillRect(x + bw / 2 - 18, y + bh / 2 - 3, 36, 6);
      if (b.label === '+') g.fillRect(x + bw / 2 - 3, y + bh / 2 - 18, 6, 36);
    } else if (b.kind === 'tag') {
      g.fillStyle = INK2; text(g, b.label.toUpperCase(), x + bw / 2, y + bh * 0.42, bw - 22, 500, 21, FONT.body);
      g.fillStyle = INK; text(g, b.value, x + bw / 2, y + bh * 0.66, bw - 20, 700, 32, FONT.head);
      const n = b.label === 'Music' ? 4 : 2, lv = Math.round((b.level || 0) * n);
      for (let k = 0; k < n; k++) { g.fillStyle = k < lv ? SHU : 'rgba(80,50,30,0.22)'; g.beginPath(); g.arc(x + bw / 2 + (k - (n - 1) / 2) * 16, y + bh * 0.87, 4.5, 0, Math.PI * 2); g.fill(); }
    } else {
      const big = bh > 160, ty = y + bh * (big ? 0.5 : 0.52);
      if (b.active) { g.fillStyle = SHU; g.beginPath(); g.arc(x + bw / 2, y + bh * 0.21, big ? 9 : 7, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = INK; text(g, b.label || '', x + bw / 2, ty, bw - 34, 800, big ? (bw > 300 ? 62 : 46) : 34, FONT.head);
      g.fillStyle = INK2; text(g, String(b.value || ''), x + bw / 2, ty + (big ? 50 : 32), bw - 30, 500, big ? 24 : 20, FONT.body, 0.75);
    }
    g.restore();
  }
  // the paper panel
  function paintStatus(g, st, colours) {
    const { x, y, w: sw, h: sh } = B.status;
    g.save(); g.beginPath(); g.rect(x, y, sw, sh); g.clip();
    washi(g, sw, sh, 11, [250, 240, 220], x, y);
    const vg = g.createRadialGradient(x + sw / 2, y + sh * 0.55, sh * 0.2, x + sw / 2, y + sh / 2, sw * 0.62);
    vg.addColorStop(0, 'rgba(255,240,205,0)'); vg.addColorStop(1, 'rgba(120,80,40,0.28)'); g.fillStyle = vg; g.fillRect(x, y, sw, sh);
    // the left: an ensō, and in it the colour the die gave (its sign), or the player's colour
    const ex = x + 150, ey = y + sh / 2, er = 92;
    enso(g, ex, ey, er, { seed: 5 + (st.round || 0), width: 20 });
    if (st.roll !== null && st.roll !== undefined) {
      const c = J().COLOURS[st.roll];
      g.fillStyle = hex(c.hex); g.beginPath(); g.arc(ex, ey, er * 0.56, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,246,228,0.95)'; g.strokeStyle = g.fillStyle; drawShape(g, c.shape, ex, ey, er * 0.3);
    } else if (st.turn !== null && st.turn !== undefined && ['roll', 'pull', 'place', 'match_end'].includes(st.phase)) {
      g.fillStyle = hex(colours[st.turn % colours.length]); g.beginPath(); g.arc(ex, ey, er * 0.22, 0, Math.PI * 2); g.fill();
    }
    // the words
    const tx = x + 290, maxW = sw - 290 - (st.round > 0 ? 220 : 50);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = INK;
    text(g, st.head || '', tx, y + sh * 0.56, maxW, 800, 96, FONT.head, 0.6);
    g.fillStyle = INK2; text(g, st.sub || '', tx, y + sh * 0.82, maxW, 500, 34, FONT.body, 0.7);
    if (st.roll !== null && st.roll !== undefined) { const c = J().COLOURS[st.roll]; g.fillStyle = hex(c.hex); g.font = `700 30px ${FONT.head}`; g.fillText(`${c.name}  ·  ${c.label}`, tx, y + sh * 0.24); }
    // the right: the round, as a red seal (hanko)
    if (st.round > 0) {
      const hx = x + sw - 120, hy = y + sh / 2, hs = 74;
      g.save(); g.translate(hx, hy); g.rotate(-0.04);
      g.fillStyle = SHU; g.beginPath(); g.roundRect(-hs, -hs, 2 * hs, 2 * hs, 14); g.fill();
      g.globalCompositeOperation = 'destination-out';                 // (a seal is never printed evenly)
      for (let k = 0; k < 90; k++) { const a = hash(k, st.round, 3), b2 = hash(k, st.round, 4); g.fillStyle = `rgba(0,0,0,${0.25 + 0.5 * hash(k, 1, 5)})`; g.beginPath(); g.arc(-hs + a * 2 * hs, -hs + b2 * 2 * hs, 1 + 3 * hash(k, 2, 6), 0, Math.PI * 2); g.fill(); }
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(255,240,225,0.95)'; g.lineWidth = 4; g.strokeRect(-hs + 10, -hs + 10, 2 * hs - 20, 2 * hs - 20);
      g.fillStyle = 'rgba(255,240,225,0.95)'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `500 20px ${FONT.body}`; g.fillText('R O U N D', 0, -hs * 0.45);
      g.font = `800 64px ${FONT.head}`; g.fillText(`${st.round}`, -14, hs * 0.16); g.font = `500 28px ${FONT.head}`; g.fillText(`/${st.rounds}`, 30, hs * 0.3);
      g.restore();
    }
    g.restore();
  }

  // ---- every frame
  let statusKey = null, backKey = null, fontsVer = 0;
  const SWING_W = 2 * Math.PI * 1.25, SPIN_W = 2 * Math.PI * 0.9;
  function update({ state, lay, touches = [], t = performance.now() / 1000, dt = 1 / 60, colours = [], fonts = 0 }) {
    if (!state || !lay) return;
    const p0 = pose(state); root.visible = !!p0;
    if (!p0) return;
    root.position.set(p0.x, p0.h, -p0.y); root.rotation.set(-(p0.pitch || 0), Math.atan2(Math.cos(p0.yaw), -Math.sin(p0.yaw)), 0, 'YXZ');
    if (fonts !== fontsVer) { fontsVer = fonts; statusKey = null; backKey = null; for (const p of plaques.values()) p.shown = null; }
    // which plaques: one for each rectangle of the layout (a button by its id, a tag by its label)
    const want = new Map();
    lay.buttons.forEach((b, i) => want.set(b.id || `tag:${b.label}`, b));
    for (const [k, p] of [...plaques]) if (!want.has(k) || p.rect.x !== want.get(k).x || p.rect.kind !== want.get(k).kind) { disposePlaque(p); plaques.delete(k); }
    let i = 0;
    for (const [k, b] of want) { if (!plaques.has(k)) makePlaque(k, b, i); i++; }
    // the faces: what each plaque shows changes only while its face is turned away (or at once, the first time)
    let redraw = false;
    const touchOf = new Map(touches.map((x) => [x.button, x]));
    for (const [k, b] of want) {
      const p = plaques.get(k), sig = content(b), off = !!b.off || !b.id && b.kind !== 'tag';
      p.rect = b;
      const away = Math.cos(p.spin) < -0.2;
      const base = off ? Math.PI : 0, k2 = Math.PI * 2;
      if (p.sig === null) { p.spin = p.target = base; }                                   // (the first time: it hangs as it should, no turn)
      if (p.shown === null || (p.sig !== sig && away)) { p.shown = Object.assign({}, b); p.sig = sig; redraw = true; }
      // where it should turn to: round (off), or face on; new words: once round
      let tgt = Math.ceil((p.target - base - 1e-6) / k2) * k2 + base;
      if (Math.abs(tgt - p.target) > 1e-6) p.target = tgt;
      else if (p.sig !== sig && !off && !away && Math.abs(p.spin - p.target) < 0.3) p.target += k2;
      // a fingertip at it: pushed back as deep as the finger goes (held), or a glow (near)
      const tc = b.id ? touchOf.get(b.id) : null, plH = b.h * m;
      const pushTo = tc && tc.held ? Math.atan2(Math.max(0.012, -tc.top), plH * 0.9) : 0;
      const sway = 0.012 * Math.sin(t * 1.1 + p.i * 1.7) + 0.006 * Math.sin(t * 2.3 + p.i);       // (air in the room: the same on every page)
      const goal = pushTo + sway * (tc && tc.held ? 0 : 1);
      p.swingV += (-SWING_W * SWING_W * (p.swing - goal) - 2 * (tc && tc.held ? 0.9 : 0.09) * SWING_W * p.swingV) * dt;
      p.swing += p.swingV * dt;
      p.spinV += (-SPIN_W * SPIN_W * (p.spin - p.target) - 2 * 0.42 * SPIN_W * p.spinV) * dt;
      p.spin += p.spinV * dt;
      p.pivot.rotation.x = p.swing; p.spinG.rotation.y = p.spin;
      p.glow += ((tc ? (tc.held ? 0.55 : 0.3) : b.active && !off ? 0.06 + 0.04 * Math.sin(t * 2) : 0) - p.glow) * Math.min(1, dt * 10);
      p.mat.emissiveIntensity = p.glow;
    }
    // the paper panel and the faces, drawn again when what they say changes
    const sk = JSON.stringify(lay.status);
    if (sk !== statusKey) { statusKey = sk; redraw = true; }
    if (redraw) {
      const g = front.g;
      g.clearRect(0, 0, W, H);
      paintStatus(g, lay.status || {}, colours);
      for (const p of plaques.values()) if (p.shown) paintFace(g, p.shown, false);
      front.t.needsUpdate = true;
    }
    const bk = lay.buttons.map((b) => `${b.kind}${b.label}${b.x}`).join('|');
    if (bk !== backKey) { backKey = bk; back.g.clearRect(0, 0, W, H); for (const b of lay.buttons) paintFace(back.g, b, true); back.t.needsUpdate = true; }
    paperMat.emissiveIntensity = 0.66 + 0.04 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 13.1 + 1.3);
  }
  // where the board is (common frame): createApp's boards and the PC view
  function pose(state) {
    if (!state || !state.place) return null;
    const Ly = J().layout(state.size, state.place), Bd = Ly.board, c = J().toCommon(state.place, Bd.c);
    return { x: c[0], y: c[1], h: Bd.bottom + h / 2, yaw: state.place.yaw + Bd.yaw, pitch: Bd.pitch };
  }
  function dispose() { for (const p of plaques.values()) disposePlaque(p); for (const g of own) g.dispose(); stand.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); front.t.dispose(); back.t.dispose(); paperMat.dispose(); backMat.dispose(); parent.remove(root); }
  return { root, update, pose, dispose, aspect: H / W, width: w };
}
