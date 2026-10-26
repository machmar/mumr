// A menu floating in the room, drawn from a menus.grid / SysMenu.layout layout (an ES module; the page gives it THREE). The look is
// docs/WRIST-MENU-SPEC.md: flat fills, sharp corners, black, white and neutral grays; every button that can be pressed is a rigid block
// (a face and four vertical walls) that stands up 4 mm when a fingertip is near, snaps into a square pit (and turns black) when pressed, and
// follows the finger. The wrist menu unrolls (the top rises with the button, the bottom rolls down, nothing is scaled) and slides sideways between layers.
//
//   const { Panel, drawGrid } = makePanels(THREE, renderer)
//   const p = new Panel(widthMetres, lay, { handle })   p.mesh (add it to the scene), p.plane (invisible, for a raycast), p.draw(lay, look),
//                                             p.pose(pose) (menus.axes conventions), p.handleLook('idle' | 'near' | 'held')
//   p.touch([{ button, top, push, held }])   the buttons a fingertip is at (menus.shape: top: metres out of the surface, push: the whole menu moved
//                                      back; held: pressed, which turns it black)
//   p.tick(dt, camPos)                 every frame: the unroll / roll up of the wrist menu, the slide between its layers (lay.level), the blocks'
//                                      heights; camPos: where the viewer is (XR)
//   drawGrid(ctx, lay, look)           look: { dark: [button ids that are pressed], edge (a colour: another player's menu), note, slide }
// Seen from behind a menu is a blank wall in its background colour (Nudgy, 2026-10-14: "make it so that menus from behind are just the
// menu background color"). Nudgy's cut-out of the real hand in front of a menu is not here; the ghost fingers are drawn over it.
const COL = { card: '#F0F0F0', btn: '#DCDCDC', dark: '#111111', text: '#111111', dim: '#555555', darkDim: '#CCCCCC', line: '#666666', wall: ['#C4C4C4', '#9A9A9A', '#ABABAB', '#B8B8B8'] };
const FONT = 'Inter, system-ui, sans-serif';
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
// docs/brand/mumr-logo.svg: the M twice (cut at the middle: one thin line runs through all three letters), the U and the R, in a 100 x 100 box
const LOGO = {
  m1: 'M17 78V2H27.93L31.41 35.85Q31.62 37.62 31.91 40.66Q32.2 43.71 32.5 47.02Q32.79 50.34 33 53H33.34Q33.5 50.9 33.75 47.97Q34.01 45.03 34.3 41.77Q34.59 38.51 34.84 35.74L38.36 2H49V78H41.71V45.59Q41.71 40.83 41.73 35.96Q41.75 31.09 41.8 27.11Q41.84 23.13 41.84 21.36H41.5Q41.38 23.02 41.1 26.17Q40.83 29.32 40.52 32.7Q40.2 36.07 39.95 38.51L35.76 78H29.73L25.5 38.51Q25.29 36.29 25 33.2Q24.71 30.1 24.43 26.89Q24.16 23.68 23.95 21.47H23.62Q23.66 24.35 23.7 28.49Q23.74 32.64 23.79 37.12Q23.83 41.6 23.83 45.59V78Z', m2: 'M17 98V22H27.93L31.41 55.85Q31.62 57.62 31.91 60.66Q32.2 63.71 32.5 67.02Q32.79 70.34 33 73H33.34Q33.5 70.9 33.75 67.97Q34.01 65.03 34.3 61.77Q34.59 58.51 34.84 55.74L38.36 22H49V98H41.71V65.59Q41.71 60.83 41.73 55.96Q41.75 51.09 41.8 47.11Q41.84 43.13 41.84 41.36H41.5Q41.38 43.02 41.1 46.17Q40.83 49.32 40.52 52.7Q40.2 56.07 39.95 58.51L35.76 98H29.73L25.5 58.51Q25.29 56.29 25 53.2Q24.71 50.1 24.43 46.89Q24.16 43.68 23.95 41.47H23.62Q23.66 44.35 23.7 48.49Q23.74 52.64 23.79 57.12Q23.83 61.6 23.83 65.59V98Z',
  u: 'M66.97 49.5Q62 49.5 58.41 47.39Q54.82 45.29 52.91 41.07Q51 36.86 51 30.61V2H60.04V30.34Q60.04 34.82 61.8 37.4Q63.56 39.99 66.97 39.99Q70.39 39.99 72.2 37.4Q74.01 34.82 74.01 30.34V2H83V30.61Q83 36.86 81.09 41.07Q79.18 45.29 75.62 47.39Q72.05 49.5 66.97 49.5Z', r: 'M51 98V50.5H70.64Q74.38 50.5 76.9 52.47Q79.41 54.44 80.66 57.86Q81.92 61.29 81.92 65.5Q81.92 70.07 80.42 73.63Q78.91 77.19 76.21 79.19L83 98H73.15L67.54 81.27H59.81V98ZM59.81 72.07H68.92Q70.74 72.07 71.85 70.38Q72.96 68.68 72.96 65.85Q72.96 63.98 72.46 62.67Q71.97 61.36 71.09 60.63Q70.2 59.9 68.92 59.9H59.81Z',
};
// buttons in a menu that can be blocks; seconds to unroll or roll up, to slide between layers (not decided: about a quarter of a second to start); the height of
// the ripple that runs up the menu while it unrolls (as tall as a button that a fingertip is near)
const MAX_HOLES = 48, UNFOLD = 0.3, SLIDE = 0.22, RIPPLE = 0.004;
// The snap of a pressed button (and the pop back up) is a fast spring, so it reads as a detent that gives way and not as a jump: a jump of the
// block's target of more than SNAP_MIN metres starts it; it rings at SNAP_HZ with a little overshoot and is done in about 80 ms. Following the finger is not delayed.
const REST = 2e-4;                                          // a block lower or higher than this (0.2 mm) is drawn as a block
const SNAP_MIN = 0.006, SNAP_W = 2 * Math.PI * 20, SNAP_ZETA = 0.55;

