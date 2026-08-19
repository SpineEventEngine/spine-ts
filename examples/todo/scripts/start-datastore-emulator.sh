#!/usr/bin/env bash
# Starts one disposable Datastore emulator and prints its Docker container ID.
# The caller owns cleanup by removing the returned container.
set -euo pipefail

container_name="${TODO_DATASTORE_CONTAINER_NAME:?TODO_DATASTORE_CONTAINER_NAME is required}"
port="${TODO_DATASTORE_PORT:-8081}"
docker run --detach --rm --name "$container_name" --publish "$port:8081" \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --database-mode=datastore-mode \
  --host-port=0.0.0.0:8081 --quiet
