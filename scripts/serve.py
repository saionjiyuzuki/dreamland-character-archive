#!/usr/bin/env python3
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

parser = argparse.ArgumentParser()
parser.add_argument("--directory", default=".")
parser.add_argument("--port", type=int, default=4183)
args = parser.parse_args()
handler = partial(NoCacheHandler, directory=args.directory)
server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
print(f"DREAMLAND V12.6.0 serving at http://localhost:{args.port} (cache disabled)", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
