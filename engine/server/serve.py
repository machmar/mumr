"""The MUMR server: an app's pages over https on the local network, the engine's client scripts, and the hub's WebSocket.

    py -3 engine/server/serve.py APP_FOLDER [port] [--http] [--no-browser] [--no-host] [--log=PATH|none]          default port 8443

WebXR only runs on https (or localhost), so the headsets need a certificate: a self-signed one is made with openssl on the first
run (and again when the PC's address changes) and kept in ~/.mumr/cert/ (never in a repository). Each browser warns about it once
(Advanced -> Proceed).

What is served (read-only, no directory listings, no dot-files, no .py/.pem/.bat/.log, no tests):
    /mumr/...       the engine's engine/client/ folder (the app loads <script src="/mumr/session.js"> and so on)
    /...            the app's folder; / goes to the app's index page
    GET  /ws        the hub (hub.py): every headset and every PC viewer holds one WebSocket
    POST /log       a page's life lines (engine/client/life.js) into the server log
    GET  /info      {"build": n, "players": k, "viewers": v, "host": bool}

The build stamp is the newest .js/.html in the app's folder and the engine's client folder: a page of another build is refused
when it joins, and pages can reload themselves when /info says the build changed.

An app configures the server with `mumr.json` in its folder (all optional):
    {"title": "Cube", "index": "index.html", "bodies": ["cube"], "owned": {"16": "cube"}, "max_peers": 4, "host": "host.js"}
`host` names the app's host module: the server then runs `node engine/client/host.js` with it (a process that holds the bodies nobody touches,
engine/client/host.js), starts it again when it ends (a new build of the pages ends it), and writes what it says into the log. --no-host: not.
or calls run() from its own start script, which may also add routes: run(app, routes={"GET /networks.json": fn}) where
fn(handler, path) answers with handler.send_json(obj) or handler.send_error(code).

Always on: the server log (serverlog.py), mumr-server.log in the app's folder; --log=PATH writes it elsewhere, --log=none not
at all (tests). There is no login: anyone on the network can open the pages and join.
"""
import http.server
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hub as hub_mod  # noqa: E402
import serverlog  # noqa: E402
import ws  # noqa: E402

CLIENT = os.path.join(os.path.dirname(HERE), "client")
CERT_DIR = os.path.join(os.path.expanduser("~"), ".mumr", "cert")
BLOCKED_DIRS = {"test", "tests", "pytests", "__pycache__", "node_modules"}
BLOCKED_EXT = {".py", ".pem", ".bat", ".log", ".key"}


