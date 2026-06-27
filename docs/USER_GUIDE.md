# Spine TS User Guide

Current status: bootstrap placeholder.

The framework does not yet expose runnable Spine-compatible behavior. This guide exists from the start so later tasks have a stable place to document real user workflows.

## What Exists Now

- A pnpm workspace with package boundaries for proto, core, server, transport, storage, and testing.
- Strict TypeScript project references configured for ESM-first NodeNext packages.
- Tooling commands for type checking, linting, formatting, tests, coverage, TypeDoc, and Buf/Protobuf-ES stubs.
- A placeholder to-do example workspace.

## What Is Deferred

- Copying Spine `.proto` files.
- Generating Protobuf-ES schemas from Spine contracts.
- Message validation through `@spine-event-engine/validation-ts`.
- gRPC service implementations.
- Entity, bus, transport, storage, and to-do domain runtime behavior.

## First Commands

```shell
pnpm install
pnpm verify
```

Generated API docs are written to `docs/api/reference` and are ignored by Git.
