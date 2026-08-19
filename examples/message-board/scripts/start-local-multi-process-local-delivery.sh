#!/usr/bin/env bash
# Starts the local Datastore emulator, managed replicas with local Delivery, Gateway, and stock UI.
set -euo pipefail
root=${MESSAGE_BOARD_REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
name="message-board-local-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
pids=()
coordinator_log=$(mktemp)
gateway_log=$(mktemp)
ui_log=$(mktemp)
cleanup() {
  trap - EXIT INT TERM
  docker rm -f "$name-datastore" "${MESSAGE_BOARD_DELIVERY_CONTAINER:-}" 2>/dev/null || true
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]:-}"; do
    for attempt in $(seq 1 5); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -f "$coordinator_log" "$gateway_log" "$ui_log"
}
trap cleanup EXIT INT TERM
docker run --rm --name "$name-datastore" -p 8081:8081 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators gcloud emulators firestore start --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet & pids+=($!)
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 && break; kill -0 "${pids[0]}" 2>/dev/null || exit 1; sleep 1; done
curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 || exit 1
pnpm -C "$root" typecheck:build
if test -n "${DELIVERY_SERVER_URL:-}"; then
  env DELIVERY_SERVER_URL="$DELIVERY_SERVER_URL" MESSAGE_BOARD_DELIVERY_MODE="${MESSAGE_BOARD_DELIVERY_MODE:-local}" HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT=2 DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process >"$coordinator_log" 2>&1 & pids+=($!)
else
  env MESSAGE_BOARD_DELIVERY_MODE="${MESSAGE_BOARD_DELIVERY_MODE:-local}" HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT=2 DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process >"$coordinator_log" 2>&1 & pids+=($!)
fi
for attempt in $(seq 1 30); do grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" && break; kill -0 "${pids[1]}" 2>/dev/null || { cat "$coordinator_log" >&2; exit 1; }; sleep 1; done
grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" || { cat "$coordinator_log" >&2; exit 1; }
HOST=127.0.0.1 PORT=8090 BROWSER_ORIGIN=http://127.0.0.1:5173 BACKEND_URLS=http://127.0.0.1:8091 SUBSCRIPTION_REGISTRY_NAMESPACE="$name" DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 node "$root/examples/message-board/app/dist/src/gateway-server.js" >"$gateway_log" 2>&1 & pids+=($!)
for attempt in $(seq 1 30); do grep -q 'MessageBoard gateway ready' "$gateway_log" && break; kill -0 "${pids[2]}" 2>/dev/null || { cat "$gateway_log" >&2; exit 1; }; sleep 1; done
grep -q 'MessageBoard gateway ready' "$gateway_log" || { cat "$gateway_log" >&2; exit 1; }
VITE_MESSAGE_BOARD_GATEWAY_URL=http://127.0.0.1:8090 pnpm -C "$root/examples/message-board/web" start >"$ui_log" 2>&1 & pids+=($!)
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 && break; kill -0 "${pids[3]}" 2>/dev/null || { cat "$ui_log" >&2; exit 1; }; sleep 1; done
curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 || { cat "$ui_log" >&2; exit 1; }
echo 'Message Board local multi-process UI: http://127.0.0.1:5173'; wait "${pids[3]}"
