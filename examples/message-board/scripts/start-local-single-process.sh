#!/usr/bin/env bash
# Starts the local in-memory app/Gateway and stock Vite UI, then stops both.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
gateway_port=${MESSAGE_BOARD_LOCAL_PORT:-8090}
web_port=${MESSAGE_BOARD_WEB_PORT:-5173}
for port in "$gateway_port" "$web_port"; do
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || {
    echo "Message Board ports must be between 1 and 65535." >&2
    exit 1
  }
done
[[ "$gateway_port" != "$web_port" ]] || { echo "Message Board ports must differ." >&2; exit 1; }
app_log=$(mktemp)
app=
ui=
cleanup() {
  trap - EXIT INT TERM
  for pid in "$ui" "$app"; do
    test -z "$pid" || kill "$pid" 2>/dev/null || true
  done
  for pid in "$ui" "$app"; do
    test -z "$pid" && continue
    for attempt in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -f "$app_log"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
pnpm -C "$root" typecheck:build
MESSAGE_BOARD_LOCAL_PORT="$gateway_port" MESSAGE_BOARD_WEB_PORT="$web_port" node "$root/examples/message-board/app/dist/src/local-application-server.js" >"$app_log" 2>&1 & app=$!
for attempt in $(seq 1 30); do
  grep -q 'MessageBoard local server ready' "$app_log" && break
  kill -0 "$app" 2>/dev/null || { cat "$app_log" >&2; exit 1; }
  sleep 1
done
grep -q 'MessageBoard local server ready' "$app_log" || { cat "$app_log" >&2; exit 1; }
echo "Message Board local UI: http://127.0.0.1:$web_port"
VITE_MESSAGE_BOARD_GATEWAY_URL="http://127.0.0.1:$gateway_port" \
  node "$root/examples/message-board/web/node_modules/vite/bin/vite.js" "$root/examples/message-board/web" --host 127.0.0.1 --port "$web_port" --strictPort & ui=$!
wait "$ui"
