# Implementation Report: T-0012.12d Validation And Refusal

Status: round-eleven metadata fixed; re-review pending
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Setup commit: `c264543`
Implementation commit: `a831bd6273335c90a85f57e9772a64afe09e687d`
Round-one reviewed branch HEAD: `a831bd6273335c90a85f57e9772a64afe09e687d`
Review-fix commit: `dc2d37e`
Round-two-fix commit: `ec3e9d2`
Round-three-metadata commit: `7c0d191`
Round-four-metadata commit: `443d95b`
Round-five-metadata commit: `b75fb49`
Round-six-metadata commit: `ed40518`
Round-seven-metadata commit: `cbf610f`
Round-eight-metadata commit: `af96a6a`
Round-nine-metadata commit: `d6ae65b`
Round-ten-metadata commit: `95bf3da`
Round-eleven-metadata commit: `1e7b884`
Final branch HEAD: `1e7b884`

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
- Round-two review-fix strengthens that helper to snapshot the full relevant
  `TaskList.tasks` contents as primitive task fields.
- Branch closure commit, if any, will be recorded after closure or
  integration, once it exists.

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
- Round-two fix RED
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 12 tests / 1 failure because the old task-list snapshot returned
  `true` for unchanged list id/open count/first task plus an extra completed
  task row.
- Round-two fix GREEN
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed after comparing every primitive task row in the snapshot helper, 1
  file / 12 tests.
- Round-two fix final verification passed:
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

Round-two review after review-fix commit `dc2d37e` requested changes:

- Snapshot and compare the full relevant `TaskList.tasks` contents so
  unchanged-state polling catches extra or duplicate task rows when the list id,
  open count, and first matching task stay unchanged.
- Replace remaining durable metadata placeholders in the task, implementation
  report, and work log with explicit `dc2d37e`, and remove the stale
  current-state instruction to commit the already-created review fix.

Planned round-two fixes: add a focused helper-level RED test for an extra task
row with unchanged count/first task, update `taskListSnapshot` to normalize all
tasks to primitive fields, record the round-two review findings in durable logs,
run required verification, and commit the fix.
