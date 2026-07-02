# Implementation Report: T-0012.7 Repository Registration And Storage Opening

Status: review complete; final verification passed
Branch: `task/T-0012-7-entities-repositories-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7-entities-repositories-routing`
Baseline commit: `6614489`

## Summary

Implemented the repository registration and storage-opening slice, then applied
review fixes that moved all registration state into `BoundedContext`:

- `Repository` now retains entity/state metadata, while
  `BoundedContextBuilder.build()` owns registration with one built
  `BoundedContext`.
- Repository registration opens a `RecordStorage` through the context
  `StorageFactory` using the repository state schema.
- Repeated `add(repository)` calls for the same builder are idempotent.
- Registering the same repository instance with a different built context is
  rejected with a simple `Error`.
- Direct public repository registration/status APIs were removed so callers
  cannot bypass or observe context-owned registration state through
  `Repository`.
- Build-time repository validation now rejects spoofed structural objects and
  duplicate entity/state identities before repository storage is opened.
- Repository storage opening is prepared for all repositories before any
  registration state is committed, preventing partial build failures from
  stranding earlier repositories on an unreturned context.
- `BoundedContextBuilder.add(repository)` and `remove(repository)` now maintain
  a real repository registration list.
- `BoundedContext.build()` registers listed repositories with the built context.
- `BoundedContext.registeredRepositories()` exposes frozen snapshot-backed
  `RepositoryView` values for later routing slices.
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

Round-1 reviewer comments:

- direct public `Repository.registerWith(context)` caused split-brain state;
- registration mutated/opened storage one repository at a time, so failures
  could strand earlier repositories;
- duplicate repository identity checks covered repeated instances, not distinct
  repositories for the same entity/state identity;
- `BoundedContextBuilder.add(repository)` accepted spoofed structural objects;
- `registeredRepositories()` returned the private structural
  `RegisteredRepository` type; and
- docs/TypeDoc still described metadata-only or deferred repository behavior.

Round-2 reviewer comments:

- the internal preparation helper still leaked storage-opening authority;
- same-context preparation reopened storage;
- partial context construction failures could leak opened storage;
- the API docs/checks needed stronger guards for removed registration APIs; and
- durable logs and docs still had stale wording.

Round-3 reviewer comments:

- repository preparation used a type-only token that deep import callers could
  forge with a cast;
- the implementation report and work log were stale after the second fix pass;
  and
- the user guide overstated the current transport lifecycle/delivery surface.

Round-4 reviewer comments:

- the exported runtime repository preparation token still allowed deep import
  callers to import both the token and helper;
- top-level task status claimed full verification had passed for the latest
  patch before it had; and
- full verification still needed to run after the final review fixes.

Round-4 fix attempt:

- removed the exported runtime token and exported preparation helper;
- restored ECMAScript-private repository preparation behind a module-local
  WeakMap access path used by bounded-context assembly; and
- removed tests that imported the deep preparation helper directly.

Round-5 reviewer comments:

- the interim context-local cast used a TypeScript `private` method that remained
  callable at runtime;
- the `instanceof Repository` check was weaker than the previous WeakMap brand;
- API docs checks needed to reject future preparation API leaks; and
- `TASK.md` still claimed final verification had passed.

Round-5/6 reviewer comments:

- the ECMAScript-private preparation path still required an exported
  authority-bearing accessor;
- public repository status methods inflated the API beyond the small JVM-like
  identity concept needed in this slice; and
- docs and tests still described registration as repository-owned state.

Code/API fixes through round 14:

- removed repository-owned registration state and preparation authority;
- made `BoundedContext` own repository registration state and storage opening;
- kept `Repository` as identity/metadata only;
- made bounded-context registration use captured repository snapshots instead
  of public virtual getters;
- retained opened repository storage handles in the built context;
- made repository and event-store cleanup preserve original failures;
- closed a reentrant registration window between preflight and commit; and
- made `registeredRepositories()` return frozen snapshot-backed views instead
  of repository instances;
