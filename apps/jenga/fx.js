// The moments of the game, drawn (an ES module; THREE is handed in): what draws the eye and what answers a move. Everything here follows the shared
// state, the host's bodies and the server's clock (rule 1: the same light in the same place on every headset); nothing is decided on one page.
//
//   the pulled block         a gold light on its edges (a fresnel glow), the held one a soft white, the one that toppled it vermilion and beating
//   the limit                a thin band of gold light round the tower at the highest level a block may be taken from
//   the die's turn           the tray's felt breathes with light and the die glows; a roll sends a ring of its colour across the tray
//   a block on top           a ring of light rises off the top (gold and sparks for a good move, pale for a move, grey for a foul)
//   the fall                 the floor ripples out from the tower, a puff of sawdust where the first block lands, the trail of that block
//                            as a ribbon of light, and words of light circling above the tower (TIMBER, REWIND, REPLAY), with a ring that
//                            fills as the replay goes on
//   whose turn               a ring of light in the player's colour on the floor where that player stands (from everybody's presence)
//   arriving                 the game put down somewhere new: light spreads from the plinth across the floor and over the sand
//   the air                  motes of dust drifting in the lantern's light. They live on the WORLD's clock: it stops when the tower falls
//                            and everything freezes, runs back with the rewind and slowly with the replay, so the dust does what the blocks do
import { glow, softRing, rand } from './textures.js';
import { FONT } from './look.js';

const S = window.JENGA;
const toV = (p) => [p[0], p[2], -p[1]];
const SPAN = 2.0;                                                          // (seconds the replay goes back: replay.js window)

