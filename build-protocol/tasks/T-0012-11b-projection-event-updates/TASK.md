# T-0012.11b: Projection Event Updates

Status: started; task docs created before implementation
Start: `2026-07-05 00:23 WEST`
Parent task: `T-0012.11 Missing Details And Example Readiness`
Branch: `task/T-0012-11b-projection-event-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11b-projection-event-updates`
Baseline commit: `f38fcac`

## Goal

Execute projection event subscribers from the existing event bus so delivered
events update read-side projection state through `Stand`.

## Must Preserve

- Keep the slice narrow and JVM-familiar.
- Preserve strict write-side/read-side segregation.
- Reuse the existing event bus, repository event routing, and `Stand` storage
  seams.
- Keep event handling asynchronous.
- Do not add catch-up workers, retry loops, external brokers, a broad `Server`
  facade, or projection-list query expansion.

## Required Evidence

- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0012-11-missing-details-example-readiness.md`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/src/bus/event-bus.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/test/stand/stand.test.ts`
- `packages/server/test/services/spine-services.test.ts`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

## Acceptance Criteria

- Repository event dispatch no longer stops at `routeEvent()` for projection
  repositories in built bounded contexts.
- A projection repository consumes a delivered event, updates projection state,
  and writes the latest state into read-side storage through `Stand`.
- `Stand` remains the query/subscription facade over read-side state.
- `SubscriptionService` can observe projection updates emitted by real event
  delivery instead of tests manually calling `stand.update(...)`.
- No catch-up worker, retry loop, or external-event broker work is introduced.

## TDD Plan

1. Add a focused failing repository/event-bus test proving projection event
   dispatch only routes today and does not update `Stand`.
2. Add focused failures for stand update/subscription delivery from a real
   delivered event.
3. Implement the smallest projection event-execution path through repository
   event dispatch and `Stand`.
4. Run focused verification, full verification, and record the event/stand
   integration choice.

## Verification Plan

- Focused red test command(s) with expected failure summaries.
- Focused green test command(s).
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`
- `git diff --check`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

- Branch/worktree created from parent T-0012.11 commit `f38fcac`.
- Durable task, report, review, and work-log files were created before behavior
  changes.
