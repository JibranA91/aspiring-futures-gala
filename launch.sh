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

# This laptop's LAN IP — the address another device on the same network uses.
LANIP=$("$PY" -c 'import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80)); print(s.getsockname()[0])
except Exception:
    pass
finally:
    s.close()' 2>/dev/null)

echo "Aspiring Futures — Gala Fundraising Display"
echo
echo "  This laptop:    $URL"
if [ -n "$LANIP" ]; then
  echo "  Other laptop:   http://$LANIP:$PORT/audience.html   (same Wi-Fi / network)"
fi
echo
echo "  Keep this window open; press Ctrl+C to stop."

# Open this laptop's browser once the server is up (in the background).
( sleep 2
  if   command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open     >/dev/null 2>&1; then open "$URL"
  elif command -v start    >/dev/null 2>&1; then start "" "$URL"
  else true; fi ) >/dev/null 2>&1 &

exec "$PY" -m http.server "$PORT"
