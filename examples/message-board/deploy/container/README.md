# MessageBoard container images

These local images demonstrate how a Spine TS application can be built once
and started without generating Protobuf code or compiling TypeScript at
runtime. They are examples for deployment work, not published images.

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

The MessageBoard image also contains the application-only entrypoint. A
deployment can override its command with:

```text
node_modules/@spine-event-engine/example-message-board-app/dist/src/application-entry.js
```

## ⚙️ Configure the processes

The images set `NODE_ENV=production`. Supply these values when starting them:

| Process          | Required environment variables                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| Application only | `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, `SPINE_IPC_DIRECTORY`                  |
| Combined         | Application values plus `BROWSER_ORIGIN` and `SUBSCRIPTION_REGISTRY_NAMESPACE` |
| Gateway          | Combined values plus `BACKEND_URL`                                             |
| Delivery server  | `HOST`, `PORT`                                                                 |

`SPINE_IPC_DIRECTORY` is an absolute, container-local directory used by the
existing same-host ZeroMQ transport. Application code selects Datastore for
MessageBoard data. The standalone gateway creates a separate Datastore-backed
subscription registry and isolates its records with the required namespace.
Infrastructure passes these values; it does not choose a storage provider.

Node runs as PID 1. `SIGINT` and `SIGTERM` stop intake, close the server-owned
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
