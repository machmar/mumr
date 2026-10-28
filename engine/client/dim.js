// THE ROOM'S DIM (Marek, 2026-10-27: "the room darkens and an object glows"): the game darkens and mutes the real room, the passthrough on
// every headset and the picture on every webcam page, the same for everybody at the same moment. The virtual world is drawn over it at
// full strength, so a thing the game makes glow stands out. No THREE and no DOM (the layer that draws it is xr/dim3d.js).
//
// It is one thing of the shared document (session.js kind 'dim', kept by the server): the look the game asked for, when it asked (the
// server's clock) and what the look was then, so a page that joins in the middle of a fade is at the same point as the others.
//   { k: 'dim', dark, mute, over, fade, at, from: { dark, mute } }
//   dark   0 the room as it is .. 1 black            mute   0 its own colours .. 1 grey
//   over   true: real hands are dimmed too (the cutouts are not perfect: a bright hand with a ragged edge in a dark room shows it);
//          false: the hand cutouts stay bright
//   fade   ms from `from` to this look, from `at` (server ms; null: at once)
//
//   clean(e) -> the dim, or null          level(d, t) -> { dark, mute, over } at server time t
//   event(d, want, t) -> the event for session.emit: want { dark, mute, over, fade } (a value left out stays as asked before)
//   layer(lv) -> { a, c }: the layer over the room: alpha and its premultiplied grey (out = c + room * (1 - a))
//
// RELIGHT (Marek, 2026-10-28: "a light that's on a wall would kind of go against the darkening of the entire room"): a light of the virtual world
// lights the real room. Where a light reaches a real surface (a wall, the floor, a table top of the room scan) the dim is taken back off it and a
// little of the light's colour is laid on it, so a lantern by a wall seems to throw its light on the real wall even in a dark room. The surfaces
// are drawn by xr/dim3d.js right after the layer; these are its numbers:
//   reach(r, range, power, facing) -> s   how strongly a light reaches a point r metres away (0 at its range; facing: the cosine between the
//                                         surface and the way to the light, either side counts)
//   relit(layer, s, tint) -> { a, c }     the layer there: a' = a (1 - s), c' = c (1 - s) + tint (tint: the light's colour laid on, premultiplied)
//   spot(cosA, cone) -> 0..1              a light that shines one way (a shade under a ceiling light shines down, not on the ceiling round it): cosA
//                                         the cosine between its way and the way to the point; full inside, none outside cone (a cosine), soft between
(function (M) {
  const GREY = 0.4;            // what mute 1 mixes the room towards (the screen's number, 0..1): a little below the middle, so muted is also a little darker
  const OFF = { dark: 0, mute: 0, over: true };
  const unit = (v, d) => (M.util.num(v) ? Math.max(0, Math.min(1, v)) : d);

  function clean(e) {
    if (!e || typeof e !== 'object') return null;
    const f = e.from && typeof e.from === 'object' ? e.from : {};
    const dark = unit(e.dark, 0), mute = unit(e.mute, 0);
    return { dark, mute, over: e.over !== false, fade: M.util.num(e.fade) ? Math.max(0, Math.min(60000, e.fade)) : 0,
      at: M.util.num(e.at) ? e.at : null, from: { dark: unit(f.dark, dark), mute: unit(f.mute, mute) } };
  }

  // the look at server time t. The fade eases in and out (smoothstep). A time from another clock (a page that was alone, or not synced yet:
  // more than a second before `at`) counts as the fade being over: never stuck at the start.
  function level(d, t) {
    if (!d) return Object.assign({}, OFF);
    let u = 1;
    if (d.fade > 0 && d.at !== null && M.util.num(t) && t >= d.at - 1000) u = Math.max(0, Math.min(1, (t - d.at) / d.fade));
    const s = u * u * (3 - 2 * u);
    return { dark: d.from.dark + (d.dark - d.from.dark) * s, mute: d.from.mute + (d.mute - d.from.mute) * s, over: d.over };
  }

  function event(d, want = {}, t = null) {
    const now = level(d, t), was = d || OFF;
    return { k: 'dim', dark: unit(want.dark, was.dark), mute: unit(want.mute, was.mute), over: want.over === undefined ? was.over : want.over !== false,
      fade: M.util.num(want.fade) ? Math.max(0, want.fade) : 0, at: M.util.num(t) ? t : null, from: { dark: now.dark, mute: now.mute } };
  }

  // darken first (the room times 1 - dark), then mix that towards the grey (times 1 - mute, plus mute grey)
  function layer(lv) {
    const k = 1 - lv.dark;
    return { a: 1 - k * (1 - lv.mute), c: k * lv.mute * GREY };
  }

  const RELIT_MAX = 0.95;              // (a light never takes all of the dim away: the room stays the game's)
  function reach(r, range, power, facing = 1, spotK = 1) {
    if (!(range > 0) || !(power > 0)) return 0;
    const f = Math.max(0, 1 - r / range), g = f * f * (3 - 2 * f);
    return power * g * g * (0.35 + 0.65 * Math.min(1, Math.abs(facing))) * spotK;
  }
  function spot(cosA, cone) {
    const lo = cone, hi = cone + 0.35 * (1 - cone), t = Math.max(0, Math.min(1, (cosA - lo) / Math.max(1e-6, hi - lo)));
    return t * t * (3 - 2 * t);
  }
  function relit(l, s, tint = 0) {
    const k = 1 - Math.max(0, Math.min(RELIT_MAX, s));
    return { a: l.a * k, c: l.c * k + tint };
  }

  M.dim = { clean, level, event, layer, reach, relit, spot, GREY, RELIT_MAX };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
