# Implementation Report: T-0009e.3 Family Capability Marker Classes

Status: Baseline Verified
Task log:
`build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
Work log: `build-protocol/work-logs/T-0009e3.md`
Review log:
`build-protocol/reviews/T-0009e3-family-capability-marker-classes.md`
Branch: `task/T-0009e3-family-capability-marker-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e3-family-capability-marker-classes`
Baseline commit: `26aa510`

## Summary

Implementation has not started yet. The task is scoped to thin
`Aggregate`/`Projection`/`ProcessManager` family capability marker classes over
the existing `TransactionalEntity` base.

## JVM Research Used

Initial setup inspected:

- JVM `Aggregate` extends an assignee-capable transactional base and owns
  dispatch/event-history/idempotency behavior that is out of scope here.
- JVM `Projection` directly extends `TransactionalEntity` and exposes
  event-playing/subscription behavior owned by projection transactions and
  repositories.
- JVM `ProcessManager` extends an assignee-capable transactional base and owns
  process/query/command behavior that is out of scope here.
- JVM `TransactionalEntity` contributes scoped transaction access and changed
  state. The current TypeScript base already models that smaller boundary.

## Files Changed

Pending implementation.

## Verification

- Initial verify stopped before tests because the isolated worktree needed
  `pnpm install` metadata hydration.
- Baseline `CI=true corepack pnpm verify` passed on `2026-06-30 01:59 WEST`:
  15 test files / 152 tests; coverage 97.23% statements, 91.41% branches,
  99.15% functions, 97.17% lines; TypeDoc/API/proto gates passed with 68
  expected server exports and generated proto output clean.

## Review

Pending implementation and first review round.
