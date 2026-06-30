# Implementation Report: T-0010.1 Runtime Lifecycle And Async Queue Kernel

Status: Implementation Complete; Author Verification Passed
Task log: `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/TASK.md`
Work log: `build-protocol/work-logs/T-0010-1.md`
Review log: `build-protocol/reviews/T-0010-1-runtime-lifecycle-queue.md`
Branch: `task/T-0010-1-runtime-lifecycle-queue`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-1-runtime-lifecycle-queue`

## Summary

T-0010.1 starts from parent T-0010 commit `70692a9`. The subtask owns only the
single-process async lifecycle and queue kernel. It must prove intake/queue
separation and deterministic lifecycle behavior while deferring buses,
transport, storage, read-side execution, repository dispatch, and server
services.

Implementation adds the first server-owned single-process async lifecycle and
queue kernel. The public surface remains intentionally small: an explicit
`SingleProcessServerRuntime` instance, a `ServerRuntimeLifecycle` contract,
deterministic lifecycle state types, per-item work completion, and a typed
state error for invalid lifecycle operations.

`enqueue()` is the intake boundary. Accepted work runs after intake returns,
executes FIFO in the same process, and is drained by `close()`. Closing is
idempotent and prevents new queued work. This remains a server runtime kernel,
not a generic job framework or any of the deferred bus/storage/delivery/server
runtime pieces.

## Files Changed

- `packages/server/src/runtime.ts`
- `packages/server/src/runtime.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/TASK.md`
- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-1.md`
- `build-protocol/reviews/T-0010-1-runtime-lifecycle-queue.md`

Setup-created files retained from the handoff:

- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/TASK.md`
- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-1.md`
- `build-protocol/reviews/T-0010-1-runtime-lifecycle-queue.md`
- parent T-0010 logs for subtask creation

## Verification

- Setup baseline verification passed on `2026-06-30 15:11 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Red test run on `2026-06-30 15:18 WEST`:
  `corepack pnpm vitest run packages/server/src/runtime.test.ts packages/server/src/index.test.ts`
  failed because `./runtime.js` and the new package root exports did not exist.
- Focused green runs:
  `corepack pnpm vitest run packages/server/src/runtime.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 16 tests.
- API guard:
  `node scripts/check-api-docs.mjs` passed with 100 proto / 28 core / 103
  server / 26 storage expected exports.
- Author verification passed on `2026-06-30 15:25 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 219 tests,
  coverage 96.33% statements / 90.87% branches / 99.12% functions / 96.26%
  lines, TypeDoc/API checks with 100 proto / 28 core / 103 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Deferred Boundaries

No global singleton, import-time registration, process supervision, gRPC,
ZeroMQ, durable storage, read-side stand, repository dispatch, `CommandBus`,
`EventBus`, `ImportBus`, `Server`, `CommandService`, `Ack`, event store, tenant
index, system context, integration broker, worker processes, or full repository
dispatch was introduced.
