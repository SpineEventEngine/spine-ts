# T-0012.12d: Validation And Refusal

Status: round-six metadata fixed; re-review pending
Start: `2026-07-05 18:08 WEST`
End: `2026-07-05 18:49 WEST`
Baseline commit: `27250a0`
Task log path: `build-protocol/tasks/T-0012-12d-validation-refusal/TASK.md`
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Authoring sub-agent: main Codex implementer
Reviewer sub-agents: unavailable in this session; local two-axis review completed
Setup commit: `c264543`
Implementation commit: `a831bd6273335c90a85f57e9772a64afe09e687d`
Round-one reviewed branch HEAD: `a831bd6273335c90a85f57e9772a64afe09e687d`
Review-fix commit: `dc2d37e`
Round-two-fix commit: `ec3e9d2`
Round-three-metadata commit: `7c0d191`
Round-four-metadata commit: `443d95b`
Round-five-metadata commit: `b75fb49`
Round-six-metadata commit: `ed40518`
Final branch HEAD: `ed40518`

## Objective

Demonstrate invalid-command validation and business-refusal behavior in the
to-do example through real framework service behavior.

## Required Inputs To Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/tasks/T-0012-12c-task-operations/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- Existing example code under `examples/todo/src`.
- Existing to-do Protobuf contracts and generated schemas under
  `examples/todo/proto` and `examples/todo/generated`.
- Existing validation and refusal seams in `packages/server`, `packages/core`,
  and `packages/testing`.

## Scope

In scope:

- Add a validation-failure example using existing Spine validation options and
  the existing validation runtime.
- Add business-refusal behavior for normal commands that reach a handler but
  must not produce events.
- Keep refusal names short and domain-familiar, such as `TASK_ALREADY_DONE` or
  `TASK_NOT_DONE`.
- Add black-box tests proving validation/refusal `Ack` status and no read-side
  state changes after rejected commands.
- Update example README and `USER_GUIDE.md` only as needed.

Out of scope:

- Subscription behavior, which belongs to `T-0012.12e`.
- Standalone server startup or external client guide, which belongs to
  `T-0012.12f`.
- Broad framework redesign, large custom error-detail hierarchy, or new
  public API unless a focused failing test proves a framework gap.

## Acceptance Criteria

- At least one command payload with a Spine validation option fails through
  `CommandService.Post` as `COMMAND_VALIDATION_ERROR` with packed
  `spine.validation.ValidationError` details.
- At least one normal command reaches a handler and is refused with
  `CommandRefusalError`, producing a stable non-ok `Ack` error without writing
  events or projection state.
- Proposed refusal names stay short and domain-familiar.
- Black-box tests prove no read-side state changes after validation failure or
  business refusal.
- No large custom error-details hierarchy is added.

## Verification Plan

- Red-first focused example tests for invalid create/rename and refused
  complete/reopen behavior.
- Assertions inspect `Ack` status type/message and packed validation details
  where applicable.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check if unrelated files block
  full formatting.
- `pnpm docs:check` if public docs/API move.
- `pnpm proto:check-generated`
- `git diff --check`
- Full coverage before marking complete.

## Baseline Evidence

- `pnpm typecheck` passed in the task worktree.
- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 8 tests.

## Implementation Notes

- Added black-box to-do example tests for invalid rename validation, duplicate
  complete refusal, and not-done reopen refusal.
- Invalid rename is packed with validation disabled at the client-side `Any`
  boundary so `CommandService.Post` performs the framework validation and
  returns `COMMAND_VALIDATION_ERROR` with packed
  `spine.validation.ValidationError` details.
- `TaskAggregate` now throws the existing framework `CommandRefusalError` for
  `TASK_ALREADY_DONE` and `TASK_NOT_DONE`; no framework code or custom details
  hierarchy was added.
- The tests read through `QueryService` after each rejected command and assert
  the task-list projection state remains unchanged.
- Round-one review found the invalid validation, duplicate-complete refusal,
  and open-reopen refusal tests only read state immediately after the rejected
  `Ack`. The review-fix strengthens those paths with a black-box eventual
  unchanged-state assertion.
- Round-two review found the eventual unchanged-state helper only compared the
  list id, open count, and first matching task, so it could miss extra task rows
  when those fields stayed unchanged. The round-two fix snapshots the full
  relevant `TaskList.tasks` contents as primitive task fields.

