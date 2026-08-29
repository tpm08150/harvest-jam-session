#!/usr/bin/env python3
"""Dev server that refuses to let the browser cache anything.

SimpleHTTPRequestHandler sends Last-Modified but no Cache-Control, so Chrome
applies heuristic freshness and will happily serve a stale page after an edit.
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", 8123))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    """Threaded, because the single-threaded TCPServer deadlocks in normal use.

    A browser holding a keep-alive connection occupies the one handler thread, and every
    other request — including a reload of the page you just edited — hangs until it times
    out. Looks exactly like the server having crashed. daemon_threads so Ctrl-C still exits.
    """

    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"serving {PORT} with caching disabled")
        httpd.serve_forever()
