// The room's dim drawn (dim.js): one layer over the whole view, drawn after the hand cutouts and before everything else, so it darkens and
// greys only what is behind the virtual world: the passthrough on a headset (the layer's alpha lets less of it through), the camera's picture
// on a webcam page (drawn over the scene's background, or into the lens pass's target, which keeps colours weighted by coverage the same way).
// It stays in the opaque list (custom blending) so that it is drawn first and never over a virtual thing.
//   over hands false: it is drawn at the far end of the depth range and tested, so the hand cutouts (handmask.js, depth only, drawn
//   before it) keep it off the real hands; true (or a page with no cutouts: cutouts: false): it covers everything.
//
//   const dim = createDim3d({ THREE, scene, cutouts }); every frame dim.update(level)   (level: M.dim.level(doc.dim, serverNow))
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
  // The layer's numbers are the screen's (sRGB), as the headset and the plain webcam page blend. Drawn into a linear target (the lens pass:
  // linear = true) they are turned so that the picture comes out about as dark: what is let through, to the power 2.2, and the grey to linear.
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return {
    mesh, linear: false,
    update(level) {
      const l = D.layer(level);
      if (this.linear) { const through = Math.pow(1 - l.a, 2.2); u.a.value = 1 - through; u.c.value = l.a > 0 ? toLin(l.c / l.a) * (1 - through) : 0; }
      else { u.a.value = l.a; u.c.value = l.c; }
      mesh.visible = l.a > 0.002;
      mat.depthTest = cutouts && !level.over;
    },
  };
}
