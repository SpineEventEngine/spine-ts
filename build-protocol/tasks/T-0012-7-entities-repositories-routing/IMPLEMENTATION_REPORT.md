# Implementation Report: T-0012.7 Repository Registration And Storage Opening

Status: review fixes implemented; verification passed
Branch: `task/T-0012-7-entities-repositories-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7-entities-repositories-routing`
Baseline commit: `6614489`

## Summary

Implemented the repository registration and storage-opening slice, then applied
review fixes for context-owned registration:

- `Repository` now retains entity/state metadata, while
  `BoundedContextBuilder.build()` owns registration with one built
  `BoundedContext`.
- Repository registration opens a `RecordStorage` through the context
  `StorageFactory` using the repository state schema.
- Repeated `add(repository)` calls for the same builder are idempotent.
- Registering the same repository instance with a different built context is
  rejected with a simple `Error`.
- Direct public `Repository.registerWith(context)` was removed so callers
  cannot bypass the context registration list.
- Build-time repository validation now rejects spoofed structural objects and
  duplicate entity/state identities before repository storage is opened.
- Repository storage opening is prepared for all repositories before any
  repository registration state is committed, preventing partial build failures
  from stranding earlier repositories on an unreturned context.
- `BoundedContextBuilder.add(repository)` and `remove(repository)` now maintain
  a real repository registration list.
- `BoundedContext.build()` registers listed repositories with the built context.
- `BoundedContext.registeredRepositories()` exposes a copy-safe registered
  `RepositoryView` list for later routing slices.
- TypeDoc/source docs, API docs, architecture docs, and user-guide sections now
  describe context-owned registration/storage opening and remaining exclusions.

No delivery/inbox, Stand, gRPC, transport execution, scheduler, import bus,
system context runtime, aggregate event-sourced storage, snapshots, handler
invocation, command/event routing into repositories, repository cache,
active-record query API, or default repository factory was added.

## Baseline Verification

- `env CI=true corepack pnpm verify` passed before implementation.
- Evidence: 35 test files, 276 tests, coverage statements 95.45%, branches
  90.37%, functions 96.81%, lines 95.44%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning
  only. Proto lint/generate and generated-clean checks passed.

## JVM Evidence Read

- `spine-entities-repositories-and-state.md`;
- JVM repository source paths listed in the task log;
- current TS repository, bounded-context, entity, and storage code.

## Review Status

External review comments received for this review-fix pass:

- direct public `Repository.registerWith(context)` caused split-brain state;
- registration mutated/opened storage one repository at a time, so failures
  could strand earlier repositories;
- duplicate repository identity checks covered repeated instances, not distinct
  repositories for the same entity/state identity;
- `BoundedContextBuilder.add(repository)` accepted spoofed structural objects;
- `registeredRepositories()` returned the private structural
  `RegisteredRepository` type; and
- docs/TypeDoc still described metadata-only or deferred repository behavior.

These comments were implemented without spawning reviewer sub-agents.

## Verification

- `corepack pnpm vitest run packages/server/test/repository/repository.test.ts packages/server/test/context/bounded-context.test.ts`
  passed before review fixes: 2 test files, 34 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including cleanup enforcement.
- `corepack pnpm format:check` passed.
- `corepack pnpm docs:check` passed. Existing warning only: TypeDoc cannot
  build source links because the local `origin` remote is not valid.
- First sandboxed `env CI=true corepack pnpm verify` reached `pnpm test` and
  failed only in
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts` with the known
  ZeroMQ local IPC `Operation not permitted` sandbox failure.
- Escalated `env CI=true corepack pnpm verify` passed:
  - 35 test files, 284 tests;
  - coverage statements 95.31%, branches 90.20%, functions 96.49%, lines
    95.36%;
  - docs/API checks passed with the existing invalid-`origin` TypeDoc warning;
  - proto lint/generate and generated-clean checks passed.

Review-fix verification:

- Focused RED tests first failed against the reviewer comments: direct
  registration remained public, duplicate identities/spoofed repositories were
  accepted, and partial storage failure could strand earlier repositories.
- Fresh focused
  `corepack pnpm vitest run packages/server/test/repository/repository.test.ts packages/server/test/context/bounded-context.test.ts`
  passed after fixes: 2 test files, 37 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Fresh sandboxed `env CI=true corepack pnpm verify` reached `pnpm test` and
  failed only in
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts` with `Operation not
permitted`; 34 test files and 285 tests passed before the sandbox IPC block.
- Fresh escalated `env CI=true corepack pnpm verify` passed:
  - 35 test files, 287 tests;
  - coverage statements 95.39%, branches 90.08%, functions 96.55%, lines
    95.43%;
  - docs/API checks passed with the existing invalid-`origin` TypeDoc warning;
  - proto lint/generate and generated-clean checks passed.

## Concerns

- `registeredRepositories()` returns copy-safe `RepositoryView` arrays backed by
  the repository instances. There is still no repository routing/query API.
- Internal repository registration helpers are exported only from the deep
  repository module for context assembly; the public root exports remain clean.
