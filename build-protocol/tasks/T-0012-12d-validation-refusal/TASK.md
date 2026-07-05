# T-0012.12d: Validation And Refusal

Status: setup baseline verified; implementation pending
Start: `2026-07-05 18:08 WEST`
End: Pending
Baseline commit: `27250a0`
Task log path: `build-protocol/tasks/T-0012-12d-validation-refusal/TASK.md`
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Authoring sub-agent: pending
Reviewer sub-agents: pending
Setup commit: `c264543`
Implementation commit: pending
Final branch HEAD: pending

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
