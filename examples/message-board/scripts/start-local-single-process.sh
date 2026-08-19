#!/usr/bin/env bash
# Starts the local single-process app and its stock Vite UI; Ctrl-C stops both.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
pnpm -C "$root" typecheck:build
pnpm -C "$root/examples/message-board/app" start & app=$!
trap 'kill "$app" 2>/dev/null || true' EXIT INT TERM
pnpm -C "$root/examples/message-board/web" start
