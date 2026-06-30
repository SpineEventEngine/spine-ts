# Implementation Report: T-0010.2 Bounded Context Runtime Handle

Status: Review Complete; No Open Findings
Task log:
`build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/TASK.md`
Work log: `build-protocol/work-logs/T-0010-2.md`
Review log:
`build-protocol/reviews/T-0010-2-bounded-context-runtime-handle.md`
Branch: `task/T-0010-2-bounded-context-runtime-handle`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-2-bounded-context-runtime-handle`

## Summary

T-0010.2 starts from parent task commit `d570bba` after `T-0010.1` was merged
and verified. The selected work is a minimal context-scoped runtime handle over
an already built `BoundedContext` snapshot and the existing single-process
runtime lifecycle/queue. It deliberately avoids building the JVM server graph.

Implementation added `BoundedContextRuntime`, a public OOP-style handle that
binds one built `BoundedContext` snapshot to a runtime lifecycle. By default it
creates and owns a private `SingleProcessServerRuntime`; callers may inject a
`ServerRuntimeLifecycle`, in which case the caller owns lifecycle sharing and
queue policy. The handle delegates `state`, `start()`, and `close()` only and
exposes fresh immutable context metadata through `name`, `tenantMode`,
`isMultitenant`, `spec`, `repositories`, and `contextSnapshot`.

Security review found that the constructor previously read inherited
`options.runtime` values, allowing a prototype-supplied lifecycle to replace the
private default runtime. The review fix makes runtime injection require an own
`runtime` property and adds a regression test proving inherited values are
ignored.

Security re-review confirmed the fix and found no remaining findings. All
participating implementation, review-fix, and reviewer sub-agents were closed.

## JVM Research Used

Setup inspected Spine JVM `core-jvm/server` source for
`BoundedContext.java`, `BoundedContextBuilder.java`, and `Server.java`, plus
the current TS bounded-context and runtime code. The JVM builder creates system
and domain contexts, initializes command bus, stand, and tenant index, and then
registers repositories/dispatchers. JVM `Server.Builder` wires built contexts
into gRPC command/query/subscription services.

The TS slice should therefore expose only a lightweight handle that keeps
context metadata and lifecycle together. Full repository registration,
dispatcher readiness, buses, services, stand, tenant index, system context,
delivery, transport, and storage remain future tasks.

## Files Changed

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/TASK.md`
- `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010-2.md`
- `build-protocol/reviews/T-0010-2-bounded-context-runtime-handle.md`

No buses, services, storage, stand, tenant index, transport, repository runtime
registration, dispatch, delivery, system context, or handler invocation were
added.

## Verification

- Setup baseline verification passed on `2026-06-30 15:56 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 219 tests,
  coverage 96.33% statements / 90.87% branches / 99.12% functions / 96.26%
  lines, TypeDoc/API checks with 100 proto / 28 core / 104 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Focused implementation verification passed on `2026-06-30 16:06 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 49 tests; `corepack pnpm typecheck:build`,
  `corepack pnpm lint`, `corepack pnpm format:check`, and
  `node scripts/check-api-docs.mjs` passed. The API docs check reported 100
  proto / 28 core / 106 server / 26 storage expected exports and the existing
  non-blocking invalid-origin TypeDoc source-link warning.
- Full implementation verification passed on `2026-06-30 16:09 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 223 tests,
  coverage 96.22% statements / 90.3% branches / 99.15% functions / 96.15%
  lines, TypeDoc/API checks with 100 proto / 28 core / 106 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean. TypeDoc emitted the existing non-blocking invalid-origin
  source-link warning.
- Review-fix focused verification passed on `2026-06-30 16:17 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts` was
  run before the production fix and failed with 1 failed / 40 passed because
  the inherited lifecycle received `start` and `close`; after changing the
  constructor to use `Object.hasOwn(options, "runtime")`, the same command
  passed with 1 test file / 41 tests.
- Review-fix full verification passed on `2026-06-30 16:20 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 224 tests in both
  normal and coverage runs, coverage 96.22% statements / 90.3% branches /
  99.15% functions / 96.15% lines, TypeDoc/API checks with 100 proto / 28 core
  / 106 server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean. TypeDoc emitted the existing
  non-blocking invalid-origin source-link warning.
- Security re-review focused verification passed on `2026-06-30 16:23 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts` passed
  with 1 test file / 41 tests.
