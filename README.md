# Spine TS — DDD and CQRS applications in TypeScript

A framework helping build Domain-Driven Design (DDD) and CQRS applications on
Node.js with less code.

> **🔧 Spine TS is an experimental snapshot.** Its public API may change before
> the first stable release.

## 💡 Why use Spine TS?

- ✅ **Keep contracts in Protobuf.** Commands, events, entities, validation, and
  query columns share one model.
- ✅ **Write focused domain code.** Aggregates protect write-side consistency,
  Process Managers coordinate multi-step work across Aggregates in response to
  events, and Projections provide query-side views through generated, type-safe
  handlers.
- ✅ **Choose storage in application code.** Start in memory, then configure
  Google Cloud Datastore or MySQL without changing domain handlers.
- ✅ **Serve Node and browser clients.** Native gRPC, Connect, and gRPC-Web use
  the same Command, Query, and Subscription services.
- ✅ **Test applications as a user would.** `BlackBox` exercises complete bounded
  contexts without exposing test-only runtime APIs.

## ✨ What is included?

**Application runtime**

- Bounded Contexts, Aggregates, Process Managers, Projections, generated
  handlers, validation, and rejections.
- A `Server` that manages startup, readiness, shutdown, and optional authenticated
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

## 🚀 Try the Message Board application

Install the workspace dependencies:

```bash
pnpm install --frozen-lockfile
```

Build the generated model, handlers, and TypeScript once:

```bash
pnpm typecheck:build
```

Start the Message Board server in one terminal:

```bash
pnpm --dir examples/message-board/app start
```

Start its React UI in another terminal:

```bash
pnpm --dir examples/message-board/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The example uses
in-memory storage and a local development identity, so it is safe to explore
without cloud credentials.

See the [Message Board guide](examples/message-board/README.md) for a beginner walkthrough.
For the two-node, one-Gateway development topology, see the
[Distributed Message Board](examples/distributed-message-board/README.md).
For production-style deployment guidance, use one standalone Gateway with
[GKE](packages/deployment-gke/README.md) headless-Service discovery or
[GCE](packages/deployment-gce/README.md) leased discovery. Operators configure
scaling and storage selection; Cloud Run and multiple Gateways are not included.

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

| Goal                            | Package                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Build and run a bounded context | [`@spine-event-engine/server`](packages/server/README.md)                              |
| Define Proto contracts          | Application model packages use [`@spine-event-engine/proto`](packages/proto/README.md) |
| Generate application model code | [`@spine-event-engine/proto-tools`](packages/proto-tools/README.md)                    |
| Connect from Node.js            | [`@spine-event-engine/client-node`](packages/client-node/README.md)                    |
| Connect from a browser          | [`@spine-event-engine/client-web`](packages/client-web/README.md)                      |
| Use React hooks                 | [`@spine-event-engine/client-react`](packages/client-react/README.md)                  |
| Test a bounded context          | [`@spine-event-engine/testing`](packages/testing/README.md) `BlackBox` tests           |
| Configure authentication        | [`@spine-event-engine/auth`](packages/auth/README.md)                                  |
| Choose a storage backend        | [`@spine-event-engine/storage`](packages/storage/README.md)                            |

## 🎓 Documentation

- [End-user guide](docs/USER_GUIDE.md)
- [Message Board example](examples/message-board/README.md)
- [Deploy on GKE](packages/deployment-gke/README.md)
- [Deploy on GCE](packages/deployment-gce/README.md)
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

## ⚠️ Experimental npm snapshots

Framework packages are available as experimental snapshots. Install an exact
version, for example:

```sh
pnpm add @spine-event-engine/server@2.0.0-snapshot.2
```

Or select the explicit snapshot tag with
`pnpm add @spine-event-engine/server@snapshot`. Do not use an unqualified
install, which would select npm's `latest` tag.

## 📄 License

Apache 2.0.

## 🔗 Related projects

- [Spine Event Engine](https://spine.io/)
- [Spine Validation for TypeScript](https://github.com/SpineEventEngine/validation)
- [Protobuf-ES](https://github.com/bufbuild/protobuf-es)
- [Connect](https://connectrpc.com/)
