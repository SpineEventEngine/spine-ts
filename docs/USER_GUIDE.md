# Spine TS User Guide

Current status: bootstrap placeholder.

The framework does not yet expose runnable Spine-compatible behavior. This guide exists from the start so later tasks have a stable place to document real user workflows.

## What Exists Now

- A pnpm workspace with package boundaries for proto, core, server, transport, storage, and testing.
- Strict TypeScript project references configured for ESM-first NodeNext packages.
- Tooling commands for type checking, linting, formatting, tests, coverage, TypeDoc, and Buf/Protobuf-ES generation.
- A first copied Spine proto set under `proto/`, with provenance checksums in
  `proto/spine-sources.json`.
- Generated Protobuf-ES schemas exported from `@spine-ts/proto`, including
  Spine custom options and validation error messages.
- A placeholder to-do example workspace.

## What Is Deferred

- Message validation through `@spine-event-engine/validation-ts`.
- Runtime metadata registries and `Any` type URL helpers.
- gRPC service implementations.
- Entity, bus, transport, storage, and to-do domain runtime behavior.

## First Commands

```shell
pnpm install
pnpm proto:verify
pnpm proto:generate
pnpm verify
```

Generated API docs are written to `docs/api/reference` and are ignored by Git.
