"""The server (engine/server/serve.py) over plain http on this PC: what it serves and refuses, /info, /log, the app's routes, the log file."""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import serve  # noqa: E402
import serverlog  # noqa: E402


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        app = cls.app = os.path.join(cls.dir.name, "app")
        write(os.path.join(app, "index.html"), "<p>hi</p>")
        write(os.path.join(app, "game.js"), "1")
        with open(os.path.join(app, "track.mp3"), "wb") as f:
            f.write(bytes(i % 251 for i in range(1000)))
        write(os.path.join(app, "server.py"), "secret")
        write(os.path.join(app, ".hidden", "a.js"), "no")
        write(os.path.join(app, "tests", "t.js"), "no")
        write(os.path.join(app, "mumr.json"), json.dumps({"title": "T", "bodies": ["cube"], "owned": {"16": "cube"}}))
        cls.log = os.path.join(cls.dir.name, "server.log")
        cls.httpd = serve.make_server(app, port=0, plain=True, log=cls.log,
                                      routes={"GET /hello.json": lambda h, p: h.send_json({"hello": p})})
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.dir.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b""

    def test_the_app_and_the_engine_are_served(self):
        self.assertEqual(self.get("/index.html"), (200, b"<p>hi</p>"))
        self.assertEqual(self.get("/"), (200, b"<p>hi</p>"), "/ goes to the index page")
        with urllib.request.urlopen(self.base + "/?name=A&frame=0,0,0", timeout=5) as r:
            self.assertTrue(r.url.endswith("/index.html?name=A&frame=0,0,0"), r.url)
        code, body = self.get("/mumr/link.js")
        self.assertEqual(code, 200)
        self.assertIn(b"connect", body)

    def ranged(self, path, spec):
        req = urllib.request.Request(self.base + path, headers={"Range": spec})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, b""

    def test_a_part_of_a_file_is_served_for_a_track_that_starts_half_way(self):
        whole = bytes(i % 251 for i in range(1000))
        code, h, body = self.ranged("/track.mp3", "bytes=100-199")
        self.assertEqual((code, h["Content-Range"], h["Content-Length"], body), (206, "bytes 100-199/1000", "100", whole[100:200]))
        self.assertEqual(h["Accept-Ranges"], "bytes"); self.assertEqual(h["Content-Type"], "audio/mpeg")
        code, h, body = self.ranged("/track.mp3", "bytes=900-")
        self.assertEqual((code, h["Content-Range"], body), (206, "bytes 900-999/1000", whole[900:]), "to the end")
        code, h, body = self.ranged("/track.mp3", "bytes=0-5000")
        self.assertEqual((code, h["Content-Range"], len(body)), (206, "bytes 0-999/1000", 1000), "an end past the file is the end")
        code, h, body = self.ranged("/track.mp3", "bytes=-50")
        self.assertEqual((code, h["Content-Range"], body), (206, "bytes 950-999/1000", whole[950:]), "the last 50 bytes")
        code, h, _ = self.ranged("/track.mp3", "bytes=1000-")
        self.assertEqual((code, h["Content-Range"]), (416, "bytes */1000"), "a start past the end")
        code, h, body = self.ranged("/track.mp3", "bytes=0-1,5-6")
        self.assertEqual((code, body), (200, whole), "several ranges: the whole file")
        code, h, body = self.ranged("/track.mp3", "bytes=abc")
        self.assertEqual((code, body), (200, whole), "nonsense: the whole file")
        self.assertEqual(self.get("/track.mp3"), (200, whole), "no Range: the whole file")
        self.assertEqual(self.ranged("/server.py", "bytes=0-2")[0], 404, "what is refused stays refused")
        self.assertEqual(self.ranged("/nothing.mp3", "bytes=0-2")[0], 404)

    def test_what_a_page_does_not_need_is_refused(self):
        for path in ("/server.py", "/.hidden/a.js", "/tests/t.js", "/mumr.json/../server.py", "/"):
            if path != "/":
                self.assertEqual(self.get(path)[0], 404, path)
        self.assertEqual(self.get("/nothing.js")[0], 404)

    def test_info_routes_and_the_config(self):
        code, body = self.get("/info")
        info = json.loads(body)
        self.assertEqual((code, info["players"], info["viewers"]), (200, 0, 0))
        self.assertGreater(info["build"], 0)
        self.assertEqual(json.loads(self.get("/hello.json")[1]), {"hello": "/hello.json"})
        self.assertEqual((self.httpd.hub.bodies, self.httpd.hub.owned, self.httpd.title), (("cube",), {16: "cube"}, "T"))

    def test_life_lines_go_into_the_log_once(self):
        post = {"pid": "q3", "name": "Quest 3", "n": 5, "lines": ["entered", "left"]}
        for _ in range(2):
            req = urllib.request.Request(self.base + "/log", data=json.dumps(post).encode(), method="POST")
            with urllib.request.urlopen(req, timeout=5) as r:
                self.assertEqual(r.status, 204)
        req = urllib.request.Request(self.base + "/log", data=b"[1]", method="POST")
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(req, timeout=5)
        time.sleep(0.05)
        with open(self.log, encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if " life " in ln]
        self.assertEqual(len(lines), 2, "a resend is not written twice")
        self.assertTrue(lines[0].endswith("Quest 3 #5  entered"), lines[0])


class ServerLogTest(unittest.TestCase):
    def test_lines_are_stamped_and_a_log_without_a_path_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.log")
            log = serverlog.ServerLog(path, wall=lambda: 0.25)
            log("ws", "a\nb")
            with open(path, encoding="utf-8") as f:
                line = f.read()
            self.assertTrue(line.endswith(".250  ws       a b\n"), line)
            serverlog.ServerLog(None)("ws", "nothing")
            self.assertFalse(serverlog.ServerLog(None).life({"lines": "no"}))


class BuildStampTest(unittest.TestCase):
    def test_the_newest_page_file_counts_and_tests_do_not(self):
        with tempfile.TemporaryDirectory() as d:
            write(os.path.join(d, "a.js"), "1")
            write(os.path.join(d, "tests", "b.js"), "1")
            os.utime(os.path.join(d, "a.js"), (1000, 1000))
            os.utime(os.path.join(d, "tests", "b.js"), (5000, 5000))
            self.assertEqual(serve.BuildStamp([d])(), 1_000_000)


if __name__ == "__main__":
    unittest.main()
