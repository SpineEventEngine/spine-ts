#!/usr/bin/env bash
# Starts the local Datastore emulator, real shared Delivery, managed replicas, Gateway, and stock UI.
set -euo pipefail
root=${MESSAGE_BOARD_REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
name="message-board-delivery-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
pnpm -C "$root" images:build:local --target simple-delivery-server
delivery_id=$(docker run --detach --name "$name" -p 8484:8484 --env HOST=0.0.0.0 --env PORT=8484 spine-ts/simple-delivery-server:local)
trap 'docker rm -f "$delivery_id" 2>/dev/null || true' EXIT INT TERM
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
export DELIVERY_SERVER_URL=http://127.0.0.1:8484
export MESSAGE_BOARD_DELIVERY_MODE=shared
export MESSAGE_BOARD_DELIVERY_CONTAINER="$delivery_id"
export NODE_ENV=production
exec "$root/examples/message-board/scripts/start-local-multi-process-local-delivery.sh"