// a button is a block when it can be pressed and is drawn as a button
const isBlock = (b) => !!b.id && !b.off && !b.text && !b.ghost && !b.flat && !b.left && !b.arrow && !b.logo;

function fit(g, s, w) { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }

// The face of the wrist's fold button: the logo (folded) or the arrow (open), in a square of `s` pixels
export function drawFace(g, kind, dark, s) {
  g.clearRect(0, 0, s, s);
  g.fillStyle = dark ? COL.dark : COL.card; g.fillRect(0, 0, s, s);
  if (kind === 'arrow') {
    g.strokeStyle = dark ? COL.card : COL.text; g.lineWidth = s * 0.14; g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(s * 0.25, s * 0.38); g.lineTo(s * 0.5, s * 0.63); g.lineTo(s * 0.75, s * 0.38); g.stroke();
    return;
  }
  g.save(); g.scale(s / 100, s / 100); g.fillStyle = dark ? COL.card : '#444444';
  g.save(); g.beginPath(); g.rect(0, 0, 100, 49.5); g.clip(); g.fill(new Path2D(LOGO.m1)); g.restore();
  g.save(); g.beginPath(); g.rect(0, 50.5, 100, 49.5); g.clip(); g.fill(new Path2D(LOGO.m2)); g.restore();
  g.fill(new Path2D(LOGO.u)); g.fill(new Path2D(LOGO.r));
  g.restore();
}

