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

### Final Verification

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

Independent review has run through five rounds. Round 1 moved payload
validation to the `CommandBus`, removed an accidental public entity inspection
hook, and filled missing public Ack docs. Round 2 moved internal validation
errors back into their owning bus/repository layers and kept arbitrary
dispatcher-thrown `ValidationException`s sanitized. Round 3 aligned docs/report
wording with the bus-boundary behavior, mapped structural payload mismatch
through the same command validation path, restored stable transition-validation
metadata for direct repository/bus callers, and passed focused/static
verification. Round 4 resolved docs-only wording drift and passed docs-only
verification. Round 5 resolved the last implementation-report wording drift and
passed report-only verification. Round 6 resolved the final README wording
alignment found by TypeScript/API review and passed docs/report verification.
Round 7 is resolving rejected transition rollback handling.
