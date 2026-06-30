# Implementation Report: T-0010 Single-Process Async Runtime

Status: Complete
Task log: `build-protocol/tasks/T-0010-single-process-async-runtime/TASK.md`
Work log: `build-protocol/work-logs/T-0010.md`
Review log: `build-protocol/reviews/T-0010-single-process-async-runtime.md`
Branch: `task/T-0010-single-process-async-runtime`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-single-process-async-runtime`

## Summary

T-0010 started after T-0009f was integrated into `main` and verified. The setup
branch starts from `169af02`. The initial scope is a first single-process async
runtime slice, not a full server, gRPC surface, ZeroMQ transport, durable
delivery engine, read-side stand, or repository dispatch implementation.

Requirements splitter `019f18d6-f12d-7640-9c9e-be8943200c99` completed on
`2026-06-30 15:01 WEST`, found no blockers, and selected
`T-0010.1 Runtime Lifecycle And Async Queue Kernel` as the first non-blocked
subtask. The splitter recommended six T-0010 subtasks: runtime lifecycle/queue
kernel, bounded-context runtime handle, write-side signal intake result,
command registration readiness, event registration readiness, and runtime
closure/docs.

## JVM Research Used

Setup inspected Spine JVM notes and task-relevant `core-jvm/server` source:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `build-protocol/RUNTIME_ARCHITECTURE.md`;
- `build-protocol/DEVELOPER_API.md`;
- `Bus.java`, `CommandBus.java`, `EventBus.java`, and `BoundedContext.java`
  under `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server`.

The key implementation constraint is to model only the smallest useful async
runtime boundary and lifecycle seam. Full JVM bus filters, dispatch registries,
storage-before-dispatch, delivery monitors, system events, integration broker,
stand/query behavior, and transport supervision are future tasks unless the
splitter narrows one of them into an explicit first slice.

`T-0010.1 Runtime Lifecycle And Async Queue Kernel` was merged into the parent
branch as `556c23a Integrate T-0010.1 runtime lifecycle queue` after a clean
review-fix round. It introduced a minimal single-process server runtime
lifecycle/queue kernel, tests, README/API documentation, and updated API export
checks. All participating implementer, fixer, and reviewer sub-agents were
closed.

`T-0010.2 Bounded Context Runtime Handle` was merged into the parent branch as
`d8ce736 Integrate T-0010.2 bounded context runtime handle` after a clean
security re-review. It introduced a lightweight runtime handle for built
bounded-context snapshots without changing builder semantics. All participating
implementer, fixer, and reviewer sub-agents were closed.

`T-0010.3 Write-Side Signal Intake Result` was merged into the parent branch as
`575e1d3 Integrate T-0010.3 write-side signal intake result` after
documentation, API, and security review fixes plus a clean final security
re-review. It introduced typed accepted/immediate-failure intake result values,
stable failure codes, copy-safe diagnostics, package exports, tests, and
README/API documentation without adding buses, `Ack`, storage, dispatch,
services, validation, or transport behavior. All participating implementer,
fixer, and reviewer sub-agents were closed.

`T-0010.4 Command Registration Readiness` was merged into the parent branch as
`032257b Integrate T-0010.4 command registration readiness` after sorting and
nested copy-safety review fixes plus clean final re-review. It introduced
metadata-derived command registration readiness over existing handler metadata
without adding bus, service, dispatch, storage, validation, transport, or `Ack`
behavior. All participating implementer, fixer, and reviewer sub-agents were
closed.

User server-module guardrail: `BUILD_PROTOCOL.md` now explicitly requires
task-relevant inspection of Spine JVM `core-jvm/server` source before creating
or changing `@spine-ts/server` runtime/API code, and directs implementers to
prefer the smallest TS contract justified by the inspected JVM source and the
current task.

`T-0010.5 Event Registration Readiness` was merged into the parent branch as
`480d14c Integrate T-0010.5 event registration readiness` after shared
readiness helper, schema/descriptor copy-safety, custom lookup validation, and
field identity review fixes plus clean final re-review. It introduced
metadata-derived event registration readiness without adding event bus,
integration broker, import bus, storage, dispatch, service, transport, handler
invocation, validation, or `Ack` behavior. All participating implementer,
fixer, and reviewer sub-agents were closed.

Next selected subtask `T-0010.6 Runtime Closure And User-Facing Docs` is now
active in isolated branch `task/T-0010-6-runtime-closure-docs` from baseline
`94a28bf`. D-0053 records that the closure subtask must update docs and add a
small public-surface smoke test only. It must not add a TypeScript `Server`
facade, service routing, command/event/import buses, transport, storage,
read-side execution, repository runtime registration, validation, handler
invocation, delivery, integration broker behavior, or `Ack` mapping.

`T-0010.6` implementation added the bounded-context runtime assembly smoke test
and user/API/architecture documentation updates on `2026-06-30 19:24 WEST`.
The smoke uses existing public server APIs only and keeps the runtime closure
as metadata plus lifecycle plus readiness. No production code, public exports,
dependencies, lockfiles, API checker expectations, or to-do example files were
changed. Focused tests, typecheck, lint, format check, and docs/API checks
passed after one lint-only test style fix. Final full verification passed on
`2026-06-30 19:28 WEST` with 21 test files / 257 tests, coverage 96.45%
statements / 90.55% branches / 99.24% functions / 96.39% lines, TypeDoc/API
export counts 100 / 28 / 124 / 26, proto checksum verification, and generated
proto output clean.

`T-0010.6` completed the required review loop after documentation log-fix
rounds, with final documentation re-review clean. The child branch was merged
into the parent task branch as `64c8e4c Integrate T-0010.6 runtime closure
docs`; parent verification passed on `2026-06-30 19:58 WEST` with 21 test files
/ 257 tests, coverage 96.45% statements / 90.55% branches / 99.24% functions /
96.39% lines, TypeDoc/API counts 100 / 28 / 124 / 26, proto checksum
verification, and generated output clean.

Final whole-branch review fix activity started on `2026-06-30 20:09 WEST`.
The fix keeps the server code metadata-only by canonicalizing command
registration readiness through `HandlerMetadataRegistry`, matching event
readiness and preserving duplicate command assignment validation for arbitrary
registry lookup implementations. It also updates stale T-0010.6 child logs and
parent T-0010 logs with the recorded parent merge/verification evidence.
Post-fix re-review completed clean after the documentation current-state
wording fix in `8c60054`. Final full verification passed on
`2026-06-30 20:24 WEST`.

## Files Changed (Whole Branch Since 169af02)

Build protocol and review logs:

- `build-protocol/DECISION_LOG.md`
- `build-protocol/reviews/T-0010-1-runtime-lifecycle-queue.md`
- `build-protocol/reviews/T-0010-2-bounded-context-runtime-handle.md`
- `build-protocol/reviews/T-0010-3-write-side-signal-intake-result.md`
- `build-protocol/reviews/T-0010-4-command-registration-readiness.md`
- `build-protocol/reviews/T-0010-5-event-registration-readiness.md`
- `build-protocol/reviews/T-0010-6-runtime-closure-docs.md`
- `build-protocol/reviews/T-0010-single-process-async-runtime.md`
- `build-protocol/work-logs/T-0010-1.md`
- `build-protocol/work-logs/T-0010-2.md`
- `build-protocol/work-logs/T-0010-3.md`
- `build-protocol/work-logs/T-0010-4.md`
- `build-protocol/work-logs/T-0010-5.md`
- `build-protocol/work-logs/T-0010-6.md`
- `build-protocol/work-logs/T-0010.md`

Task reports:

- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/TASK.md`
- `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/TASK.md`
- `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-3-write-side-signal-intake-result/TASK.md`
- `build-protocol/tasks/T-0010-3-write-side-signal-intake-result/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-4-command-registration-readiness/TASK.md`
- `build-protocol/tasks/T-0010-4-command-registration-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/TASK.md`
- `build-protocol/tasks/T-0010-5-event-registration-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-6-runtime-closure-docs/TASK.md`
- `build-protocol/tasks/T-0010-6-runtime-closure-docs/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0010-single-process-async-runtime/TASK.md`
- `build-protocol/tasks/T-0010-single-process-async-runtime/IMPLEMENTATION_REPORT.md`

