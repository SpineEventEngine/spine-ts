# T-0012.7b: Aggregate Storage And Signal Routing

Status: round-7 validation fix verified
Start: `2026-07-02 06:20 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-7b-aggregate-storage-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7b-aggregate-storage-routing`
Baseline commit: `77492b9`

## Goal

Finish the remaining entity/repository stage before delivery by adding the
smallest JVM-aligned aggregate storage and repository signal-routing slice.

The previous `T-0012.7` task intentionally covered repository registration and
record-storage opening only. This task must continue that stage without jumping
to `Inbox`, `Stand`, gRPC services, import bus, scheduler, or delivery workers.

## Must Preserve

- Follow corrected order from `D-0047`.
- Keep repository and aggregate APIs short and JVM-familiar.
- Inspect Spine JVM aggregate repository/storage and routing source before
  changing code.
- Use existing `StorageFactory`, `RecordStorage`, `EventStore`, buses, handler
  metadata, and `BoundedContext` assembly.
- Keep write-side/read-side segregation strict.
- Do not add generated code, gRPC services, `Stand`, `Inbox`, delivery,
  scheduler, import bus, or process supervision in this task.
- No exported standalone helpers unless a strong reason is recorded.
- Names must have no more than four semantic components.
- Tests must stay under `packages/server/test/**` and mirror `src` semantics.
- Update docs/API docs and durable logs for every public API change.

## JVM Evidence

Required evidence for this task:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateStorage.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- current TS `Repository`, aggregate/entity classes, buses, handler metadata,
  bounded-context, event-store, and storage code.

## Required Changes

- Add aggregate storage for snapshot-plus-event persistence using the existing
  storage/event-store seams.
- Route command and event signals from context/buses to registered repositories
  through the smallest needed dispatch entry points.
- Keep default routing aligned with existing handler metadata and first-field
  routing conventions.
- Keep aggregate loading and event replay minimal and explicit.
- Keep command/event handler invocation limited to the repository/entity
  behavior needed by this slice.
- Record any deferrals for delivery-backed cache, catch-up, read-side indexing,
  subscription updates, or system events.

## Acceptance

- Aggregate repository storage persists events and uses snapshots when present.
- Aggregate loading can replay stored events after the latest snapshot.
- Signals can be routed to a registered repository without exposing repository
  registration internals.
- Same signal routing failures produce small, clear errors/results; no large
  detail hierarchies are introduced.
- Existing repository registration and storage-opening behavior remains intact.
- No `Inbox`, delivery, `Stand`, gRPC, import bus, scheduler, process
  supervision, or read-side query behavior is introduced.

## Skills

- `using-git-worktrees` for the task worktree.
- `test-driven-development` for behavior changes.
- `event-store-design` for the aggregate event stream shape.
- `cqrs-implementation` for write/read segregation boundaries.
- `subagent-driven-development`, `requesting-code-review`,
  `code-review-excellence`, and `verification-before-completion` for the
  protocol loop.

## Current State

- Task branch/worktree created from parent commit `77492b9`.
- Implementation and review loops have completed through round 6.
- Final verification passed after coverage-focused aggregate-storage tests were
  added, and focused verification passed after the round-5 reliability fix.
- The round-6 docs-only fix was applied. Round-7 re-review produced new
  documentation, security, and reliability validation findings; this pass
  addressed those aggregate-storage validation gaps and stale durable logs.
- Required round-7 fix verification passed: focused aggregate-storage tests,
  `typecheck`, `lint`, `format:check`, and `docs:check`.
- No blocking human question is known.
