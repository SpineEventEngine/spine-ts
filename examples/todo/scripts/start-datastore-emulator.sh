#!/usr/bin/env bash
# Starts the shared local Datastore emulator and prints this launcher's container ID.
# The caller owns cleanup by removing only that named container.
set -euo pipefail

container_name="${TODO_DATASTORE_CONTAINER_NAME:?TODO_DATASTORE_CONTAINER_NAME is required}"
port="${TODO_DATASTORE_PORT:-8081}"
docker run --detach --rm --name "$container_name" --publish "$port:8081" \
  google/cloud-sdk:578.0.0-emulators \
  gcloud emulators firestore start --database-mode=datastore-mode \
  --host-port=0.0.0.0:8081 --quiet
