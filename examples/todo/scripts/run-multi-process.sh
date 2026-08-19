#!/usr/bin/env bash
# Builds, starts, verifies, and stops the To-Do multi-process local demonstration.
# This launcher owns only its uniquely named emulator container and child processes.
set -euo pipefail

repo_root="${TODO_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
script_root="$repo_root/examples/todo/scripts"
container_name="todo-datastore-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
container_id=""
delivery_pid=""
app_pid=""
app_log="$(mktemp -t todo-multi-process.XXXXXX)"
delivery_log="$(mktemp -t todo-delivery.XXXXXX)"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  for pid in "$app_pid" "$delivery_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid" 2>/dev/null || true; fi
    for _ in {1..50}; do [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null && break; sleep 0.1; done
  done
  if [[ -n "$container_id" ]]; then docker rm --force "$container_id" >/dev/null 2>&1 || true; fi
  rm -f "$app_log" "$delivery_log"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$repo_root"
pnpm typecheck:build
container_id="$(TODO_DATASTORE_CONTAINER_NAME="$container_name" "$script_root/start-datastore-emulator.sh")"
for attempt in {1..30}; do
  if ! docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null | grep -qx "true"; then
    echo "Datastore emulator exited before readiness." >&2
    docker logs "$container_id" >&2 || true
    exit 1
  fi
  if docker logs "$container_id" 2>&1 | grep -q "Dev App Server is now running"; then break; fi
  if [[ "$attempt" == 30 ]]; then
    echo "Datastore emulator did not become ready." >&2
    docker logs "$container_id" >&2 || true
    exit 1
  fi
  sleep 1
done
"$script_root/start-delivery-server.sh" >"$delivery_log" 2>&1 &
delivery_pid=$!
for attempt in {1..30}; do
  if grep -q "Delivery server listening at" "$delivery_log"; then break; fi
  if ! kill -0 "$delivery_pid" 2>/dev/null; then cat "$delivery_log" >&2; exit 1; fi
  if [[ "$attempt" == 30 ]]; then echo "Delivery server did not become ready." >&2; exit 1; fi
  sleep 1
done
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