User-facing documentation and API checks:

- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `scripts/check-api-docs.mjs`

Server runtime, readiness, and package-root code/tests:

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/command-registration-readiness.ts`
- `packages/server/src/command-registration-readiness.test.ts`
- `packages/server/src/event-registration-readiness.ts`
- `packages/server/src/event-registration-readiness.test.ts`
- `packages/server/src/index.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/registration-readiness-metadata.ts`
- `packages/server/src/runtime.test.ts`
- `packages/server/src/runtime.ts`
- `packages/server/src/signal-intake.ts`
- `packages/server/src/signal-intake.test.ts`

## Verification

- Setup baseline verification passed on `2026-06-30 15:00 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Parent integration verification after merge commit `556c23a` passed on
  `2026-06-30 15:50 WEST`: `CI=true corepack pnpm verify` passed with 18 test
  files / 219 tests, coverage 96.33% statements / 90.87% branches / 99.12%
  functions / 96.26% lines, TypeDoc/API checks with 100 proto / 28 core / 104
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `d8ce736` passed on
  `2026-06-30 16:28 WEST`: `CI=true corepack pnpm verify` passed with 18 test
  files / 224 tests, coverage 96.22% statements / 90.3% branches / 99.15%
  functions / 96.15% lines, TypeDoc/API checks with 100 proto / 28 core / 106
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `575e1d3` passed on
  `2026-06-30 17:20 WEST`: `CI=true corepack pnpm verify` passed with 19 test
  files / 234 tests, coverage 96.21% statements / 90.38% branches / 99.16%
  functions / 96.14% lines, TypeDoc/API checks with 100 proto / 28 core / 116
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `032257b` passed on
  `2026-06-30 18:08 WEST`: `CI=true corepack pnpm verify` passed with 20 test
  files / 242 tests, coverage 95.94% statements / 90.38% branches / 98.15%
  functions / 95.87% lines, TypeDoc/API checks with 100 proto / 28 core / 119
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `480d14c` passed on
  `2026-06-30 19:04 WEST`: `CI=true corepack pnpm verify` passed with 21 test
  files / 256 tests, coverage 96.45% statements / 90.55% branches / 99.24%
  functions / 96.39% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `64c8e4c` passed on
  `2026-06-30 19:58 WEST`: `CI=true corepack pnpm verify` passed with 21 test
  files / 257 tests, coverage 96.45% statements / 90.55% branches / 99.24%
  functions / 96.39% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean. Parent log commit `8dfbafb`
  records this post-merge verification evidence.
