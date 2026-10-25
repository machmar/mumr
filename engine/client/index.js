// Node: every client file, in the order a page loads them with <script> tags, on one shared object.
//   const M = require('mumr/client/index.js');   M.session.Session, M.body.Body, ...
// In the browser:
//   <script src="/mumr/util.js"></script> <script src="/mumr/link.js"></script> <script src="/mumr/align.js"></script>
//   <script src="/mumr/wire.js"></script> <script src="/mumr/session.js"></script> <script src="/mumr/presence.js"></script>
//   <script src="/mumr/body.js"></script> <script src="/mumr/worldfeed.js"></script> <script src="/mumr/life.js"></script>
//   <script src="/mumr/hands.js"></script> <script src="/mumr/follow.js"></script> <script src="/mumr/menus.js"></script>
//   <script src="/mumr/anchor.js"></script> <script src="/mumr/lineup.js"></script>
//   <script src="/mumr/room.js"></script> <script src="/mumr/physics.js"></script> <script src="/mumr/grab.js"></script>
//   <script src="/mumr/model.js"></script> <script src="/mumr/clicks.js"></script> <script src="/mumr/sysmenu.js"></script>
// (or one tag, <script src="/mumr/all.js"></script>, which writes those tags in this order), and then window.MUMR has them all.
// The XR parts are ES modules in /mumr/xr/ (they need THREE, which the page gives them).
const FILES = ['util', 'link', 'align', 'wire', 'session', 'presence', 'body', 'worldfeed', 'life', 'hands', 'follow', 'menus', 'anchor', 'lineup', 'room', 'physics', 'grab', 'model', 'clicks', 'sysmenu'];
for (const f of FILES) require(`./${f}.js`);
module.exports = require('./ns.js');
module.exports.FILES = FILES;
