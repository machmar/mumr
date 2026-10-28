// What of the real room hides the virtual world in the mixed view: the boxes that stand for walls, tables and solid furniture, as the room scan says where
// they are (the same numbers the physics crashes into: room.js walls and blocks). No THREE and no DOM, so that Node can test it. The page (mixed.js) makes a
// depth-only mesh of each box: it draws nothing itself, but everything virtual that is behind it, seen from the camera, is cut off.
//
//   list(room) -> [{ cx, cy, hx, hy, z0, z1, ang, kind }]     in the common floor frame: centre x, y on the floor, half sizes, from z0 to z1 above the common floor
//     room   the room's data (feed.doc.room.data): { planes: [{ l, v, p }] } as room.js has it, or null
//
// What counts: walls (an upright plane: a slab WALL_T thick along its two ends, from its lowest to its highest point), the tops of tables (a thin slab TABLE_T thick:
// the cube under a table is hidden from above and seen from the side), and solid furniture (a bed, a couch, storage: a block from the floor to its top), each as the
// smallest turned rectangle that holds its outline. What does not: floors, ceilings, door and window frames (flat or empty), and, never, people.
// (The boxes are the room's, room.js boxes: the shadows of the app's lights on the real room, dim.js, use the same ones.)
(function (M) {
  const MAX = 3000;                                       // boxes: more than that is not drawn
  const list = (room) => M.room.boxes(room).slice(0, MAX);

  M.occluders = { list, fit: (pts) => M.room.fit(pts), get WALL_T() { return M.room.WALL_T; }, TABLE_T: 0.04, MAX };
})(typeof module !== 'undefined' ? (module.exports = require('../ns.js')) : (globalThis.MUMR = globalThis.MUMR || {}));