- Final-review focused verification passed on `2026-06-30 20:13 WEST`:
  `corepack pnpm vitest run packages/server/src/command-registration-readiness.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 21 tests.
- Final-review full verification first reached `format:check` on
  `2026-06-30 20:13 WEST` and failed because Prettier needed to rewrite
  `build-protocol/work-logs/T-0010-6.md` and `build-protocol/work-logs/T-0010.md`.
  `corepack pnpm prettier --write build-protocol/work-logs/T-0010-6.md build-protocol/work-logs/T-0010.md`
  passed.
- Final-review full verification passed on `2026-06-30 20:14 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Final closure verification first reached `format:check` on
  `2026-06-30 20:24 WEST` and failed because Prettier needed to rewrite
  `build-protocol/work-logs/T-0010.md`; `corepack pnpm prettier --write build-protocol/work-logs/T-0010.md`
  passed.
- Final closure verification passed on `2026-06-30 20:24 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, generated proto
  output clean, and generated files clean.

## Subtask Progress

- `T-0010.1 Runtime Lifecycle And Async Queue Kernel` branch/worktree created
  on `2026-06-30 15:08 WEST` from parent commit `70692a9`; setup logs were
  created before implementation handoff. Setup baseline verification passed on
  `2026-06-30 15:11 WEST` with 17 test files / 212 tests, coverage 96.39%
  statements / 90.8% branches / 99.09% functions / 96.32% lines, TypeDoc/API,
  proto, and generated-output gates clean.
- `T-0010.1` implementation and review closure completed on
  `2026-06-30 15:45 WEST`; the child branch was merged into the parent task
  branch on `2026-06-30 15:50 WEST` and verified cleanly.
- `T-0010.2 Bounded Context Runtime Handle` is the next selected non-blocked
  subtask.
- `T-0010.2` branch/worktree was created on `2026-06-30 15:52 WEST` from
  parent commit `d570bba`; setup logs were created before implementation
  handoff. Setup baseline verification passed on `2026-06-30 15:56 WEST` with
  18 test files / 219 tests, coverage 96.33% statements / 90.87% branches /
  99.12% functions / 96.26% lines, TypeDoc/API, proto, and generated-output
  gates clean.
- `T-0010.2` implementation, security review fix, clean security re-review,
  and review closure completed on `2026-06-30 16:23 WEST`; the child branch was
  merged into the parent task branch as `d8ce736 Integrate T-0010.2 bounded
