// The browser's one-tag way to load the engine's plain scripts, in order: <script src="/mumr/all.js"></script> (in the page's head or
// body, not async/defer: it writes the script tags while the page is being read). The list is engine/client/index.js's FILES.
(function () {
  const FILES = ['util', 'link', 'align', 'cams', 'camknobs', 'wire', 'session', 'presence', 'body', 'worldfeed', 'life', 'hands', 'follow', 'menus', 'anchor', 'lineup', 'room', 'physics', 'grab', 'model', 'clicks', 'sysmenu'];
  const base = document.currentScript.src.replace(/all\.js(\?.*)?$/, '');
  for (const f of FILES) document.write(`<script src="${base}${f}.js"></script>`);
})();
