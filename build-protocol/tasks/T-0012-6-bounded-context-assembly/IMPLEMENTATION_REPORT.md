# Implementation Report: T-0012.6 BoundedContext Assembly

Status: complete; verified and ready for parent integration
Branch: `task/T-0012-6-bounded-context-assembly`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-6-bounded-context-assembly`
Baseline commit: `e0a6f5e`

## Summary

Implemented the T-0012.6 bounded-context assembly slice.

- Replaced the metadata-only bounded-context shell with a small builder/runtime
  assembly surface.
- Added `addCommandDispatcher()`, `removeCommandDispatcher()`,
  `addEventDispatcher()`, `removeEventDispatcher()`, and
  `withStorageFactory()`.
- `build()` now creates a `BoundedContext` that owns a `CommandBus` and an
  `EventBus`; the `EventBus` is backed by an `EventStore` created from the
  configured `StorageFactory`.
- Built contexts expose post-only `commandBus()` and `eventBus()` endpoints
  while keeping repository registration, delivery, stand, gRPC, transport
  execution, scheduler, import bus, and system context runtime out of scope.
- Repository registration was shrunk to chainable pending no-op builder methods;
  built contexts no longer expose repository arrays.
- Removed bounded-context repository registration error/code/operation exports
  from the package root and API docs expectations.
- Updated package README, API docs overview, architecture docs, user guide, and
  public export tests.

## Round-1 Review Fix Summary

- Moved the `BoundedContext` class ahead of `BoundedContextBuilder` and
  `ContextSpec` in `packages/server/src/context/bounded-context.ts`.
- Converted `Repository` and related repository entity imports to type-only
  imports in bounded-context assembly.
- Added `CommandEndpoint` and `EventEndpoint` as minimal post-only exported
  endpoint types, with stable frozen endpoint objects returned by
  `context.commandBus()` and `context.eventBus()`.
- Proved the context endpoint surface lacks `register()` while `post()` still
  reaches builder-registered dispatchers and event storage.
- Removed the write-only builder repository set; `add(repository)` and
  `remove(repository)` now remain tiny chainable pending no-ops for T-0012.7.
- Updated stale docs/logs so the slice is described as bounded-context assembly,
  not only immutable metadata, without claiming repositories, delivery, Stand,
  gRPC, transport execution, scheduler, import bus, system context runtime,
  tenant index, or server builder have landed.
- Known concern: multitenant event storage still has no tenant-selection seam.
  Tenant-specific event-store scoping remains deferred to later tenancy/runtime
  work.

## Baseline Verification

- `env CI=true corepack pnpm verify` passed before implementation.
- Evidence: 35 test files, 302 tests, coverage statements 95.61%, branches
  90.08%, functions 98.37%, lines 95.60%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning
  only. Proto lint/generate and generated-clean checks passed.

## JVM Evidence Read

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `BoundedContext.java`;
- `BoundedContextBuilder.java`;
- `ServerEnvironment.java` path identified for storage-factory context.

## Review Status

Round 1 reviewer findings were fixed in
`db69bdf18c9a6fc2c62b033b840f250093280c5d`. Round 2 required reviewer lanes
reported no Critical, Important, or Minor findings. All participating
sub-agents with known IDs were closed.

## Verification So Far

- Round-1 RED:
  `pnpm test packages/server/test/context/bounded-context.test.ts` failed with
  1 expected failure because `"register" in context.commandBus()` was still
  `true`.
- Round-1 focused GREEN:
  `pnpm test packages/server/test/context/bounded-context.test.ts` passed with
  1 file / 10 tests.
- Round-1 affected API test:
  `pnpm test packages/server/test/index.test.ts` passed with 1 file / 10 tests.
- Round-1 build typecheck:
  initial `pnpm typecheck:build` failed on two implicit endpoint lambda
  parameters; after annotation, `pnpm typecheck:build` passed.
- Round-1 focused verification:
  `pnpm test packages/server/test/context/bounded-context.test.ts packages/server/test/index.test.ts`
  passed with 2 files / 20 tests.
- Round-1 typecheck:
  `pnpm typecheck` passed.
- Round-1 docs/API:
  `pnpm docs:check` passed. Existing warning only: TypeDoc cannot build source
  links because local `origin` is invalid. API checker reported 125 expected
  `@spine-ts/server` exports.
- Round-1 full verification:
  sandboxed `pnpm verify` passed typecheck, lint, format, and 34/35 normal test
  files, then failed in
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts` with the known
  `Operation not permitted` IPC failure. Escalated `pnpm verify` passed:
  35 test files / 276 tests in normal and coverage runs; coverage statements
  95.45%, branches 90.37%, functions 96.81%, lines 95.44%; docs/API checks
  passed with the existing invalid-`origin` TypeDoc warning; proto
  lint/generate and generated-clean passed.
- RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/test/context/bounded-context.test.ts`
  failed with 7 expected failures for missing `commandBus()`, `eventBus()`,
  dispatcher add/remove methods, `withStorageFactory()`, and old repository
  exposure.
- Focused GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/test/context/bounded-context.test.ts`
  passed with 1 file / 10 tests.
- Nearby server tests:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/test/context/bounded-context.test.ts packages/server/test/bus/command-bus.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/runtime/runtime-routing.test.ts packages/server/test/index.test.ts`
  passed with 5 files / 40 tests.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm typecheck:tooling` passed.
- `corepack pnpm lint` passed.
- `node scripts/check-api-docs.mjs` passed with the existing invalid-`origin`
  TypeDoc warning only.
- `corepack pnpm format:check` passed.
- Full verification:
  - Sandboxed `env CI=true corepack pnpm verify` passed typecheck, lint, and
    format, then failed in `packages/transport/test/zeromq/local-ipc-smoke.test.ts`
    with the known `Operation not permitted` local IPC error.
  - Escalated `env CI=true corepack pnpm verify` passed. Evidence: 35 test
    files / 276 tests passed in normal and coverage runs; coverage statements
    95.44%, branches 90.37%, functions 96.8%, lines 95.44%; docs/API checks
    passed with the existing invalid-`origin` TypeDoc warning; proto
    lint/generate and generated-clean checks passed.
- Final verification after round 2 review closure:
  - escalated `env CI=true corepack pnpm verify` passed with 35 test files and
    276 tests;
  - coverage: statements 95.45%, branches 90.37%, functions 96.81%, lines
    95.44%;
  - docs/API/proto checks passed with the existing invalid-`origin` TypeDoc
    warning only.
