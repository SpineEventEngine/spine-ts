#!/usr/bin/env bash
# Builds, starts, verifies, and stops the To-Do multi-process local demonstration.
# This launcher owns only its uniquely named emulator container and child processes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
script_root="$repo_root/examples/todo/scripts"
container_name="todo-datastore-$$"
delivery_pid=""
app_pid=""
app_log="$(mktemp -t todo-multi-process.XXXXXX)"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then kill "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$delivery_pid" ]] && kill -0 "$delivery_pid" 2>/dev/null; then kill "$delivery_pid" 2>/dev/null || true; fi
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  rm -f "$app_log"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$repo_root"
pnpm typecheck:build
TODO_DATASTORE_CONTAINER_NAME="$container_name" "$script_root/start-datastore-emulator.sh" >/dev/null
for attempt in {1..30}; do
  if docker logs "$container_name" 2>&1 | grep -q "Dev App Server is now running"; then break; fi
  sleep 1
  if [[ "$attempt" == 30 ]]; then echo "Datastore emulator did not become ready." >&2; exit 1; fi
done
"$script_root/start-delivery-server.sh" &
delivery_pid=$!
sleep 1
if ! kill -0 "$delivery_pid" 2>/dev/null; then echo "Delivery server exited before readiness." >&2; exit 1; fi
"$script_root/start-multi-process-app.sh" >"$app_log" 2>&1 &
app_pid=$!
for attempt in {1..30}; do
  if grep -q "To-Do multi-process Coordinator ready" "$app_log"; then break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then cat "$app_log" >&2; exit 1; fi
  sleep 1
  if [[ "$attempt" == 30 ]]; then echo "To-Do app did not become ready." >&2; exit 1; fi
done
cat "$app_log"
wait "$app_pid"
