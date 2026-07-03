# Spine TS

This repository is the TypeScript/Node.js implementation workspace for a Spine-inspired server-side framework.

Current status: workspace/toolchain bootstrap, the first copied Spine Protobuf
contract intake, core validation facades, descriptor-backed server metadata, a
server-owned set-once state-transition validator, and a non-durable in-memory
storage adapter. The server package now includes entity transactions, entity
families, repository registration, aggregate snapshot/event storage,
repository command/event route calculation, and the first durable
delivery/inbox slice for inbox rows, dedup guards, and shard leases. Handler
invocation, delivery worker loops/execution, Stand/read-side query behavior,
gRPC services, ZeroMQ transport, production storage adapters, import bus,
scheduler, process supervision, and the to-do domain are intentionally deferred
to later tasks.

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
- Package tests live outside package source under `packages/<package>/test`.
- Cleanup enforcement runs through `pnpm lint` and therefore also through
  `pnpm verify`.

## Useful Commands

- `pnpm install`
- `pnpm lint`
- `pnpm verify`
- `pnpm docs:api`
- `pnpm proto:generate`

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the framework user guide and
runnable API examples, and [build-protocol](build-protocol/README.md) for the
implementation protocol.
