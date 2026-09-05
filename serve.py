#!/usr/bin/env python3
"""Static server for the Aspiring Futures gala app.

Serves the gala/ folder with no-cache headers, so browsers always fetch the
current files (no stale JS/CSS after an update). Binds to all interfaces so a
second laptop on the same network can reach it. Usage: python serve.py [port]
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gala")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the launcher window quiet


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print("Serving gala/ on http://localhost:%d/  (no-cache)" % PORT)
    try:
        with Server(("", PORT), Handler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        pass
