# T-0017h Review Log

Status: all review lanes clean

Scope: delivery loop, retry-through-durable-inbox behavior, clean shutdown,
catch-up honesty, docs/API updates, and verification evidence.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f45d2-a2e3-7060-8330-2da7ac07cf97` | Closed | FINDINGS |
| Documentation completeness | `019f45d2-ccb0-7851-8819-a74fd7160359` | Closed | FINDINGS |
| TypeScript/API docs        | `019f45d2-ee0d-72f2-b3d6-d43c2726f16b` | Closed | FINDINGS |
| Security                   | `019f45d3-0e64-7e80-968e-b8d7e940bd72` | Closed | FINDINGS |
| Performance/reliability    | `019f45d3-3331-7691-bdaf-041354a90bf0` | Closed | FINDINGS |

## Review Requirements

- Reviewers must explicitly check the task
  `Human-Imposed Requirements Ledger`.
- Reviewers must check that the implementation does not import the full JVM
  conveyor/station architecture or invent durable catch-up storage in this
  slice.
- Reviewers must check that end-user code remains free of framework `Event`
  envelopes, manual transactions, `@Apply`, schema-bearing decorators, and
  application-owned handler materialization.
- Reviewers must check that native verification is used where local timers,
  IPC, or listener behavior participates.

## First-Round Findings

- Code style/maintainability: `DeliveryLoop.run()` checks stopped state before
  active-run state. `run(); stop(); run()` while the first drain is in flight
  can return a separate zero-count stopped result instead of rejecting or
  joining the active lifecycle.
- Code style/maintainability, documentation, TypeScript/API docs, security,
  and performance/reliability: `docs/api/README.md` still says this slice does
  not run scheduler loops even though the task introduces the supported local
  one-shard `DeliveryLoop`. Reword the deferred list to transport-backed or
  production scheduler/supervision loops.
- TypeScript/API docs: `DeliveryLoopOptions.limit` is forwarded without public
  boundary validation. Validate present limits as positive integers, or
  explicitly document deferred validation; preferred fix is validation plus
  tests.
- Documentation completeness: public docs do not consistently state that
  `stop()` prevents future drain starts but does not interrupt the current
  `Delivery.drain()`, and that `close()` waits for the in-flight drain.
- Documentation completeness and reliability: review-log verification snapshot
  is stale after the coordinator formatted
  `packages/server/test/context/process-manager-handoff.test.ts` and reran a
  passing full `format:check`.
- Performance/reliability: `close()` rejection behavior is reasonable but lacks
  focused regression coverage. Add a test where the current drain rejects and
  `close()` observes the same failure.

## First-Round Closure Plan

- Dispatch one fix sub-agent with ownership of `DeliveryLoop`, delivery-loop
  tests, docs/API wording, and task/review/work logs.
- Require focused tests for the active-run-after-stop case, invalid `limit`,
  and `close()` rejection propagation.
- Require focused verification, docs check as needed, `format:check`, and
  `git diff --check` before re-review.

## First Review-Fix Response

- `DeliveryLoop.run()` now checks the active run before the stopped fast path,
  so `run(); stop(); run()` while the first drain is in flight rejects with the
  existing one-run-at-a-time error instead of returning an independent
  zero-count stopped result.
- `DeliveryLoopOptions.limit` is validated at construction when present with
  the same positive safe integer boundary used for loop numeric options.
- Added focused tests for active-run-after-stop, invalid limits, and worker
  boundary drain rejection propagation through `close()`. The close rejection
  test asserts the closing promise and running promise observe the same error
  and that a later stopped run does not start another drain.
- Public docs now describe the supported local one-shard `DeliveryLoop`, narrow
  deferred claims to transport-backed/background workers and production
  catch-up orchestration, and consistently state that `stop()` prevents future
  drain starts without interrupting an in-flight `Delivery.drain()` while
  `close()` calls `stop()` and waits for the current drain.
- The previous `format:check` blocker is stale and cleared. The coordinator
  had already formatted the carried-forward
  `packages/server/test/context/process-manager-handoff.test.ts` change; this
  fix pass reran `format:check` successfully.

## Re-Review Lanes

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f45e6-a541-7223-af4b-19d50cd00e5e` | Closed | FINDINGS |
| Documentation completeness | `019f45e6-c9fc-71b1-9555-ef04d2b17cb9` | Closed | CLEAN    |
| TypeScript/API docs        | `019f45e6-eff0-7b82-b531-16917037cf9d` | Closed | FINDINGS |
| Security                   | `019f45e7-0d4d-7121-a012-7cf651bdf34e` | Closed | CLEAN    |
| Performance/reliability    | `019f45e7-37a1-77d2-b128-12e0b9a24a6e` | Closed | CLEAN    |

## Re-Review Findings

- Code style/maintainability: `packages/server/src/delivery/delivery-loop.ts`
  declares `defaultMaxFailures` before the primary `DeliveryLoop` declaration,
  violating the file declaration-order rule.
