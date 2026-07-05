# T-0012.12c: Task Operations

Status: opened; implementation pending
Start: `2026-07-05 16:12 WEST`
End: Pending
Baseline commit: `fc71408`
Task log path: `build-protocol/tasks/T-0012-12c-task-operations/TASK.md`
Branch: `task/T-0012-12c-task-operations`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Authoring sub-agent: `019f32d6-a303-7480-b4b9-d30a3da75ea1`
Reviewer sub-agents: pending
Implementation commit: pending
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
- Add coverage proving aggregate state is preserved through persisted history
  and snapshot-backed rehydration rather than direct projection mutation.
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
- Event appliers preserve aggregate state through persisted history and
  snapshots rather than mutating projection state directly.
- No framework gap is introduced unless proven by a focused failing test and
  routed through the parent task's gap-routing rule.

## Verification Plan

- Red-first focused example black-box tests for rename, complete, reopen, and
  replayed aggregate state.
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
