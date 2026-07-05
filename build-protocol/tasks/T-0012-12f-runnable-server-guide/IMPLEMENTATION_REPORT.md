# Implementation Report: T-0012.12f Runnable Server And Guide

Status: setup verified; ready for implementation
Branch: `task/T-0012-12f-runnable-server-guide`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Baseline commit: `230452d`

## Summary

This slice closes the to-do example by making it runnable through real
gRPC-compatible services and replacing the remaining placeholder-oriented docs.

## Planned Implementation Shape

- Reuse the existing to-do bounded-context assembly and `SpineServices`.
- Add the smallest example-owned server startup surface needed for a standalone
  example.
- Add focused real-client smoke coverage for command, query, and subscription
  behavior.
- Refresh README and `USER_GUIDE.md` to explain actual usage and limitations.

## Framework Gap Policy

No framework gap is known at setup. If implementation proves one, pause this
slice, record the gap, and implement the framework slice first under the same
autonomous protocol.

Any change under `packages/server` must first record the Spine JVM
server-source/docs guardrail in the task logs.

## Verification Evidence

- Sandboxed `pnpm install` failed with registry `ENOTFOUND`; escalated
  `pnpm install` succeeded.
- Changed-log Prettier check passed.
- `git diff --check` passed.
- First focused todo test failed before build outputs existed, with package
  entry resolution for `@spine-ts/core`.
- `pnpm typecheck` passed.
- Focused
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed after typecheck built the packages, 1 file / 14 tests.
