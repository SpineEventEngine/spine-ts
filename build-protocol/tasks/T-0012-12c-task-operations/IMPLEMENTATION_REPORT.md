# Implementation Report: T-0012.12c Task Operations

Status: opened; implementation pending
Branch: `task/T-0012-12c-task-operations`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Baseline commit: `fc71408`

## Summary

This slice extends the runnable to-do create flow with rename, complete, and
reopen operations using the same aggregate, event, projection, and query path.

## Current State

- Task branch/worktree has been created.
- Durable task, implementation, review, and work logs have been opened before
  implementation.
- Implementation sub-agent is pending.

## Expected Implementation Shape

- Add the smallest domain code needed in `examples/todo/src/index.ts`.
- Extend `examples/todo/src/index.test.ts` test-first with black-box command and
  query assertions.
- Use the existing generated Protobuf-ES schemas directly.
- Avoid new framework abstractions unless a failing example test proves a
  concrete gap.

## Verification Evidence

Pending.
