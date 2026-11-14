#!/bin/sh
# Supervises the demo providers and the API: each is restarted if it exits, and everything they print goes to stdout
# and to /tmp/boot.log (served by logserver.mjs when WARDLINE_DEBUG_LOG_PORT is set).
set -u
: > /tmp/boot.log
run() {
  name="$1"; dir="$2"; shift 2
  while true; do
    echo "[$(date -u +%H:%M:%S)] starting $name" | tee -a /tmp/boot.log
    (cd "$dir" && "$@") 2>&1 | tee -a /tmp/boot.log
    echo "[$(date -u +%H:%M:%S)] $name exited; restarting in 3s" | tee -a /tmp/boot.log
    sleep 3
  done
}
[ -n "${WARDLINE_DEBUG_LOG_PORT:-}" ] && node /app/logserver.mjs &
run providers /app/services/demo-provider node dist/serve.js &
run api /app/services/api node dist/index.js &
wait
