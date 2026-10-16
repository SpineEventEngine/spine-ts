#!/usr/bin/env bash
# Starts every local multi-process dependency: Datastore, shared Delivery,
# the selected managed replicas, the public Gateway, and the stock browser UI.
set -euo pipefail

root=${MESSAGE_BOARD_REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
name="message-board-local-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
delivery_port=${MESSAGE_BOARD_DELIVERY_PORT:-8484}
datastore_port=${MESSAGE_BOARD_DATASTORE_PORT:-8081}
coordinator_port=${MESSAGE_BOARD_COORDINATOR_PORT:-8091}
gateway_port=${MESSAGE_BOARD_GATEWAY_PORT:-8090}
web_port=${MESSAGE_BOARD_WEB_PORT:-5173}
process_count=${MESSAGE_BOARD_PROCESS_COUNT:-2}
shard_count=${MESSAGE_BOARD_DELIVERY_SHARD_COUNT:-2}
image_tag=${MESSAGE_BOARD_IMAGE_TAG:-local}
for port in "$delivery_port" "$datastore_port" "$coordinator_port" "$gateway_port" "$web_port"; do
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || {
    echo "Message Board ports must be between 1 and 65535." >&2
    exit 1
  }
done
if [[ $(printf '%s\n' "$delivery_port" "$datastore_port" "$coordinator_port" "$gateway_port" "$web_port" | sort -u | wc -l | tr -d ' ') != 5 ]]; then
  echo "Message Board ports must be distinct." >&2
  exit 1
fi
[[ "$process_count" =~ ^[1-9][0-9]*$ && "$shard_count" =~ ^[1-9][0-9]*$ ]] || {
  echo "Message Board process and shard counts must be positive integers." >&2
  exit 1
}
[[ "$image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "Message Board image tag is invalid." >&2
  exit 1
}
datastore_id=
delivery_id=
app_pid=
gateway_pid=
ui_pid=
coordinator_log=$(mktemp)
gateway_log=$(mktemp)
ui_log=$(mktemp)

cleanup() {
  trap - EXIT INT TERM
  for container in "$delivery_id" "$datastore_id"; do
    test -z "$container" || docker rm -f "$container" 2>/dev/null || true
  done
  for pid in "$app_pid" "$gateway_pid" "$ui_pid"; do
    test -z "$pid" || kill "$pid" 2>/dev/null || true
  done
  for pid in "$app_pid" "$gateway_pid" "$ui_pid"; do
    test -z "$pid" && continue
    for attempt in $(seq 1 5); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -f "$coordinator_log" "$gateway_log" "$ui_log"
}
trap cleanup EXIT INT TERM

MESSAGE_BOARD_IMAGE_TAG="$image_tag" pnpm -C "$root" images:build:local --target simple-delivery-server
delivery_id=$(docker run --detach --name "$name-delivery" -p "127.0.0.1:$delivery_port:8484" \
  --env HOST=0.0.0.0 --env PORT=8484 "spine-ts/simple-delivery-server:$image_tag")
for attempt in $(seq 1 30); do
  docker logs "$delivery_id" 2>&1 | grep -q 'Delivery server listening' && break
  docker inspect --format '{{.State.Running}}' "$delivery_id" 2>/dev/null | grep -qx true || {
    docker logs "$delivery_id" >&2 || true
    exit 1
  }
  sleep 1
done
docker logs "$delivery_id" 2>&1 | grep -q 'Delivery server listening' || {
  docker logs "$delivery_id" >&2 || true
  exit 1
}

datastore_id=$(docker run --detach --name "$name-datastore" -p "127.0.0.1:$datastore_port:8081" \
  google/cloud-sdk:578.0.0-emulators \
  gcloud emulators firestore start --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet)
for attempt in $(seq 1 30); do
  curl --fail --silent "http://127.0.0.1:$datastore_port" >/dev/null 2>&1 && break
  docker inspect --format '{{.State.Running}}' "$datastore_id" 2>/dev/null | grep -qx true || {
    docker logs "$datastore_id" >&2 || true
    exit 1
  }
  sleep 1
done
curl --fail --silent "http://127.0.0.1:$datastore_port" >/dev/null 2>&1 || {
  docker logs "$datastore_id" >&2 || true
  exit 1
}

pnpm -C "$root" typecheck:build
env NODE_ENV=production DELIVERY_SERVER_URL="http://127.0.0.1:$delivery_port" \
  HOST=127.0.0.1 PORT="$coordinator_port" DATASTORE_PROJECT_ID="$name" \
  DATASTORE_EMULATOR_HOST="127.0.0.1:$datastore_port" PROCESS_COUNT="$process_count" \
  DELIVERY_SHARD_COUNT="$shard_count" node "$root/examples/message-board/app/dist/src/multi-process-app.js" \
  >"$coordinator_log" 2>&1 & app_pid=$!
for attempt in $(seq 1 30); do
  grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" && break
  kill -0 "$app_pid" 2>/dev/null || { cat "$coordinator_log" >&2; exit 1; }
  sleep 1
done
grep -q 'MessageBoard managed coordinator ready' "$coordinator_log" || {
  cat "$coordinator_log" >&2
  exit 1
}

HOST=127.0.0.1 PORT="$gateway_port" BROWSER_ORIGIN="http://127.0.0.1:$web_port" BACKEND_URLS="http://127.0.0.1:$coordinator_port" \
  DATASTORE_PROJECT_ID="$name" \
  DATASTORE_EMULATOR_HOST="127.0.0.1:$datastore_port" node "$root/examples/message-board/app/dist/src/gateway-server.js" \
  >"$gateway_log" 2>&1 & gateway_pid=$!
for attempt in $(seq 1 30); do
  grep -q 'MessageBoard gateway ready' "$gateway_log" && break
  kill -0 "$gateway_pid" 2>/dev/null || { cat "$gateway_log" >&2; exit 1; }
  sleep 1
done
grep -q 'MessageBoard gateway ready' "$gateway_log" || { cat "$gateway_log" >&2; exit 1; }

VITE_MESSAGE_BOARD_GATEWAY_URL="http://127.0.0.1:$gateway_port" \
  node "$root/examples/message-board/web/node_modules/vite/bin/vite.js" "$root/examples/message-board/web" --host 127.0.0.1 --port "$web_port" --strictPort >"$ui_log" 2>&1 & ui_pid=$!
for attempt in $(seq 1 30); do
  curl --fail --silent "http://127.0.0.1:$web_port" >/dev/null 2>&1 && break
  kill -0 "$ui_pid" 2>/dev/null || { cat "$ui_log" >&2; exit 1; }
  sleep 1
done
curl --fail --silent "http://127.0.0.1:$web_port" >/dev/null 2>&1 || { cat "$ui_log" >&2; exit 1; }

echo "Message Board local multi-process UI: http://127.0.0.1:$web_port"
wait "$ui_pid"
