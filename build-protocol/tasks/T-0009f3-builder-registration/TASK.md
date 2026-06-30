# T-0009f.3: Builder Repository Registration And Conflict Checks

Status: Round 4 Review Fix Implemented And Verified
Start: `2026-06-30 11:34 WEST`
Parent task: `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
Parent branch: `task/T-0009f-repository-seams`
Branch: `task/T-0009f3-builder-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f3-builder-registration`
Baseline commit: `40c1b52`
Task log path: `build-protocol/tasks/T-0009f3-builder-registration/TASK.md`
Implementation report path:
`build-protocol/tasks/T-0009f3-builder-registration/IMPLEMENTATION_REPORT.md`
Work log path: `build-protocol/work-logs/T-0009f3.md`
Review log path: `build-protocol/reviews/T-0009f3-builder-registration.md`

## Scope

Add metadata-only repository registration to `BoundedContextBuilder`, building
on the existing `Repository` identity seam.

In scope:

- `BoundedContextBuilder.add(repository)` and `remove(repository)` for explicit
  repository identity objects.
- Immutable builder/context snapshots that include registered repository
  identities.
- Duplicate and conflicting registration checks based on entity constructor,
  entity family, and state schema/type ownership.
- Tests proving add/remove chaining, snapshot immutability/fresh copies,
  duplicate idempotence or rejection semantics selected by implementation
  notes, and conflicting repository rejection.
- Public exports, API-doc guard updates, package/API/user/architecture docs, and
  durable logs.

Out of scope:

- `add(entityClass)` default repository construction unless it can remain a
  thin metadata-only wrapper without inventing runtime repository classes.
- Command/event dispatcher registration, filters, listeners, assignees,
  enrichers, tenant indexes, system settings, lifecycle callbacks, or aggregate
  root directory behavior.
- Repository `create`, `find`, `store`, storage adapters, context registration
  execution, stand/type-supplier registration, routing, inbox writes, handler
  invocation, bus registration, ZeroMQ, transport, gRPC, or system context.

## JVM Source Evidence Required

Implementation must inspect task-relevant Spine JVM `core-jvm/server` sources
before code changes and record the impact:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/DefaultRepository.java`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`

Expected boundary from current research:

- JVM `BoundedContextBuilder.add(repository)` accumulates repository
  registrations for later `BoundedContext` runtime registration.
- JVM `add(entityClass)` creates a default repository by entity family, but
  default runtime repository behavior is broader than this subtask.
- JVM context registration opens storage and registers visibility/type
  suppliers; TypeScript must defer those runtime effects and record only
  immutable ownership metadata in this subtask.

## Acceptance Criteria

- [x] Tests are written before production code and fail for the missing builder
      repository registration surface.
- [x] `BoundedContextBuilder` can add and remove explicit `Repository`
      identities without mutating previously returned snapshots.
- [x] Built `BoundedContext` snapshots include immutable repository identity
      snapshots for later runtime tasks.
- [x] Duplicate/conflicting repository registrations are deterministic and
      covered by tests.
- [x] Runtime behavior remains metadata-only and does not create/find/store,
      route, dispatch, open storage, or register buses/stands.
- [x] Public docs and TypeDoc/API guard describe the repository-registration
      surface and deferred behavior.
- [ ] Required reviewer lanes report no remaining comments before integration.

## Review Round 1 Fixes

- [x] Security Low: unreadable or malformed virtual `Repository.snapshot`
      values are covered by RED/GREEN tests and now fail as deterministic
      `BoundedContextRepositoryRegistrationError` values with
      `INVALID_REPOSITORY_SNAPSHOT`.
- [x] Security Low: conflict diagnostics no longer read
      `snapshot.entityType.name` directly; hostile or non-string constructor
      names fall back to `(anonymous)`.
- [x] Documentation P2: the unsupported `VisibilityGuard.java` citation was
      removed from the implementation report because the durable task/work logs
      did not record exact inspected path evidence.
- [x] Documentation P3: the work log now records reviewed implementation commit
      `108d5fa` instead of saying the commit is still in progress.
- [x] Required focused and full verification pass for the review-fix commit.

## Review Round 2 Fixes

- [x] Documentation P3: corrected the implementation report's first-round
      review-fix bounded-context GREEN evidence from 20 tests to the actual
      16-test run recorded in the work log; the later focused trio still
      passed 45 tests.
- [x] TypeScript/API P3: exported
      `BoundedContextRepositoryRegistrationOperation`,
      `BoundedContextRepositoryRegistrationConflictErrorDetails`, and
      `BoundedContextRepositorySnapshotErrorDetails` from the module/root
      surface and updated the API-doc guard expected server exports.
- [x] Reliability P2: added RED/GREEN coverage for hostile repository
      snapshots whose `metadata.columns` or `metadata.setOnceFields` are not
      arrays and whose custom `map()` returns a non-array with no-op
      `forEach()`.
- [x] Reliability P2: repository snapshot cloning and validation now assert
      metadata lists with `Array.isArray()` before accepting them.
- [x] Reliability P3: reduced `build()` clone churn by letting
      `BoundedContext` constructor validation own the repository-snapshot clone
      and by freezing already-validated context snapshot children instead of
      cloning them again.
- [x] Required focused and full verification pass for the round-2 fix commit.

## Review Round 3 Fixes

- [x] Reliability P2: added RED/GREEN coverage for sparse
      `metadata.columns`, `metadata.setOnceFields`, and `metadata.semanticTags`
      arrays returned by hostile repository snapshots.
- [x] Reliability P2: metadata field-list clone and validation now use
      index-based loops that reject missing own indices before cloning or
      validating each field.
- [x] Security Low: added RED/GREEN coverage for non-array and non-string
      `metadata.semanticTags` values returned by hostile repository snapshots.
- [x] Security Low: repository snapshot cloning and validation now require
      `metadata.semanticTags` to be an array of strings.
- [x] Required focused and full verification pass for the round-3 fix commit.

## Review Round 4 Fixes

- [x] Security Low: added RED/GREEN coverage for empty, blank, and
      trim-needed `metadata.semanticTags` values returned by hostile
      repository snapshots.
- [x] Security Low: repository snapshot cloning and validation now require
      semantic tags to be non-empty canonical strings that do not need
      trimming, matching descriptor-derived semantic-tag boundaries.
- [x] Reliability P2: added RED/GREEN coverage for forged repository snapshots
      whose `stateFullTypeName` and `metadata.fullTypeName` agree with each
      other but not with `stateSchema.typeName`.
- [x] Reliability P2: repository snapshot validation now directly verifies
      `stateSchema.typeName === stateFullTypeName` before accepting the
      snapshot.
- [x] Required focused and full verification pass for the round-4 fix commit.

## Review Round 5 Fixes

- [x] Security Low: added RED/GREEN coverage for duplicate and unsorted
      `metadata.semanticTags` values returned by hostile repository snapshots.
- [x] Security Low: repository snapshot cloning and validation now require
      semantic tags to match the descriptor metadata contract: dense,
      non-empty, canonical, deduplicated, and sorted.
- [x] Documentation P3: `packages/server/README.md` now describes
      `BoundedContextBuilder.add(repository)` in present tense while keeping
      runtime context registration deferred.
- [x] Reliability P2: added RED/GREEN coverage for hostile snapshots whose
      `entityType` is an arbitrary function or whose entity constructor
      implies a family that does not match `snapshot.entityFamily`.
- [x] Reliability P2: repository snapshot validation now verifies
      `entityType` is a supported Aggregate/Projection/ProcessManager class
      and that the inferred family matches the snapshot family before
      accepting metadata.
- [x] Required focused and full verification pass for the round-5 fix commit.

## Implementation Evidence

- Inspected `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`:
  JVM keeps a mutable repository registration list, exposes a snapshot
  `repositories()` view, supports `add(Repository)` / `remove(Repository)`, and
  only performs runtime registration during `build()`.
- Inspected `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`:
  JVM `register(repository)` performs context-aware registration, visibility
  registration, and repository callbacks after context construction. TypeScript
  keeps these effects deferred.
- Inspected `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`:
  repository identity is available through entity class, ID class, and state
  type metadata, while create/find/store/storage/context registration remain
  lifecycle/runtime concerns outside this subtask.
- Inspected `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/DefaultRepository.java`:
  default repository construction selects runtime repository implementations by
  entity family. TypeScript did not implement `add(entityClass)`.
- Inspected `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` and
  `spine-jvm-docs/spine-entities-repositories-and-state.md`: confirmed the
  builder should collect registration metadata while runtime storage opening,
  stand/type-supplier registration, buses, system context, routing, and handler
  execution remain later slices.

Implementation impact: `BoundedContextBuilder` now records explicit
metadata-only `Repository` identity snapshots, treats duplicate identical
identity registration as idempotent, rejects conflicting entity constructor or
state type ownership deterministically, and builds frozen context snapshots that
include repository identities.

## Required Verification

- Focused RED/GREEN Vitest for bounded-context repository registration tests.
- Focused index/API export tests when public exports change.
- `corepack pnpm typecheck:tooling`
- `node scripts/check-api-docs.mjs`
- `CI=true corepack pnpm verify`

## Review Lanes

For this task, including docs-only changes, the orchestrator must run separate
reviewer sub-agents for:

- code style/maintainability,
- documentation,
- TypeScript/API docs,
- security,
- performance/reliability.

Reviewer comments must be fed back to the authoring sub-agent and review rounds
must repeat until no comments remain.
