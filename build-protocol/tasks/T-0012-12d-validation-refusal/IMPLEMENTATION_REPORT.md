# Implementation Report: T-0012.12d Validation And Refusal

Status: review-fix ready for re-review
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Setup commit: `c264543`
Implementation commit: `a831bd6273335c90a85f57e9772a64afe09e687d`
Round-one reviewed branch HEAD: `a831bd6273335c90a85f57e9772a64afe09e687d`
Review-fix commit: this commit

## Summary

This slice extends the runnable to-do example with invalid-command validation
and business-refusal paths over the same command, aggregate, projection, and
query behavior completed by `T-0012.12c`.

## Implementation Shape

- Added focused black-box tests before implementation changes.
- Used existing generated Protobuf-ES schemas and framework validation APIs.
- Added only domain refusal checks in `examples/todo/src/index.ts`.
- Used existing `CommandRefusalError`; no custom refusal/details hierarchy was
  added.
- Updated example README and `USER_GUIDE.md` for externally visible behavior.
- Round-one review-fix strengthens the rejected-command tests with a black-box
  eventual unchanged-state helper for invalid validation and both business
  refusal paths.

## Verification Evidence

- Baseline `pnpm typecheck` passed in the task worktree.
- Baseline
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 8 tests.
- RED
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 10 tests / 1 failure: duplicate `CompleteTask` returned Ack
  status `ok` instead of the expected refusal error.
- GREEN `pnpm typecheck:build` passed.
- GREEN
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 11 tests.
- Final `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 11 tests.
- Final `pnpm typecheck` passed.
- Final `pnpm lint` passed.
- Final changed-file Prettier check passed.
- Final `pnpm docs:check` passed with only the existing invalid `origin`
  TypeDoc source-link warning.
- Final `pnpm proto:check-generated` passed.
- Final `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed on sandboxed local IPC/loopback
  permissions. Escalated `pnpm test:coverage` passed, 45 files / 647 tests,
  overall coverage 95.18% statements, 90.48% branches, 97.63% functions, and
  95.2% lines.
- Review-fix RED
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 11 tests / 1 failure after a temporary post-rejection delayed
  rename proved the new eventual invariant helper catches a projection change
  from title `Kept` to `Changed`.
- Review-fix GREEN
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed after removing the temporary mutation while keeping the strengthened
  eventual assertions, 1 file / 11 tests.
- Review-fix final verification passed:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`,
  `pnpm typecheck`, `pnpm lint`, changed-file
  `pnpm exec prettier --check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, and `git diff --check`. `pnpm docs:check`
  reported the existing invalid `origin` TypeDoc source-link warning only.

## Framework Gap

No framework gap was found. Existing `CommandService.Post`,
`CommandValidationError`, packed `ValidationError` details, and
`CommandRefusalError` seams were sufficient.

## Review Result

Local standards/spec review found no issues. A separate reviewer sub-agent was
not available in this session.

Round-one review after implementation commit
`a831bd6273335c90a85f57e9772a64afe09e687d` requested changes:

- Strengthen the invalid validation, duplicate-complete refusal, and
  open-reopen refusal tests so they prove no eventual projection change rather
  than only checking an immediate read after the rejected `Ack`.
- Replace stale durable-log placeholders and next-step wording with the
  reviewed implementation commit and a review/fix/re-review state.

Planned fixes: add a small eventual unchanged-state test helper, route all
three rejected-command paths through it, update durable logs, run focused and
repository checks, commit the fix, and send the branch back for re-review.
