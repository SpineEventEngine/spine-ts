#!/usr/bin/env bash
# Starts the local Datastore emulator, managed replicas with local Delivery, Gateway, and stock UI.
set -euo pipefail
root=${MESSAGE_BOARD_REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
name="message-board-local-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
pids=()
datastore_id=
app_pid=
gateway_pid=
ui_pid=
coordinator_log=$(mktemp)
gateway_log=$(mktemp)
ui_log=$(mktemp)
cleanup() {
  trap - EXIT INT TERM
  for container in "$datastore_id" "${MESSAGE_BOARD_DELIVERY_CONTAINER:-}"; do test -z "$container" || docker rm -f "$container" 2>/dev/null || true; done
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]:-}"; do
    for attempt in $(seq 1 5); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -f "$coordinator_log" "$gateway_log" "$ui_log"
}
trap cleanup EXIT INT TERM
datastore_id=$(docker run --detach --name "$name-datastore" -p 8081:8081 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators gcloud emulators firestore start --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet)
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 && break; docker inspect --format '{{.State.Running}}' "$datastore_id" 2>/dev/null | grep -qx true || { docker logs "$datastore_id" >&2 || true; exit 1; }; sleep 1; done
curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 || { docker logs "$datastore_id" >&2 || true; exit 1; }
pnpm -C "$root" typecheck:build
if test -n "${DELIVERY_SERVER_URL:-}"; then
  env DELIVERY_SERVER_URL="$DELIVERY_SERVER_URL" MESSAGE_BOARD_DELIVERY_MODE="${MESSAGE_BOARD_DELIVERY_MODE:-local}" HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT="${MESSAGE_BOARD_PROCESS_COUNT:-2}" DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process >"$coordinator_log" 2>&1 & app_pid=$!; pids+=($app_pid)
else
  env MESSAGE_BOARD_DELIVERY_MODE="${MESSAGE_BOARD_DELIVERY_MODE:-local}" HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT="${MESSAGE_BOARD_PROCESS_COUNT:-2}" DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process >"$coordinator_log" 2>&1 & app_pid=$!; pids+=($app_pid)
fi
for attempt in $(seq 1 30); do grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" && break; kill -0 "$app_pid" 2>/dev/null || { cat "$coordinator_log" >&2; exit 1; }; sleep 1; done
grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" || { cat "$coordinator_log" >&2; exit 1; }
HOST=127.0.0.1 PORT=8090 BROWSER_ORIGIN=http://127.0.0.1:5173 BACKEND_URLS=http://127.0.0.1:8091 SUBSCRIPTION_REGISTRY_NAMESPACE="$name" DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 node "$root/examples/message-board/app/dist/src/gateway-server.js" >"$gateway_log" 2>&1 & gateway_pid=$!; pids+=($gateway_pid)
for attempt in $(seq 1 30); do grep -q 'MessageBoard gateway ready' "$gateway_log" && break; kill -0 "$gateway_pid" 2>/dev/null || { cat "$gateway_log" >&2; exit 1; }; sleep 1; done
grep -q 'MessageBoard gateway ready' "$gateway_log" || { cat "$gateway_log" >&2; exit 1; }
VITE_MESSAGE_BOARD_GATEWAY_URL=http://127.0.0.1:8090 pnpm -C "$root/examples/message-board/web" start:dev-server >"$ui_log" 2>&1 & ui_pid=$!; pids+=($ui_pid)
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 && break; kill -0 "$ui_pid" 2>/dev/null || { cat "$ui_log" >&2; exit 1; }; sleep 1; done
curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 || { cat "$ui_log" >&2; exit 1; }
echo 'Message Board local multi-process UI: http://127.0.0.1:5173'; wait "$ui_pid"
