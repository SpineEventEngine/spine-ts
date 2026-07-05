# Implementation Report: T-0012.11b Projection Event Updates

Status: round-3 review fixes implemented; verification passed
Branch: `task/T-0012-11b-projection-event-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11b-projection-event-updates`
Baseline commit: `f38fcac`

## Summary

This slice follows the merged aggregate command-execution path. The target is
the smallest read-side event path:

- delivered events reach repository event dispatchers through the event bus;
- projection repositories invoke all matching event subscribers;
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

## Round-1 Review Fixes

- Aggregate-produced events now preserve the command context as event origin
  when the event does not already carry origin metadata, so multitenant
  projection dispatch can derive the command tenant for tenant-scoped `Stand`
  reads, writes, and subscriptions.
- Handler-backed executable projection repositories now require `number`
  projection version metadata at the public repository type boundary, matching
  the runtime rehydration contract.
- The shared entity method-invocation diagnostic now uses neutral repository
  entity execution wording instead of aggregate-only wording.
- Public docs and durable task/report/work logs were updated for the review
  fixes and for the all-matching-subscribers implementation shape.

## Round-2 Review Fixes

- `BoundedContext` now records asynchronous already-stored event redispatch
  failures in a copy-safe `storedEventDispatchFailures()` diagnostic snapshot.
- Aggregate command completion still resolves after aggregate event storage and
  snapshot handling. The later fire-and-forget redispatch job no longer
  discards failures silently; dispatcher acceptance/dispatch failures,
  projection subscriber failures, and `Stand` update failures are visible to
  tests and diagnostics.
- The change deliberately does not add retry, catch-up, inbox, or delivery
  worker behavior.
- Parent `T-0012.11` task/report/review status text is being synchronized with
  the already-updated parent work log so durable docs no longer stop at
  `T-0012.11a`.

## Round-3 Review Fixes

- Aggregate command execution now overwrites handler-produced event origin
  metadata with the current command as direct `pastMessage` origin. This keeps
  multitenant projection dispatch under the command tenant even when an
  aggregate handler returns an event with conflicting `importContext` or
  embedded `pastMessage` tenant metadata.
- Stored-event redispatch diagnostics now keep only a small bounded buffer,
  clone events on write/read, and store frozen scalar `DispatchErrorSnapshot`
  values instead of retaining thrown objects by reference.
- Internal context/repository callback names were shortened to
  `recordDispatchFailure`; the public `storedEventDispatchFailures()` API
  remains unchanged.
- API docs, server README wording, repository TypeDoc, and API export
  expectations now describe projection subscriber execution and the bounded
  diagnostic error snapshot.

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
- Round-1 review-fix RED:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/repository.test.ts -t "command tenant metadata|missing projection subscriber|constrains entity constructor"`
  failed as expected before the fix: the command-tenant projection state was
  absent, the missing-method diagnostic still said aggregate execution, and
  the projection version type `@ts-expect-error` was unused.
- Round-1 review-fix GREEN: the same focused command passed with 2 files, 3
  tests after the fix; `pnpm typecheck` also passed.
- Round-1 review-fix final verification passed:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/repository.test.ts -t "command tenant metadata|missing projection subscriber|constrains entity constructor"`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, and
  `git diff --check`.
- Sandboxed `pnpm test:coverage` still failed only on known local IPC/HTTP2
  permissions (`Operation not permitted` for ZeroMQ IPC and
  `listen EPERM 127.0.0.1` for service tests). Escalated `pnpm test:coverage`
  passed with 45 files and 575 tests; coverage summary: statements 95%,
  branches 90.09%, functions 97.48%, lines 95.02%.
- Round-2 focused RED:
  `pnpm test packages/server/test/repository/repository-routing.test.ts -t "resolves aggregate command execution after commit when stored-event dispatch later throws"`
  failed as expected before the fix because
  `context.storedEventDispatchFailures` did not exist.
- Round-2 focused GREEN:
  `pnpm test packages/server/test/repository/repository-routing.test.ts -t "stored-event|stored event|after commit when stored-event dispatch later throws|records stored-event projection subscriber failures"`
  passed with 1 file and 3 selected tests after the diagnostic channel was
  wired.
- Round-2 final verification passed: focused tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, and `git diff --check`.
- Sandboxed `pnpm test:coverage` still failed only on known local IPC/HTTP2
  permissions (`Operation not permitted` for ZeroMQ IPC and
  `listen EPERM 127.0.0.1` for service tests), with 555 tests passing before
  the permission failures. Escalated `pnpm test:coverage` passed with 45 files
  and 576 tests; coverage summary: statements 95.01%, branches 90.09%,
  functions 97.49%, lines 95.03%.
- Round-3 focused repository verification:
  `pnpm vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with 1 file and 37 tests.
- Round-3 final verification passed: `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm docs:check`, and `git diff --check`.
- Sandboxed `pnpm test:coverage` failed only on local endpoint permissions:
  ZeroMQ IPC reported `Operation not permitted`, and gRPC service tests
  reported `listen EPERM 127.0.0.1`. The sandboxed run had 43 files and 557
  tests passing, with 2 files and 21 tests failed due to those permissions.
- Escalated `pnpm test:coverage` passed with 45 files and 579 tests; coverage
  summary: statements 94.97%, branches 90.04%, functions 97.5%, lines 94.99%.
