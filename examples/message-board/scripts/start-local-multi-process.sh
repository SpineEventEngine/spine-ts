#!/usr/bin/env bash
# Starts the documented multi-process coordinator; dependencies must be running first.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
pnpm -C "$root" typecheck:build
exec pnpm -C "$root/examples/message-board/app" start:multi-process
