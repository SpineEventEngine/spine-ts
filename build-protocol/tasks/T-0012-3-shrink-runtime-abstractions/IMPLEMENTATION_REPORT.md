# Implementation Report: T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions

Status: Created; implementation pending
Branch: `task/T-0012-3-shrink-runtime-abstractions`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-3-shrink-runtime-abstractions`
Baseline commit: `cb5ace3`

## Setup Summary

- Parent corrective branch integrated `T-0012.1` and `T-0012.2`.
- Parent verification passed after the source-folder repack.
- This task starts before storage/event-store reset, so it must delete or
  shrink wrong abstractions rather than replacing them with new behavior.

## Expected Implementation Shape

- Prefer deleting public types/tests over moving them sideways.
- Keep remaining errors simple.
- Update export lists and TypeDoc expected counts when API shrinkage is
  deliberate.
- Keep transport abstraction focused on topic/subscription plus
  publish/request/respond.
- Leave later roadmap behavior absent.

## Verification Plan

- Focused tests for removed/shrunk APIs where practical.
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm docs:check`
- `corepack pnpm proto:generate`
- `corepack pnpm proto:check-generated`
- `git diff --check`
- `env CI=true corepack pnpm verify`, escalated if ZeroMQ local IPC is blocked
  by the sandbox.

## Implementation Notes

Pending.
