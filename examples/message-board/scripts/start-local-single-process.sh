#!/usr/bin/env bash
# Starts the local in-memory app/Gateway and stock Vite UI; it owns both children.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
app_log=$(mktemp)
app=
ui=
cleanup() {
  test -z "$ui" || kill "$ui" 2>/dev/null || true
  test -z "$app" || kill "$app" 2>/dev/null || true
  wait "$ui" 2>/dev/null || true
  wait "$app" 2>/dev/null || true
  rm -f "$app_log"
}
trap cleanup EXIT INT TERM
pnpm -C "$root" typecheck:build
pnpm -C "$root/examples/message-board/app" start >"$app_log" 2>&1 & app=$!
for attempt in $(seq 1 30); do
  grep -q 'MessageBoard local server ready' "$app_log" && break
  kill -0 "$app" 2>/dev/null || { cat "$app_log" >&2; exit 1; }
  sleep 1
done
grep -q 'MessageBoard local server ready' "$app_log" || { cat "$app_log" >&2; exit 1; }
echo 'Message Board local UI: http://127.0.0.1:5173'
pnpm -C "$root/examples/message-board/web" start & ui=$!
wait "$ui"
