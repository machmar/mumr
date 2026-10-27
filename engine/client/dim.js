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

  M.dim = { clean, level, event, layer, GREY };
})(typeof module !== 'undefined' ? (module.exports = require('./ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
