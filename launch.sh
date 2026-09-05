#!/usr/bin/env bash
# Aspiring Futures — Gala Fundraising Display launcher.
# Serves the app on http://localhost:8080/ and opens your browser.

cd "$(dirname "$0")/gala" || { echo "Could not find the gala/ folder."; exit 1; }

URL="http://localhost:8080/"
PORT=8080

# Pick a Python interpreter.
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python  >/dev/null 2>&1; then PY=python
else echo "Python is required (python3 or python)."; exit 1; fi

# Open the browser once the server is up (in the background).
( sleep 2
  if   command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open     >/dev/null 2>&1; then open "$URL"
  elif command -v start    >/dev/null 2>&1; then start "" "$URL"
  else echo "Open $URL in your browser."; fi ) >/dev/null 2>&1 &

echo "Aspiring Futures — Gala Fundraising Display"
echo "Serving on $URL  (press Ctrl+C to stop)"
exec "$PY" -m http.server "$PORT"
