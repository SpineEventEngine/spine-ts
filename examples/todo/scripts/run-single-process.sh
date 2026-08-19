#!/usr/bin/env bash
# Builds and starts the beginner-friendly To-Do app in one local process.
# Its Event Store is in memory, so stopping the process also discards its data.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
pnpm typecheck:build
exec node examples/todo/dist/src/single-process-app.js
