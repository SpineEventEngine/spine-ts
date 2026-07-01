# T-0012.4: Storage Factory And Record Storage Reset

Status: implemented
Start: `2026-07-01 20:20 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-4-storage-factory-record-storage`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-4-storage-factory-record-storage`
Baseline commit: `1b855fd`

## Goal

Replace the broad `@spine-ts/storage` adapter surface with a small
JVM-aligned storage seam:

- `StorageFactory` with one mandatory adapter method:
  `createRecordStorage(context, spec)`;
- `Storage` and `RecordStorage` contracts for identified Protobuf records;
- declarative `RecordSpec` and columns;
- an in-memory factory and record storage;
- `EventStore` as a framework delegate over `RecordStorage`.

## Must Preserve

- Use Buf-generated Protobuf-ES messages directly. Generated output remains
  ignored under `packages/<package>/generated`.
- Keep source files grouped by semantics and tests under `packages/storage/test`
  with matching folders.
- Prefer short JVM-familiar names. No name may exceed four semantic components.
- Do not export standalone helper functions unless there is a strong reason.
- Use classes or grouped objects for behavior. Keep methods small.
- Keep line length at 120 characters maximum.
- Keep read-side/write-side segregation. This task adds no buses, repositories,
  delivery, gRPC, stand, or bounded-context runtime.

## JVM Evidence

The task must inspect and follow:

- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/StorageFactory.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/RecordStorage.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/RecordSpec.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/InMemoryStorageFactory.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/memory/InMemoryRecordStorage.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventStore.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/store/DefaultEventStore.java`.

## Required Changes

- Remove `StorageAdapter`, delivery stores, diagnostics, tenant index, aggregate
  event-history adapter, and other ahead-of-roadmap concepts from the storage
  package.
- Repack storage source into semantic folders. The package root `src/index.ts`
  should only re-export public API.
- Add storage tests under matching semantic folders.
- Update `packages/storage/README.md`.
- Update architecture/API docs when public API changes.
- Update this task log, implementation report, work log, and review log.

## Acceptance

- In-memory storage is a real adapter for the `RecordStorage` contract, not a
  test stub.
- Record storage supports tenant slices for multitenant contexts.
- Records are cloned on write/read using the generated Protobuf API first:
  generated messages should use `.clone()` when available.
- Queries are deterministic and support the scoped record-storage needs:
  identifiers, columns, sorting, positive limits, and simple masks when the
  record shape supports them.
- `EventStore` persists generated Spine `Event` messages through
  `RecordStorage`.
- No bus, bounded-context runtime, repository dispatch, delivery, stand, or
  gRPC behavior is introduced.

## Baseline Verification

Fresh baseline in this worktree:

- Command: `env CI=true corepack pnpm verify`.
- Result: passed.
- Evidence: 28 test files, 291 tests, coverage statements 96.5%, branches
  91.22%, functions 99.31%, lines 96.44%.
- Existing warning only: TypeDoc cannot build source links because the local
  `origin` remote is not valid.

## Process

- One implementation sub-agent owns the code change.
- Required reviewer lanes after implementation:
  - code style/maintainability;
  - documentation;
  - TypeScript/API docs;
  - security;
  - performance/reliability.
- Reviewer comments feed back to the authoring sub-agent until all lanes are
  clean.
- All participating sub-agents are closed after their role is complete.
