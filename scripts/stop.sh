#!/usr/bin/env sh
# scripts/stop.sh - stop the background server started by scripts/start.sh
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/logs/server.pid"

if [ ! -f "$PID_FILE" ]; then echo "Not running (no logs/server.pid)."; exit 0; fi
PID="$(cat "$PID_FILE")"
if kill "$PID" 2>/dev/null; then echo "Stopped (PID $PID)."; else echo "PID $PID was not running; nothing to stop."; fi
rm -f "$PID_FILE"