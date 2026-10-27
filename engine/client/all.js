// The browser's one-tag way to load the engine's plain scripts, in order: <script src="/mumr/all.js"></script> (in the page's head or
// body, not async/defer: it writes the script tags while the page is being read). The list is engine/client/index.js's FILES.
(function () {
  const FILES = ['util', 'link', 'align', 'wire', 'session', 'presence', 'body', 'worldfeed', 'life', 'hands', 'follow', 'menus', 'anchor', 'lineup', 'room', 'physics', 'grab', 'model', 'clicks', 'sysmenu'];
  const base = document.currentScript.src.replace(/all\.js(\?.*)?$/, '');
  for (const f of FILES) document.write(`<script src="${base}${f}.js"></script>`);

  // A page that fails before it starts (a script that does not load, THREE not loading from /mumr/vendor/ when the PC
  // went off the network, an error) used to be a white page with nothing in the log. From here on it says why: on the page and in the server's log
  // ("page before start"). A page has started when it makes its life log (life.js sets MUMR_STARTED).
  const pid = 'boot' + Math.random().toString(36).slice(2, 8);
  let n = 0;
  function report(text) {
    try { fetch('/log', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid, name: 'page before start', n: ++n, lines: [`${text} (${navigator.userAgent.slice(0, 60)})`] }) }); } catch (e) { /* no network: the page still shows it */ }
    const show = () => {
      let el = document.getElementById('mumr-boot');
      if (!el) { el = document.createElement('pre'); el.id = 'mumr-boot'; el.style.cssText = 'position:fixed;left:0;right:0;top:0;margin:0;padding:16px;font:16px/1.4 monospace;white-space:pre-wrap;background:#fff3f0;color:#7a1a00;z-index:99999'; document.body.appendChild(el); }
      el.textContent += text + '\n';
    };
    if (document.body) show(); else addEventListener('DOMContentLoaded', show);
  }
  const started = () => !!globalThis.MUMR_STARTED;
  addEventListener('error', (e) => {
    if (started()) return;
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) report(`could not load ${t.src || t.href}${t.type === 'module' ? ' or something it imports (THREE comes from /mumr/vendor/three/)' : ''}`);
    else report(`error before start: ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`);
  }, true);
  addEventListener('unhandledrejection', (e) => { if (!started()) report(`error before start: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`); });
  setTimeout(() => { if (!started()) report('the page has not started after 10 s (is the PC still reachable? THREE is loaded from it, /mumr/vendor/three/).'); }, 10000);
})();
