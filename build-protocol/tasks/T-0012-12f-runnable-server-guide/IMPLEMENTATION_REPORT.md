# Implementation Report: T-0012.12f Runnable Server And Guide

Status: final verification passed
Branch: `task/T-0012-12f-runnable-server-guide`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Baseline commit: `230452d`
Setup commit: `21c3c27`

## Summary

This slice closes the to-do example by making it runnable through real
gRPC-compatible services and replacing the remaining placeholder-oriented docs.

Implemented:

- `startTodoServer()` in the example package starts an HTTP/2 Connect host over
  `createTodoContext()` and existing `SpineServices`.
- `@spine-ts/example-todo` has a `start` script for the built server.
- The focused example suite includes a real-client smoke test for
  `CommandService`, `QueryService`, and `SubscriptionService`.
- README and `USER_GUIDE.md` now describe the actual generation, startup,
  command, query, subscription, test, and in-memory behavior.

## Planned Implementation Shape

- Reuse the existing to-do bounded-context assembly and `SpineServices`.
- Add the smallest example-owned HTTP/2 Connect server startup surface needed
  for a standalone example.
- Add focused real-client smoke coverage for command, query, and subscription
  behavior.
- Refresh README and `USER_GUIDE.md` to explain actual usage and limitations.

## Framework Gap Policy

No framework gap is known at setup. If implementation proves one, pause this
slice, record the gap, and implement the framework slice first under the same
autonomous protocol.

Any change under `packages/server` must first record the Spine JVM
server-source/docs guardrail in the task logs.

No `packages/server` change is currently planned. The implementation will reuse
`SpineServices` directly from `examples/todo/src/index.ts`.

Final result: no framework gap was found. No `packages/server` changes were
made.

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
- RED:
  - First focused Vitest after the smoke-test addition failed before test
    execution because the example package did not directly depend on
    `@connectrpc/connect` or `@connectrpc/connect-node`.
  - After adding those direct dependencies and restoring `node_modules`, focused
    Vitest failed as intended with `TypeError: startTodoServer is not a
function`.
- GREEN:
  - `pnpm typecheck:build` passed after adding the example-owned server startup
    surface and Node types.
  - Sandboxed focused Vitest failed with `listen EPERM: operation not permitted
127.0.0.1`; this also exposed missing startup-listen rejection handling,
    which was fixed.
  - Escalated
    `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
    passed, 1 file / 15 tests.
- FINAL:
  - `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
    passed with escalation, 1 file / 15 tests.
  - `pnpm typecheck` passed.
  - `pnpm lint` passed, including cleanup enforcement.
  - Changed-file Prettier check passed.
  - `pnpm docs:check` passed with the existing invalid-origin TypeDoc warning.
  - `pnpm proto:check-generated` passed.
  - `git diff --check` passed.
  - Sandboxed `pnpm test:coverage` failed with expected local listener/ZeroMQ
    `EPERM` failures. Escalated `pnpm test:coverage` passed, 45 files / 651
    tests, with 95.18% statements, 90.48% branches, 97.63% functions, and
    95.2% lines.
