#!/usr/bin/env bash
# Starts the repository's local Delivery server in the foreground for its caller.
# The parent launcher records and stops this child process during cleanup.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
exec env HOST="${TODO_DELIVERY_HOST:-127.0.0.1}" PORT="${TODO_DELIVERY_PORT:-8484}" \
  node packages/delivery-server/dist/bin/spine-delivery-server.js
