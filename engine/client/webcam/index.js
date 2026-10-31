// Node: the engine's client (index.js), then the webcam page's plain files in dependency order, on the same shared object.
//   const M = require('mumr/client/webcam/index.js');   M.webcam.solve, M.markers.detect, M.webcamcal.Calib, M.lens, ...
// In the browser a page loads them with <script src="/mumr/webcam/all.js"></script> (after /mumr/all.js).
const FILES = ['webcam', 'markers', 'webcamsim', 'webcamcal', 'fovcapture', 'lens', 'overlaylens', 'lensfit', 'screencodes', 'boardcapture', 'latency', 'calmode', 'mixedshow', 'occluders', 'camadjust', 'handcam'];
require('../index.js');
for (const f of FILES) require(`./${f}.js`);
module.exports = require('../ns.js');
module.exports.WEBCAM_FILES = FILES;
