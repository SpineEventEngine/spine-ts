# Review Log: T-0012.12d Validation And Refusal

Task log: `build-protocol/tasks/T-0012-12d-validation-refusal/TASK.md`
Branch: `task/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Reviewed commit/diff basis:
`ec3e9d2`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Status: round-two metadata fixed; re-review pending

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Rounds

### Round 1

Reviewed basis: implementation commit
`a831bd6273335c90a85f57e9772a64afe09e687d`.

Outcome: changes requested.

Findings:

- `examples/todo/src/index.test.ts` invalid validation and business-refusal
  paths asserted read-side state immediately after the rejected `Ack`. This did
  not prove that no projection change appeared later. The affected reads were
  the invalid rename path and both refusal paths around the prior lines 157,
  204, and 227.
- Durable task/report/work-log metadata still used placeholders or stale
  process wording after implementation commit `a831bd6`, including
  implementation/final branch HEAD placeholders and a next step to commit the
  already-created implementation.

Planned fixes:

- Add a small black-box eventual unchanged-state helper for the to-do task-list
  projection.
- Use it in the invalid validation, already-completed refusal, and open-reopen
  refusal tests so the tests wait for any divergent projection snapshot and
  fail if one appears.
- Capture RED by temporarily demonstrating the helper catches a post-rejection
  delayed mutation, then remove that deliberate mutation for GREEN.
- Record implementation commit
  `a831bd6273335c90a85f57e9772a64afe09e687d` in task/report/work-log metadata
  and update current state/next step to review/fix/re-review.
- Run the focused to-do example test plus required typecheck, lint, changed-file
  Prettier, docs, proto, and diff checks before committing the review-fix.

### Round 2

Reviewed basis: review-fix commit `dc2d37e`.

Outcome: changes requested.

Findings:

- `examples/todo/src/index.test.ts` `taskListSnapshot` only captured the list
  id, open count, and first matching task. The eventual unchanged helper could
  therefore miss extra or duplicate `TaskList.tasks` rows when the count and
  first task stayed unchanged.
- Durable metadata in the task, implementation report, and work log still used
  unresolved placeholders for the already-created review-fix/final-head state.
  The work log current state also still said the next step was to commit the
  already-committed review fix.

Planned fixes:

- Add a focused RED test that keeps the list id, open count, and first task
  unchanged while adding an extra task row.
- Update `taskListSnapshot` to normalize and compare every relevant
  `TaskList.tasks` row using primitive task fields.
- Replace review-fix/final-head placeholders with explicit `dc2d37e`.
- Update the work log current state so it points to round-two verification and
  commit work, not the already-created review-fix commit.
- Run the focused to-do example test plus required typecheck, lint,
  changed-file Prettier, docs, proto, and diff checks before committing the
  round-two fix.

Fix evidence:

- RED:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 12 tests / 1 failure because the old snapshot comparison returned
  `true` for unchanged id/open count/first task plus an extra completed task
  row.
- GREEN/final verification:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`,
  `pnpm typecheck`, `pnpm lint`, changed-file
  `pnpm exec prettier --check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, and `git diff --check` passed. The docs check
  reported the existing invalid `origin` TypeDoc source-link warning only.

### Round 3

Reviewed basis: round-two-fix commit `ec3e9d2`.

Outcome: changes requested.

Findings:

- Task and work-log metadata still recorded only the pre-round-two head
  `dc2d37e` after round-two fix commit `ec3e9d2`.
- Work-log round-two timestamps were out of chronological order after an
  existing `18:56 WEST` entry.

Planned fixes:

- Record `ec3e9d2` as the round-two fix and final branch head in task,
  implementation report, and work-log metadata.
- Correct round-two work-log timestamps so the log remains chronological.
