// The paper shades over the room's ceiling lights (Marek, 2026-10-28: "Real world rooms might have a large ceiling light, which might feel too
// harsh"; "account for fluorescent lights which are long and narrow"). Under each real light (the engine's room.js lights(): the scan's lamps up
// at the ceiling and the ones players marked; one list for everybody, in the common frame: rule 1) hangs a thing of the game's own that the light
// seems to shine through:
//   a round fitting   an akari: a paper lantern on a spiral of bamboo, wider than it is tall, on a short cord close under the ceiling
//   a strip (a tube)  a kumiko panel: a long shallow box of dark wood flat under the ceiling, its underside washi behind an asanoha lattice
// It hides the bright fitting and glows the lantern's warm colour; it lights the real room below it (the engine's relight, shining down: as the
// room darkens the floor under it stays lit, the ceiling round it does not); a soft veil on the ceiling round it holds back the glare that
// spills past it, deeper as the room darkens. A new one unfolds from the ceiling. While a player marks the lights (the board's Lights), everybody
// sees where that player points: a thread of light from the hand to a ring on the ceiling, the strip drawn so far, a red ring on a shade a tap
// would take away.
//
//   const sh = createShades({ THREE, parent, env, own })      parent: the common frame's group (THREE (x, h, -y))
//   sh.update({ lights, t, dark, lightK, cursor })            lights: room.js lights(); t: the server's clock (s); dark: the room's dim now
//                                                            (0..1); lightK: how much light the game lets the room have (draw.js);
//                                                            cursor: null or { aim: [x, y] | null, drag: { a, b } | null, over: id | null,
//                                                            tip: [x, y, z] | null, h }
//   sh.relights() -> the engine's relight list (world coordinates)
import { washi, kumiko, glow, softRing } from './textures.js';

const toV = (x, y, z) => [x, z, -y];
const TILE = [0.22, 0.19];            // m: one kumiko tile (two triangles of 11 cm across, two rows)
const UNFOLD = 1.6;                   // s: a new shade opening out under the ceiling
const CLEAR = 2.0;                    // m: the lowest a shade may hang (heads)

