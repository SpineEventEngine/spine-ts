# Implementation Report: T-0012.11e Minimal Black-Box Test Fixture

Status: merged into parent at `c9ed81d` and parent-verified
Branch: `task/T-0012-11e-minimal-black-box-fixture`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11e-minimal-black-box-fixture`
Baseline commit: `6b5dd07`

## Initial Evidence

- The parent `T-0012.11` split selected this as the final example-readiness
  slice before the to-do example implementation.
- `packages/testing` currently exists, but the parent split records it as a
  skeleton that does not yet provide the required black-box bounded-context
  fixture.
- The fixture must stay small and in-process, using existing command, query,
  subscription, bounded-context, and service seams rather than adding a new
  server facade or client DSL.

## Implementation Notes

- `2026-07-05 09:20 WEST`: Orchestrator created this child branch/worktree from
  parent commit `6b5dd07` and opened the durable task/report/review/work logs.
  Implementation must start with focused tests around the smallest useful
  fixture surface.
- `2026-07-05 09:25 WEST`: Added focused RED tests for the public
  `BoundedContextFixture` surface before implementation. The first dependency
  metadata run failed because `@spine-ts/testing` did not yet declare its
  runtime/test dependencies; after adding the minimal workspace dependencies and
  rerunning install outside the sandbox, the RED test failed on the expected
  missing fixture constructor.
- Replaced the package skeleton with `BoundedContextFixture`, a small generic
  class over one built `BoundedContext`. The fixture captures the real
  in-process `SpineServices` command/query/subscription handlers, posts events
  through the built context event endpoint, clones protobuf messages at its
  boundary, and exposes `post`, `postEvent`, `read`, `readEventually`, and
  `subscribe`.
- Added `FixtureSubscription` as the small active-subscription handle returned
  by the fixture. It activates the real `SubscriptionService` stream and
  exposes only `next`, `cancel`, and `close`.
- Updated `packages/testing` package metadata and TypeScript references so the
  public fixture can depend on generated protobuf, core packing, and server
  bounded-context/service types.
- Updated public testing docs in `packages/testing/README.md`,
  `docs/api/README.md`, `docs/USER_GUIDE.md`, and
  `build-protocol/DEVELOPER_API.md`.
- Extended `scripts/check-api-docs.mjs` so `pnpm docs:check` pins the three
  expected `@spine-ts/testing` root exports.

## Verification

- RED: `pnpm test packages/testing/test/index.test.ts` failed with
  `TypeError: BoundedContextFixture is not a constructor` after dependency
  metadata was in place.
- Focused GREEN: `pnpm test packages/testing/test/index.test.ts` passed with 1
  file and 7 tests after coverage-focused fixture branch tests were added.
- `pnpm typecheck` passed after adding DOM/Node ambient types to the testing
  package tsconfig.
- `pnpm lint` passed, including cleanup enforcement.
- `pnpm format:check` passed.
- `pnpm docs:check` passed and now reports 3 expected `@spine-ts/testing`
  exports. TypeDoc still emits the existing invalid-origin source-link warning.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed only on local endpoint/IPC sandbox
  permissions: ZeroMQ `Operation not permitted` and HTTP/2
  `listen EPERM: operation not permitted 127.0.0.1`.
- Escalated `pnpm test:coverage` passed with 45 files and 616 tests. Coverage
  summary: statements 95.02%, branches 90.17%, functions 97.59%, lines 95.04%.

## Review Fixes

- `2026-07-05 09:39 WEST`: Round-1 review found the subscription handle did not
  activate before returning, exposed the original `BoundedContext`, used the
  public mutable subscription as the cancel token, imported a private server
  test fixture, left parent logs saying the child commit was pending, and had
  impossible timestamp ordering. The fix starts subscription activation eagerly,
  queues updates for later `next()` calls, keeps a private cancel token, removes
  the context getter, moves descriptor test data under `packages/testing`, and
  aligns durable status timestamps.
- `2026-07-05 09:44 WEST`: Round-1 fix verification passed for focused fixture
  tests, `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, and
  `git diff --check`. `pnpm format:check` reported Prettier drift in touched
  test and log files; those files were formatted before the final rerun.
- `2026-07-05 09:50 WEST`: Follow-up re-review found two remaining durable-doc
  rollup issues and one subscription queue lifecycle issue. The fixture now
  clears queued updates when closed, checks closed state before returning queued
  updates, closes the handle when fixture-local queued updates reach
  `queueLimit`, and adds focused regressions for post-cancel and overflow
  reads.
- `2026-07-05 09:55 WEST`: Follow-up security re-review found a cancellation
  window in which queued updates could still be read while `cancel()` awaited
  service cancellation. The fixture now marks the handle closed before awaiting
  service cancellation, and a focused regression covers that in-flight
  cancellation path.
- `2026-07-05 09:59 WEST`: Latest fix verification passed: focused fixture
  tests with 1 file and 10 tests, `pnpm typecheck`, `pnpm lint`,
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.
- `2026-07-05 10:09 WEST`: Final re-review passed in all required lanes:
  code style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability.
- `2026-07-05 10:19 WEST`: Parent merge commit `c9ed81d` integrated this slice
  into `task/T-0012-11-missing-details-example-readiness`. Parent verification
  passed focused fixture tests with 1 file and 10 tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, `git diff --check`, and
  escalated `pnpm test:coverage` with 45 files, 619 tests, and branch coverage
  90.22%. Sandboxed coverage remains blocked only by local endpoint and IPC
  permissions.