- removed public repository authority statics in favor of internal
  `repositoryAccess`;
- fixed event dispatcher retry and same-dispatcher reentrant registration; and
- updated API-doc guards and authored docs for the removed/internal
  registration, status, preparation, and repository-authority names.

Round-15/16 documentation fixes aligned task acceptance, report verification,
server README, and work-log wording with the final `add(repository)` idempotence
and review-round history.

Round-17/18 runtime fixes added `RuntimeStateErrorCode`,
`ServerRuntimeRejectedState`, same-runtime active-work handling through
`AsyncLocalStorage`, and active-work `close()` rejection.

Round-19 runtime and tooling fixes added inactive async context frames after
work settles, follow-up enqueue coverage, same-runtime runtime wording, and
cleanup-rule exception pruning.

All code/API comments above have been addressed in the current task branch.
Final full verification remains pending until reviewer lanes are clean.

## Verification

- `focused repository/context suite`
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
  `focused repository/context suite`
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

Round-2 fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 37 tests.
- Fresh `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed.
- Fresh escalated `env CI=true corepack pnpm verify` passed:
  - 35 test files, 287 tests;
  - coverage statements 95.43%, branches 90.10%, functions 96.57%, lines
    95.48%;
  - docs/API checks passed with the existing invalid-`origin` TypeDoc warning;
  - proto lint/generate and generated-clean checks passed.

Round-3 fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 38 tests.
- Fresh `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.

Round-4 fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 35 tests.
- Fresh `corepack pnpm typecheck`, `corepack pnpm lint`, and
  `corepack pnpm format:check` passed.

Round-5 fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 35 tests.
- Fresh `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.

Latest simplification verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 35 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-7 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 38 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-8 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 40 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-9 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 41 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-10 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 41 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-11 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 41 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-12 review-fix verification:

- Fresh focused
  `focused repository/context suite`
  passed: 2 test files, 41 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-13 review-fix verification:

- Fresh focused
  `focused event/repository/context suite`
  passed: 3 test files, 46 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-14 review-fix verification:

- Fresh focused
  `focused event/repository/context suite`
  passed: 3 test files, 47 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-15 doc-fix verification:

- Fresh focused
  `focused event/repository/context suite`
  passed: 3 test files, 47 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-17 review-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 70 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-18 review-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 72 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-19 review-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-20 review-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-21 doc-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-22 doc-fix verification:

- Fresh focused
  `focused runtime/bus/repository/context suite`
  passed: 6 test files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-23 pre-review verification:

- Fresh focused `focused runtime/bus/repository/context suite` passed: 6 test
  files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-24 doc-fix verification:

- Fresh focused `focused runtime/bus/repository/context suite` passed: 6 test
  files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Round-25 doc-fix verification:

- Fresh focused `focused runtime/bus/repository/context suite` passed: 6 test
  files, 73 tests.
- Fresh `corepack pnpm typecheck` passed.
- Fresh `corepack pnpm lint` passed, including cleanup enforcement.
- Fresh `corepack pnpm format:check` passed.
- Fresh `corepack pnpm docs:check` passed. Existing warning only: TypeDoc
  cannot build source links because the local `origin` remote is not valid.
- Full verification remains pending until reviewer lanes are clean.

Final verification:

- Sandboxed `env CI=true corepack pnpm verify` failed only in the known ZeroMQ
  local IPC smoke tests with `Operation not permitted`.
- Escalated `env CI=true corepack pnpm verify` passed.
- Test evidence: 35 test files, 299 tests.
- Coverage evidence: statements 95.57%, branches 90.50%, functions 96.78%,
  lines 95.62%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.
- Proto lint/generate and generated-clean checks passed.

## Concerns

- `registeredRepositories()` returns frozen copy-safe snapshot-backed
  `RepositoryView` arrays. There is still no repository routing/query API.
- Repository preparation is no longer a repository API. Bounded-context
  assembly opens repository state storage directly from repository metadata.
