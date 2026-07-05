# Implementation Report: T-0012.12f Runnable Server And Guide

Status: task review clean; final verification pending
Branch: `task/T-0012-12f-runnable-server-guide`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Baseline commit: `230452d`
Setup commit: `21c3c27`
Implementation commit: `995e842`
Review-fix commit: `9872e7d`
Metadata follow-up commit: `21470bc`
Metadata state correction commit: `fe46d2a`

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

## Round 1 Review Fixes

Addressed in `9872e7d`:

- Move standalone smoke-test cleanup so `server.close()` is guaranteed after
  server startup.
- Settle the pending subscription update promise during cleanup.
- Format IPv6 hosts safely in `TodoServer.baseUrl`.
- Update the example package description.
- Guard undefined query row states in the guide snippet.
- Correct task/report/review/work-log timestamps, author/reviewer metadata, and
  review basis.

Verification:

- Changed-file Prettier write/check passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- Sandboxed focused Vitest failed with expected `listen EPERM` on
  `127.0.0.1`; escalated focused Vitest passed, 1 file / 15 tests.
- `pnpm lint` passed.
- `pnpm docs:check` passed with the existing invalid-origin TypeDoc warning.
- `pnpm proto:check-generated` passed.

## Round 2 Re-Review Fixes

Addressed in `21470bc`:

- Updated stale review-state wording that still described the `9872e7d`
  review-fix commit as pending or in progress.
- Recorded that round 2 found metadata-only comments while security,
  performance/reliability, and TypeScript/API docs were clean.

Verification:

- Changed-log Prettier check passed.
- `git diff --check` passed.
- Re-review package:
  `.superpowers/sdd/review-9872e7d..21470bc.diff`.

## Round 3 And 4 Metadata Corrections

Addressed in `1dc0969`:

- Recorded the `21470bc` metadata follow-up as committed and packaged.
- Added verification evidence for the `21470bc` metadata follow-up.

Addressed in `fe46d2a`:

- Avoided exact pending-package metadata for the current correction, because
  the exact hash is only stable after commit.
- Recorded that metadata-correction re-review should use `HEAD~1..HEAD` while
  the latest correction is pending, avoiding stale exact pending-package
  metadata.
- Recorded round 4 comments against `21470bc..1dc0969`.

Verification:

- Changed-log Prettier check passed before commit.
- `git diff --check` passed before commit.
- Five-lane re-review of `1dc0969..fe46d2a` was clean.
