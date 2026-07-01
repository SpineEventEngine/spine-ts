# T-0012.7: Repository Registration And Storage Opening

Status: review fixes implemented; verification passed
Start: `2026-07-01 23:41 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-7-entities-repositories-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7-entities-repositories-routing`
Baseline commit: `6614489`

## Goal

Start the repository part of the corrected implementation order by connecting
repositories to built bounded contexts and storage.

This slice is intentionally smaller than the whole original T-0012.7 roadmap.
It should make repository registration real enough for later signal routing,
while leaving aggregate event-sourced storage, delivery, Stand, gRPC, import
bus, and system context runtime to following tasks.

## Must Preserve

- Follow corrected order from `D-0047`.
- Keep close conceptual alignment with Spine JVM `Repository`,
  `RecordBasedRepository`, `DefaultRepository`, and `BoundedContextBuilder.add`.
- Use existing `StorageFactory`, `RecordStorage`, and bounded-context assembly.
- Keep public APIs small and JVM-familiar.
- No exported standalone helpers unless a strong reason is recorded.
- Names must have no more than four semantic components.
- Tests stay under `packages/server/test/repository` or
  `packages/server/test/context`.
- Update docs/API docs and durable logs for every public API change.

## JVM Evidence

Required evidence for this task:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/RecordBasedRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/DefaultRecordBasedRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/DefaultRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateStorage.java`;
- current TS `Repository`, entity classes, `BoundedContext`, and storage package.

## Required Changes

- Replace metadata-only repository identity with a small repository lifecycle
  owner:
  - retains entity/state metadata;
  - can be registered with one built `BoundedContext`;
  - opens a record storage through the context storage factory;
  - exposes simple `isRegistered()` / context metadata as needed;
  - rejects registering the same repository with two contexts.
- Make `BoundedContextBuilder.add(repository)` and `remove(repository)` real
  registration-list operations.
- Make `BoundedContext.build()` register repository instances with the built
  context after buses/storage are created.
- Keep repository storage generic. Do not add in-memory-specific code to
  `Repository`.
- Keep direct entity creation, handler invocation, delivery, read-side indexing,
  aggregate snapshot/event replay, import bus, and gRPC out of this task.
- Preserve duplicate/conflict checks for entity constructor and state type
  ownership, but simplify error shape if possible.

## Acceptance

- A repository added to a builder is registered with the built context.
- Removing a repository before `build()` prevents registration.
- Repeated registration of the same repository is idempotent for the same
  context.
- Registering one repository instance with two different contexts is rejected.
- A built context can expose its registered repositories as a copy-safe list or
  count, only if needed for verification and later routing.
- Repository registration opens `RecordStorage` via the context `StorageFactory`
  using the repository state schema.
- No delivery, Stand, gRPC, transport execution, scheduler, import bus, system
  context runtime, aggregate event-sourced storage, or handler invocation is
  introduced.

## Deferred Within T-0012.7 Roadmap

- Aggregate event-sourced storage as snapshots plus events.
- Command/event routing into repositories.
- Repository cache and batch delivery behavior.
- Active-record filtering and query APIs.
- Default repository factories by entity class.

## Baseline Verification

Fresh baseline in this worktree:

- Command: `env CI=true corepack pnpm verify`.
- Result: passed.
- Evidence: 35 test files, 276 tests, coverage statements 95.45%, branches
  90.37%, functions 96.81%, lines 95.44%.
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
