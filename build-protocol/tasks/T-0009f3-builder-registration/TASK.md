# T-0009f.3: Builder Repository Registration And Conflict Checks

Status: Setup Complete - Pending Implementation
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

- [ ] Tests are written before production code and fail for the missing builder
      repository registration surface.
- [ ] `BoundedContextBuilder` can add and remove explicit `Repository`
      identities without mutating previously returned snapshots.
- [ ] Built `BoundedContext` snapshots include immutable repository identity
      snapshots for later runtime tasks.
- [ ] Duplicate/conflicting repository registrations are deterministic and
      covered by tests.
- [ ] Runtime behavior remains metadata-only and does not create/find/store,
      route, dispatch, open storage, or register buses/stands.
- [ ] Public docs and TypeDoc/API guard describe the repository-registration
      surface and deferred behavior.
- [ ] Required reviewer lanes report no remaining comments before integration.

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
