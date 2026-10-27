// HAND CUTOUTS (Nudgy's hand masks, 2026-10-11, with its measured offsets): your real hands, seen in passthrough, stay in front of
// everything the app draws. A hand model is bent to the tracked joints and drawn before anything else, writing depth only: it is
// invisible itself, and whatever is behind it is then not drawn, which leaves the camera picture there. The model is three.js's generic
// WebXR hand (XRHandModelFactory; its models are served from /mumr/vendor/generic-hand/, so a headset needs no internet). It follows the tracking and ends at the wrist.
// An ES module; the page's import map must have three/addons/ (createApp's pages do).
//
//   const mask = createHandMask({ THREE, renderer, scene }); mask.update() every frame; mask.enabled = false hides them;
//   mask.masked(side) whether that hand is masked now; mask.setTipReach(m), mask.grow.value (m) to fit them while the page runs
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// How far the mask reaches past the tracked fingertip joint. The joint is not the end of the finger: it sits about its own radius inside,
// and the hand in passthrough looks a little larger than it is tracked. Marek's Quest Pro, 2026-10-11: 4 mm ended 15 mm short, 19 mm
// was 5 mm short: 24 mm (the total, growth included).
export const TIP_REACH = 0.024;
// The model's fingers are about as thick as the tracked joints say, but the real hand in passthrough is wider: the whole mask is grown
// outwards along its surface normals by this much.
export const GROW = 0.003;

export function createHandMask({ THREE, renderer, scene, tipReach = TIP_REACH, grow = GROW }) {
  const growU = { value: grow }, reach = { value: tipReach };
  const TIP_PAD = tipReach - grow;                         // (the growth lengthens the fingertips too; the reach is the total)
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrow = growU;
    sh.vertexShader = 'uniform float uGrow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * uGrow;');
  };
  const factory = new XRHandModelFactory().setPath('/mumr/vendor/generic-hand/');
  const hands = [0, 1].map((i) => {
    const space = renderer.xr.getHand(i); scene.add(space);
    const model = factory.createHandModel(space, 'mesh'); space.add(model);
    const m = { space, model, side: null, ready: false, mesh: null };
    space.addEventListener('connected', (e) => { m.side = e.data && e.data.hand ? e.data.handedness : null; });
    space.addEventListener('disconnected', () => { m.side = null; });
    return m;
  });

  // The stock hand model has nothing attached to its fingertip joints: every fingertip hangs rigidly on the joint before it, at the
  // model's own length, so on a hand with longer fingers the model ends short of the real tip. This attaches each fingertip to its tip
  // joint: a vertex part-way from the last knuckle to the tip follows the two joints in that proportion, so the last finger segment
  // stretches to wherever the tracked tip is.
  function fixFingertips(mesh) {
    const sk = mesh.skeleton, geo = mesh.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    if (!sk || !pos || !si || !sw) return 0;
    const bindPos = (i) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert());
    const v = new THREE.Vector3();
    let moved = 0;
    mesh.userData.tips = [];
    for (const f of ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
      const d = sk.bones.findIndex((b) => b.name === `${f}-phalanx-distal`), t = sk.bones.findIndex((b) => b.name === `${f}-tip`);
      if (d < 0 || t < 0) continue;
      const D = bindPos(d), axis = bindPos(t).sub(D);
      if (axis.lengthSq() < 1e-8) continue;
      // The model's tip joint sits in the middle of the fingertip, about a centimetre short of the end of the mesh; the headset's tip
      // joint is at the end of the finger. So the model's tip joint is moved out to where its mesh ends (less TIP_PAD, which the mask
      // then reaches past the tracked tip), and the stretch is measured to there.
      let end = 0;
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === d && sw.getComponent(i, k) > 0.5) end = Math.max(end, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).sub(D).dot(axis) / axis.length());
      }
      const dir = axis.clone().normalize(), at = D.clone().addScaledVector(dir, end - TIP_PAD);
      axis.setLength(Math.max(0.002, end - TIP_PAD));
      const len2 = axis.lengthSq(), bind = new THREE.Matrix4().copy(sk.boneInverses[t]).invert();
      sk.boneInverses[t].copy(bind.setPosition(at)).invert();
      const tipSet = { d, t, bind: bind.clone(), at, dir };
      mesh.userData.tips.push(tipSet);
      for (let i = 0; i < pos.count; i++) {
        let slot = -1;                                       // which of the vertex's four influences is the last knuckle
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === d && sw.getComponent(i, k) > 0) slot = k;
        if (slot < 0) continue;
        const u = Math.max(0, Math.min(1, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).sub(D).dot(axis) / len2));
        if (u <= 0) continue;                                // behind the knuckle: leave it
        let ts = -1, weakest = -1, wMin = Infinity;          // a place for the tip joint among the four
        for (let k = 0; k < 4; k++) { if (k === slot) continue; const wk = sw.getComponent(i, k); if (si.getComponent(i, k) === t) ts = k; if (wk < wMin) { wMin = wk; weakest = k; } }
        if (ts < 0) { ts = weakest; si.setComponent(i, ts, t); sw.setComponent(i, ts, 0); }
        const w = sw.getComponent(i, slot);
        sw.setComponent(i, slot, w * (1 - u)); sw.setComponent(i, ts, sw.getComponent(i, ts) + w * u);
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += sw.getComponent(i, k);
        if (sum > 0) for (let k = 0; k < 4; k++) sw.setComponent(i, k, sw.getComponent(i, k) / sum);
        moved++;
      }
    }
    si.needsUpdate = true; sw.needsUpdate = true;
    return moved;
  }
  // how far the masks reach past the tracked fingertips, on models that are already loaded: the tip joint slides back along the finger
  const P = new THREE.Vector3();
  function setTipReach(metres) {
    reach.value = Math.max(0, Math.min(0.04, metres));
    for (const m of hands) {
      if (!m.ready || !m.mesh.userData.tips) continue;
      for (const f of m.mesh.userData.tips) { P.copy(f.at).addScaledVector(f.dir, -(reach.value - tipReach)); m.mesh.skeleton.boneInverses[f.t].copy(f.bind.setPosition(P)).invert(); }
    }
  }
  const api = {
    enabled: true, grow: growU, setTipReach,
    get tipReach() { return reach.value; },
    // once a hand model has arrived, make it the mask: depth only, drawn first
    update() {
      for (const m of hands) {
        if (!m.ready) m.model.traverse((o) => { if (o.isSkinnedMesh) { m.reattached = fixFingertips(o); m.mesh = o; o.material = mat; o.renderOrder = -100; o.frustumCulled = false; m.ready = true; } });
        m.model.visible = api.enabled;
      }
      if (reach.value !== tipReach && hands.some((m) => m.ready && !m.reached)) { for (const m of hands) m.reached = m.ready; setTipReach(reach.value); }
    },
    masked: (side) => api.enabled && hands.some((m) => m.ready && m.side === side && m.space.visible),
  };
  return api;
}
