// The browser's one-tag way to load the webcam page's plain scripts, in order: <script src="/mumr/webcam/all.js"></script> (after
// <script src="/mumr/all.js"></script>; not async/defer: it writes the script tags while the page is being read). The list is
// engine/client/webcam/index.js's FILES. The page's modules (webcamview.js, lenspass.js, mixed.js) are ES modules and load themselves.
(function () {
  const FILES = ['webcam', 'markers', 'webcamsim', 'webcamcal', 'fovcapture', 'lens', 'overlaylens', 'lensfit', 'screencodes', 'boardcapture', 'latency', 'calmode', 'mixedshow', 'occluders', 'camadjust', 'handcam'];
  const base = document.currentScript.src.replace(/all\.js(\?.*)?$/, '');
  for (const f of FILES) document.write(`<script src="${base}${f}.js"></script>`);
})();
