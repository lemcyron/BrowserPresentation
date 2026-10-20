#!/usr/bin/env bash
# Starts the local web server for the presentation app and opens it in the browser.
# Works on macOS and Linux. Override the port with:  PORT=8080 ./start.sh
set -u

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}/index.html"

# Find a working Python 3 (each candidate is actually run, not just looked up).
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Python 3 was not found."
  echo "  macOS:  brew install python   (or https://www.python.org/downloads/)"
  echo "  Debian/Ubuntu:  sudo apt install python3"
  echo "  Fedora:  sudo dnf install python3"
  exit 1
fi

# Open the default browser (macOS: open, Linux: xdg-open).
open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1
  else
    echo "Open this address in your browser: $URL"
  fi
}

# If something is already listening on the port, just open the app.
if "$PY" -c "import socket,sys; s=socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('127.0.0.1', $PORT)) == 0 else 1)" >/dev/null 2>&1; then
  echo "A server is already running on port $PORT. Opening $URL"
  open_browser
  exit 0
fi

echo "Starting server on $URL"
echo "Press Ctrl+C to stop it."
echo

# Open the browser shortly after the server starts.
( sleep 2; open_browser ) &

# Bound to localhost only, so it is not reachable from other machines.
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
