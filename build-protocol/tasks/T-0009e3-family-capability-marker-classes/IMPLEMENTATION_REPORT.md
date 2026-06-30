# Implementation Report: T-0009e.3 Family Capability Marker Classes

Status: Implemented And Verified
Task log:
`build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
Work log: `build-protocol/work-logs/T-0009e3.md`
Review log:
`build-protocol/reviews/T-0009e3-family-capability-marker-classes.md`
Branch: `task/T-0009e3-family-capability-marker-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e3-family-capability-marker-classes`
Setup commit: `54c670b`
Parent baseline before setup: `26aa510`

## Summary

Implemented the first public `@spine-ts/server` entity family capability marker
classes:

- `Aggregate<Id, Schema, Version>`;
- `Projection<Id, Schema, Version>`;
- `ProcessManager<Id, Schema, Version>`; and
- `EntityFamily`, a minimal `"aggregate" | "projection" | "process-manager"`
  marker union.

Each family class is an abstract subclass of
`TransactionalEntity<Id, Schema, Version>` and adds only a stable
readonly `entityFamily` property. No repository, storage, dispatch, command
posting, query client, event history, snapshot, process workflow, handler
invocation, idempotency, lifecycle event, automatic version increment, or global
transaction behavior was added.

## JVM Research Used

The required JVM files were inspected before implementation:

- `Aggregate.java`: extends an assignee-capable transactional base and owns or
  collaborates with command dispatch, event history, idempotency, applier
  watching, lifecycle columns, and repository snapshot behavior. These runtime
  capabilities were intentionally deferred.
- `Projection.java`: directly extends JVM `TransactionalEntity` and adds
  event-playing/subscriber/repository behavior outside this TypeScript slice.
- `ProcessManager.java`: extends an assignee-capable transactional base and adds
  event reaction, command production/substitution, query client, bounded-context,
  and process-manager model behavior. These runtime capabilities were
  intentionally deferred.
- `TransactionalEntity.java`: provides protected transaction access, changed
  state, lifecycle flag delegation, and scoped mutation behavior. The existing
  TypeScript `TransactionalEntity` already models the safe subset used here.
- `Entity.java` and `AbstractEntity.java`: confirm the common entity identity,
  state, version, lifecycle, and model-family concepts; TypeScript keeps the
  current explicit constructor/options shape instead of adding Java builders.

## TDD Record

RED tests were added first in `packages/server/src/entity.test.ts` and
`packages/server/src/index.test.ts` to require:

- root exports for `Aggregate`, `Projection`, and `ProcessManager`;
- inheritance from `TransactionalEntity`;
- stable `entityFamily` identities and `EntityFamily` typing;
- inherited transaction/snapshot behavior through a test aggregate subclass; and
- transaction-scope operations remaining absent from the public family class
  types.

The RED run failed as expected because the classes were not implemented or
exported:

- `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  failed with `Class extends value undefined is not a constructor or null` and
  missing root export assertions.

After the minimal implementation and export updates, the targeted GREEN run
passed:

- `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed: 2 test files, 36 tests.

## Files Changed

- `packages/server/src/entity.ts`
- `packages/server/src/entity.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009e3-family-capability-marker-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e3.md`

## Verification

- Baseline `CI=true corepack pnpm verify` passed before implementation on
  `2026-06-30 01:59 WEST` after `corepack pnpm install` hydration.
- Targeted RED/GREEN verification is recorded above.
- Final `CI=true corepack pnpm verify` passed on `2026-06-30 02:11 WEST`:
  typecheck, lint, format check, 15 test files / 156 tests, coverage, TypeDoc
  API export check with 72 expected server exports, proto lint/generate, and
  generated-output clean checks all completed successfully. TypeDoc reported the
  existing invalid `origin` remote warning only.

## Review

Implementation review is pending. The review log remains available at
`build-protocol/reviews/T-0009e3-family-capability-marker-classes.md` for the
required five-lane review round.

## Concerns

None at implementation time. The only deliberate limitation is the task scope:
the new public classes are family markers over `TransactionalEntity` and do not
provide runtime aggregate/projection/process-manager infrastructure.
