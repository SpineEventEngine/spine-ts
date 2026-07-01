# Review Log: T-0012.7 Repository Registration And Storage Opening

Status: review fixes implemented; verification passed
Branch: `task/T-0012-7-entities-repositories-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7-entities-repositories-routing`
Baseline commit: `6614489`

## Required Review Lanes

Every review round must run these separate reviewer sub-agents:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- delivery, Stand, gRPC, transport execution, scheduler, import bus, system
  context runtime, aggregate event-sourced storage, or handler invocation in
  this task;
- broad storage adapters or in-memory-specific leakage into repository APIs;
- snapshot/detail/error hierarchies that survive without JVM-backed need;
- repositories that can register with multiple contexts;
- public APIs with names over the four-component limit;
- exported standalone helpers without a recorded reason;
- tests under `src`; and
- stale docs/API expectations.

## Rounds

No independent reviewer sub-agent rounds were run because the implementation
instruction explicitly said not to spawn agents.

## Review-Fix Round

Reviewer comments received on `2026-07-02 WEST`:

- `Repository.registerWith(context)` was public and allowed callers to open
  storage while bypassing `BoundedContext.registeredRepositories()`.
- Build registration was not exception-safe; a later repository storage failure
  could leave earlier repositories registered on an unreturned context.
- Duplicate identity checks needed to reject distinct repositories for the same
  entity constructor or state type.
- `BoundedContextBuilder.add(repository)` needed a runtime instance check so
  structural lookalikes could not spoof repositories.
- `registeredRepositories()` needed a meaningful public return type instead of
  the private structural `RegisteredRepository`.
- TypeDoc/docs/logs still contained metadata-only and deferred-registration
  wording after storage opening existed.

Fixes applied:

- Removed direct public repository registration and moved registration through
  internal repository prepare/commit capabilities used by `BoundedContext`.
- Added build-time preflight for real repository instances, already-registered
  repositories, duplicate entity constructors, and duplicate state full type
  names.
- Opened all repository storage before committing any repository registration
  state, preserving unregistered repositories when later storage opening fails.
- Added public `RepositoryView` and changed `registeredRepositories()` to return
  `readonly RepositoryView[]`.
- Added focused tests for no public direct registration, spoofed repository
  rejection, duplicate identity rejection, and no partial stranding on build
  failure.
- Updated source TypeDoc comments, API docs, user guide, architecture docs, and
  durable task logs.

## Implementation Self-Check

- Scope exclusions checked: no delivery, Stand, gRPC, transport execution,
  scheduler, import bus, system context runtime, aggregate event-sourced
  storage, snapshots, handler invocation, command/event routing into
  repositories, repository cache, active-record query API, or default repository
  factory was added.
- Repository registration is one-context-only and same-context idempotent.
- Builder `add(repository)` / `remove(repository)` now maintain a real
  registration list, and `build()` registers the listed repositories.
- Repository registration opens `RecordStorage` via context `StorageFactory`
  using repository state schema.
- Public context/repository surface remains small:
  `Repository.isRegistered()`, `Repository.registeredContextName`,
  `RepositoryView`, and `BoundedContext.registeredRepositories()`.
- Review-fix verification passed. The sandboxed full verify failed only on
  ZeroMQ local IPC permissions; the escalated full verify passed with 35 test
  files, 287 tests, coverage above thresholds, docs/API check, proto
  lint/generate, and generated-clean checks.