export function createFx({ THREE, overlay, own }) {
  const game = new THREE.Group(); overlay.add(game);                       // in the game frame (moved with the furniture)
  const at = (gx, gy, gz) => [gx, gz, -gy];
  const tGlow = own(glow(THREE)), tRing = own(softRing(THREE));
  const add = (o, p = game) => { p.add(o); return o; };
  const basic = (o) => own(new THREE.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }, o)));

  // ---- edge glows (fresnel) on a block or the die
  const shellMat = (colour) => own(new THREE.ShaderMaterial({
    uniforms: { colour: { value: new THREE.Color(colour) }, strength: { value: 1 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 colour; uniform float strength; varying vec3 vN; varying vec3 vV; void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = (pow(f, 3.0) * 1.2 + 0.03) * strength; gl_FragColor = vec4(colour * a, 1.0);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const shells = {};
  for (const [k, c] of [['handled', 0xffc46a], ['held', 0xfff3e0], ['culprit', 0xff4a24], ['die', 0xffc46a]]) { const m = new THREE.Mesh(new THREE.BufferGeometry(), shellMat(c)); m.visible = false; m.renderOrder = 4; overlay.add(m); shells[k] = m; }
  const shellOn = (k, mesh, strength, grow = 1.07) => {
    const s = shells[k];
    if (!mesh || !mesh.visible) { s.visible = false; return; }
    s.visible = true; s.geometry = mesh.geometry; s.position.copy(mesh.position); s.quaternion.copy(mesh.quaternion); s.scale.setScalar(grow); s.material.uniforms.strength.value = strength;
  };

  // ---- the limit: four strips of soft gold light round the tower
  const bandTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.42, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.58, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64); return own(new THREE.CanvasTexture(c)); })();
  const limit = add(new THREE.Group()), bandMat = basic({ map: bandTex, color: 0xffc879, opacity: 0.8 });
  for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), bandMat); m.userData.k = k; limit.add(m); }
  const beads = []; const beadMat = own(new THREE.SpriteMaterial({ map: tGlow, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
  for (let k = 0; k < 4; k++) { const s = new THREE.Sprite(beadMat); limit.add(s); beads.push(s); }

  // ---- the tray's light, and the rings (a roll, a block on top, the floor at the fall, the sand at the start)
  const trayGlow = add(new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), basic({ map: tGlow, color: 0xffb35c, opacity: 0 }))); trayGlow.rotation.x = -Math.PI / 2;
  const rings = [];                                       // { mesh, start, dur, from, to, opacity, clockOf: 'real' | 'world' }
  const ringPool = Array.from({ length: 6 }, () => { const m = add(new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), basic({ map: tRing, opacity: 0 }))); m.rotation.x = -Math.PI / 2; m.visible = false; return m; });
  function ring(o) { const m = ringPool.find((q) => !rings.some((r) => r.mesh === q)) || ringPool[0]; m.visible = true; m.material.color.set(o.colour); m.position.set(...at(o.p[0], o.p[1], o.p[2])); rings.push(Object.assign({ mesh: m }, o)); }
  // ---- sparks (a good move) and sawdust (the fall)
  const sparkMat = own(new THREE.SpriteMaterial({ map: tGlow, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const sparks = Array.from({ length: 16 }, () => { const s = add(new THREE.Sprite(sparkMat.clone())); own(s.material); s.visible = false; return s; });
  let sparkAt = -1e9, sparkFrom = null, sparkSeed = 1;
  const dustTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(235,215,180,0.9)'); gr.addColorStop(0.5, 'rgba(225,200,160,0.35)'); gr.addColorStop(1, 'rgba(220,195,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = own(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const dust = Array.from({ length: 34 }, () => { const s = add(new THREE.Sprite(own(new THREE.SpriteMaterial({ map: dustTex, depthWrite: false, transparent: true, opacity: 0 })))); s.visible = false; return s; });
  let dustAt = null, dustFrom = null, dustSeed = 1;

  // ---- the words of the fall: a band of light circling above the tower; under it the ring of the replay's progress
  const wordsCv = document.createElement('canvas'); wordsCv.width = 2048; wordsCv.height = 128;
  const wordsTex = own(new THREE.CanvasTexture(wordsCv)); wordsTex.colorSpace = THREE.SRGBColorSpace; wordsTex.anisotropy = 8;
  // (only the half of the band that faces the viewer is drawn: the far half would read backwards through it)
  const wordsMat = own(new THREE.ShaderMaterial({
    uniforms: { map: { value: wordsTex }, colour: { value: new THREE.Color(0xffe2b8) }, opacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 colour; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float face = smoothstep(0.05, 0.45, dot(normalize(vN), normalize(vV))); vec4 t = texture2D(map, vUv); gl_FragColor = vec4(colour * t.rgb * t.a * opacity * face, 1.0);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const words = add(new THREE.Mesh(own(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true)), wordsMat));
  words.renderOrder = 6; words.visible = false;
  const arcMat = own(new THREE.ShaderMaterial({
    uniforms: { colour: { value: new THREE.Color(0xffd08a) }, p: { value: 0 }, a: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 colour; uniform float p; uniform float a; varying vec2 vP; void main() { float ang = atan(vP.y, vP.x) / 6.2831853 + 0.5; if (ang > p) discard; float r = length(vP); float e = exp(-pow((r - 1.0) / 0.012, 2.0)); float head = smoothstep(p - 0.04, p, ang); gl_FragColor = vec4(colour * e * a * (0.6 + 0.8 * head), 1.0);\n#include <colorspace_fragment>\n}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const arc = add(new THREE.Mesh(own(new THREE.RingGeometry(0.95, 1.05, 128, 1)), arcMat)); arc.rotation.x = -Math.PI / 2; arc.visible = false; arc.renderOrder = 6;
  let wordsKey = null, wordsA = 0, fontsDrawn = -1;
  function drawWords(text) {
    const g = wordsCv.getContext('2d'), W = 2048, H = 128; g.clearRect(0, 0, W, H);
    g.font = `700 82px ${FONT.head}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    const unit = `${text}   ·   `, uw = g.measureText(unit).width, n = Math.max(1, Math.round(W / uw)), sc = W / (uw * n);
    g.save(); g.scale(sc, 1);
    g.shadowColor = 'rgba(255,190,110,0.9)'; g.shadowBlur = 18; g.fillStyle = '#fff4e2';
    for (let k = 0; k < n; k++) g.fillText(unit, k * uw, H / 2 + 4);
    g.restore(); wordsTex.needsUpdate = true;
  }
  // ---- the ribbon of the block that toppled it
  const trailMat = basic({ color: 0xff7a3c, opacity: 0.85, side: THREE.FrontSide });
  const trail = new THREE.Mesh(new THREE.BufferGeometry(), trailMat); trail.visible = false; trail.renderOrder = 5; overlay.add(trail);
  let trailKey = null;

  // ---- whose turn: a ring on the floor at that player's feet (common frame), and a faint pool inside it
  const turnRing = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), basic({ map: tRing, opacity: 0 })); turnRing.rotation.x = -Math.PI / 2; turnRing.renderOrder = 2; overlay.add(turnRing);
  const turnPool = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), basic({ map: tGlow, opacity: 0 })); turnPool.rotation.x = -Math.PI / 2; turnPool.renderOrder = 2; overlay.add(turnPool);
  let turnAt = null, turnA = 0, turnSlot = null;

  // ---- the motes in the air (game frame), on the world's clock
  const NM = 70, mr = rand(4242), mb = Array.from({ length: NM }, () => ({ x: -1.45 + mr() * 1.95, y: -0.45 + mr() * 1.7, z: 0.15 + mr() * 1.55, f: [0.05 + mr() * 0.08, 0.04 + mr() * 0.07, 0.03 + mr() * 0.05], ph: [mr() * 6.3, mr() * 6.3, mr() * 6.3], a: 0.04 + mr() * 0.08, tw: 0.4 + mr() * 1.4, s: mr() }));
  const mGeo = new THREE.BufferGeometry(), mPos = new Float32Array(NM * 3), mCol = new Float32Array(NM * 3);
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3)); mGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 3)); own(mGeo);
  const motes = add(new THREE.Points(mGeo, own(new THREE.PointsMaterial({ size: 0.007, map: tGlow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }))));
  motes.frustumCulled = false;
  // the world's clock: the server's, but stopped at the fall, run back with the rewind, slowly with the replay; it catches up after
  let T0 = null, liveAt = null, offset = 0, worldPrev = 0;
  function worldClock(ts, state, snap, dt) {
    const falling = state.phase === 'fall' || state.phase === 'replay', mode = snap ? snap.mode : 0, pr = snap ? snap.progress : 0;
    let c;
    if (falling) {
      if (T0 === null) { T0 = worldPrev || ts; liveAt = null; }
      if (mode === 2) c = T0 - SPAN * (pr * pr * (3 - 2 * pr));
      else if (mode === 3) c = T0 - SPAN + SPAN * pr;
      else if (mode === 4) { if (liveAt === null) liveAt = ts; c = T0 + (ts - liveAt); }
      else c = T0;
    } else {
      if (T0 !== null) { offset = worldPrev - ts; T0 = null; }
      offset *= Math.exp(-dt / 2.5);
      c = ts + offset;
    }
    worldPrev = c;
    return c;
  }

  let lastPhase = null, phaseAt = 0, lastFallRev = null;
  function update({ state, snap, t, dt, blocks, dieMesh, L, place, moments, fonts, lampAt, heads = [], colours = [] }) {
    const d = L.d, T = L.plinth.top, k = d.k, ph = state.phase, mode = snap ? snap.mode : 0;
    game.position.set(place.x, 0, -place.y); game.rotation.set(0, place.yaw, 0);
    if (ph !== lastPhase) { lastPhase = ph; phaseAt = t; }
    const since = t - phaseAt, wc = worldClock(t, state, snap, dt);
    const playing = ['roll', 'pull', 'place'].includes(ph);
    // -- the glows on the blocks
    let handled = null, culprit = null, held = null, dieHeld = false;
    if (snap) for (const it of snap.items) { if (it.i === S.DIE) { dieHeld = !!(it.flags & S.F.held); continue; } if (it.flags & S.F.handled) handled = it; if (it.flags & S.F.culprit) culprit = it; if ((it.flags & S.F.held) && !held) held = it; }
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.2);
    shellOn('handled', playing && handled ? blocks[handled.i] : null, 0.75 + 0.25 * breathe);
    shellOn('held', held && !(handled && handled.i === held.i) ? blocks[held.i] : null, 0.45);
    shellOn('culprit', culprit ? blocks[culprit.i] : null, 0.9 + 0.6 * (0.5 + 0.5 * Math.sin(t * 7)), 1.1);
    shellOn('die', ph === 'roll' && !dieHeld ? dieMesh : null, 0.1 + 0.14 * breathe, 1.05);
    // -- the limit
    const full = state.tower ? state.tower.full : 17, ly = T + full * d.H + 0.0012 * k, hx = d.L * 0.6;
    limit.visible = playing && full >= 0 && full < 22;
    if (limit.visible) {
      const bh = d.H * 0.8;
      limit.children.forEach((m) => {
        if (m.isSprite) return;
        const kk = m.userData.k, ang = kk * Math.PI / 2;
        m.scale.set(2 * hx, bh, 1); m.position.set(...at(Math.cos(ang) * hx, Math.sin(ang) * hx, ly)); m.rotation.set(0, -ang + Math.PI / 2, 0);
      });
      beads.forEach((s, i) => { const a = Math.PI / 4 + i * Math.PI / 2; s.position.set(...at(Math.cos(a) * hx * Math.SQRT2, Math.sin(a) * hx * Math.SQRT2, ly)); s.scale.setScalar(d.H * 0.8 * (0.8 + 0.3 * breathe)); });
      bandMat.opacity = 0.45 + 0.25 * Math.sin(t * 1.6);
    }
    // -- the tray
    const Tr = L.tray, trayOn = ph === 'roll';
    trayGlow.position.set(...at(Tr.c[0], Tr.c[1], L.console.top + 0.003)); trayGlow.scale.setScalar(Tr.half * 2.1);
    trayGlow.material.opacity += ((trayOn ? 0.2 + 0.14 * breathe : 0) - trayGlow.material.opacity) * Math.min(1, dt * 4);
    // -- the moments
    const topY = T + ((state.tower ? state.tower.top : 17) + 1) * d.H;
    for (const m of moments) {
      if (m === 'rolled' && state.roll !== null && state.roll !== undefined) ring({ p: [Tr.c[0], Tr.c[1], L.console.top + 0.004], colour: S.COLOURS[state.roll].hex, start: t, dur: 1.5, from: 0.04, to: Tr.half * 2.2, opacity: 0.9 });
      if (m === 'placedWell' || m === 'placed' || m === 'placedBad') {
        const good = m === 'placedWell', bad = m === 'placedBad';
        ring({ p: [0, 0, topY], colour: good ? 0xffc46a : bad ? 0x6a7a90 : 0xfff0d8, start: t, dur: good ? 1.8 : 1.4, from: d.L * 0.5, to: d.L * (good ? 3.2 : 2.4), opacity: bad ? 0.5 : 0.85 });
        if (good) { sparkAt = t; sparkFrom = topY; sparkSeed = state.rev; }
      }
      if (m === 'start') ring({ p: [0, 0, T + 0.001], colour: 0xffd08a, start: t, dur: 2.6, from: d.L * 0.4, to: L.plinth.half * 2.4, opacity: 0.7 });
      if (m === 'arrived') {                              // (the game put down somewhere new: light spreads from it across the floor, and over the sand)
        ring({ p: [0, 0, 0.004], colour: 0xffcf8a, start: t, dur: 2.2, from: L.plinth.half * 0.8, to: L.plinth.half * 3 + 1.4, opacity: 0.55 });
        ring({ p: [0, 0, T + 0.001], colour: 0xffd08a, start: t + 0.15, dur: 2.0, from: d.L * 0.4, to: L.plinth.half * 2.4, opacity: 0.6 });
      }
    }
    // the fall: a ripple across the floor and the sawdust, on the world's clock (they stop with it, run back and come again in the replay)
    if (ph === 'fall' && lastFallRev !== state.rev && culprit && T0 !== null && dustAt === null) {
      lastFallRev = state.rev;
      const c = S.fromCommon(place, culprit.p);
      dustAt = T0; dustFrom = [c[0], c[1], Math.max(0, c[2] - d.H * 0.4)]; dustSeed = state.rev + (state.seed || 0);
      ring({ p: [0, 0, 0.004], colour: 0xffd9a0, start: T0, dur: 1.4, from: L.plinth.half * 0.5, to: L.plinth.half * 4 + 0.6, opacity: 0.6, world: true });
    }
    if (!['fall', 'replay', 'aftermath'].includes(ph)) dustAt = null;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i], u = ((r.world ? wc : t) - r.start) / r.dur;
      if (u > 1) { r.mesh.visible = false; rings.splice(i, 1); continue; }           // (before its start it waits, unseen: a ring to come, or the world's clock run back)
      const e = 1 - Math.pow(1 - Math.max(0, u), 3);
      r.mesh.visible = u >= 0; r.mesh.scale.setScalar(r.from + (r.to - r.from) * e); r.mesh.material.opacity = r.opacity * Math.pow(1 - Math.max(0, u), 1.6);
    }
    // sparks rising off the top
    const su = (t - sparkAt) / 1.8;
    sparks.forEach((s, i) => {
      s.visible = su >= 0 && su < 1;
      if (!s.visible) return;
      const r = rand(sparkSeed * 31 + i), a = r() * Math.PI * 2, rad = d.L * (0.4 + r() * 0.9), rise = (0.05 + r() * 0.12) * Math.sqrt(k), e = 1 - Math.pow(1 - su, 2);
      s.position.set(...at(Math.cos(a) * rad * (0.6 + 0.6 * e), Math.sin(a) * rad * (0.6 + 0.6 * e), sparkFrom + rise * e));
      s.scale.setScalar(0.012 * Math.sqrt(k) * (1 - su * 0.6)); s.material.opacity = Math.pow(1 - su, 1.5) * (0.6 + 0.4 * Math.sin(t * 20 + i));
    });
    // sawdust
    const du = dustAt === null ? -1 : (wc - dustAt) / 2.6;
    dust.forEach((s, i) => {
      s.visible = du >= 0 && du < 1;
      if (!s.visible) return;
      const r = rand(dustSeed * 17 + i), a = r() * Math.PI * 2, sp = (0.08 + r() * 0.25) * Math.sqrt(k), up = (0.02 + r() * 0.1) * Math.sqrt(k), e = 1 - Math.exp(-du * 4);
      s.position.set(...at(dustFrom[0] + Math.cos(a) * sp * e, dustFrom[1] + Math.sin(a) * sp * e, dustFrom[2] + up * e - 0.04 * du * du * Math.sqrt(k)));
      s.scale.setScalar((0.02 + 0.07 * e) * Math.sqrt(k) * (0.6 + r()));
      s.material.opacity = 0.55 * Math.pow(1 - du, 1.4) * Math.min(1, du * 12);
    });
    // the words and the replay's ring
    let text = null;
    if (ph === 'fall') text = 'TIMBER';
    else if (ph === 'replay') text = mode === 2 ? 'REWIND' : mode === 4 ? 'TIMBER' : 'REPLAY  ·  0.3×';
    else if (ph === 'aftermath') { const who = state.fall ? (state.players.find((p) => p.slot === state.fall.by) || {}).name : ''; text = who ? `${who.toUpperCase()} TOPPLED IT` : 'THE TOWER FELL'; }
    const wantA = text ? 1 : 0;
    wordsA += (wantA - wordsA) * Math.min(1, dt * (wantA ? 3 : 1.5));
    words.visible = wordsA > 0.01;
    if (text && (text !== wordsKey || fonts !== fontsDrawn)) { wordsKey = text; fontsDrawn = fonts; drawWords(text); }
    const R = Math.max(0.14, d.L * 0.95), wy = T + d.height + Math.max(0.16, d.L * 0.9);
    if (words.visible) {
      const hgt = (2 * Math.PI * R) / 16;
      words.scale.set(R, hgt, R); words.position.set(...at(0, 0, wy)); words.rotation.y = -t * 0.22;
      wordsMat.uniforms.opacity.value = wordsA * (ph === 'aftermath' ? Math.max(0, 1 - since / 6) : 1) * (mode === 2 ? 0.8 : 1);
      wordsMat.uniforms.colour.value.set(mode === 2 ? 0xbfd8ff : 0xffe2b8);
    }
    let p = 0;
    if (ph === 'fall') p = Math.min(1, snap && mode === 1 ? snap.progress : 1);
    else if (ph === 'replay') p = mode === 2 ? 1 - snap.progress : mode === 3 ? snap.progress : 1;
    arc.visible = words.visible;
    if (arc.visible) { arc.position.set(...at(0, 0, wy - (2 * Math.PI * R) / 16 * 0.75)); arc.scale.setScalar(R); arcMat.uniforms.p.value = p; arcMat.uniforms.a.value = wordsA * (ph === 'aftermath' ? Math.max(0, 1 - since / 3) : 1); arcMat.uniforms.colour.value.set(mode === 2 ? 0xa8ccff : 0xffd08a); }
    // the trail
    const tr = ['fall', 'replay'].includes(ph) && state.fall && state.fall.trail;
    trail.visible = !!tr && tr.length > 1;
    if (trail.visible) {
      const tk = `${state.rev}|${tr.length}`;
      if (tk !== trailKey) {
        trailKey = tk; trail.geometry.dispose();
        const pts = tr.map((q) => new THREE.Vector3(...toV(q)));
        trail.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 3), 0.0016 * Math.sqrt(k), 6, false);
      }
      trailMat.opacity = 0.55 + 0.3 * Math.sin(t * 5);
    }
    // whose turn
    const onTurn = playing && state.players[state.turn] ? state.players[state.turn].slot : null, hd = onTurn === null ? null : heads.find((q) => q.slot === onTurn);
    if (hd) {
      if (!turnAt || turnSlot !== onTurn) { turnAt = [hd.x, hd.y]; turnSlot = onTurn; }
      const kk = Math.min(1, dt * 4); turnAt[0] += (hd.x - turnAt[0]) * kk; turnAt[1] += (hd.y - turnAt[1]) * kk;
      const col = colours[onTurn % Math.max(1, colours.length)] || 0xffd08a;
      turnRing.material.color.set(col); turnPool.material.color.set(col);
    }
    turnA += ((hd ? 1 : 0) - turnA) * Math.min(1, dt * 2.5);
    turnRing.visible = turnPool.visible = turnA > 0.01 && !!turnAt;
    if (turnRing.visible) {
      const p = toV([turnAt[0], turnAt[1], 0.005]), br = 0.5 + 0.5 * Math.sin(t * 1.8);
      turnRing.position.set(...p); turnRing.scale.setScalar(0.62 + 0.03 * br); turnRing.material.opacity = turnA * (0.45 + 0.2 * br);
      turnPool.position.set(p[0], p[1] - 0.001, p[2]); turnPool.scale.setScalar(0.7); turnPool.material.opacity = turnA * 0.12;
    }
    // the motes
    const lp = lampAt || [-0.9, 0.8, 0.4];
    for (let i = 0; i < NM; i++) {
      const b = mb[i], x = b.x + b.a * Math.sin(wc * b.f[0] * 6.3 + b.ph[0]), y = b.y + b.a * Math.sin(wc * b.f[1] * 6.3 + b.ph[1]), z = b.z + b.a * 0.7 * Math.sin(wc * b.f[2] * 6.3 + b.ph[2]) + 0.02 * Math.sin(wc * 0.11 + b.s * 9);
      mPos[i * 3] = x; mPos[i * 3 + 1] = z; mPos[i * 3 + 2] = -y;
      const dl = (x - lp[0]) ** 2 + (y - lp[1]) ** 2 + (z - lp[2]) ** 2, lit = 0.12 + 1.1 * Math.exp(-dl / 0.35), tw = 0.55 + 0.45 * Math.sin(wc * b.tw * 2 + b.ph[0]);
      mCol[i * 3] = lit * tw; mCol[i * 3 + 1] = lit * tw * 0.78; mCol[i * 3 + 2] = lit * tw * 0.5;
    }
    mGeo.attributes.position.needsUpdate = true; mGeo.attributes.color.needsUpdate = true;
  }
  function dispose() { trail.geometry.dispose(); overlay.remove(game); for (const s of Object.values(shells)) overlay.remove(s); overlay.remove(trail, turnRing, turnPool); }
  return { update, dispose, clock: () => worldPrev };
}
