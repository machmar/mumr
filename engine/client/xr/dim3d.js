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
// wall warms; with no dim only the warm light is laid on, faintly. They are drawn first, at the far end of the depth range (a hair nearer than the
// layer, and kept off the hand cutouts like it), and the layer is then drawn only where they did not draw (the depth test): one dim, never two.
// It is right on a headset, over a desktop page's background and over a webcam's picture alike (nothing is taken back from what is behind).
//   dim.surfaces(room, parent)   room: room.js { planes } in the floor plan of `parent` (THREE (x, h, -y)), or null (a floor only); redrawn
//                                only when the room object or the parent changes
//   dim.lights(list)             this frame's lights, [{ at: THREE.Vector3 (world), colour (hex), range (m), power (0..1), dir, cone }]; at most
//                                8, the strongest; [] for none. dir (THREE.Vector3, world, unit) and cone (a cosine): a light that shines one
//                                way only (dim.js spot), e.g. down from a shade under the ceiling; without them, every way
export function createDim3d({ THREE, scene, cutouts = true }) {
  const u = { a: { value: 0 }, c: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.99999, 1.0); }',          // (the whole view, each eye's; at the far end of the depth range)
    fragmentShader: 'uniform float a; uniform float c;\nvoid main() { gl_FragColor = vec4(vec3(c), a); }',     // (premultiplied: out = c + behind * (1 - a))
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -99; mesh.visible = false; mesh.name = 'dim';
  scene.add(mesh);
  const D = window.MUMR.dim;
  // ---- the relight: the real surfaces, drawn with the lights
  const MAXL = 8, lp = Array.from({ length: MAXL }, () => new THREE.Vector3()), lc = Array.from({ length: MAXL }, () => new THREE.Color()), lr = Array.from({ length: MAXL }, () => new THREE.Vector2());
  const ld = Array.from({ length: MAXL }, () => new THREE.Vector4(0, -1, 0, -2));          // (the way it shines and its cone's cosine; -2: every way)
  const ru = { lp: { value: lp }, lc: { value: lc }, lr: { value: lr }, ld: { value: ld }, n: { value: 0 }, tint: { value: 0.2 }, lin: { value: 0 }, a: { value: 0 }, c: { value: 0 } };
  const rmat = new THREE.ShaderMaterial({
    uniforms: ru, depthWrite: true, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // (lit where the surface really is; drawn at the far end of the depth range, a hair nearer than the layer)
    vertexShader: 'varying vec3 vW; varying vec3 vN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = 0.99998 * gl_Position.w; }',
    // (dim.js reach for each light, then relit; in a linear target the numbers are turned as the layer's are)
    fragmentShader: `uniform vec3 lp[${MAXL}]; uniform vec3 lc[${MAXL}]; uniform vec2 lr[${MAXL}]; uniform vec4 ld[${MAXL}]; uniform int n; uniform float tint; uniform float lin; uniform float a; uniform float c; varying vec3 vW; varying vec3 vN;
      vec3 toLin(vec3 v) { return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), v)); }
      void main() {
        float s = 0.0; vec3 col = vec3(0.0);
        for (int i = 0; i < ${MAXL}; i++) {
          if (i >= n) break;
          vec3 d = lp[i] - vW; float r = length(d), f = clamp(1.0 - r / lr[i].x, 0.0, 1.0), g = f * f * (3.0 - 2.0 * f);
          float k = lr[i].y * g * g * (0.35 + 0.65 * min(1.0, abs(dot(normalize(vN), d / max(r, 1e-4)))));
          if (ld[i].w > -1.5) { float lo = ld[i].w, hi = lo + 0.35 * (1.0 - lo), t = clamp((dot(-d / max(r, 1e-4), ld[i].xyz) - lo) / max(1e-6, hi - lo), 0.0, 1.0); k *= t * t * (3.0 - 2.0 * t); }
          s += k; col += lc[i] * k;
        }
        float keep = 1.0 - min(s, ${D.RELIT_MAX.toFixed(2)});
        float a2 = a * keep; vec3 c2 = vec3(c * keep) + col * tint;
        if (lin > 0.5) { float through = pow(1.0 - a2, 2.2); vec3 g2 = a2 > 0.0 ? toLin(vec3(c * keep) / a2) * (1.0 - through) : vec3(0.0); c2 = g2 + toLin(col * tint); a2 = 1.0 - through; }
        gl_FragColor = vec4(c2, a2);
      }`,
  });
  const surf = new THREE.Mesh(new THREE.BufferGeometry(), rmat);
  surf.frustumCulled = false; surf.renderOrder = -100; surf.visible = false; surf.name = 'relight';
  let surfRoom, surfParent = null, lightN = 0, levelA = 0;
  // a plane of the scan as triangles (a fan: the scan's outlines are convex), with its normal
  function planeTris(q, out, nrm) {
    const v = q.map((p) => [p[0], p[2], -p[1]]);
    const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let i = 1; i + 1 < v.length; i++) for (const p of [v[0], v[i], v[i + 1]]) { out.push(p[0], p[1] + 0.003, p[2]); nrm.push(nx, ny, nz); }
  }
  function surfaces(room, parent) {
    if (room === surfRoom && parent === surfParent) return;
    surfRoom = room;
    if (parent !== surfParent) { if (surf.parent) surf.parent.remove(surf); surfParent = parent || null; (parent || scene).add(surf); }
    const pos = [], nrm = [], R = window.MUMR.room;
    let floor = false;
    for (const pl of (room && room.planes) || []) {
      if (!pl.p || pl.p.length < 3) continue;
      const k = R.kind(pl);
      if (k === 'opening') continue;                       // (a doorway shows the next room: its light is not ours)
      if (k === 'floor') floor = true;
      planeTris(pl.p, pos, nrm);
    }
    if (!floor) { const n = 48, r = 8; for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; pos.push(0, 0.003, 0, Math.cos(a1) * r, 0.003, -Math.sin(a1) * r, Math.cos(a0) * r, 0.003, -Math.sin(a0) * r); for (let k = 0; k < 3; k++) nrm.push(0, 1, 0); } }
    surf.geometry.dispose();
    surf.geometry = new THREE.BufferGeometry();
    surf.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); surf.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  }
  function lights(list) {
    const L = (list || []).filter((q) => q && q.at && q.range > 0 && q.power > 0).sort((p, q) => q.power - p.power).slice(0, MAXL);
    L.forEach((q, i) => { lp[i].copy(q.at); lc[i].set(q.colour === undefined ? 0xffb066 : q.colour); lr[i].set(q.range, Math.min(1, q.power)); if (q.dir && Number.isFinite(q.cone)) ld[i].set(q.dir.x, q.dir.y, q.dir.z, Math.max(-1, Math.min(0.99, q.cone))); else ld[i].set(0, -1, 0, -2); });
    lightN = ru.n.value = L.length;
  }
  surfaces(null, null);
  // The layer's numbers are the screen's (sRGB), as the headset and the plain webcam page blend. Drawn into a linear target (the lens pass:
  // linear = true) they are turned so that the picture comes out about as dark: what is let through, to the power 2.2, and the grey to linear.
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return {
    mesh, relight: surf, linear: false, surfaces, lights,
    update(level) {
      const l = D.layer(level);
      if (this.linear) { const through = Math.pow(1 - l.a, 2.2); u.a.value = 1 - through; u.c.value = l.a > 0 ? toLin(l.c / l.a) * (1 - through) : 0; }
      else { u.a.value = l.a; u.c.value = l.c; }
      mesh.visible = l.a > 0.002;
      // the lit surfaces draw the layer where they are (only while there is a light: else the layer alone, as it always was); the layer then
      // only where they did not draw, so it tests the depth they leave
      levelA = l.a; ru.a.value = l.a; ru.c.value = l.c; ru.tint.value = 0.1 + 0.3 * levelA; ru.lin.value = this.linear ? 1 : 0;
      surf.visible = lightN > 0;
      // (depth is only written while the test is on: when the layer covers the hands too, the test is on and always passes)
      rmat.depthTest = true; rmat.depthFunc = cutouts && !level.over ? THREE.LessEqualDepth : THREE.AlwaysDepth;
      mat.depthTest = surf.visible || (cutouts && !level.over);
    },
  };
}
