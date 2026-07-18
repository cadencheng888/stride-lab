#!/usr/bin/env python3
"""Static dev server that disables HTTP caching.

`python3 -m http.server` sends no Cache-Control header, so browsers
heuristically cache the JS modules and can keep running stale code long after
the files change on disk. This serves the same directory but tells the browser
to revalidate every file on each load.
"""
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    http.server.test(HandlerClass=NoCacheHandler, port=8000)
