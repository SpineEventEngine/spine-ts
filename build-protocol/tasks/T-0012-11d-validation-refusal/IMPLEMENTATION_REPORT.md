# Implementation Report: T-0012.11d Validation And Immediate Refusal Outcomes

Status: implemented and verified
Branch: `task/T-0012-11d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11d-validation-refusal`
Baseline commit: `c13b19c`

## Initial Evidence

- `@spine-ts/core` already exposes `validateMessage()`, `checkValid()`, and
  `ValidationException` backed by `@spine-event-engine/validation-ts`.
- `EntityTransaction.commit()` already returns rejected commit results when
  transition validation, including `(set_once)`, fails.
- Aggregate command execution currently unpacks command payloads and invokes
  assignees, but it does not yet validate payloads before loading/writing, and
  `CommandService.Post` currently maps dispatch errors to the generic
  `COMMAND_POST_ERROR`.

## Implementation Notes

- `2026-07-05 04:36 WEST`: Confirmed the child branch starts from `c13b19c`.
  The task docs still named the previous parent commit `47777d3`, so this pass
  corrected the child durable baseline before code changes.
- First TDD target: prove aggregate command execution rejects invalid command
  payloads before aggregate history load, event append, snapshot write, or
  stored-event dispatch.
- Runtime aggregate command execution now validates command payloads with the
  existing `@spine-ts/core` validation facade before routing/load/durable
  write-side work.
- `CommandService.Post` now maps one immediate business refusal path
  (`CommandRefusalError`) to a stable non-ok Ack, maps command-bus payload
  validation failures to `COMMAND_VALIDATION_ERROR`, keeps dispatcher-thrown
  `ValidationException`s sanitized as `COMMAND_POST_ERROR`, and maps aggregate
  transition validation failures to
  `COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with validation details.
- Aggregate command execution now reads rejected `EntityTransaction` commits
  after event appliers and raises a command-visible transition validation error
  before event append, snapshot write, or dispatch.
- Round 12 tightened rejected-commit marker lifetime: starting a new
  transaction no longer clears an earlier rejected commit, so rollback followed
  by a fresh transaction without an accepted commit cannot mask transition
  validation failure. Accepted commits remain the marker-clearing recovery path.

## Verification

### RED

- `pnpm vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects invalid aggregate command payloads before durable aggregate work"`:
  failed as expected. The invalid command resolved `undefined` instead of
  rejecting, proving aggregate command execution did not validate the payload
  before invoking the existing path.
- `pnpm vitest run packages/server/test/services/spine-services.test.ts -t "returns stable Ack errors for immediate aggregate command refusals"`:
  failed as expected. The aggregate handler refusal was reported as
  `COMMAND_POST_ERROR` instead of the handler's stable `TASK_ALREADY_COMPLETED`
  error type.
- `pnpm vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects state-transition validation failures before storing aggregate output"`:
  failed as expected. The command resolved `undefined` instead of rejecting,
  proving rejected entity transaction commits were not yet wired into aggregate
  command execution.

### GREEN

- `pnpm vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects invalid aggregate command payloads before durable aggregate work"`:
  passed with 1 test and 38 skipped.
- `pnpm vitest run packages/server/test/services/spine-services.test.ts -t "returns stable Ack errors for immediate aggregate command refusals"`:
  passed with 1 test and 33 skipped.
- `pnpm vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects state-transition validation failures before storing aggregate output"`:
  passed with 1 test and 39 skipped.
- `pnpm vitest run packages/server/test/services/spine-services.test.ts -t "returns stable Ack errors"`:
  passed with 3 Ack outcome tests and 33 skipped.
- `pnpm vitest run packages/server/test/repository/repository-routing.test.ts packages/server/test/services/spine-services.test.ts -t "rejects invalid aggregate command payloads before durable aggregate work|returns stable Ack errors|rejects state-transition validation failures before storing aggregate output"`:
  passed with 2 files, 5 tests, and 71 skipped.

### Initial Full Verification

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm docs:check`: passed. TypeDoc warned only that git remote `origin` is
  not valid, so generated source links will be broken.
- `git diff --check`: passed.
- Sandboxed `pnpm test:coverage`: failed because the sandbox blocks local
  listeners/IPC. Exact failures included `listen EPERM: operation not permitted
127.0.0.1` in real gRPC service tests and ZeroMQ local IPC smoke tests with
  `Operation not permitted`.
- Escalated `pnpm test:coverage`: passed with 45 files and 597 tests. Coverage
  summary: statements 95%, branches 90.05%, functions 97.53%, lines 95.02%.

## Review Summary

Review history is current through the round-14 docs/status follow-up. Round 1
moved payload validation to the `CommandBus`, removed an accidental public
entity inspection hook, and filled missing public Ack docs. Round 2 moved
internal validation errors back into their owning bus/repository layers and
kept arbitrary dispatcher-thrown `ValidationException`s sanitized. Round 3
aligned docs/report wording with the bus-boundary behavior, mapped structural
payload mismatch through the same command validation path, restored stable
transition-validation metadata for direct repository/bus callers, and passed
focused/static verification. Round 4 resolved docs-only wording drift and
passed docs-only verification. Round 5 resolved the last implementation-report
wording drift and passed report-only verification. Round 6 resolved the final
README wording alignment found by TypeScript/API review and passed docs/report
verification. Round 7 resolved rejected transition rollback handling. Round 8
resolved aggregate replay error separation, stale-marker recovery coverage, and
queued command-bus validation ordering coverage. Round 9 protected rejected
transition-validation details from handler mutation, moved replay errors to a
replay-owned module, qualified public replay-failure docs, and refreshed parent
ledger state. Round 10 aligned remaining replay-failure documentation and
status summaries. Round 11 added sanitized incompatible-payload validation
details. Round 12 preserves rejected-commit markers across rollback followed by
a fresh transaction until an accepted commit clears them. Round 13 refreshed the
review-log lane rollup and fixed README Markdown continuation. Round 14 updated
the report/parent durable status to include the round-13 handoff and then
aligned the child task status with the round-14 review-log status.

### Latest Verification

- `2026-07-05 10:05 WEST`: Round-14 status follow-up verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.
- `2026-07-05 10:00 WEST`: Round-14 docs/status verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.
- `2026-07-05 09:50 WEST`: Round-13 docs-only verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.
- `2026-07-05 09:38 WEST`: Focused restarted-marker regressions passed with 3
  selected tests. Full affected repository-routing suite passed with 46 tests.
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed. No service/network test was blocked in this pass.
- `2026-07-05 09:20 WEST`: Focused incompatible-payload service regression
  passed. Full affected bus/repository/service suites passed outside the
  sandbox with 3 files and 97 tests. The sandboxed affected suite failed only
  on known loopback gRPC listener permissions (`listen EPERM 127.0.0.1`).
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed.
- `2026-07-05 09:03 WEST`: Docs-only round-10 verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.
- `2026-07-05 08:49 WEST`: Focused mutation regression passed. Full affected
  bus/repository/service suites passed outside the sandbox with 3 files and 96
  tests. The sandboxed affected suite failed only on known loopback gRPC
  listener permissions (`listen EPERM 127.0.0.1`). `pnpm typecheck`,
  `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and `git diff --check`
  passed.
- `2026-07-05 07:34 WEST`: Focused bus/repository regressions passed with 3
  selected tests. Full affected bus/repository/service suites passed outside
  the sandbox with 3 files and 95 tests. The sandboxed affected suite failed
  only on known loopback gRPC listener permissions (`listen EPERM 127.0.0.1`).
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed.
