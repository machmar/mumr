// The room's dim drawn (dim.js): one layer over the whole view, drawn after the hand cutouts and before everything else, so it darkens and
// greys only what is behind the virtual world: the passthrough on a headset (the layer's alpha lets less of it through), the camera's picture
// on a webcam page (drawn over the scene's background, or into the lens pass's target, which keeps colours weighted by coverage the same way).
// It stays in the opaque list (custom blending) so that it is drawn first and never over a virtual thing.
//   over hands false: it is drawn at the far end of the depth range and tested, so the hand cutouts (handmask.js, depth only, drawn
//   before it) keep it off the real hands; true (or a page with no cutouts: cutouts: false): it covers everything.
//
//   const dim = createDim3d({ THREE, scene, cutouts }); every frame dim.update(level)   (level: M.dim.level(doc.dim, serverNow))
//
// RELIGHT (dim.js reach, relit): the lights of the virtual world light the real room. The real surfaces (the room scan's walls, floor, table tops
// and tops of furniture; with no scan a floor round the player) draw the layer themselves, lit: at each point a' = a (1 - s), c' = c (1 - s) +
// the light's colour (premultiplied, the usual blending), so a lantern by a wall throws its light on the real wall: the dim lifts round it and the
// wall warms; with no dim only the warm light is laid on, faintly. They are drawn at the far end of the depth range (a hair nearer than the layer,
// and kept off the hand cutouts like it), and the layer is then drawn only where they did not draw (the depth test).
// It is right on a headset, over a desktop page's background and over a webcam's picture alike (nothing is taken back from what is behind).
//   Each pixel once: where two surfaces are in the same place in the picture (a table top and the floor behind it) only the nearer draws, as
//   twice would dim the room twice there. They go in order, nearest first (furniture, then door and window frames, then walls, then floor and
//   ceiling, each kind nearest the eye first: a frame late), each a step further back in depth than the one before and testing it (less), so a
//   surface behind one that has drawn does not. A door or window frame draws the layer unlit (its light is the next room's, not ours).
//   Shadows (dim.js block, seen): the room's solid things (room.js boxes) stand in the lights' way, so the floor under a table stays dark.
//   Order: the hand cutouts, the surfaces, the layer. When the layer covers the hands too (over), the surfaces go before the cutouts, so that
//   they dim a hand as they dim what is behind it, and the cutouts still hide the virtual world behind a real hand.
//   dim.surfaces(room, parent)   room: room.js { planes } in the floor plan of `parent` (THREE (x, h, -y)), or null (a floor only); redrawn
//                                only when the room object or the parent changes
//   dim.lights(list)             this frame's lights, [{ at: THREE.Vector3 (world), colour (hex), range (m), power (0..1), size (m: its
//                                radius, how soft its shadows are; 0.05), dir, cone }]; at most 8, the strongest; [] for none. dir (THREE.Vector3,
//                                world, unit) and cone (a cosine): a light that shines one way only (dim.js spot), e.g. down from a shade under
//                                the ceiling; without them, every way
export function createDim3d({ THREE, scene, cutouts = true }) {
  const u = { a: { value: 0 }, c: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, depthWrite: false, toneMapped: false, depthFunc: THREE.LessDepth,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.99999, 1.0); }',          // (the whole view, each eye's; at the far end of the depth range)
    fragmentShader: 'uniform float a; uniform float c;\nvoid main() { gl_FragColor = vec4(vec3(c), a); }',     // (premultiplied: out = c + behind * (1 - a))
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -99; mesh.visible = false; mesh.name = 'dim';
  scene.add(mesh);
  const D = window.MUMR.dim, SH = D.SHADE;
  // ---- the relight: the real surfaces, drawn with the lights
  // (Z0, ZSTEP: the surfaces' depths, nearest first, all nearer than the layer; a step is a few steps of a 24-bit depth buffer, so that rounding
  // never puts a later surface in front of an earlier one)
  const MAXL = 8, MAXB = 31, Z0 = 0.9999, ZSTEP = 5e-7, MAXRANK = 150;
  const lp = Array.from({ length: MAXL }, () => new THREE.Vector3()), lc = Array.from({ length: MAXL }, () => new THREE.Color()), lr = Array.from({ length: MAXL }, () => new THREE.Vector3());
  const lw = Array.from({ length: MAXL }, () => new THREE.Vector3());          // (where the lights are in the world; lp: in the parent's axes)
  const ld = Array.from({ length: MAXL }, () => new THREE.Vector4(0, -1, 0, -2)), dw = Array.from({ length: MAXL }, () => new THREE.Vector3(0, -1, 0));          // (the way it shines and its cone's cosine; -2: every way; dw: the way in the world)
  const bc = Array.from({ length: MAXB }, () => new THREE.Vector4()), bh = Array.from({ length: MAXB }, () => new THREE.Vector4()), bm = new Array(MAXL).fill(0);
  const ru = { lp: { value: lp }, lc: { value: lc }, lr: { value: lr }, ld: { value: ld }, n: { value: 0 }, bc: { value: bc }, bh: { value: bh }, nb: { value: 0 }, bm: { value: bm },
    tint: { value: 0.2 }, warm: { value: 0.35 }, lin: { value: 0 }, a: { value: 0 }, c: { value: 0 } };
  const f = (v) => v.toFixed(6);
  const rmat = new THREE.ShaderMaterial({
    uniforms: ru, depthWrite: true, depthFunc: THREE.LessDepth, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // (lit where the surface really is, in the parent's axes; drawn at the far end of the depth range, its own step back for its place in the order)
    vertexShader: `attribute float rk; attribute float lit; varying vec3 vP; varying vec3 vN; varying float vLit;
      void main() { vP = position; vN = normal; vLit = lit; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = (${f(Z0)} + rk * ${ZSTEP.toExponential()}) * gl_Position.w; }`,
    // (dim.js reach for each light, less what the boxes keep from it (dim.js block), then relit; in a linear target the numbers are turned as the layer's are)
    fragmentShader: `uniform vec3 lp[${MAXL}]; uniform vec3 lc[${MAXL}]; uniform vec3 lr[${MAXL}]; uniform vec4 ld[${MAXL}]; uniform int n; uniform vec4 bc[${MAXB}]; uniform vec4 bh[${MAXB}]; uniform int nb; uniform int bm[${MAXL}];
      uniform float tint; uniform float warm; uniform float lin; uniform float a; uniform float c; varying vec3 vP; varying vec3 vN; varying float vLit;
      vec3 toLin(vec3 v) { return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), v)); }
      // dim.js block in THREE's axes: a box's own axes are (along, up, across), its half sizes h; C (centre, cos), H (half along, half across, half up, sin)
      float block(vec3 p, vec3 l, vec4 C, vec4 H, float size) {
        vec3 a = p - C.xyz, b = l - C.xyz, h = H.xzy;
        vec3 P = vec3(a.x * C.w - a.z * H.w, a.y, -a.x * H.w - a.z * C.w), L = vec3(b.x * C.w - b.z * H.w, b.y, -b.x * H.w - b.z * C.w);
        if (all(lessThan(abs(P), h + ${f(SH.INSIDE)})) || all(lessThan(abs(L), h + ${f(SH.INSIDE)}))) return 0.0;
        vec3 d = L - P; float dd = max(dot(d, d), 1e-12), len = sqrt(dd);
        float t0 = clamp(-dot(P, d) / dd, 0.0, 1.0), w = clamp(size * t0 * len / max((1.0 - t0) * len, 0.05), 0.003, 0.3);
        vec3 thin = step(h, vec3(${f(SH.THIN)})), e = h + w * (1.0 - thin);
        vec3 sg = vec3(d.x < 0.0 ? -1.0 : 1.0, d.y < 0.0 ? -1.0 : 1.0, d.z < 0.0 ? -1.0 : 1.0), inv = sg / max(abs(d), vec3(1e-9));
        vec3 ta = (-e - P) * inv, tb = (e - P) * inv, tn = min(ta, tb), tf = max(ta, tb);
        float t1 = max(max(tn.x, tn.y), max(tn.z, 0.0)), t2 = min(min(tf.x, tf.y), min(tf.z, 1.0));
        if (t2 <= t1) return 0.0;
        vec3 deep = mix(e - abs(P + d * (0.5 * (t1 + t2))), vec3(1e3), thin);
        return smoothstep(0.0, 2.0 * w, min(deep.x, min(deep.y, deep.z)));
      }
      void main() {
        float s = 0.0; vec3 col = vec3(0.0), N = normalize(vN);
        for (int i = 0; i < ${MAXL}; i++) {
          if (i >= n) break;
          vec3 d = lp[i] - vP; float r = length(d), f = clamp(1.0 - r / lr[i].x, 0.0, 1.0), g = f * f * (3.0 - 2.0 * f);
          float k = lr[i].y * g * g * (0.35 + 0.65 * min(1.0, abs(dot(N, d / max(r, 1e-4)))));
          if (ld[i].w > -1.5) { float lo = ld[i].w, hi = lo + 0.35 * (1.0 - lo), t = clamp((dot(-d / max(r, 1e-4), ld[i].xyz) - lo) / max(1e-6, hi - lo), 0.0, 1.0); k *= t * t * (3.0 - 2.0 * t); }
          for (int j = 0; j < ${MAXB}; j++) {
            if (j >= nb || k <= 0.0) break;
            if (((bm[i] >> j) & 1) == 1) k *= 1.0 - block(vP, lp[i], bc[j], bh[j], lr[i].z);
          }
          s += k; col += lc[i] * k;
        }
        s *= vLit; col *= vLit;
        float keep = 1.0 - min(s, ${D.RELIT_MAX.toFixed(2)});
        float a2 = a * keep; vec3 c2 = vec3(c * keep) + col * tint;
        // (a warm veil: near a light part of what is behind takes that light's colour, so a white real room turns amber round a lamp instead of only
        //  having a little warm light laid on it: Marek, 2026-10-29)
        float wv = warm * min(1.0, s); vec3 hue = col / max(s, 1e-4);
        c2 += hue * 0.62 * wv * (1.0 - a2); a2 += wv * (1.0 - a2);
        if (lin > 0.5) { float through = pow(1.0 - a2, 2.2); vec3 g2 = a2 > 0.0 ? toLin(vec3(c * keep) / a2) * (1.0 - through) : vec3(0.0); c2 = g2 + toLin(col * tint); a2 = 1.0 - through; }
        gl_FragColor = vec4(c2, a2);
      }`,
  });
  const surf = new THREE.Mesh(new THREE.BufferGeometry(), rmat);
  surf.frustumCulled = false; surf.renderOrder = -99.5; surf.visible = false; surf.name = 'relight';
  let surfRoom, surfParent = null, lightN = 0, levelA = 0, boxShadows = true, maxLights = MAXL;
  let planes = [], boxes = [], order = '';      // planes: { tier, first, count, lo, hi } (the parent's axes); boxes: room.js boxes in the parent's axes
  // a plane of the scan as triangles (a fan: the scan's outlines are convex), with its normal
  function planeTris(q, out, nrm) {
    const v = q.map((p) => [p[0], p[2], -p[1]]);
    const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let i = 1; i + 1 < v.length; i++) for (const p of [v[0], v[i], v[i + 1]]) { out.push(p[0], p[1] + 0.003, p[2]); nrm.push(nx, ny, nz); }
  }
  const TIER = { table: 0, solid: 0, opening: 1, wall: 2, floor: 3, ceiling: 3 };
  function surfaces(room, parent) {
    if (room === surfRoom && parent === surfParent) return;
    surfRoom = room;
    if (parent !== surfParent) { if (surf.parent) surf.parent.remove(surf); surfParent = parent || null; (parent || scene).add(surf); }
    const pos = [], nrm = [], lit = [], R = window.MUMR.room;
    planes = [];
    const plane = (tier, unlit, add) => {
      const first = pos.length / 3; add(); const count = pos.length / 3 - first;
      if (!count) return;
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = first; i < first + count; i++) { lo.min(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])); hi.max(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])); lit.push(unlit ? 0 : 1); }
      planes.push({ tier, first, count, lo, hi });
    };
    let floor = false;
    for (const pl of (room && room.planes) || []) {
      if (!pl.p || pl.p.length < 3) continue;
      const k = R.kind(pl);
      if (k === 'floor') floor = true;
      plane(TIER[k] ?? 3, k === 'opening', () => planeTris(pl.p, pos, nrm));
    }
    if (!floor) plane(3, false, () => { const n = 48, r = 8; for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; pos.push(0, 0.003, 0, Math.cos(a1) * r, 0.003, -Math.sin(a1) * r, Math.cos(a0) * r, 0.003, -Math.sin(a0) * r); for (let k = 0; k < 3; k++) nrm.push(0, 1, 0); } });
    boxes = R.boxes(room).map((b) => ({ c: new THREE.Vector3(b.cx, (b.z0 + b.z1) / 2, -b.cy), co: Math.cos(b.ang), si: Math.sin(b.ang), h: [b.hx, b.hy, (b.z1 - b.z0) / 2] }));
    surf.geometry.dispose();
    const g = surf.geometry = new THREE.BufferGeometry(), nv = pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('lit', new THREE.Float32BufferAttribute(lit, 1)); g.setAttribute('rk', new THREE.Float32BufferAttribute(new Float32Array(nv), 1));
    g.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(nv), 1));
    order = ''; sortPlanes(null);
  }
  // the order the surfaces draw in: by kind, then nearest the eye first (eye: in the parent's axes, or null: by kind only)
  const near = new THREE.Vector3();
  function sortPlanes(eye) {
    const key = (p) => p.tier * 1e6 + (eye ? near.copy(eye).clamp(p.lo, p.hi).distanceTo(eye) : 0);
    const by = planes.map((p, i) => [key(p), i]).sort((a, b) => a[0] - b[0]).map((q) => q[1]), now = by.join(',');
    if (now === order) return;
    order = now;
    const g = surf.geometry, idx = g.index.array, rk = g.getAttribute('rk').array;
    let o = 0;
    by.forEach((pi, r) => { const p = planes[pi]; for (let i = p.first; i < p.first + p.count; i++) { idx[o++] = i; rk[i] = Math.min(r, MAXRANK); } });
    g.index.needsUpdate = true; g.getAttribute('rk').needsUpdate = true;
  }
  // a point in a box's own axes (along, up, across), and how far it is from the box
  const boxLocal = (b, p) => { const x = p.x - b.c.x, y = p.y - b.c.y, z = p.z - b.c.z; return [x * b.co - z * b.si, y, -x * b.si - z * b.co]; };
  const boxGap = (b, q) => Math.hypot(Math.max(0, Math.abs(q[0]) - b.h[0]), Math.max(0, Math.abs(q[1]) - b.h[2]), Math.max(0, Math.abs(q[2]) - b.h[1]));
  function lights(list) {
    const L = (list || []).filter((q) => q && q.at && q.range > 0 && q.power > 0).sort((p, q) => q.power - p.power).slice(0, maxLights);
    L.forEach((q, i) => {
      lw[i].copy(q.at); lc[i].set(q.colour === undefined ? 0xffb066 : q.colour); lr[i].set(q.range, Math.min(1, q.power), q.size > 0 ? q.size : SH.SIZE);
      if (q.dir && Number.isFinite(q.cone)) { dw[i].copy(q.dir); ld[i].w = Math.max(-1, Math.min(0.99, q.cone)); } else ld[i].w = -2;
    });
    lightN = ru.n.value = L.length;
  }
  // every frame, as it is drawn: the lights in the parent's axes, the boxes in their reach (the nearest MAXB) and which light each shadows, the order
  const inv = new THREE.Matrix4(), eye = new THREE.Vector3(), dv = new THREE.Vector3();
  let frameDone = -1;
  surf.onBeforeRender = (renderer, sc, camera) => {
    if (renderer.info.render.frame === frameDone || !surf.parent) return;
    frameDone = renderer.info.render.frame;
    inv.copy(surf.parent.matrixWorld).invert();
    for (let i = 0; i < lightN; i++) { lp[i].copy(lw[i]).applyMatrix4(inv); if (ld[i].w > -1.5) { dv.copy(dw[i]).transformDirection(inv); ld[i].set(dv.x, dv.y, dv.z, ld[i].w); } }
    const take = [];
    for (const b of boxes) {
      let mask = 0, gap = Infinity;
      for (let i = 0; i < lightN; i++) { const d = boxGap(b, boxLocal(b, lp[i])); if (d < lr[i].x) { mask |= 1 << i; gap = Math.min(gap, d); } }
      if (mask) take.push({ b, mask, gap });
    }
    take.sort((p, q) => p.gap - q.gap); take.length = Math.min(take.length, MAXB);
    bm.fill(0);
    take.forEach((t, j) => {
      bc[j].set(t.b.c.x, t.b.c.y, t.b.c.z, t.b.co); bh[j].set(t.b.h[0], t.b.h[1], t.b.h[2], t.b.si);
      for (let i = 0; i < lightN; i++) if (t.mask & (1 << i)) bm[i] |= 1 << j;
    });
    ru.nb.value = boxShadows ? take.length : 0;
    sortPlanes(camera.getWorldPosition(eye).applyMatrix4(inv));
  };
  surfaces(null, null);
  // The layer's numbers are the screen's (sRGB), as the headset and the plain webcam page blend. Drawn into a linear target (the lens pass:
  // linear = true) they are turned so that the picture comes out about as dark: what is let through, to the power 2.2, and the grey to linear.
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return {
    mesh, relight: surf, linear: false, surfaces, lights,
    // how much the relight costs (a page's quality): at most `lights` lights, and whether the room's furniture shades them (the dearest part)
    quality({ lights = MAXL, shadows = true } = {}) { maxLights = Math.max(0, Math.min(MAXL, lights | 0)); boxShadows = !!shadows; },
    // how much a light turns the real surfaces round it to its own colour (0: it only adds light; 1: right by it, the surface is the light's colour)
    warmth(v) { ru.warm.value = Math.max(0, Math.min(1, v)); },
    update(level) {
      const l = D.layer(level);
      if (this.linear) { const through = Math.pow(1 - l.a, 2.2); u.a.value = 1 - through; u.c.value = l.a > 0 ? toLin(l.c / l.a) * (1 - through) : 0; }
      else { u.a.value = l.a; u.c.value = l.c; }
      mesh.visible = l.a > 0.002;
      // the lit surfaces draw the layer where they are (only while there is a light: else the layer alone, as it always was); the layer then
      // only where they did not draw, so it tests the depth they leave
      levelA = l.a; ru.a.value = l.a; ru.c.value = l.c; ru.tint.value = 0.1 + 0.3 * levelA; ru.lin.value = this.linear ? 1 : 0;
      surf.visible = lightN > 0;
      surf.renderOrder = cutouts && level.over ? -101 : -99.5;           // (over the hands: before the cutouts, which then still hide what is behind a hand)
      mat.depthTest = surf.visible || (cutouts && !level.over);
    },
  };
}
