from __future__ import annotations

import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass  # silenciar logs


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    url = f"http://localhost:{PORT}/docs/"
    print(f"Dashboard local: {url}")
    print("Ctrl+C para detener.")
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    httpd.serve_forever()
