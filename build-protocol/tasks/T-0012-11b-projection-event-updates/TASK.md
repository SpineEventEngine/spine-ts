# T-0012.11b: Projection Event Updates

Status: round-5 review fixes implemented; verification passed
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

- Focused RED tests were added for projection subscriber execution, `Stand`
  updates, and subscription delivery from real event handling.
- Built projection repositories now execute matching event subscribers from the
  event bus through an internal repository runtime binding and write changed
  projection state through context-owned `Stand`.
- Focused GREEN tests passed for the new repository and SubscriptionService
  behavior.
- Full verification passed. Sandboxed coverage still fails on local IPC/HTTP2
  endpoint permissions; escalated coverage passed.
- Round-1 review fixes are implemented for command-tenant propagation into
  aggregate-produced projection events, handler-backed projection version type
  constraints, neutral shared entity invocation diagnostics, and stale docs/log
  wording. Focused red/green verification, typecheck, lint, format, docs,
  diff, and escalated coverage all passed. Sandboxed coverage still fails on
  local IPC/HTTP2 endpoint permissions only.
- Round-2 review fixes add an observable
  `BoundedContext.storedEventDispatchFailures()` diagnostic channel for
  asynchronous already-stored event redispatch failures after aggregate event
  storage. Command completion still resolves after storage/snapshot handling;
  redispatch failures from dispatcher acceptance/dispatch, projection
  subscribers, or `Stand` updates are recorded for tests and diagnostics
  without adding retry, catch-up, or delivery-worker scope.
- Final round-2 verification passed. Sandboxed `pnpm test:coverage` still fails
  only on known local IPC/HTTP2 endpoint permissions; escalated coverage passed
  with 45 files and 576 tests.
- Round-3 review fixes are implemented and verified. Aggregate-produced events
  now always bind their direct origin to the executing command, preventing
  handler-supplied origin tenants from routing projection updates into another
  tenant. Stored-event dispatch diagnostics now retain a bounded buffer of
  frozen `DispatchErrorSnapshot` values and clone events on write/read.
  Internal dispatch-failure callbacks use the shorter `recordDispatchFailure`
  name. Public/API docs and TypeDoc export expectations were updated.
- Round-3 verification passed. Sandboxed `pnpm test:coverage` still fails only
  on local IPC/listen permissions; escalated coverage passed with 45 files and
  579 tests, including 90.04% branch coverage.
- Round-4 review fixes attempted to close the residual no-id command tenant
  routing gap by binding command context even when the command had no id. Round
  5 found that shape was not protobuf-contract-safe because `Origin.message` is
  required.
- Round-5 review fixes reject aggregate command execution when `command.id` is
  missing before aggregate events are bound, applied, or stored. The no-id
  tenant regression now expects rejection and no projection write in tenant-a or
  tenant-b. Command-with-ID tenant overwrite tests remain in place. Final
  verification passed. Sandboxed `pnpm test:coverage` still fails only on local
  IPC/listen permissions; escalated coverage passed with 45 files and 580
  tests.
