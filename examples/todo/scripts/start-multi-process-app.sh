#!/usr/bin/env bash
# Starts the compiled To-Do Coordinator in the foreground after prerequisites are ready.
# Process and Delivery-shard counts remain explicit independent launcher inputs.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
datastore_host="${TODO_DATASTORE_HOST:-127.0.0.1}"
datastore_port="${TODO_DATASTORE_PORT:-8081}"
delivery_host="${TODO_DELIVERY_HOST:-127.0.0.1}"
delivery_port="${TODO_DELIVERY_PORT:-8484}"

exec env HOST="${TODO_APP_HOST:-127.0.0.1}" PORT="${TODO_APP_PORT:-8080}" \
DATASTORE_PROJECT_ID="${TODO_DATASTORE_PROJECT_ID:-todo-multi-process}" \
DATASTORE_EMULATOR_HOST="${TODO_DATASTORE_EMULATOR_HOST:-$datastore_host:$datastore_port}" \
DELIVERY_SERVER_URL="${TODO_DELIVERY_URL:-http://$delivery_host:$delivery_port}" \
PROCESS_COUNT="${TODO_PROCESS_COUNT:-2}" \
DELIVERY_SHARD_COUNT="${TODO_DELIVERY_SHARD_COUNT:-2}" \
  node examples/todo/dist/src/multi-process-app.js
