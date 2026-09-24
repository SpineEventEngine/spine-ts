#!/usr/bin/env bash
# Builds and starts the beginner-friendly To-Do app in one local process.
# Memory is the default; TODO_STORAGE can select MySQL or PostgreSQL instead.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
pnpm typecheck:build
exec node examples/todo/dist/src/single-process-app.js