## Red/Green Evidence

- RED:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 10 tests / 1 failure: already-completed `CompleteTask` returned
  Ack status `ok` instead of `error`.
- GREEN:
  `pnpm typecheck:build` passed.
- GREEN:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 11 tests.
- Review-fix RED:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 11 tests / 1 failure after a temporary post-rejection delayed
  rename proved the new eventual invariant helper catches a projection change
  from title `Kept` to `Changed`.
- Review-fix GREEN:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed after removing the temporary mutation while keeping the strengthened
  eventual assertions, 1 file / 11 tests.
- Review-fix final verification:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`,
  `pnpm typecheck`, `pnpm lint`, changed-file
  `pnpm exec prettier --check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, and `git diff --check` passed.
  `pnpm docs:check` reported the existing invalid `origin` TypeDoc source-link
  warning only.
- Round-two fix RED:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 12 tests / 1 failure because the old snapshot comparison returned
  `true` for a task list with unchanged id/open count/first task and an extra
  completed task row.
- Round-two fix GREEN:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed after the snapshot helper began comparing every primitive task row, 1
  file / 12 tests.
- Round-two fix final verification:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`,
  `pnpm typecheck`, `pnpm lint`, changed-file
  `pnpm exec prettier --check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, and `git diff --check` passed.
  `pnpm docs:check` reported the existing invalid `origin` TypeDoc source-link
  warning only.

## Final Verification

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 11 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm exec prettier --check` on changed task/example files passed.
- `pnpm docs:check` passed; TypeDoc reported the existing invalid `origin`
  source-link warning only.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.
- Round-two fix verification passed:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 12 tests.
- Round-two fix `pnpm typecheck` passed.
- Round-two fix `pnpm lint` passed.
- Round-two fix changed-file Prettier check passed.
- Round-two fix `pnpm docs:check` passed with the existing invalid `origin`
  TypeDoc source-link warning only.
- Round-two fix `pnpm proto:check-generated` passed.
- Round-two fix `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed because local IPC and loopback are
  restricted (`Operation not permitted` and `listen EPERM 127.0.0.1`).
- Escalated `pnpm test:coverage` passed, 45 files / 647 tests, with overall
  coverage: statements 95.18%, branches 90.48%, functions 97.63%, lines
  95.2%.

## Review Notes

- Standards: no issues found against `CODE_QUALITY.md`; the diff stays scoped
  to the example and task logs, uses existing framework names, and does not add
  a custom details hierarchy.
- Spec: no gaps found against this task's acceptance criteria. Validation
  fails through `CommandService.Post` with packed `ValidationError` details,
  refusal uses `CommandRefusalError`, and tests assert unchanged read-side
  projection state after both validation failure and business refusal.
- Framework gap found: none.
- Round-one review result: changes requested for eventual negative assertions
  and stale durable-log metadata. Planned fixes are to poll for any divergent
  task-list snapshot after rejected commands, record implementation commit
  `a831bd6273335c90a85f57e9772a64afe09e687d`, and route the branch back to
  review/re-review after the fix commit.
- Round-two review result: changes requested for full-list snapshot coverage and
  durable metadata cleanup. Planned fixes are to add a focused failing helper
  test, snapshot all relevant task rows, record `dc2d37e` explicitly as the
  prior review-fix/final-head state, and run the required verification suite
  before committing.

## Skill Applicability Check

- Selected workflow skills for this slice:
  `subagent-driven-development`, `using-git-worktrees`,
  `test-driven-development`, `implement`, `requesting-code-review`, and
  `verification-before-completion`.
- Advisory skills available if implementation needs them:
  `error-handling-patterns`, `javascript-testing-patterns`,
  `typescript-advanced-types`, and `nodejs-backend-patterns`.
- Project protocol, cleanup code style, Protobuf contracts, and explicit human
  instructions override skill guidance if conflicts arise.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Initial Decisions

- Continue from `main@27250a0`, immediately after `T-0012.12c` integration.
- Use existing validation and refusal framework seams directly before adding any
  new API.
- Keep refusal names short and close to Spine JVM terminology.
- If the example exposes a framework gap, record it and route it through a
  focused gap slice before broadening framework code.
