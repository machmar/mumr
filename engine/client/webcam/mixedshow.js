// What the mixed view shows: switches for the parts of the world that the webcam page draws over the camera's picture. No THREE and no DOM: it works on the
// objects the app's PC view hands over by what they are (anything with `visible`), so Node can test it with stand-ins.
//
// The app's PC view (view.js) draws the world, sets what is visible of the players (heads, hands) and the menus every frame, and exposes
//   window.view.parts = { hands, head, floor, grid, marks, cameras, walls, boxes, menus }
// each a function () -> [objects] (or an object, or an array) with the three.js objects of that part of the picture, or { objects, static: true } for
// things the view never shows or hides itself. The webcam page calls apply() once a frame, after the view's updates and just before it draws:
//   a part whose switch is off     its objects are hidden (the view shows them again the next frame, and apply() hides them again)
//   a part whose switch is on      left alone: the view decides what is visible (a static part is shown)
//   a part the view does not give  the switch is greyed out (`missing` says which; an app that cannot tell its walls from its floor gives only one)
//   hands, head cones, menus       the players' drawing           floor   the room's floor outlines and rugs      grid   the grid floor (off at the start)
//   walls                          the room's walls, fences and tables   boxes   the marked boxes    marks   the calibration marks: the spot discs, the line
//   between them, the check discs  cameras   the real cameras (xr/cammark3d.js)
//   occlude                        not handled here: the page switches the depth-only boxes of the room's real things (occluders.js) with it
(function (M) {
  const ITEMS = [
    { id: 'hands', label: 'Hands' },
    { id: 'head', label: 'Head cones' },
    { id: 'floor', label: 'Floor (outline and rugs)' },
    { id: 'grid', label: 'Grid floor' },
    { id: 'marks', label: 'Calibration marks' },
    { id: 'cameras', label: 'Real cameras' },
    { id: 'walls', label: 'Walls and tables' },
    { id: 'boxes', label: 'Boxes' },
    { id: 'menus', label: 'Menus' },
    { id: 'occlude', label: 'Hide things behind the room' },
  ];
  const DEFAULTS = { hands: true, head: true, floor: true, grid: false, marks: true, cameras: true, walls: true, boxes: true, menus: true, occlude: true };
  const PARTS = ITEMS.map((i) => i.id).filter((id) => id !== 'occlude');       // the switches that work through view.parts

  // saved settings merged into the defaults (anything that is not a true or false for a known switch is dropped)
  function clean(saved) {
    const out = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === 'object') for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
    return out;
  }

  // the objects of a part: what a function returns, or the thing itself; a Map's values and arrays are flattened, anything without `visible` is skipped
  function objects(part) {
    let p = typeof part === 'function' ? part() : part;
    if (p instanceof Map) p = [...p.values()];
    const out = [];
    const add = (o) => { if (Array.isArray(o)) o.forEach(add); else if (o && typeof o === 'object' && 'visible' in o) out.push(o); };
    add(p);
    return out;
  }

  // view: { parts } (window.view of the app's PC view); s: the settings -> { ok (every part is given), missing: [ids] }
  // A part is what the view hands over, as objects() reads it, and the view sets `visible` of those objects itself every frame (a player's head is
  // hidden when the player is not there): the switch only hides them. For things the view never hides or shows (the grid, the room's outline, the cameras)
  // the part is { objects, static: true }: the switch then shows them again as well.
  function apply(view, s) {
    const parts = (view && view.parts) || {}, missing = [];
    for (const id of PARTS) {
      const part = parts[id];
      if (part === undefined || part === null) { missing.push(id); continue; }
      const stat = typeof part === 'object' && !Array.isArray(part) && !(part instanceof Map) && part.objects !== undefined && part.static === true;
      for (const o of objects(stat ? part.objects : part)) { if (!s[id]) o.visible = false; else if (stat) o.visible = true; }
    }
    return { ok: missing.length === 0, missing };
  }

  M.mixedshow = { ITEMS, DEFAULTS, PARTS, clean, apply, objects };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