def lan_ip():
    """The address other devices on the network reach this PC at (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def find_openssl():
    exe = shutil.which("openssl")
    if exe:
        return exe
    for p in (r"C:\Program Files\Git\usr\bin\openssl.exe", r"C:\Program Files\Git\mingw64\bin\openssl.exe",
              r"C:\msys64\usr\bin\openssl.exe", r"C:\msys64\mingw64\bin\openssl.exe"):
        if os.path.exists(p):
            return p
    return None


def ensure_cert(ip, folder=CERT_DIR):
    """A self-signed certificate for this address; returns (cert, key)."""
    cert, key, stamp = (os.path.join(folder, n) for n in ("cert.pem", "key.pem", "ip.txt"))
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp) and open(stamp).read().strip() == ip:
        return cert, key
    exe = find_openssl()
    if not exe:
        sys.exit("openssl was not found. Install Git for Windows (it brings openssl) or put openssl on the PATH.")
    os.makedirs(folder, exist_ok=True)
    env = dict(os.environ, MSYS_NO_PATHCONV="1", MSYS2_ARG_CONV_EXCL="*")   # keep MSYS from rewriting /CN=...
    subprocess.run([exe, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825", "-keyout", key, "-out", cert,
                    "-subj", "/CN=mumr", "-addext", f"subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost"],
                   check=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(stamp, "w") as f:
        f.write(ip)
    return cert, key


def keep_alive(sock):
    """No Nagle (a motion packet must not wait for the acknowledgement of the one before it), and let the system check that an idle
    connection is still there (every 10 s, then every 3 s): a headset whose Wi-Fi went away is found out in about half a minute."""
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except (OSError, ValueError, AttributeError):
        pass
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        if hasattr(sock, "ioctl") and hasattr(socket, "SIO_KEEPALIVE_VALS"):
            sock.ioctl(socket.SIO_KEEPALIVE_VALS, (1, 10000, 3000))
        elif hasattr(socket, "TCP_KEEPIDLE"):
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 10)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 3)
    except (OSError, ValueError, AttributeError):
        pass


class BuildStamp:
    """When the pages' files last changed (ms): the newest .js/.html under the given folders. Looked up at most once a second."""

    def __init__(self, folders):
        self.folders, self.at, self.n = list(folders), 0.0, 0

    def __call__(self):
        now = time.monotonic()
        if now - self.at < 1.0 and self.n:
            return self.n
        newest = 0
        for root in self.folders:
            for base, dirs, files in os.walk(root):
                dirs[:] = [d for d in dirs if d.lower() not in BLOCKED_DIRS and not d.startswith(".")]
                for name in files:
                    if name.lower().endswith((".js", ".html")):
                        try:
                            newest = max(newest, os.stat(os.path.join(base, name)).st_mtime_ns // 1_000_000)
                        except OSError:
                            pass
        self.at, self.n = now, newest
        return newest


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=a[2].app, **kw)

    # ---- helpers for the app's routes
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _body(self, limit):
        """The request's body, or None after answering 413 (too big or no length)."""
        try:
            n = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            n = -1
        if not 0 <= n <= limit:
            self.close_connection = True
            self.send_error(413)
            return None
        return self.rfile.read(n)

    # ---- files
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == "/mumr" or clean.startswith("/mumr/"):
            self.directory = CLIENT
            path = path[len("/mumr"):] or "/"
        else:
            self.directory = self.server.app
        return super().translate_path(path)

    def _refused(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        parts = [p for p in path.replace("\\", "/").split("/") if p]
        if any(p.lower() in BLOCKED_DIRS or p.startswith(".") for p in parts):
            return True
        return os.path.splitext(path)[1].lower() in BLOCKED_EXT

    def list_directory(self, path):               # no directory listings
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # the headset always gets the files as they are now
        super().end_headers()

    def _ranged(self):
        """A part of a file (Range: bytes=a-b, a-, -n), as a media element asks to start a track half way: 206 with that part, 416 for one outside the
        file. False when the request is not such a one (no Range, several ranges, not a file): the whole file is sent."""
        spec = self.headers.get("Range", "").strip()
        if not spec.startswith("bytes=") or "," in spec:
            return False
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return False
        first, _, last = spec[6:].partition("-")
        try:
            size = os.path.getsize(path)
            if first.strip() == "":
                start, end = max(0, size - int(last)), size - 1
            else:
                start, end = int(first), min(size - 1, int(last)) if last.strip() else size - 1
        except (ValueError, OSError):
            return False
        if start > end or start >= size or start < 0:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        try:
            with open(path, "rb") as f:
                self.send_response(206)
                self.send_header("Content-Type", self.guess_type(path))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
                self.send_header("Content-Length", str(end - start + 1))
                self.end_headers()
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True             # (a player that seeks again drops the part it was reading)
        return True

    def log_message(self, fmt, *args):
        line = fmt % args
        if "/log " not in line and "/info " not in line:
            sys.stderr.write("  %s  %s\n" % (self.address_string(), line))
        parts = line.split('"')
        req = parts[1] if len(parts) > 2 else line
        code = parts[2].split()[0] if len(parts) > 2 and parts[2].split() else ""
        target = req.split()[1].split("?", 1)[0] if len(req.split()) > 1 else ""
        if target.lower().endswith(".html") or target == "/" or (code.isdigit() and int(code) >= 400):
            ua = self.headers.get("User-Agent", "")[:120] if getattr(self, "headers", None) else ""
            self.server.slog("page", "%s  %s -> %s  (%s)" % (self.address_string(), req, code or line, ua))

    # ---- requests
    def _route(self, method):
        path = self.path.split("?", 1)[0]
        fn = self.server.routes.get("%s %s" % (method, path))
        if fn is None:
            return False
        fn(self, path)
        return True

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/ws":
            self._socket()
        elif path == "/":
            self.send_response(302)
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            self.send_header("Location", "/" + self.server.index + ("?" + query if query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/info":
            h = self.server.hub
            self.send_json({"build": self.server.build(), "players": len([q for q in h.peers if q != hub_mod.HOST]), "viewers": len(h.viewers), "host": hub_mod.HOST in h.peers})
        elif self._route("GET"):
            pass
        elif self._refused():
            self.send_error(404)
        elif self._ranged():
            pass
        else:
            super().do_GET()

    def do_HEAD(self):
        if self._refused():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/log":
            body = self._body(200_000)
            if body is None:
                return
            try:
                ok = self.server.slog.life(json.loads(body))
            except ValueError:
                ok = False
            if ok:
                self._no_content()
            else:
                self.send_error(400)
        elif not self._route("POST"):
            self.close_connection = True
            self.send_error(404)

    def _socket(self):
        """One WebSocket, until it closes. What is to go out waits in an Outbox and is sent by a thread of its own, so a headset whose
        Wi-Fi stalls, or that was taken off and has stopped reading, holds nobody else up. The log lines say when a connection came
        and went and WHY, with the time: that is what tells a closed page from a lost Wi-Fi."""
        hub, slog = self.server.hub, self.server.slog
        if not ws.accept(self):
            slog("ws", "%s  a request for /ws that was not a WebSocket: refused" % self.address_string())
            self.send_error(400)
            return
        slog("ws", "%s  socket opened" % self.address_string())
        self.close_connection = True
        keep_alive(self.request)
        out = hub_mod.Outbox()
        conn = object()
        born = time.monotonic()
        why = ["connection lost"]           # (why it ended: the first thing that says so wins)
        heard = [born]

        def say(text):
            sys.stderr.write("  %s  %s  %s\n" % (time.strftime("%H:%M:%S"), self.address_string(), text))
            sys.stderr.flush()
            slog("ws", "%s  %s" % (self.address_string(), text))

        def writer():
            try:
                while True:
                    item = out.get()
                    if item is None:
                        return
                    ws.write_frame(self.wfile, ws.BINARY if item[0] == hub_mod.BIN else item[0], item[1])
            except (OSError, ssl.SSLError, ValueError):
                pass

        def send_text(msg):
            if not out.put_text((ws.TEXT, json.dumps(msg, separators=(",", ":")).encode())):
                raise OSError("too far behind on messages")      # the hub gives it up (and calls kill)

        def kill():
            why[0] = "given up on: it stopped reading (too far behind on messages)"
            out.close()
            try:
                self.request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        def watch():
            # What the relay does to this connection's traffic, in words, when it is not as it should be: motion packets replaced by newer
            # ones because the socket could not take them, and a page that has gone quiet (not in front: timers at 1 a second; frozen: nothing)
            last_dropped, quiet = 0, False
            while not out.closed:
                time.sleep(2.0)
                gap = time.monotonic() - heard[0]
                if out.dropped - last_dropped >= 10:
                    say("%d motion packets replaced in the last 2 s: it does not take them as fast as they come" % (out.dropped - last_dropped))
                last_dropped = out.dropped
                if gap > 3.0 and not quiet:
                    quiet = True
                    say("silent for %.0f s (a page that is not in front, or a lost connection)" % gap)
                elif gap <= 3.0 and quiet:
                    quiet = False
                    say("heard again")

        sender = threading.Thread(target=writer, daemon=True)
        sender.start()
        threading.Thread(target=watch, daemon=True).start()
        who = None
        try:
            while True:
                frame = ws.read_frame(self.rfile)
                if frame is None:
                    break
                heard[0] = time.monotonic()
                op, data = frame
                if op == ws.CLOSE:
                    code, reason = ws.close_info(data)
                    why[0] = "the page closed it" + (f" (code {code}{', ' + reason if reason else ''})" if code is not None else "")
                    break
                if op == ws.PING:
                    out.put_text((ws.PONG, data))
                elif op == ws.TEXT:
                    msg = json.loads(data)
                    if who is None:
                        who = hub.join(send_text, out.put_bin, msg, conn=conn, kill=kill)
                        if who is None:
                            why[0] = "refused (another build of the page, or full)"
                            break
                        say("%s joined (%s)" % (hub.label(who), str(msg.get("name") or "")[:24]))
                    else:
                        hub.text(who, msg, conn)
                elif op == ws.BINARY and who is not None:
                    hub.binary(who, data, conn)
        except (OSError, ssl.SSLError, ValueError):
            pass
        finally:
            if who is not None:
                hub.leave(who, conn)
                say("%s left: %s; up %.0f s, silent for %.1f s, %d motion packets replaced"
                    % (hub.label(who), why[0], time.monotonic() - born, time.monotonic() - heard[0], out.dropped))
            else:
                slog("ws", "%s  socket closed before joining: %s; up %.0f s" % (self.address_string(), why[0], time.monotonic() - born))
            out.put_text((ws.CLOSE, b""))
            out.close()
            sender.join(2.0)                      # what is still to go out (a refusal, the close) goes before the socket does


class Server(http.server.ThreadingHTTPServer):
    """TLS is set up in the request's own thread, so a browser that stalls on the certificate blocks nobody."""
    ctx = None
    daemon_threads = True

    def finish_request(self, request, client_address):
        if self.ctx is not None:
            try:
                request = self.ctx.wrap_socket(request, server_side=True)
            except (ssl.SSLError, OSError):
                return
        self.RequestHandlerClass(request, client_address, self)

    def handle_error(self, request, client_address):
        pass                                      # browsers drop connections all the time; nothing to report


def load_config(app):
    path = os.path.join(app, "mumr.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def make_server(app, port=8443, plain=False, log=None, routes=None, config=None, host=None):
    """The server, not started yet (tests use this). log: a path, None for mumr-server.log in the app's folder, or False for none."""
    app = os.path.abspath(app)
    cfg = dict(load_config(app), **(config or {}))
    slog = serverlog.ServerLog(None) if log is False else serverlog.ServerLog(log) if log else serverlog.in_folder(app)
    build = BuildStamp([app, CLIENT])
    httpd = Server((host or ("127.0.0.1" if plain else "0.0.0.0"), port), Handler)
    httpd.app, httpd.index, httpd.slog, httpd.build = app, cfg.get("index", "index.html"), slog, build
    httpd.title = cfg.get("title", os.path.basename(app))
    httpd.host_module = os.path.join(app, cfg["host"]) if cfg.get("host") else None
    httpd.plain = plain
    httpd.routes = dict(routes or {})
    httpd.hub = hub_mod.Hub(build, max_peers=int(cfg.get("max_peers", 4)), bodies=tuple(cfg.get("bodies", ())),
                            owned={int(k): v for k, v in cfg.get("owned", {}).items()}, log=slog)

    def tick():
        while True:
            time.sleep(0.25)
            httpd.hub.tick()
    threading.Thread(target=tick, daemon=True).start()
    if not plain:
        cert, key = ensure_cert(lan_ip())
        httpd.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        httpd.ctx.load_cert_chain(cert, key)
    return httpd


def find_node():
    exe = shutil.which("node")
    if exe:
        return exe
    for p in (r"C:\Program Files\nodejs\node.exe", r"C:\Program Files (x86)\nodejs\node.exe"):
        if os.path.exists(p):
            return p
    return None


def keep_host(httpd, port):
    """Run the app's host (engine/client/host.js) for as long as the server runs, and start it again when it ends."""
    node, slog = find_node(), httpd.slog
    if not node:
        slog("host", "node was not found: no host (install Node.js, or put node on the PATH)")
        return
    url = "%s://127.0.0.1:%d/ws" % ("ws" if httpd.plain else "wss", port)
    env = dict(os.environ, NODE_TLS_REJECT_UNAUTHORIZED="0")       # (our own certificate, on this PC)

    def loop():
        while True:
            started = time.monotonic()
            try:
                proc = subprocess.Popen([node, os.path.join(CLIENT, "host.js"), url, httpd.host_module], env=env, cwd=os.path.dirname(CLIENT),
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            except OSError as e:
                slog("host", "could not start: %s" % e)
                return
            httpd.host_proc = proc
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    sys.stderr.write("  host  %s\n" % line)
            code = proc.wait()
            slog("host", "ended (code %s) after %.0f s; starting it again" % (code, time.monotonic() - started))
            time.sleep(2.0 if time.monotonic() - started > 10 else 5.0)
    threading.Thread(target=loop, daemon=True).start()


def run(app, port=8443, plain=False, browser=True, log=None, routes=None, config=None, host=True):
    httpd = make_server(app, port, plain, log, routes, config)
    ip, scheme = lan_ip(), "http" if plain else "https"
    page = httpd.index
    print(httpd.title, "(MUMR)", flush=True)
    print(f"  serving   {httpd.app}   and the engine at /mumr/")
    if plain:
        print(f"  plain http, this PC only:   http://localhost:{port}/{page}")
    else:
        print(f"  on a headset, open   https://{ip}:{port}/{page}")
        print("  Each browser warns about the certificate once: Advanced -> Proceed.")
        print("  The PC and the headsets must be on the same network. If the page does not load, allow Python")
        print("  through the Windows firewall for private networks.")
    if browser:
        threading.Timer(1.0, webbrowser.open, args=(f"{scheme}://localhost:{port}/{page}",)).start()
    httpd.slog("server", "started on port %d (%s), address %s, app %s; this log: %s" % (port, scheme, ip, httpd.app, httpd.slog.path))
    print(f"  server log   {httpd.slog.path or 'none'}")
    if host and httpd.host_module:
        print(f"  host         {httpd.host_module} (holds what nobody touches)")
        keep_host(httpd, port)
    print("Close this window or press Ctrl+C to stop.\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        proc = getattr(httpd, "host_proc", None)
        if proc and proc.poll() is None:
            proc.kill()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    log = None
    for a in argv:
        if a.startswith("--log="):
            log = False if a[6:].lower() == "none" else os.path.abspath(a[6:])
    run(args[0], int(args[1]) if len(args) > 1 else 8443, plain="--http" in argv, browser="--no-browser" not in argv, log=log, host="--no-host" not in argv)


if __name__ == "__main__":
    main()
