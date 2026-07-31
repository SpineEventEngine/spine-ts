# Spine TS — Event-driven applications in TypeScript

Spine TS helps Node.js applications process commands, store entity state, build
read models, and notify clients through typed Protobuf contracts.

> **🔧 Spine TS is an experimental snapshot.** Its public API may change before
> the first stable release.

## 💡 Why use Spine TS?

- ✅ **Keep contracts in Protobuf.** Commands, events, entities, validation, and
  query columns share one model.
- ✅ **Write focused domain code.** Aggregates, Process Managers, and Projections
  receive signals through generated, type-safe handlers.
- ✅ **Choose storage in application code.** Start in memory, then configure
  Google Cloud Datastore or MySQL without changing domain handlers.
- ✅ **Serve Node and browser clients.** Native gRPC, Connect, and gRPC-Web use
  the same Command, Query, and Subscription services.
- ✅ **Test applications as a user would.** `BlackBox` exercises complete bounded
  contexts without exposing test-only runtime APIs.

## ✨ What is included?

**Application runtime**

- Bounded contexts, entities, generated handlers, validation, rejections, and
  event-driven state changes.
- A `Server` that owns startup, readiness, shutdown, and optional authenticated
  browser access.
- In-memory delivery coordination for one process or a trusted local network.

**Clients and models**

- Node and browser clients for commands, queries, and subscriptions.
- A small React adapter with hooks for query and subscription lifecycles.
- Protobuf generation tools, type registries, `Any` packing, and typed query
  columns.

**Storage**

- In-memory storage for development and tests.
- Google Cloud Datastore and MySQL adapters for application-selected
  persistence.

## 🚀 Try the Chat application

Install the workspace dependencies:

```bash
pnpm install --frozen-lockfile
```

Start the Chat server in one terminal:

```bash
pnpm --dir examples/chat/app start
```

Start its React UI in another terminal:

```bash
pnpm --dir examples/chat/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The example uses
in-memory storage and a local development identity, so it is safe to explore
without cloud credentials.

See the [Chat guide](examples/chat/README.md) for a beginner walkthrough.

## 📦 Workspace map

```text
spine-ts/
├── packages/          # Framework, clients, storage adapters, and tooling
├── examples/          # Complete applications and focused examples
├── proto/             # Spine Protobuf sources copied with provenance
├── docs/              # User, browser, architecture, and API guides
└── build-protocol/    # Rules used to develop this repository
```

Start with these packages:

| Goal                            | Package                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| Build and run a bounded context | [`@spine-event-engine/server`](packages/server/README.md)             |
| Connect from Node.js            | [`@spine-event-engine/client-node`](packages/client-node/README.md)   |
| Connect from a browser          | [`@spine-event-engine/client-web`](packages/client-web/README.md)     |
| Use React hooks                 | [`@spine-event-engine/client-react`](packages/client-react/README.md) |
| Configure authentication        | [`@spine-event-engine/auth`](packages/auth/README.md)                 |
| Choose a storage backend        | [`@spine-event-engine/storage`](packages/storage/README.md)           |
| Generate application model code | [`@spine-event-engine/proto-tools`](packages/proto-tools/README.md)   |

## 🎓 Documentation

- [End-user guide](docs/USER_GUIDE.md)
- [Chat example](examples/chat/README.md)
- [Browser authentication and extension guide](docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Generated API documentation](docs/api/README.md)
- [Reference for coding agents](REFERENCE.md)

The coding-agent reference is deliberately separate from this beginner guide.
It records repository boundaries, verification commands, and detailed
implementation constraints.

## 🛠️ Development

Spine TS requires Node.js 24 LTS or newer and `pnpm@11.9.0`.

| Command                | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `pnpm proto:generate`  | Generates Protobuf and handler code.                |
| `pnpm typecheck:build` | Builds the TypeScript project graph.                |
| `pnpm test`            | Runs the test suite.                                |
| `pnpm lint`            | Checks source, documentation, and repository rules. |
| `pnpm docs:api`        | Generates and validates API documentation.          |
| `pnpm verify`          | Runs the complete release-readiness check.          |

## ⚠️ Current limits

- Packages are not published to npm yet; examples run from this workspace.
- The supplied delivery server is in-memory and loses its state on restart.
- Browser deployments still need application-selected identity providers,
  durable sessions, TLS, and network policy.
- Subscription updates are notifications, not a complete event history. Clients
  re-query entity state after reconnecting.

## 📄 License

Apache 2.0.

## 🔗 Related projects

- [Spine Event Engine](https://spine.io/)
- [Spine Validation for TypeScript](https://github.com/SpineEventEngine/validation-ts)
- [Protobuf-ES](https://github.com/bufbuild/protobuf-es)
- [Connect](https://connectrpc.com/)
