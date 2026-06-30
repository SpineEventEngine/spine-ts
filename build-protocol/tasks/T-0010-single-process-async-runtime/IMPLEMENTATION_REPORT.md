# Implementation Report: T-0010 Single-Process Async Runtime

Status: Setup Complete; Requirements Splitting Pending
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

The requirements splitter is pending and must produce the staged T-0010
roadmap before implementation begins.

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

## Files Changed

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0010-single-process-async-runtime/TASK.md`
- `build-protocol/tasks/T-0010-single-process-async-runtime/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0010.md`
- `build-protocol/reviews/T-0010-single-process-async-runtime.md`

## Verification

- Setup baseline verification passed on `2026-06-30 15:00 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
