# Implementation Report: T-0012.11b Projection Event Updates

Status: implemented; verification passed
Branch: `task/T-0012-11b-projection-event-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11b-projection-event-updates`
Baseline commit: `f38fcac`

## Summary

This slice follows the merged aggregate command-execution path. The target is
the smallest read-side event path:

- delivered events reach repository event dispatchers through the event bus;
- projection repositories invoke one matching event subscriber;
- projection state is updated and written through `Stand`; and
- stand subscriptions and gRPC subscriptions can observe those real projection
  updates.

## Initial Evidence

- `EventBus` already dispatches delivered events asynchronously in registration
  order.
- `Repository` already owns event handler metadata and route calculation, but
  event dispatch currently only calls `routeEvent()`.
- `Stand` already owns storage-backed state updates, version metadata, and
  in-process subscriptions.
- The to-do example needs task-list projection state updated by domain events
  before the example can use query/subscription behavior as a real app.

## Open Design Point

The implementation must decide the smallest way for context-built projection
repositories to reach `Stand` without making `Stand` a write-side API for
application code. The preferred shape is an internal repository runtime binding
that updates `Stand` after a projection subscriber mutates projection state.

## Implementation

- `BoundedContext` now binds its framework-owned `Stand` into the existing
  internal repository runtime when registering repositories.
- Repository event dispatch still uses `accept()` for route validation, while
  `dispatch()` executes projection repositories in built contexts.
- Projection event execution loads existing read-side state through `Stand`,
  creates a projection entity for the routed ID, invokes matching event
  subscribers, and writes changed projection state back through `Stand` with
  event version metadata.
- Direct `routeEvent()` remains route-only, and no public write-side read API,
  catch-up worker, retry loop, broker, or projection-list query expansion was
  added.

## Verification

- RED:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts packages/server/test/services/spine-services.test.ts -t "projection event|real projection event"`
  failed as expected: projection subscriber call count stayed `0`, Stand
  subscription updates were empty, and the SubscriptionService handler timed
  out waiting for a projection update.
- GREEN:
  The same focused command passed with 2 files, 3 tests.
- Additional focused coverage:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with 31 tests after adding branch-coverage cases for unchanged
  subscribers, stored-state rehydration, route-valid no-subscriber events,
  imported tenant metadata from stored aggregate events, missing event version
  metadata, and multitenant aggregate command tenant rejection.
- Focused repository file:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with 31 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm docs:check` passed with the existing invalid-origin source-link
  warning from TypeDoc.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed on known local IPC/HTTP2 permissions
  (`Operation not permitted` for ZeroMQ IPC and `listen EPERM 127.0.0.1` for
  service tests).
- Escalated `pnpm test:coverage` passed: 45 files, 573 tests; statements
  94.97%, branches 90.14%, functions 97.48%, lines 94.99%.