export function createShades({ THREE, parent, env = null, own = (x) => x }) {
  const root = new THREE.Group(); root.name = 'shades'; parent.add(root);
  const paper = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; washi(c.getContext('2d'), 256, 256, 57, [250, 230, 200]); const t = own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
  const lattice = own(kumiko(THREE)), tGlow = own(glow(THREE)), tRing = own(softRing(THREE, 128, 0.78, 0.12));
  const M = {
    akari: own(new THREE.MeshStandardMaterial({ map: paper, emissive: 0xffcf98, emissiveMap: paper, emissiveIntensity: 1, roughness: 1, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.1 })),
    panel: own(new THREE.MeshStandardMaterial({ map: lattice, emissive: 0xffcf98, emissiveMap: lattice, emissiveIntensity: 1, roughness: 1, envMap: env, envMapIntensity: 0.1 })),
    wood: own(new THREE.MeshStandardMaterial({ color: 0x2a1c13, roughness: 0.55, envMap: env, envMapIntensity: 0.5 })),
    rib: own(new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.8, emissive: 0x3a2412, emissiveIntensity: 0.8 })),
    cord: own(new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.7 })),
    eye: own(new THREE.MeshBasicMaterial({ color: 0xfff1da, transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false })),
  };
  // the veil on the ceiling round a shade: dark, soft, from the shade's outline out (a rounded rectangle; a circle for an akari)
  const veilMat = (half, rr, fall) => (new THREE.ShaderMaterial({
    uniforms: { hs: { value: new THREE.Vector2(...half) }, rr: { value: rr }, fall: { value: fall }, A: { value: 0 } },
    transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec2 hs; uniform float rr; uniform float fall; uniform float A; varying vec2 vP;
      void main() { vec2 q = abs(vP) - (hs - vec2(rr)); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
        float k = 1.0 - smoothstep(0.0, fall, d); gl_FragColor = vec4(0.035, 0.024, 0.016, A * k * k); }`,
  }));

  let shades = [], sig = '';
  const seen = new Map();             // id -> when it was first seen (s, server's clock): it unfolds from then
  function clear() {
    const shared = new Set(Object.values(M));
    for (const s of shades) { root.remove(s.g); s.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !shared.has(o.material)) o.material.dispose(); }); }
    shades = [];
  }
  // ---- an akari over a round fitting
  function akari(L) {
    let W = Math.max(0.5, L.w + 0.2), Hs = W * 0.56;
    const room = L.h - CLEAR - 0.03;
    if (Hs > room) { Hs = Math.max(0.2, room); W = Math.max(L.w + 0.1, Hs / 0.56); }
    const drop = Math.max(0.03, Math.min(0.14, L.h - CLEAR - Hs)), g = new THREE.Group(), body = new THREE.Group(), inner = new THREE.Group();
    inner.position.y = -Hs / 2; body.add(inner);                  // (body: its top; it unfolds downwards from there)
    // (the paper: a ball pressed flat, open a little at the top and the bottom)
    const prof = [], N = 40, rAt = (u) => { const f = Math.PI * (0.1 + 0.8 * u); return [(W / 2) * Math.pow(Math.sin(f), 0.8), (Hs / 2) * Math.cos(f) / Math.cos(Math.PI * 0.1)]; };      // (u 0: the top)
    for (let i = 0; i <= N; i++) { const [r, y] = rAt(i / N); prof.push(new THREE.Vector2(r, y)); }
    const shell = new THREE.LatheGeometry(prof, 56); shell.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 ? 1.4 : 3); });
    inner.add(new THREE.Mesh(shell, M.akari));
    // (the bamboo rib: one spiral round the paper, every 3.5 cm, a hair outside it)
    const turns = Math.max(5, Math.round(Hs / 0.035)), pts = [];
    for (let i = 0; i <= turns * 40; i++) { const u = i / (turns * 40), [r, y] = rAt(u), a = u * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * (r + 0.0015), y, Math.sin(a) * (r + 0.0015))); }
    inner.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 40, 0.0011, 4, false), M.rib));
    // (rings at the openings; the bright opening underneath, where the light is seen)
    const [rt, yt] = rAt(0), [rb, yb] = rAt(1);                  // (the top opening, the bottom one)
    for (const [r, y] of [[rt, yt], [rb, yb]]) { const ring = new THREE.TorusGeometry(r, 0.0028, 5, 32); ring.rotateX(Math.PI / 2); ring.translate(0, y, 0); inner.add(new THREE.Mesh(ring, M.rib)); }
    const eye = new THREE.CircleGeometry(rb * 0.96, 32); eye.rotateX(Math.PI / 2); eye.translate(0, yb - 0.002, 0); inner.add(new THREE.Mesh(eye, M.eye));
    body.position.y = -drop; g.add(body);
    // (the cord and the canopy at the ceiling: they do not unfold)
    const cord = new THREE.CylinderGeometry(0.0028, 0.0028, drop + 0.01, 6); cord.translate(0, -(drop + 0.01) / 2, 0); g.add(new THREE.Mesh(cord, M.cord));
    const can = new THREE.CylinderGeometry(0.05, 0.058, 0.02, 24); can.translate(0, -0.01, 0); g.add(new THREE.Mesh(can, M.wood));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tGlow, color: 0xffc58a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    halo.scale.setScalar(W * 2.1); halo.position.y = -drop - Hs / 2; g.add(halo);
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * 1.1, W + 2 * 1.1), veilMat([W / 2, W / 2], W / 2, 0.75)); veil.rotation.x = Math.PI / 2; veil.position.y = -0.004; veil.renderOrder = 1; g.add(veil);
    g.position.set(...toV(L.a[0], L.a[1], L.h));
    return { id: L.id, g, body, halo, veil, glowAt: new THREE.Vector3(0, -drop - Hs, 0), range: 3.4, size: W };
  }
  // ---- a kumiko panel under a strip
  function panel(L) {
    const len = L.len + 0.3, wid = Math.max(0.34, L.w + 0.24), dep = 0.1, t = 0.016, g = new THREE.Group(), body = new THREE.Group();
    const geos = [];
    for (const z of [-1, 1]) { const b = new THREE.BoxGeometry(len, dep, t); b.translate(0, -dep / 2, z * (wid / 2 - t / 2)); geos.push(b); }
    for (const x of [-1, 1]) { const b = new THREE.BoxGeometry(t, dep, wid - 2 * t); b.translate(x * (len / 2 - t / 2), -dep / 2, 0); geos.push(b); }
    // (a bar across every 60 cm or so, under the paper: the frame the lattice is set in)
    const bays = Math.max(1, Math.round((len - 2 * t) / 0.6));
    for (let k = 1; k < bays; k++) { const b = new THREE.BoxGeometry(0.012, 0.014, wid - 2 * t); b.translate(-len / 2 + t + k * (len - 2 * t) / bays, -dep + 0.005, 0); geos.push(b); }
    for (const b of geos) body.add(new THREE.Mesh(b, M.wood));
    const face = new THREE.PlaneGeometry(len - 2 * t, wid - 2 * t); face.rotateX(Math.PI / 2);
    face.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 ? (wid - 2 * t) / TILE[1] : (len - 2 * t) / TILE[0]); });
    face.translate(0, -dep + 0.012, 0); body.add(new THREE.Mesh(face, M.panel));
    const glowP = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.5, wid + 0.5), new THREE.MeshBasicMaterial({ map: tGlow, color: 0xffc58a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    glowP.rotation.x = Math.PI / 2; glowP.position.y = -dep - 0.004; body.add(glowP);
    body.position.y = -0.012; g.add(body);
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(len + 2 * 1.1, wid + 2 * 1.1), veilMat([len / 2, wid / 2], 0.05, 0.75)); veil.rotation.x = Math.PI / 2; veil.position.y = -0.004; veil.renderOrder = 1; g.add(veil);
    const c = [(L.a[0] + L.b[0]) / 2, (L.a[1] + L.b[1]) / 2];
    g.position.set(...toV(c[0], c[1], L.h)); g.rotation.y = Math.atan2(L.b[1] - L.a[1], L.b[0] - L.a[0]);
    return { id: L.id, g, body, halo: glowP, veil, glowAt: new THREE.Vector3(0, -dep - 0.05, 0), range: 3.4 + L.len / 2, size: len };
  }
  function rebuild(lights) {
    clear();
    for (const L of lights) { const s = L.round ? akari(L) : panel(L); s.round = L.round; root.add(s.g); shades.push(s); }
  }

  // ---- the marking cursor: a thread of light from the hand to a ring on the ceiling, the strip so far
  const ringMat = own(new THREE.MeshBasicMaterial({ map: tRing, color: 0xfff0d8, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, side: THREE.DoubleSide, toneMapped: false }));      // (seen through a shade: it is a pointer)
  const ring = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), ringMat); ring.rotation.x = Math.PI / 2; ring.renderOrder = 4; root.add(ring);
  const threadMat = own(new THREE.MeshBasicMaterial({ color: 0xffe6c4, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0.35, toneMapped: false }));
  const thread = new THREE.Mesh(own(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 5, 1, true)), threadMat); thread.renderOrder = 4; root.add(thread);
  // (the strip so far, drawn as the outline of the panel it will be: a line of light round it, a faint fill)
  const dragMat = own(new THREE.ShaderMaterial({
    uniforms: { hs: { value: new THREE.Vector2(0.5, 0.17) }, A: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vP; uniform vec2 hs; void main() { vP = position.xy * (hs + vec2(0.06)) * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec2 hs; uniform float A; varying vec2 vP;
      void main() { vec2 q = abs(vP) - (hs - vec2(0.03)); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.03;
        float line = 1.0 - smoothstep(0.004, 0.016, abs(d)), fill = d < 0.0 ? 0.12 : 0.0, glow = exp(-max(d, 0.0) * 30.0) * 0.25;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * (line + fill + glow) * A, 1.0); }`,
  }));
  const drag = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), dragMat); drag.rotation.order = 'YXZ'; drag.renderOrder = 4; root.add(drag);
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // ---- every frame
  let lastLights = [];
  function update({ lights = [], t = 0, dark = 0, lightK = 1, cursor = null }) {
    const s2 = JSON.stringify(lights.map((L) => [L.id, L.a, L.b, L.h, L.w]));
    if (s2 !== sig) { sig = s2; rebuild(lights); }
    lastLights = lights;
    const glowK = 0.55 + 0.45 * lightK;
    M.akari.emissiveIntensity = 1.05 * glowK; M.panel.emissiveIntensity = 1.1 * glowK; M.eye.opacity = 0.95 * glowK;
    for (const s of shades) {
      if (!seen.has(s.id)) seen.set(s.id, t);
      const u = Math.max(0, Math.min(1, (t - seen.get(s.id)) / UNFOLD)), e = 1 - Math.pow(1 - u, 3);
      // (it opens out downwards from the ceiling: the akari as if a folded lantern dropped open, the panel lowered into place)
      s.body.scale.set(s.round ? 0.6 + 0.4 * e : 1, Math.max(0.001, e), s.round ? 0.6 + 0.4 * e : 1);
      s.halo.material.opacity = (s.round ? 0.22 : 0.3) * e * lightK;
      s.veil.material.uniforms.A.value = 0.5 * Math.pow(dark, 1.3) * e;      // (none in a room as it is: only the dark brings the glare out)
      // (a shade a tap would take away is lit red at its rim)
      const marked = cursor && cursor.over === s.id;
      s.halo.material.color.setHex(marked ? 0xff5a3c : 0xffc58a); if (marked) s.halo.material.opacity = 0.55 + 0.2 * Math.sin(t * 6);
    }
    // the cursor
    const aim = cursor && cursor.aim;
    ring.visible = !!aim; thread.visible = !!(aim && cursor.tip); drag.visible = !!(cursor && cursor.drag);
    if (aim) {
      const over = cursor.over, pulse = 1 + 0.08 * Math.sin(t * 5);
      ring.position.set(...toV(aim[0], aim[1], cursor.h - 0.008)); ring.scale.setScalar(0.3 * pulse);
      ringMat.color.setHex(over ? 0xff6a4a : 0xfff0d8); ringMat.opacity = 0.9;
      if (cursor.tip) {
        vA.set(...toV(...cursor.tip)); vB.copy(ring.position);
        const d = vB.clone().sub(vA), l = d.length();
        thread.position.copy(vA).addScaledVector(d, 0.5); thread.scale.set(1, l, 1); thread.quaternion.setFromUnitVectors(up, d.normalize());
      }
    }
    if (cursor && cursor.drag) {
      const { a, b } = cursor.drag, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      drag.position.set(...toV((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, cursor.h - 0.01));
      drag.rotation.set(Math.PI / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), 0, 'YXZ');
      const hl = (l + 0.3) / 2, hw = 0.18; drag.scale.set(2 * (hl + 0.06), 2 * (hw + 0.06), 1); dragMat.uniforms.hs.value.set(hl, hw);
      dragMat.uniforms.A.value = 0.8 + 0.2 * Math.sin(t * 4);
    }
    out.length = 0;
    shades.forEach((s, k) => {
      const e = Math.min(1, s.body.scale.y);
      if (e <= 0.01) return;
      out.push({ s, power: 0.5 * lightK * e * (cursor && cursor.over === s.id ? 0.6 : 1), range: s.range });
    });
  }
  // the lights they throw on the real room: down from each shade, wide but never up at the ceiling round it
  const out = [], lw = [];
  function relights() {
    root.updateMatrixWorld();
    while (lw.length < out.length) lw.push({ at: new THREE.Vector3(), colour: 0xffc690, range: 0, power: 0, dir: new THREE.Vector3(0, -1, 0), cone: 0.05 });
    return out.map((o, i) => { const w = lw[i]; w.at.copy(o.s.glowAt).applyMatrix4(o.s.g.matrixWorld); w.range = o.range; w.power = o.power; return w; });
  }
  function dispose() { clear(); parent.remove(root); }
  return { root, update, relights, dispose, count: () => lastLights.length };
}

// The aim of the player marking the lights (the board's Lights), the same on every page: worked out from that player's head and hands (presence,
// in the common frame) with the engine's LightMarker. R: the engine's room (MUMR.room); eye: [x, y, z] -> { cursor (for update), done (the event
// the marking player's own page sends, once) }
export function markCursor(R, marker, eye, sources, h, lights, nowMs) {
  const r = marker.update(eye, sources, h, lights, nowMs);
  let tip = null, best = -Infinity;
  for (const s of sources || []) { const p = R.pinchPoint(s); if (!p || !R.aimUp(eye, p, h)) continue; const sc = (s.pinch ? 10 : 0) + p[2]; if (sc > best) { best = sc; tip = p; } }
  return { cursor: r.aim ? { aim: r.aim, drag: r.drag, over: r.over ? r.over.id : null, tip, h } : null, done: r.done };
}