export function drawGrid(ctx, lay, look = {}) {
  const g = ctx, card = lay.card === undefined ? { x: 0, y: 0, w: lay.w, h: lay.h } : lay.card, sl = look.slide;
  g.clearRect(0, 0, lay.w, lay.h);
  if (!card) return;                                          // (the folded wrist menu: its button is drawn by drawFace)
  const layer = (l, dx) => { g.save(); g.beginPath(); g.rect(card.x, card.y, card.w, card.h); g.clip(); g.translate(dx, 0); drawLayer(g, l, look, card); g.restore(); };
  if (sl) {                                                   // a slide between two layers: deeper goes in from the right, out goes back to the left
    const t = sl.t, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(2 - 2 * t, 2) / 2;
    layer(sl.prev, -sl.dir * e * card.w); layer(lay, sl.dir * (1 - e) * card.w);
  } else layer(lay, 0);
  if (look.edge !== undefined && look.edge !== null) { g.lineWidth = 20; g.strokeStyle = hex(look.edge); g.strokeRect(card.x + 10, card.y + 10, card.w - 20, card.h - 20); }
}

// the card with everything on it, from (card.x, card.y) on; lines are drawn at least 6 px (1.5 mm on the wrist menu) thick, or they alias
function drawLayer(g, lay, look, card) {
  const W = lay.w, dark = new Set([].concat(look.dark || [], look.hover || [], look.pressed || []));
  g.fillStyle = COL.card; g.fillRect(card.x, card.y, card.w, card.h);
  const th = lay.title.h, ty = lay.title.y || 0, wrist = !!lay.wrist, pad = wrist ? 32 : 22, big = wrist ? 36 : 30, small = wrist ? 30 : 22;
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = COL.text; g.font = `600 ${big}px ${FONT}`;
  g.fillText(lay.title.text || '', card.x + pad, ty + th / 2);
  const note = look.note !== undefined ? look.note : lay.title.note, tops = lay.buttons.filter((b) => b.top);
  if (note) {
    g.fillStyle = COL.dim; g.font = `500 ${small}px ${FONT}`;
    if (tops.length) { const x = card.x + pad + g.measureText(lay.title.text || '').width + 24, to = tops.reduce((a, b) => Math.min(a, b.x), W); g.fillText(fit(g, note, to - x - 16), x, ty + th / 2); }
    else { const used = (() => { g.font = `600 ${big}px ${FONT}`; return g.measureText(lay.title.text || '').width; })(); g.font = `500 ${small}px ${FONT}`; g.textAlign = 'right'; g.fillText(fit(g, note, card.w - 2 * pad - used - 24), card.x + card.w - pad, ty + th / 2); g.textAlign = 'left'; }
  }
  // shapes under the buttons (the room picker's map): { pts: [[x, y]] (px), colour, fill }
  for (const s of lay.shapes || []) {
    g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
    if (s.fill) { g.fillStyle = s.fill; g.fill(); }
    g.lineWidth = 8; g.strokeStyle = s.colour || COL.dim; g.stroke();
  }
  for (const b of lay.buttons) {
    if (b.arrow || b.logo) continue;
    const text = (!b.id || b.off || b.text) && !b.plate, dk = dark.has(b.id) && !text, k = Math.min(1, b.h / 120), px = b.left ? 0 : wrist ? 24 : 18;
    if (b.ghost) {                                       // (a button drawn as a frame only: what is under it shows)
      if (dk) { g.fillStyle = 'rgba(17,17,17,0.28)'; g.fillRect(b.x, b.y, b.w, b.h); }
      g.lineWidth = b.active ? 12 : 6; g.strokeStyle = b.active ? COL.dark : COL.line; g.strokeRect(b.x, b.y, b.w, b.h);
    } else if (!text && !b.flat) { g.fillStyle = dk ? COL.dark : COL.btn; g.fillRect(b.x, b.y, b.w, b.h); if (b.active && !dk) { g.fillStyle = COL.dark; g.fillRect(b.x, b.y, 16, b.h); } }
    const left = b.x + (wrist ? 32 : 18), fg = dk ? COL.card : b.off ? '#888888' : text ? COL.line : COL.text, sub = dk ? COL.darkDim : COL.dim;
    g.fillStyle = fg;
    if (b.left) {                                        // a line of text (a window's): left aligned, `size` px, `head` bold
      g.font = `${b.head ? 600 : 500} ${b.size || 24}px ${FONT}`; g.textAlign = 'left'; g.fillStyle = COL.text;
      g.fillText(fit(g, b.label || '', b.w - 32), b.x + 16, b.y + b.h / 2);
    } else if (b.ghost) {
      g.textAlign = 'center'; g.fillStyle = COL.text; g.font = `600 ${Math.round(26)}px ${FONT}`; g.fillText(fit(g, b.label, b.w - 16), b.x + b.w / 2, b.y + b.h * 0.36);
      g.fillStyle = COL.dim; g.font = `500 22px ${FONT}`; g.fillText(fit(g, String(b.value || ''), b.w - 16), b.x + b.w / 2, b.y + b.h * 0.7);
    } else if (b.center) {                               // (a small button in a plate: its sign, centred)
      g.textAlign = 'center'; g.font = `600 ${Math.round(b.h * 0.8)}px ${FONT}`; g.fillText(b.label || '', b.x + b.w / 2, b.y + b.h / 2);
    } else if (b.value !== undefined && b.value !== '') {
      g.textAlign = 'left'; const lf = Math.round((text ? 36 : 44) * k * (wrist ? 1 : 0.85)), sf = Math.round(28 * k * (wrist ? 1 : 0.85)), lx = wrist ? left : b.x + px;
      g.font = `600 ${lf}px ${FONT}`; g.fillText(fit(g, b.label || '', b.w - 2 * px - 8 - (b.inset || 0)), lx, b.y + b.h * 0.38);
      g.fillStyle = sub; g.font = `500 ${sf}px ${FONT}`; g.fillText(fit(g, String(b.value), b.w - 2 * px - 8 - (b.inset || 0)), lx, b.y + b.h * 0.7);
    } else {
      g.textAlign = 'left'; g.font = `600 ${Math.round((text ? 36 : 44) * k * (wrist ? 1 : 0.85))}px ${FONT}`;
      g.fillText(fit(g, b.label || '', b.w - 2 * px - 8), wrist ? left : b.x + px, b.y + b.h / 2);
    }
  }
}

