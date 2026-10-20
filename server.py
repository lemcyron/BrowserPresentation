#!/usr/bin/env python3
"""
Custom HTTP server for the presentation app with ESV API proxy.
Serves static files and proxies ESV API requests to avoid CORS issues.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = Path(__file__).parent
ESV_API_URL = "https://api.esv.org/v3/passage/text/"


class PresentationHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def end_headers(self):
        # Add CORS headers for API endpoints
        if self.path.startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(200)
            self.end_headers()
        else:
            self.send_error(405)

    def do_POST(self):
        if self.path == "/api/esv":
            self.handle_esv_proxy()
        else:
            self.send_error(404)

    def handle_esv_proxy(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self.send_json_response({"error": "Empty request body"}, 400)
            return

        try:
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json_response({"error": "Invalid JSON"}, 400)
            return

        q = data.get("q", "").strip()
        esv_key = data.get("key", "").strip()
        per_slide = data.get("perSlide", 2)

        if not q:
            self.send_json_response({"error": "Missing reference (q)"}, 400)
            return
        if not esv_key:
            self.send_json_response({"error": "Missing ESV API key"}, 400)
            return

        params = urllib.parse.urlencode({
            "q": q,
            "include-headings": "false",
            "include-footnotes": "false",
            "include-verse-numbers": "true",
            "include-short-copyright": "false",
            "include-passage-references": "false",
        })

        url = f"{ESV_API_URL}?{params}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Token {esv_key}")

        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                resp_data = response.read().decode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(resp_data.encode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            self.send_json_response(
                {"error": f"ESV API error ({e.code}): {error_body}"},
                e.code if e.code in (401, 403) else 502
            )
        except urllib.error.URLError as e:
            self.send_json_response({"error": f"Network error: {e.reason}"}, 502)
        except Exception as e:
            self.send_json_response({"error": f"Server error: {e}"}, 500)

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))


def run_server():
    os.chdir(DIRECTORY)
    server = HTTPServer(("127.0.0.1", PORT), PresentationHandler)
    print(f"Starting server on http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    run_server()