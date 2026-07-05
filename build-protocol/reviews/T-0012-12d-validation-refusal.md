# Review Log: T-0012.12d Validation And Refusal

Task log: `build-protocol/tasks/T-0012-12d-validation-refusal/TASK.md`
Branch: `task/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Reviewed commit/diff basis:
`a831bd6273335c90a85f57e9772a64afe09e687d`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Status: round-one fix ready for re-review

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
