# Implementation Report: T-0012.12d Validation And Refusal

Status: complete; commit pending
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Setup commit: `c264543`

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

## Framework Gap

No framework gap was found. Existing `CommandService.Post`,
`CommandValidationError`, packed `ValidationError` details, and
`CommandRefusalError` seams were sufficient.

## Review Result

Local standards/spec review found no issues. A separate reviewer sub-agent was
not available in this session.
