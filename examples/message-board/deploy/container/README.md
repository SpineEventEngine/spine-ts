# Message Board container images

Use these local images to run a Spine TS application built once, without
generating Protobuf code or compiling TypeScript at runtime. They are examples
for deployment work, not published images.

## 🚀 Build the images

From the repository root, build the workspace and then create all three images:

```bash
pnpm typecheck:build
pnpm images:build:local
```

The second command packs exact-version workspace packages into a temporary,
bounded build context. It installs those packages offline and removes the
temporary context after success, failure, `SIGINT`, or `SIGTERM`.

| Local tag                               | Default process                                 |
| --------------------------------------- | ----------------------------------------------- |
| `spine-ts/message-board:local`          | Combined browser gateway and application server |
| `spine-ts/standalone-gateway:local`     | Browser gateway for a separate application      |
| `spine-ts/simple-delivery-server:local` | The in-memory simple delivery server            |

The Message Board image also contains application-only and managed entrypoints. A
deployment can override its command with:

```text
node_modules/@spine-event-engine/example-message-board-app/dist/src/managed-entry.js
```

## ⚙️ Configure the processes

The images set `NODE_ENV=production`. Supply these values when starting them:

| Process                  | Required environment variables                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Managed application node | `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, `DELIVERY_SERVER_URL`, `PROCESS_COUNT`, `DELIVERY_SHARD_COUNT` |
| Combined                 | `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, `DELIVERY_SERVER_URL`, `BROWSER_ORIGIN`, `SUBSCRIPTION_REGISTRY_NAMESPACE` |
| Gateway (local)          | `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, `BROWSER_ORIGIN`, `SUBSCRIPTION_REGISTRY_NAMESPACE`, `BACKEND_URLS` or `BACKEND_URL` |
| Gateway (GKE)            | `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, `BROWSER_ORIGIN`, `SUBSCRIPTION_REGISTRY_NAMESPACE`, `BACKEND_DISCOVERY_SERVICE`, `BACKEND_DISCOVERY_PORT` |
| Delivery server          | `HOST`, `PORT`                                                                                         |

Every browser process additionally requires one shared
`MESSAGE_BOARD_SESSION_ISSUER`, `MESSAGE_BOARD_SESSION_AUDIENCE`,
`MESSAGE_BOARD_SESSION_KEY_ID`, and `MESSAGE_BOARD_SESSION_PRIVATE_KEY`.
Each process constructs a Datastore client from
`DATASTORE_PROJECT_ID` and passes that same client into its storage factory.
Browser-capable replicas must share both the signing values and the registry
namespace.

`DELIVERY_SERVER_URL` is the sole application Delivery setting. In these
references it is `http://delivery:8484` for Compose and
`http://simple-delivery-server:8484` for Kubernetes; `8484` is the delivery
server listener port, not an application browser port. Do not add separate
delivery host or port variables.

`PROCESS_COUNT` is the explicit number of full application replicas launched
inside one managed node. `DELIVERY_SHARD_COUNT` is selected independently by
the application; this reference uses two of each. Application code selects
Datastore for Message Board data. The standalone gateway creates a separate Datastore-backed
subscription registry and isolates its records with the required namespace.
Infrastructure passes these values; it does not choose a storage provider.

`BACKEND_URLS` is the comma-separated local Compose fixture and `BACKEND_URL`
remains its legacy single-backend form. Production Kubernetes gateways use
`BACKEND_DISCOVERY_SERVICE` and `BACKEND_DISCOVERY_PORT` for GKE service DNS;
they do not configure a fixed backend list.

For example, start the native application against a disposable Datastore
emulator:

```bash
docker network create message-board-local

docker run --detach --name message-board-datastore \
  --network message-board-local --network-alias datastore \
  gcr.io/google.com/cloudsdktool/google-cloud-cli@sha256:cda01b8c880e9161992c3fd61d7d0e153b4dd073aa4a9d62ad79243907cf8dd4 \
  gcloud emulators firestore start \
  --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet

docker run --rm --name message-board-app \
  --network message-board-local --publish 8080:8080 \
  --env HOST=0.0.0.0 --env PORT=8080 \
  --env DATASTORE_PROJECT_ID=message-board-local \
  --env DATASTORE_EMULATOR_HOST=datastore:8081 \
  --env DELIVERY_SERVER_URL=http://delivery:8484 \
  --env PROCESS_COUNT=2 --env DELIVERY_SHARD_COUNT=2 \
  spine-ts/message-board:local \
  node_modules/@spine-event-engine/example-message-board-app/dist/src/managed-entry.js
```

Stop the application with `Ctrl-C`, then remove the emulator and network:

```bash
docker rm --force message-board-datastore
docker network rm message-board-local
```

Node runs as PID 1. `SIGINT` and `SIGTERM` stop intake, close the server
environment facilities, and must finish within ten seconds. The images do not
add application health endpoints. Readiness is the process listener becoming
available.

## ⚠️ Limits

- No image or npm package is published by these commands.
- The simple delivery server keeps state only in memory and is neither durable
  nor highly available.
- These images do not provide TLS, cloud credentials, secrets management, or
  identity-provider configuration. A deployment supplies them at runtime.
- Multiple application replicas require the standalone gateway topology.

The deterministic Compose and Kubernetes examples build on these tags in the
next deployment layer.
