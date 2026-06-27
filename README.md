# Spine TS

This repository is the TypeScript/Node.js implementation workspace for a Spine-inspired server-side framework.

Current status: workspace and toolchain bootstrap only. Runtime behavior, copied Spine Protobuf files, validation integration, gRPC services, ZeroMQ transport, storage adapters, and the to-do domain are intentionally deferred to later tasks.

## Workspace

- Package manager: `pnpm@11.9.0` via the `packageManager` field.
- Node.js engine target: Node 24 LTS or newer.
- TypeScript module target: ESM-first `NodeNext`.
- Package boundaries: `packages/proto`, `packages/core`, `packages/server`, `packages/transport`, `packages/storage`, and `packages/testing`.
- Example boundary: `examples/todo`.

## Useful Commands

- `pnpm install`
- `pnpm verify`
- `pnpm docs:api`
- `pnpm proto:generate`

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the framework user guide placeholder and [build-protocol](build-protocol/README.md) for the implementation protocol.
