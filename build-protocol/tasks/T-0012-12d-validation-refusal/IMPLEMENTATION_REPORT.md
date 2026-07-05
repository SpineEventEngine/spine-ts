# Implementation Report: T-0012.12d Validation And Refusal

Status: setup baseline verified; implementation pending
Branch: `task/T-0012-12d-validation-refusal`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`
Baseline commit: `27250a0`
Setup commit: `c264543`

## Summary

This slice will extend the runnable to-do example with invalid-command
validation and business-refusal paths over the same command, aggregate,
projection, and query behavior completed by `T-0012.12c`.

## Expected Implementation Shape

- Add focused black-box tests before implementation changes.
- Prefer existing generated Protobuf-ES schemas and framework validation APIs.
- Add the smallest domain code needed in `examples/todo/src/index.ts`.
- Avoid a custom refusal/details hierarchy.
- Update example docs only for externally visible behavior.

## Verification Evidence

- Baseline `pnpm typecheck` passed in the task worktree.
- Baseline
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 8 tests.