- TypeScript/API docs: `DeliveryDrainOptions.limit` TypeDoc in
  `packages/server/src/delivery/delivery.ts` still says only "bounded page
  size" while the API docs now state the positive page-size constraint.

## Re-Review Closure Plan

- Apply a tiny coordinator fix: move or inline the default max-failure value so
  the primary declaration remains first, and update the `DeliveryDrainOptions`
  `limit` comment to say positive page size.
- Run focused tests, docs/API check as needed, `format:check`, and
  `git diff --check`, then re-review only the affected style and TypeScript/API
  lanes.

## Second Re-Review Lanes

| Lane                       | Reviewer ID                            | Status | Result |
| -------------------------- | -------------------------------------- | ------ | ------ |
| Code style/maintainability | `019f45ed-163b-7ed1-9a74-2584fc8ded90` | Closed | CLEAN  |
| TypeScript/API docs        | `019f45ed-3f2d-7f82-8341-1596d64014be` | Closed | CLEAN  |

## Review Closure

- Documentation, security, and performance/reliability re-reviews were clean
  after the first fix pass.
- Style and TypeScript/API second re-reviews were clean after the tiny
  declaration-order and TypeDoc follow-up.
- No reviewer findings remain.

## Implementation Snapshot

- Added `DeliveryLoop` as a small framework-owned loop around existing
  `Delivery.drain()`.
- Retry semantics remain durable by leaving failed rows `TO_DELIVER`; the loop
  stops at `maxFailures` and a later loop/drain run retries pending rows.
- `stop()` prevents future drain starts without interrupting an in-flight
  `Delivery.drain()`; `close()` calls `stop()` and waits for the current drain,
  if any, to finish.
- JVM design evidence remains in `build-protocol/work-logs/T-0017h.md`: the
  implementation deliberately stays a small TypeScript loop around
  `Delivery.drain()` and does not port JVM conveyor, stations, monitor
  hierarchy, or catch-up storage.
- Skipped shard claims are reported as `SKIPPED` without endpoint invocation.
- No JVM conveyor/station/monitor hierarchy or fake durable catch-up storage
  was introduced.
- Updated server root exports, API guard expectations, package docs, API docs,
  user guide, architecture notes, and focused tests.

## Verification Snapshot

- Focused red check failed as expected before implementation because
  `DeliveryLoop` was not constructible.
- Focused green/regression run passed:
  `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/delivery/delivery-loop.test.ts
packages/server/test/delivery/delivery-worker.test.ts
packages/server/test/index.test.ts --passWithNoTests` — 3 files, 32 tests.
- `pnpm --config.verify-deps-before-run=false lint:generated` passed.
- `pnpm --config.verify-deps-before-run=false docs:check:generated` passed
  with only the existing invalid-origin TypeDoc source-link warning.
- `pnpm --config.verify-deps-before-run=false proto:check-generated` passed.
- `git diff --check` passed.
- Targeted Prettier check over changed files passed.
- Coordinator focused delivery/process-manager verification passed:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker.test.ts packages/server/test/context/process-manager-handoff.test.ts`
  with `3` files and `30` tests.
- First review-fix red check:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts`
  failed as expected before the production fix with `7` failing tests:
  active-run-after-stop and six invalid-limit cases.
- First review-fix focused verification passed after the fix:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker.test.ts packages/server/test/context/process-manager-handoff.test.ts packages/server/test/index.test.ts`
  with `4` files and `48` tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed. TypeDoc
  emitted the existing invalid-`origin` source-link warning; API export checks
  still found 198 expected `@spine-ts/server` exports.
- `pnpm --config.verify-deps-before-run=false format:check` passed with
  `All matched files use Prettier code style!`.
- `git diff --check` passed.
- Sandboxed `pnpm --config.verify-deps-before-run=false verify` passed
  typecheck, lint, and format, then failed only where sandboxed native IPC and
  listener tests cannot bind (`listen EPERM 127.0.0.1` and ZeroMQ `Operation
  not permitted`): 51 files and 995 tests passed; 4 files and 30 tests failed.
- Escalated `pnpm --config.verify-deps-before-run=false verify` passed end to
  end: 55 test files and 1025 tests passed in both normal and coverage runs,
  coverage was 95.32% statements / 90.16% branches / 98.36% functions / 95.28%
  lines, TypeDoc/API checks passed with the existing invalid-`origin` warning,
  proto lint passed, and generated proto outputs were clean.
- Post tiny-fix verification passed:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/index.test.ts`
  with `2` files and `24` tests,
  `pnpm --config.verify-deps-before-run=false docs:check` with the existing
  invalid-`origin` TypeDoc warning,
  `pnpm --config.verify-deps-before-run=false format:check`, and
  `git diff --check`.
- Final native `pnpm --config.verify-deps-before-run=false verify` passed:
  normal tests `55` files / `1025` tests, coverage tests `55` files / `1025`
  tests, coverage 95.32% statements / 90.16% branches / 98.36% functions /
  95.28% lines, TypeDoc/API checks with the existing invalid-`origin` warning,
  proto lint, and generated-clean checks.