context runtime handle` and verified cleanly.
- `T-0010.3 Write-Side Signal Intake Result` is the next selected non-blocked
  subtask.
- `T-0010.3` branch/worktree was created on `2026-06-30 16:31 WEST` from
  parent commit `4d58ba8`; setup logs were created before implementation
  handoff. Setup baseline verification passed on `2026-06-30 16:35 WEST` with
  18 test files / 224 tests, coverage 96.22% statements / 90.3% branches /
  99.15% functions / 96.15% lines, TypeDoc/API, proto, and generated-output
  gates clean.
- `T-0010.3` implementation, review fixes, clean final security re-review, and
  review closure completed on `2026-06-30 17:09 WEST`; the child branch was
  merged into the parent task branch as `575e1d3 Integrate T-0010.3 write-side
signal intake result` and verified cleanly.
- `T-0010.4 Command Registration Readiness` is the next selected non-blocked
  subtask.
- `T-0010.4` branch/worktree was created on `2026-06-30 17:24 WEST` from
  parent commit `e5e7b1d`; setup logs were created before implementation
  handoff. Setup baseline verification passed on `2026-06-30 17:27 WEST` with
  19 test files / 234 tests and clean TypeDoc/API, proto, and generated-output
  gates.
- `T-0010.4` implementation, review fix, clean final re-review, and review
  closure completed on `2026-06-30 18:03 WEST`; the child branch was merged
  into the parent task branch as `032257b Integrate T-0010.4 command
registration readiness` and verified cleanly.
- `T-0010.5 Event Registration Readiness` is the next selected non-blocked
  subtask.
- `T-0010.5` branch/worktree was created on `2026-06-30 18:12 WEST` from
  parent commit `20aaad1`; setup logs were created before implementation
  handoff. Setup baseline verification passed on `2026-06-30 18:16 WEST` with
  20 test files / 242 tests and clean TypeDoc/API, proto, and generated-output
  gates.
- `T-0010.5` implementation, review fixes, clean final re-review, and review
  closure completed on `2026-06-30 19:03 WEST`; the child branch was merged
  into the parent task branch as `480d14c Integrate T-0010.5 event
registration readiness` and verified cleanly.
- `T-0010.6 Runtime Closure And User-Facing Docs` is integrated into the parent
  branch at merge commit `64c8e4c` and verified.
- Final whole-branch review fix canonicalized command readiness duplicate
  validation, updated stale child/parent logs, and passed focused/full
  verification on `2026-06-30 20:14 WEST`.
- Final whole-branch re-review is clean and final closure verification passed
  on `2026-06-30 20:24 WEST`.
