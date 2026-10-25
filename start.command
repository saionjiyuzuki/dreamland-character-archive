#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "DREAMLAND V12.6.0 requires Node.js and npm. Install Node.js LTS from https://nodejs.org/ and try again."
  read -r -p "Press Return to close..." _
  exit 1
fi

if [ ! -x "$ROOT/node_modules/.bin/tsc" ]; then
  echo "Installing TypeScript build dependency..."
  npm install
fi

echo "Building DREAMLAND V12.6.0 from src/ (stale dist will be removed first)..."
npm run build

PORT=4185
while /usr/sbin/lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT+1))
done
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to serve the local game."
  read -r -p "Press Return to close..." _
  exit 1
fi

echo "Starting DREAMLAND V12.6.0 at http://localhost:${PORT}"
python3 "$ROOT/scripts/serve.py" --directory "$ROOT" --port "$PORT" >/tmp/dreamland-v12-6-0-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://localhost:${PORT}"
echo "Keep this Terminal window open while playing. Press Control-C to stop."
wait "$SERVER_PID"
