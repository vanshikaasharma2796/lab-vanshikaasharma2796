#!/usr/bin/env sh
# scripts/start.sh - start the built-in server (page + HTTP API, tools/server.js) in the background
#   sh scripts/start.sh          port 3242
#   PORT=4242 sh scripts/start.sh
PORT="${PORT:-3242}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/server.pid"
mkdir -p "$LOG_DIR"

command -v node >/dev/null 2>&1 || { echo "Node.js was not found. Install Node.js 18 or later, then try again."; exit 1; }

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Already running (PID $(cat "$PID_FILE")) at http://localhost:$PORT/"
  exit 0
fi

cd "$ROOT" || exit 1
nohup node tools/server.js --port "$PORT" >"$LOG_DIR/server.log" 2>&1 &
echo $! >"$PID_FILE"

i=0
while [ $i -lt 60 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Started (PID $(cat "$PID_FILE")). Open http://localhost:$PORT/   API: http://localhost:$PORT/api/health   Logs: logs/server.log"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done
echo "The server did not become healthy within 30 seconds. Last lines of the log:"
tail -n 10 "$LOG_DIR/server.log"
exit 1