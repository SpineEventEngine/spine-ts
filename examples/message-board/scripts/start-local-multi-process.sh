#!/usr/bin/env bash
# Starts every local multi-process dependency: Datastore, shared Delivery,
# two managed replicas, the public Gateway, and the stock browser UI.
set -euo pipefail

root=${MESSAGE_BOARD_REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
name="message-board-local-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
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

pnpm -C "$root" images:build:local --target simple-delivery-server
delivery_id=$(docker run --detach --name "$name-delivery" -p 8484:8484 \
  --env HOST=0.0.0.0 --env PORT=8484 spine-ts/simple-delivery-server:local)
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

datastore_id=$(docker run --detach --name "$name-datastore" -p 8081:8081 \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet)
for attempt in $(seq 1 30); do
  curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 && break
  docker inspect --format '{{.State.Running}}' "$datastore_id" 2>/dev/null | grep -qx true || {
    docker logs "$datastore_id" >&2 || true
    exit 1
  }
  sleep 1
done
curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 || {
  docker logs "$datastore_id" >&2 || true
  exit 1
}

pnpm -C "$root" typecheck:build
env NODE_ENV=production DELIVERY_SERVER_URL=http://127.0.0.1:8484 MESSAGE_BOARD_DELIVERY_MODE=shared \
  HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local \
  DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT="${MESSAGE_BOARD_PROCESS_COUNT:-2}" \
  DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process \
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

HOST=127.0.0.1 PORT=8090 BROWSER_ORIGIN=http://127.0.0.1:5173 BACKEND_URLS=http://127.0.0.1:8091 \
  SUBSCRIPTION_REGISTRY_NAMESPACE="$name" DATASTORE_PROJECT_ID=message-board-local \
  DATASTORE_EMULATOR_HOST=127.0.0.1:8081 node "$root/examples/message-board/app/dist/src/gateway-server.js" \
  >"$gateway_log" 2>&1 & gateway_pid=$!
for attempt in $(seq 1 30); do
  grep -q 'MessageBoard gateway ready' "$gateway_log" && break
  kill -0 "$gateway_pid" 2>/dev/null || { cat "$gateway_log" >&2; exit 1; }
  sleep 1
done
grep -q 'MessageBoard gateway ready' "$gateway_log" || { cat "$gateway_log" >&2; exit 1; }

VITE_MESSAGE_BOARD_GATEWAY_URL=http://127.0.0.1:8090 \
  pnpm -C "$root/examples/message-board/web" start:dev-server >"$ui_log" 2>&1 & ui_pid=$!
for attempt in $(seq 1 30); do
  curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 && break
  kill -0 "$ui_pid" 2>/dev/null || { cat "$ui_log" >&2; exit 1; }
  sleep 1
done
curl --fail --silent http://127.0.0.1:5173 >/dev/null 2>&1 || { cat "$ui_log" >&2; exit 1; }

echo 'Message Board local multi-process UI: http://127.0.0.1:5173'
wait "$ui_pid"
