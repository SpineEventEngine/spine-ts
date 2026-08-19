#!/usr/bin/env bash
# Starts the local Datastore emulator, real shared Delivery, managed replicas, Gateway, and stock UI.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
name="message-board-delivery-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
docker run --rm --name "$name" -p 8484:8484 spine-ts/simple-delivery-server:local & delivery=$!
trap 'kill "$delivery" 2>/dev/null || true; docker rm -f "$name" 2>/dev/null || true' EXIT INT TERM
for attempt in $(seq 1 30); do curl --fail --silent http://127.0.0.1:8484 >/dev/null 2>&1 && break; kill -0 "$delivery" 2>/dev/null || exit 1; sleep 1; done
curl --fail --silent http://127.0.0.1:8484 >/dev/null 2>&1 || exit 1
export DELIVERY_SERVER_URL=http://127.0.0.1:8484
export MESSAGE_BOARD_DELIVERY_CONTAINER="$name"
exec "$root/examples/message-board/scripts/start-local-multi-process-local-delivery.sh"
