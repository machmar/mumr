// Bending the overlay to match a camera's lens (lens.js, overlaylens.js). The camera's picture is never straightened: it is drawn as it comes. The overlay is rendered with an ideal pinhole
// camera into an off-screen target (a wider frustum, so that nothing is missing at the corners of a pincushion), and a full-screen pass draws the raw video and, over it, the target looked
// up through the lens: for every pixel of the picture the shader finds the ideal point (lens.js glsl) and takes the overlay's colour there.
//
//   const pass = createLensPass({ renderer, scene, camera, getVideo });   getVideo: () => the video texture, or null
//   pass.setPlan(plan)    plan: overlaylens.renderPlan(...) (or null): { distort: false } leaves rendering exactly as it was
// It wraps renderer.render for the scene it was given; with no distortion, or no video yet, the wrapper calls the original untouched.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createLensPass({ renderer, scene, camera, getVideo }) {
  const LN = window.MUMR.lens;
  const rt = new THREE.WebGLRenderTarget(2, 2, { samples: 4 });
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { video: { value: null }, over: { value: null }, a1: { value: 0 }, a2: { value: 0 }, size: { value: new THREE.Vector2(1, 1) }, m: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: [
      'uniform sampler2D video; uniform sampler2D over; uniform float a1; uniform float a2; uniform vec2 size; uniform float m;',
      'varying vec2 vUv;',
      LN.glsl(),
      'void main() {',
      '  vec4 vid = texture2D(video, vUv);',
      '  vid.rgb = mix(vid.rgb / 12.92, pow((vid.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, vid.rgb));',         // (the video's colours are the usual sRGB numbers: to linear, as the overlay is, and back at the end)
      '  vec2 ideal = lensIdeal(vUv, a1, a2, size);',
      '  vec2 tuv = 0.5 + (ideal - 0.5) / m;',
      '  vec4 ov = (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) ? vec4(0.0) : texture2D(over, tuv);',
      '  gl_FragColor = vec4(ov.rgb + vid.rgb * (1.0 - ov.a), 1.0);',                // (the target holds colours already weighted by their coverage)
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  let plan = { distort: false };
  const size = new THREE.Vector2(), clear = new THREE.Color(), original = renderer.render.bind(renderer);

  renderer.render = function (s, c) {
    const video = getVideo();
    if (s !== scene || !plan.distort || !video) return original(s, c);
    renderer.getDrawingBufferSize(size);
    const w = Math.min(4096, Math.max(2, Math.round(size.x * plan.m))), h = Math.min(4096, Math.max(2, Math.round(size.y * plan.m)));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    // the overlay, without the picture behind it, with the wider frustum, into the target
    const background = scene.background, fov = camera.fov, target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    scene.background = null; camera.fov = plan.vfovDeg; camera.updateProjectionMatrix();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    original(s, c);
    renderer.setRenderTarget(target); renderer.setClearColor(clear, alpha);
    scene.background = background; camera.fov = fov; camera.updateProjectionMatrix();
    // the picture, and the overlay through the lens on top of it
    const u = mat.uniforms;
    u.video.value = video; u.over.value = rt.texture; u.a1.value = plan.a1; u.a2.value = plan.a2; u.size.value.set(plan.aspect, 1); u.m.value = plan.m;
    original(quadScene, quadCam);
  };

  return { setPlan(p) { plan = p && p.distort ? p : { distort: false }; }, get plan() { return plan; }, get target() { return rt; } };
}
