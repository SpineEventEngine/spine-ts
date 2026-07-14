# Spine TS

This repository is the TypeScript/Node.js implementation workspace for a Spine-inspired server-side framework.

Current status: verified local/example readiness over copied Spine Protobuf
contracts, core validation/envelope helpers, descriptor-backed server metadata,
bare decorator ingestion through generated handler registries, framework-owned
entity transactions, repository-backed aggregate/projection/process-manager
execution, read-side catch-up, durable delivery inbox primitives, durable
inactive subscription recovery, adapter-neutral transport contracts,
adapter-private same-host ZeroMQ IPC, and real Connect/Node `CommandService`,
`QueryService`, and `SubscriptionService` wiring hosted by a small local HTTP/2
`Server`.

The runnable `examples/todo` package is a real local Connect/Node
gRPC-compatible app. It uses generated Protobuf and handler-registry artifacts
from the build workflow, bare application handler decorators, and process-local
in-memory storage. It is not a production persistence, deployment,
authentication, tracing, health-check, process-supervision, or multi-host
transport recipe. The initial release excludes durable production storage
adapters, remote/multi-host transport adapters, broker or worker process
supervision, deployment/authentication/tracing/health hardening, retained
attempt/update replay policy, application-owned semantic-tag registration or
handler materialization, and broader production verification. These are release
exclusions, not commitments to a future policy or implementation.

## Workspace

- Package manager: `pnpm@11.9.0` via the `packageManager` field.
- Node.js engine target: Node 24 LTS or newer.
- TypeScript module target: ESM-first `NodeNext`.
- Package boundaries: `packages/proto`, `packages/core`, `packages/server`,
  `packages/transport`, `packages/storage`, and `packages/testing`.
- Example boundary: `examples/todo`.
- Copied Spine proto contracts live under `proto/`, with source provenance in
  `proto/spine-sources.json`.
- `@spine-ts/proto` exposes curated Protobuf-ES schemas, descriptors, message
  types, and Spine custom options for the first intake set.
- `@spine-ts/core` owns type metadata, validation, and envelope helpers;
  `@spine-ts/server` owns bounded-context, service, lifecycle, and durable
  handoff behavior; `@spine-ts/storage` owns record storage; and
  `@spine-ts/transport` owns adapter-neutral transport contracts plus its
  adapter-scoped same-host ZeroMQ subpath.
- Package tests live outside package source under `packages/<package>/test`.
- Cleanup enforcement runs through `pnpm lint` and therefore also through
  `pnpm verify`.

## Useful Commands

- `pnpm install`
- `pnpm proto:generate`
- `pnpm typecheck:build`
- `pnpm docs:check`
- `pnpm vitest run examples/todo/src/index.test.ts --passWithNoTests`
- `pnpm --filter @spine-ts/example-todo start`
- `pnpm lint`
- `pnpm verify`
- `pnpm docs:api`

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the framework user guide and
runnable API examples, and [build-protocol](build-protocol/README.md) for the
implementation protocol.
