#!/usr/bin/env python3
"""
Custom HTTP server for the presentation app with ESV API proxy.
Serves static files and proxies ESV API requests to avoid CORS issues.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = Path(__file__).parent
ESV_API_URL = "https://api.esv.org/v3/passage/text/"

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


def convert_pptx_to_images(pptx_bytes):
    temp_dir = tempfile.mkdtemp(prefix="pptx_conv_")
    try:
        input_file = os.path.join(temp_dir, "input.pptx")
        export_dir = os.path.join(temp_dir, "slides")
        os.makedirs(export_dir, exist_ok=True)
        with open(input_file, "wb") as f:
            f.write(pptx_bytes)

        if sys.platform == "win32":
            abs_input = os.path.abspath(input_file)
            abs_export = os.path.abspath(export_dir)
            ps_script = f"""
$ErrorActionPreference = 'Stop'
$ppt = $null
$pres = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
    $pres = $ppt.Presentations.Open('{abs_input}', [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
    $pres.SaveAs('{abs_export}', 17)
}} finally {{
    if ($pres) {{
        $pres.Close()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
    }}
    if ($ppt) {{
        $ppt.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
    }}
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}}
"""
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=90,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"PowerPoint export failed: {proc.stderr.strip() or proc.stdout.strip()}")
        else:
            soffice = shutil.which("soffice") or shutil.which("libreoffice")
            if not soffice:
                raise RuntimeError("LibreOffice or PowerPoint is required on the server to convert slides.")
            proc = subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", input_file, "--outdir", export_dir],
                capture_output=True,
                text=True,
                timeout=90,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"LibreOffice conversion failed: {proc.stderr.strip()}")
            pdf_path = os.path.join(export_dir, "input.pdf")
            if not os.path.exists(pdf_path):
                raise RuntimeError("Failed to generate PDF from presentation")
            pdftoppm = shutil.which("pdftoppm")
            if not pdftoppm:
                raise RuntimeError("pdftoppm is required to render PDF slides to images")
            proc2 = subprocess.run(
                [pdftoppm, "-jpeg", "-r", "150", pdf_path, os.path.join(export_dir, "slide")],
                capture_output=True,
                text=True,
                timeout=90,
            )
            if proc2.returncode != 0:
                raise RuntimeError(f"pdftoppm failed: {proc2.stderr.strip()}")

        exported_files = [
            f for f in os.listdir(export_dir)
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        ]
        exported_files.sort(key=natural_sort_key)

        images = []
        for f in exported_files:
            file_path = os.path.join(export_dir, f)
            with open(file_path, "rb") as img_file:
                b64 = base64.b64encode(img_file.read()).decode("ascii")
                mime = "image/png" if f.lower().endswith(".png") else "image/jpeg"
                images.append(f"data:{mime};base64,{b64}")

        return images
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# The index page keeps one connection open to /api/alive while it is open. When the last one closes, the
# server stops after a short grace period (so a page reload, which closes and reopens it, does not stop it).
KEEPALIVE_SECONDS = 2
GRACE_SECONDS = 5


class TabTracker:
    """Counts open index pages and calls on_idle once none has been open for GRACE_SECONDS."""

    def __init__(self, on_idle):
        self._on_idle = on_idle
        self._lock = threading.Lock()
        self._count = 0
        self._timer = None

    def opened(self):
        with self._lock:
            self._count += 1
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def closed(self):
        with self._lock:
            self._count = max(0, self._count - 1)
            if self._count == 0:
                self._timer = threading.Timer(GRACE_SECONDS, self._fire)
                self._timer.daemon = True
                self._timer.start()

    def _fire(self):
        with self._lock:
            if self._count != 0:
                return  # a page opened again just in time
        self._on_idle()


class PresentationHandler(SimpleHTTPRequestHandler):
    tabs = None  # set by run_server()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def do_GET(self):
        if self.path == "/api/alive":
            self.handle_alive()
        else:
            super().do_GET()

    def handle_alive(self):
        # Server-sent events stream that never ends. Writing a small comment every few seconds makes a closed
        # tab show up as a broken connection, which is what tells the server the page is gone.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True
        self.tabs.opened()
        try:
            while True:
                self.wfile.write(b": alive\n\n")
                self.wfile.flush()
                time.sleep(KEEPALIVE_SECONDS)
        except OSError:
            pass  # the page was closed
        finally:
            self.tabs.closed()

    def end_headers(self):
        # Add CORS headers for API endpoints
        if self.path.startswith("/api/"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        else:
            # Always load the current files. Without this, browsers keep serving old copies of
            # app.js / screen.js / styles.css after an update.
            self.send_header("Cache-Control", "no-store")
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
        elif self.path == "/api/convert-pptx":
            self.handle_pptx_convert()
        else:
            self.send_error(404)

    def handle_pptx_convert(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self.send_json_response({"error": "Empty file"}, 400)
            return
        if content_length > 200 * 1024 * 1024:
            self.send_json_response({"error": "File too large (200 MB maximum)"}, 400)
            return

        try:
            pptx_bytes = self.rfile.read(content_length)
        except Exception as e:
            self.send_json_response({"error": f"Failed to read upload: {e}"}, 400)
            return

        try:
            images = convert_pptx_to_images(pptx_bytes)
            if not images:
                self.send_json_response({"error": "No slides were exported from the presentation"}, 400)
                return
            self.send_json_response({"success": True, "slides": images, "count": len(images)})
        except Exception as e:
            self.send_json_response({"error": f"PowerPoint conversion error: {e}"}, 500)

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
    server = ThreadingHTTPServer(("127.0.0.1", PORT), PresentationHandler)

    def stop_when_closed():
        print("\nThe presentation page was closed. Shutting down...")
        server.shutdown()

    PresentationHandler.tabs = TabTracker(stop_when_closed)
    print(f"Starting server on http://127.0.0.1:{PORT}")
    print("It stops by itself when the presentation page (index.html) is closed. Press Ctrl+C to stop it sooner.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()