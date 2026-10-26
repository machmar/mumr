// How the overlay is rendered for a camera with a lens: the camera's picture is never straightened, so the overlay (drawn with an ideal pinhole camera) is bent to match it.
// No THREE and no DOM (lenspass.js does the drawing, mixed.js asks for the plan once a frame).
//
//   renderPlan(lens, W, H, hfovRad, aspect) -> { distort: false }   no lens (or one that is not a lens): the overlay is drawn as it always was, in one render, over the video
//                                           -> { distort: true, m, hfov, vfovDeg, aspect, a1, a2 }   the overlay is rendered into a target with a frustum m times wider and higher (so that
//                                              the ideal points of the whole picture, also of its corners, are inside it) and warped by the lens onto the picture
//     lens { a1, a2 } (lens.js), W x H the camera's picture, hfovRad and aspect the camera of the overlay as the solver has it
(function (M) {
  function renderPlan(lens, W, H, hfovRad, aspect) {
    const LN = M.lens, l = lens ? { a1: lens.a1, a2: lens.a2, W, H } : null;
    if (!l || LN.isNone(l) || !LN.valid(l) || !(hfovRad > 0) || !(aspect > 0)) return { distort: false };
    const m = LN.bounds(l).m, tanH = Math.tan(hfovRad / 2) * m;
    return { distort: true, m, hfov: 2 * Math.atan(tanH), vfovDeg: 2 * Math.atan(tanH / aspect) * 180 / Math.PI, aspect, a1: l.a1, a2: l.a2 };
  }
  M.overlaylens = { renderPlan };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
