# Spine TS

This repository is the TypeScript/Node.js implementation workspace for a Spine-inspired server-side framework.

Current status: workspace/toolchain bootstrap, copied Spine Protobuf contract
intake, core validation facades, descriptor-backed server metadata, a
server-owned set-once state-transition validator, and a non-durable in-memory
storage adapter. The server package includes entity transactions, entity
families, repository registration, aggregate snapshot/event storage, command
and event route calculation, delivery inbox storage, generated handler registry
ingestion/discovery, and real Connect/Node `CommandService`, `QueryService`,
and `SubscriptionService` wiring. The runnable `examples/todo` package uses
bare handler decorators plus generated Protobuf and handler-registry artifacts
from `pnpm proto:generate`; production storage adapters, import bus,
scheduler, process supervision, richer query planning, and durable
subscription recovery remain future work.

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
