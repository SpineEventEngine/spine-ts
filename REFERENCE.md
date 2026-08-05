# Spine TS repository reference

This reference is for coding agents and maintainers. Beginners should start
with the [root README](README.md) and [end-user guide](docs/USER_GUIDE.md).

## Workspace boundaries

Framework packages live in `packages/`; runnable learning applications live in
`examples/`. Imported Spine Protos live in `packages/proto/proto/` with their
source manifest. `compatibility-tests/jvm/` performs static compatibility
checks without building Spine JVM.

Generated Protobuf, model modules, application registries, and handler
registries are ignored outputs. Produce them with `pnpm proto:generate`; never
edit them. `pnpm typecheck:build:generated` consumes the generated graph.

## Application entry points

`@spine-event-engine/server` is the Node application entry point.
`Server.start()` is embedding mode: the caller owns signals and must close the
returned `RunningServer`. `Server.run()` is process-owning mode and coordinates
`SIGINT`/`SIGTERM` shutdown across running servers.

Browser applications configure `ServerOptions.browser` with exact origins,
session resolution, authorization, actor/tenant context resolution, clock,
principal fingerprinting, optional schema registry, and optional strict opaque
cookies. The server keeps its native HTTP/2 backend on an ephemeral loopback
port and returns only the authenticated Connect/gRPC-Web URL. Framework code
owns listener creation, CORS, routing, readiness, rollback, subscription
bindings, and shutdown. Application code owns identity-provider flows, durable
sessions, policy, TLS, and deployment.

## Package responsibilities

- `proto` and `proto-tools`: framework contracts and application model generation.
- `core`: validation, type URLs, `Any`, registries, envelopes, and rejections.
- `server`: bounded contexts, entities, services, delivery, environments, and hosting.
- `client-node`, `client-web`, `client-react`: Node, browser, and React clients.
- `auth`: provider-neutral sessions, policies, trusted contexts, and gateways.
- `storage*`: storage contract, in-memory implementation, Datastore, and MySQL.
- `delivery-*` and `transport`: in-memory delivery coordination and same-host IPC.
- `testing`: end-user `BlackBox` application testing.

Each package README teaches ordinary use. Its adjacent `REFERENCE.md` records
detailed exports, lifecycle, trust, error, concurrency, and test constraints.

## Stand subscription registries

`StandSubscriptionRegistry.get(id)` returns one clone of an admitted definition
or `undefined`; it never exposes an in-flight reservation. `cleanup()` removes
at most 25 expired pending definitions and returns its scanned/deleted counts
plus `more` when another expired page remains. `close()` is idempotent, waits
for admitted operations, and makes every later registry operation reject as
closed. A built-in durable registry owns three storage handles: definition,
control, and fixed staging. A custom registry remains one owned handle.

## Verification

Use the smallest focused test while editing, then run the repository gates:

```bash
pnpm proto:generate
pnpm typecheck:build:generated
pnpm docs:check:generated
pnpm lint
pnpm verify
```

Some listener, IPC, browser, Datastore, and MySQL tests need native permissions
or explicitly configured external services. Do not treat a sandbox `EPERM` as
a product failure; rerun the same deterministic command in a suitable native
environment.

## Protected development records

The autonomous workflow is defined under `build-protocol/`. Task branches use
isolated worktrees, record review and verification evidence, and are pushed
before and after integration. Preserve unrelated dirty files and never modify
human review notes unless the user asks explicitly.
