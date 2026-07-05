# Implementation Report: T-0012.12c Task Operations

Status: implemented; awaiting review
Branch: `task/T-0012-12c-task-operations`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Baseline commit: `fc71408`

## Summary

This slice extends the runnable to-do create flow with rename, complete, and
reopen operations using the same aggregate, event, projection, and query path.

## Current State

- Rename, complete, and reopen operations are implemented in the to-do example
  aggregate and task-list projection.
- Focused black-box tests cover command posting and query-visible results for
  each operation.
- A multi-command sequence covers persisted aggregate rehydration by preserving
  title/completed state across create, complete, rename, and reopen commands.

## Expected Implementation Shape

- Add the smallest domain code needed in `examples/todo/src/index.ts`.
- Extend `examples/todo/src/index.test.ts` test-first with black-box command and
  query assertions.
- Use the existing generated Protobuf-ES schemas directly.
- Avoid new framework abstractions unless a failing example test proves a
  concrete gap.

## Verification Evidence

- RED: after adding the focused tests first,
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed with 4 new failures and 3 existing passing tests. The failures showed
  operation command acks as `error` and missing rename/projection effects.
- GREEN: after implementation, the same focused command passed with 7 tests.
- Final focused check:
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 7 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed, including cleanup enforcement.
- `pnpm exec prettier --check` on changed files passed.
- `pnpm docs:check` passed with the existing invalid-origin source-link
  warning.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed from local IPC/localhost sandbox
  restrictions (`Operation not permitted`, `listen EPERM 127.0.0.1`) and
  timeout fallout. Escalated `pnpm test:coverage` passed: 45 files / 643 tests;
  statements 95.18%, branches 90.48%, functions 97.63%, lines 95.20%.