export const HANDLE_GAP = 0.035, HANDLE_HALF = 0.07;

export function makePanels(THREE, renderer) {
  const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  // the card: the canvas, with a hole where each block is (the block is its own mesh), and from behind a blank wall
  // (win: the part of the canvas that is shown, bottom to top, while the wrist menu unrolls)
  const FS_CARD = `uniform sampler2D map; uniform vec4 holes[${MAX_HOLES}]; uniform int nh; uniform vec2 win; varying vec2 vUv;
    void main() {
      if (vUv.y < win.x || vUv.y > win.y) discard;
      if (gl_FrontFacing) { for (int i = 0; i < ${MAX_HOLES}; i++) { if (i >= nh) break; vec4 h = holes[i]; if (vUv.x >= h.x && vUv.x <= h.z && vUv.y >= h.y && vUv.y <= h.w) discard; } }
      vec4 c = texture2D(map, vUv);
      if (!gl_FrontFacing) c = vec4(pow(vec3(240.0 / 255.0), vec3(2.2)), c.a);
      gl_FragColor = c;
      #include <colorspace_fragment>
    }`;
  const FS_FACE = `uniform sampler2D map; varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(map, vUv);
      #include <colorspace_fragment>
    }`;
  // a block's face: the same canvas, so the same win (its uv are the canvas's)
  const FS_BLOCK = `uniform sampler2D map; uniform vec2 win; varying vec2 vUv;
    void main() {
      if (vUv.y < win.x || vUv.y > win.y) discard;
      gl_FragColor = texture2D(map, vUv);
      #include <colorspace_fragment>
    }`;
  const handleGeo = new THREE.CapsuleGeometry(0.008, HANDLE_HALF * 2, 4, 12); handleGeo.rotateZ(Math.PI / 2);
  // four vertical walls of a unit square, from z = 0 to z = 1 (scaled to a block's size and height), each in its own shade
  const wallGeo = (() => {
    const P = [], C = [], c = new THREE.Color();
    const quad = (a, b, shade) => { c.set(COL.wall[shade]); for (const v of [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], 1], [a[0], a[1], 0], [b[0], b[1], 1], [a[0], a[1], 1]]) { P.push(...v); C.push(c.r, c.g, c.b); } };
    quad([-0.5, 0.5], [0.5, 0.5], 0); quad([0.5, -0.5], [-0.5, -0.5], 1); quad([0.5, 0.5], [0.5, -0.5], 2); quad([-0.5, -0.5], [-0.5, 0.5], 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return g;
  })();
  const wallMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

  class Panel {
    // width: metres; lay: a menus.grid layout; opts.handle: a bar under the panel to carry it by (this player's own menu only)
    constructor(width, lay, opts = {}) {
      this.width = width; this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
      this.mesh = new THREE.Group();                         // (posed; the body is moved back inside it, the handle is not)
      this.body = new THREE.Group(); this.mesh.add(this.body);
      this.cardGroup = new THREE.Group(); this.body.add(this.cardGroup);      // (the card and its blocks)
      this.holes = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4());
      this.win = new THREE.Vector2(0, 1);                    // (the part of the canvas shown, bottom to top, 0..1: less while the wrist menu unrolls)
      this.material = new THREE.ShaderMaterial({ transparent: true, side: THREE.DoubleSide, uniforms: { map: { value: null }, holes: { value: this.holes }, nh: { value: 0 }, win: { value: this.win } }, vertexShader: VS, fragmentShader: FS_CARD });
      this.faceMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null }, win: { value: this.win } }, vertexShader: VS, fragmentShader: FS_BLOCK });
      this.slide = null;                                     // a slide between two layers of the wrist menu: { prev (its layout), dir (1: deeper), t }
      this.cardPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material); this.cardPlane.renderOrder = 2; this.cardGroup.add(this.cardPlane);
      this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));     // (what a raycast hits: the layout's size)
      this.mesh.add(this.plane);
      this.handle = null;
      if (opts.handle) {
        this.handle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xece9e2, transparent: true, opacity: 0.85 }));
        this.mesh.add(this.handle);
      }
      this.tex = null; this.lay = null; this.cardLay = null; this.look = {}; this.sig = ''; this.blocks = new Map();
      this.touches = new Map(); this.pushM = 0; this.camPos = null;
      this.p = 0; this.ticked = false; this.foldId = null;
      this.fold = null;                                      // the wrist's fold button: a block with two faces (logo, arrow), outside the card
      if (lay) this.setLayout(lay);
    }
    get h() { return this.lay ? this.width * this.lay.h / this.lay.w : this.width; }
    get mpp() { return this.lay ? this.width / this.lay.w : 0; }       // metres per canvas pixel
    setLayout(lay) {
      const was = this.lay, old = this.cardLay;
      this.lay = lay;
      // a layer of the wrist menu that is deeper (higher `level`) comes in from the right, going back out goes to the left (only on a page that ticks)
      if (!lay.folded && old && was && !was.folded && this.ticked && this.p >= 1 && old.level !== undefined && lay.level !== undefined && lay.level !== old.level && old.w === lay.w && old.h === lay.h) {
        this.slide = { prev: old, dir: lay.level > old.level ? 1 : -1, t: 0 };
      }
      if (!lay.folded) {
        if (!this.cardLay || this.cardLay.w !== lay.w || this.cardLay.h !== lay.h) {
          // A texture keeps the size of its first upload: a canvas of another size needs a new texture (or the old picture is shown,
          // stretched: the line-up menu in the first headset run, 2026-10-22)
          this.canvas.width = lay.w; this.canvas.height = lay.h;
          if (this.tex) this.tex.dispose();
          this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
          if (renderer) this.tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          this.material.uniforms.map.value = this.tex; this.faceMat.uniforms.map.value = this.tex;
        }
        this.cardLay = lay;
      }
      if (lay.wrist && !this.fold) this._makeFold();
      this._blocks();
      this._size();
    }
    // the width in metres (a menu that opens and folds changes it)
    setWidth(w) { if (w === this.width) return; this.width = w; this._size(); }
    _size() {
      const lay = this.lay; if (!lay) return;
      const mpp = this.mpp, c = this.cardLay;
      this.plane.scale.set(this.width, this.width * lay.h / lay.w, 1);
      if (c) { this.cardPlane.scale.set(c.w * mpp, c.h * mpp, 1); this.cardPlane.position.set(0, 0, 0); }
      if (this.handle) this.handle.position.set(0, -this.h / 2 - HANDLE_GAP, 0);
      this._apply();
    }
    // the blocks of the card: one for each button that can be pressed (rebuilt when the layout's shape changes)
    _blocks() {
      const c = this.cardLay, list = c ? c.buttons.filter(isBlock).slice(0, MAX_HOLES) : [];
      const sig = c ? `${c.w}x${c.h}|${list.map((b) => `${b.id},${b.x},${b.y},${b.w},${b.h}`).join(';')}` : '';
      if (sig === this.sig) return;
      this.sig = sig;
      for (const e of this.blocks.values()) { this.cardGroup.remove(e.group); e.face.geometry.dispose(); }
      this.blocks.clear();
      list.forEach((b, i) => {
        const geo = new THREE.PlaneGeometry(1, 1), uv = geo.attributes.uv, u0 = b.x / c.w, u1 = (b.x + b.w) / c.w, v0 = 1 - (b.y + b.h) / c.h, v1 = 1 - b.y / c.h;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) < 0.5 ? u0 : u1, uv.getY(k) < 0.5 ? v0 : v1);
        const group = new THREE.Group(), face = new THREE.Mesh(geo, this.faceMat), walls = new THREE.Mesh(wallGeo, wallMat);
        face.renderOrder = 3; group.add(face, walls);
        this.cardGroup.add(group);
        this.holes[i].set(2, 2, 2, 2);
        this.blocks.set(b.id, { group, face, walls, b, i, rect: [u0, v0, u1, v1], cy: 0.5 - (b.y + b.h / 2) / c.h, sn: { last: 0, off: 0, vel: 0 } });
      });
      this.material.uniforms.nh.value = list.length;
    }
    _makeFold() {
      const mk = (kind) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: VS, fragmentShader: FS_FACE });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); face.renderOrder = 3;
        return { kind, canvas, tex, face, dark: null };
      };
      const group = new THREE.Group(), logo = mk('logo'), arrow = mk('arrow'), walls = new THREE.Mesh(wallGeo, wallMat);
      group.add(logo.face, arrow.face, walls); this.body.add(group);
      this.fold = { group, logo, arrow, walls, sn: { last: 0, off: 0, vel: 0 } };
    }
    // the height a block is drawn at: its target (menus.shape) plus the spring's offset, which a jump of the target starts at the old height
    _shown(sn, target) {
      if (this.ticked && Math.abs(target - sn.last) > SNAP_MIN) { sn.off = sn.last + sn.off - target; sn.vel = 0; }
      sn.last = target;
      return target + sn.off;
    }
    _spring(sn, dt) {
      if (!sn.off && !sn.vel) return;
      const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
      for (let i = 0; i < n; i++) { sn.vel += (-SNAP_W * SNAP_W * sn.off - 2 * SNAP_ZETA * SNAP_W * sn.vel) * h; sn.off += sn.vel * h; }
      if (Math.abs(sn.off) < 1e-5 && Math.abs(sn.vel) < 1e-3) { sn.off = 0; sn.vel = 0; }
    }
    _foldFaces(dark) {
      for (const f of [this.fold.logo, this.fold.arrow]) if (f.dark !== dark) { f.dark = dark; drawFace(f.canvas.getContext('2d'), f.kind, dark, 128); f.tex.needsUpdate = true; }
    }
    draw(lay, look) {
      this.look = look || {};
      this.setLayout(lay);
      if (!this.ticked) this.p = lay.wrist ? (lay.folded ? 0 : 1) : 1;
      this._paint();
      this._apply();
    }
    // the canvas (the card), unless the wrist menu is folded: then what was last drawn waits for the next unfold
    _paint() {
      const lay = this.lay; if (!lay) return;
      const dark = this._darkIds(), look = Object.assign({}, this.look, { dark, slide: this.slide });
      if (!lay.folded) { drawGrid(this.ctx, lay, look); this.tex.needsUpdate = true; }
      if (this.fold) this._foldFaces(dark.some((id) => id === 'sysOpen' || id === 'sysClose'));
    }
    // the buttons that are pressed (black): a fingertip near a button only lifts it
    _darkIds() { return [...this.touches.values()].filter((t) => t.held).map((t) => t.button).concat(this.look.dark || [], this.look.hover || [], this.look.pressed || []).filter(Boolean); }
    // the buttons a fingertip is at: [{ button, top, push, held }]. A redraw only when which buttons are black changed
    touch(list) {
      const was = this._darkIds().sort().join('|');
      this.touches = new Map((list || []).map((t) => [t.button, t]));
      this.pushM = (list || []).reduce((a, t) => Math.max(a, t.push || 0), 0);
      if (this.lay && this._darkIds().sort().join('|') !== was) this._paint();
      this._apply();
    }
    tick(dt, camPos) {
      this.ticked = true; this.camPos = camPos || this.camPos;
      const lay = this.lay; if (!lay) return;
      if (lay.wrist) { const goal = lay.folded ? 0 : 1, step = dt / UNFOLD; this.p = goal > this.p ? Math.min(goal, this.p + step) : Math.max(goal, this.p - step); }
      for (const blk of this.blocks.values()) this._spring(blk.sn, dt);
      if (this.fold) this._spring(this.fold.sn, dt);
      if (this.slide) { this.slide.t += dt / SLIDE; if (this.slide.t >= 1) this.slide = null; this._paint(); }
      this._apply();
    }
    // heights, positions and what is shown, from the layout, the touches and the unfold
    _apply() {
      const lay = this.lay, c = this.cardLay; if (!lay) return;
      const mpp = this.mpp, front = !this.camPos || this.mesh.worldToLocal(new THREE.Vector3().fromArray(this.camPos)).z > -0.0005, p = this.p;
      this.body.position.z = -this.pushM;
      const wrist = !!lay.wrist, e = ease(p);
      const showCard = !!c && (!wrist || p > 0);
      this.cardGroup.visible = showCard;
      this.cardPlane.visible = showCard;
      if (showCard) {
        // The menu unrolls (nothing is scaled): the top edge rises with the button, the bottom stays at the button and rolls down behind it.
        // The window is the part of the canvas that shows, in canvas v (0 bottom, 1 top), round the middle where the card's middle is
        const cardH = c.card ? c.card.h : c.h, unrolling = wrist && p < 1, half = cardH / 2 / c.h;
        this.win.set(unrolling ? 0.5 - half * p * p : 0, unrolling ? 0.5 + half * e : 1);
        const sliding = !!this.slide;                         // (a slide is drawn flat in the canvas: no blocks while it runs)
        for (const [id, blk] of this.blocks) {
          const b = blk.b, t = this.touches.get(id), v0 = 1 - (b.y + b.h) / c.h, v1 = 1 - b.y / c.h;
          let top = this._shown(blk.sn, t ? t.top : 0);
          if (unrolling && p > 0) {                           // the ripple that runs up through the menu while it opens, as tall as a button that a fingertip is near
            const y01 = Math.min(1, Math.max(0, (c.card ? c.card.y + c.card.h - (b.y + b.h / 2) : c.h - (b.y + b.h / 2)) / cardH)), phase = p * 1.5 - y01 * 0.5;
            top = Math.max(top, RIPPLE * Math.sin(Math.PI * Math.min(1, Math.max(0, phase))));
          }
          blk.group.position.set(((b.x + b.w / 2) - c.w / 2) * mpp, (c.h / 2 - (b.y + b.h / 2)) * mpp, 0);
          blk.face.scale.set(b.w * mpp, b.h * mpp, 1); blk.face.position.z = top;
          blk.walls.scale.set(b.w * mpp, b.h * mpp, top);
          blk.walls.visible = Math.abs(top) > 1e-5 && v0 >= this.win.x && v1 <= this.win.y;      // (a wall is not cut: shown when the whole block is)
          // At rest a button is just the canvas: a block flush with the card in a hole of the same size leaves a hairline between them, which aliases.
          // A block is a mesh only while it stands up or is down, and the card has a hole only for a pit (a raised block covers what is under it)
          const rest = Math.abs(top) < REST;
          blk.group.visible = front && !sliding && !rest;
          const h = this.holes[blk.i];
          if (front && !sliding && top < -REST) h.set(blk.rect[0], blk.rect[1], blk.rect[2], blk.rect[3]); else h.set(2, 2, 2, 2);
        }
      }
      if (this.fold) {                                          // the fold button: the logo on the wrist, rising to the arrow above the open menu
        const fb = lay.buttons.find((b) => b.arrow || b.logo), ob = c ? c.buttons.find((b) => b.arrow) : null, size = (fb ? fb.w : 80) * mpp;
        const to = ob ? [((ob.x + ob.w / 2) - c.w / 2) * mpp, (c.h / 2 - (ob.y + ob.h / 2)) * mpp] : [0, 0];
        const settledOpen = !lay.folded, at = wrist && p < 1 ? [to[0] * e, to[1] * e] : settledOpen ? to : [0, 0];
        const t = fb ? this.touches.get(fb.id) : null, top = this._shown(this.fold.sn, t ? t.top : 0);
        this.fold.group.position.set(at[0], at[1], 0);
        this.fold.logo.face.visible = p < 0.5; this.fold.arrow.face.visible = p >= 0.5;
        for (const f of [this.fold.logo.face, this.fold.arrow.face]) { f.scale.set(size, size, 1); f.position.z = top; }
        this.fold.walls.scale.set(size, size, top); this.fold.walls.visible = Math.abs(top) > 1e-5;
        this.fold.group.visible = front;
      }
    }
    // 'idle', 'near' (a hand is at it), 'held' (it is being carried)
    handleLook(state) {
      if (!this.handle) return;
      this.handle.material.color.setHex(state === 'held' ? 0x111111 : state === 'near' ? 0x777777 : 0xdcdcdc);
      this.handle.scale.setScalar(state === 'idle' ? 1 : 1.3);
    }
    // pose: { x, y (floor plan), h (XR height), yaw, pitch }, as menus.axes takes it
    pose(p) {
      this.mesh.position.set(p.x, p.h, -p.y);
      if (p.q) this.mesh.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]);          // (a card that turns with a wrist)
      else this.mesh.rotation.set(-(p.pitch || 0), Math.atan2(Math.cos(p.yaw), -Math.sin(p.yaw)), 0, 'YXZ');
      this.mesh.updateMatrixWorld(true);
    }
    dispose() {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.cardPlane.geometry.dispose(); this.plane.geometry.dispose(); this.plane.material.dispose(); this.material.dispose(); this.faceMat.dispose();
      for (const e of this.blocks.values()) e.face.geometry.dispose();
      if (this.fold) for (const f of [this.fold.logo, this.fold.arrow]) { f.face.geometry.dispose(); f.face.material.dispose(); f.tex.dispose(); }
      if (this.tex) this.tex.dispose(); if (this.handle) this.handle.material.dispose();
    }
  }
  return { Panel, drawGrid };
}
