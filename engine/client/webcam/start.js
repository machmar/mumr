// Turns the app's PC view into the webcam page: waits for the view (window.view, see mixed.js) and starts the mixed view on it.
//   <script type="module" src="view.js"></script> <script type="module" src="/mumr/webcam/start.js"></script>
import { startMixedView } from './mixed.js';

const until = (test) => new Promise((resolve) => { const t = setInterval(() => { const v = test(); if (v) { clearInterval(t); resolve(v); } }, 50); });
// (the view starts with a network request: it is a moment before it is built. Until then `window.view` may be the page's own <canvas id="view">: look for the feed)
startMixedView(await until(() => window.view && window.view.feed && window.view.renderer && window.view));
