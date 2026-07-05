# T-0012.12c: Task Operations

Status: round-seven-status committed; re-review pending
Start: `2026-07-05 16:12 WEST`
End: `2026-07-05 16:21 WEST`
Baseline commit: `fc71408`
Task log path: `build-protocol/tasks/T-0012-12c-task-operations/TASK.md`
Branch: `task/T-0012-12c-task-operations`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Authoring sub-agent: `019f32d6-a303-7480-b4b9-d30a3da75ea1`
Reviewer sub-agents: rounds one through seven closed; re-review pending
Implementation commit: `8ab4b5c`
Review-fix commit: `3ee5c1a`
Metadata-fix commit: `b6495bb`
Status-fix commit: `6fea638`
Restart-guidance-fix commit: `7ed30a3`
Post-restart-status commit: `2cb0cf8`
Round-seven-status commit: `05bceb5`
Final branch HEAD: pending

## Objective

Add the remaining normal to-do operations over the same aggregate and projection
path introduced by `T-0012.12b`.

## Required Inputs To Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- Existing example code under `examples/todo/src`.
- Existing to-do Protobuf contracts and generated schemas under
  `examples/todo/proto` and `examples/todo/generated`.
- Existing framework seams in `packages/server`, `packages/storage`, and
  `packages/testing` needed for aggregate command handling, event replay,
  projection updates, and query visibility.

## Scope

In scope:

- Add decorated aggregate command handlers for `RenameTask`, `CompleteTask`,
  and `ReopenTask`.
- Add aggregate appliers for `TaskRenamed`, `TaskCompleted`, and
  `TaskReopened`.
- Update the task-list projection from the corresponding events.
- Add black-box tests proving command posting and query results after rename,
  complete, and reopen operations.
- Add command/projection coverage proving state remains visible across
  multi-command operation sequences.
- Update example docs and API docs only as needed.

Out of scope:

- Validation/refusal behavior, which belongs to `T-0012.12d`.
- Subscriptions, which belong to `T-0012.12e`.
- Standalone server startup or external client guide, which belongs to
  `T-0012.12f`.
- Broad server facade, new production storage, or speculative framework APIs.

## Acceptance Criteria

- `RenameTask`, `CompleteTask`, and `ReopenTask` each have decorated aggregate
  command handlers.
- `TaskRenamed`, `TaskCompleted`, and `TaskReopened` each have aggregate
  appliers.
- The projection subscriber updates the list/read model for renamed,
  completed, and reopened tasks.
- Black-box tests verify command posting and query results after each
  operation.
- Event appliers update aggregate state for the task-operation events, and
  black-box tests verify command/projection-visible state across multi-command
  operation sequences.
- No framework gap is introduced unless proven by a focused failing test and
  routed through the parent task's gap-routing rule.

## Verification Plan

- Red-first focused example tests for rename, complete, reopen, duplicate
  same-ID projection counts, and multi-command state visibility.
- Focused generated-domain compile or example test command.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check if unrelated untracked
  files block the full formatter.
- `pnpm docs:check` if public exports or docs change.
- `pnpm proto:check-generated`
- `git diff --check`
- Full coverage before marking complete.

## Skill Applicability Check

- Session inventory exposed these relevant skills: `subagent-driven-development`,
  `using-git-worktrees`, `test-driven-development`, `implement`,
  `requesting-code-review`, and `verification-before-completion`.
- Expected-skill manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Installed skill entrypoint check:
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print | sort`
  filtered to task-relevant skills. Relevant entrypoints were readable.
- Selected and read before task actions:
  `subagent-driven-development`, `using-git-worktrees`,
  `test-driven-development`, `implement`, `requesting-code-review`, and
  `verification-before-completion`.
- Skipped relevant-looking skills:
  `cqrs-implementation` because the slice uses existing CQRS framework seams
  and does not design new CQRS infrastructure.
- Skill conflict resolution: project protocol, task scope, cleanup code style,
  and explicit human instructions override skill guidance if conflicts arise.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Initial Decisions

- Continue from `main@fc71408`, immediately after `T-0012.12b` integration.
- Use TDD for each new operation behavior.
- Keep the example API narrow and direct; do not add a facade or client DSL.
- If a framework gap is found, record it and route it through a gap slice before
  broadening `@spine-ts/server`.

## Implementation Summary

- Added decorated aggregate handlers for `RenameTask`, `CompleteTask`, and
  `ReopenTask`.
- Added aggregate appliers for `TaskRenamed`, `TaskCompleted`, and
  `TaskReopened`.
- Updated `TaskListProjection` subscribers for renamed, completed, and reopened
  task rows.
- Added focused black-box tests for each operation, duplicate same-ID projection
  count coverage, and a multi-command command/projection state sequence.
- Updated the example README and user guide status text for the new operations.

## Verification Evidence

- RED: focused example test failed after tests were added first, with 4 new
  failures and 3 existing passing tests.
- GREEN/final focused:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 7 tests.
- ROUND-ONE RED: focused example test failed after adding duplicate same-ID
  projection count coverage, with 1 failure: expected duplicate completed rows
  to set `openTaskCount` to 0, received 1.
- ROUND-ONE GREEN/focused:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 8 tests.
- ROUND-ONE final verification:
  `pnpm typecheck` passed.
- ROUND-ONE final verification:
  `pnpm lint` passed, including cleanup enforcement.
- ROUND-ONE final verification:
  changed-file Prettier check passed after formatting the work log.
- ROUND-ONE final verification:
  `pnpm docs:check` passed with the existing invalid-origin source-link
  warning.
- ROUND-ONE final verification:
  `pnpm proto:check-generated` passed.
- ROUND-ONE final verification:
  `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- Tracked-file Prettier check passed.
- `pnpm docs:check` passed with the existing invalid-origin source-link warning.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed from local IPC/localhost sandbox
  restrictions. Escalated `pnpm test:coverage` passed: 45 files / 643 tests;
  statements 95.18%, branches 90.48%, functions 97.63%, lines 95.20%.
