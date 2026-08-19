#!/usr/bin/env bash
# Starts the local Datastore emulator, managed replicas with local Delivery, Gateway, and stock UI.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
name="message-board-local-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
pids=()
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; docker rm -f "$name-datastore" "${MESSAGE_BOARD_DELIVERY_CONTAINER:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
docker run --rm --name "$name-datastore" -p 8081:8081 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators gcloud emulators firestore start --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet & pids+=($!)
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 && break; kill -0 "${pids[0]}" 2>/dev/null || exit 1; sleep 1; done
curl --fail --silent http://127.0.0.1:8081 >/dev/null 2>&1 || exit 1
pnpm -C "$root" typecheck:build
delivery_environment=()
test -z "${DELIVERY_SERVER_URL:-}" || delivery_environment=("DELIVERY_SERVER_URL=$DELIVERY_SERVER_URL")
env "${delivery_environment[@]}" MESSAGE_BOARD_DELIVERY_MODE="${MESSAGE_BOARD_DELIVERY_MODE:-local}" HOST=127.0.0.1 PORT=8091 DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 PROCESS_COUNT=2 DELIVERY_SHARD_COUNT=2 pnpm -C "$root/examples/message-board/app" start:multi-process & pids+=($!)
HOST=127.0.0.1 PORT=8090 BROWSER_ORIGIN=http://127.0.0.1:5173 BACKEND_URLS=http://127.0.0.1:8091 SUBSCRIPTION_REGISTRY_NAMESPACE="$name" DATASTORE_PROJECT_ID=message-board-local DATASTORE_EMULATOR_HOST=127.0.0.1:8081 node "$root/examples/message-board/app/dist/src/gateway-server.js" & pids+=($!)
VITE_MESSAGE_BOARD_GATEWAY_URL=http://127.0.0.1:8090 pnpm -C "$root/examples/message-board/web" start & pids+=($!)
echo 'Message Board local multi-process UI: http://127.0.0.1:5173'; wait "${pids[2]}"
