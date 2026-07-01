# Implementation Report: T-0011.6 Server Runtime Wiring Integration

Status: In Progress
Task log: `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/TASK.md`
Work log: `build-protocol/work-logs/T-0011-6.md`
Review log:
`build-protocol/reviews/T-0011-6-server-runtime-wiring-integration.md`
Branch: `task/T-0011-6-server-runtime-wiring-integration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-6-server-runtime-wiring-integration`

## Summary

T-0011.6 begins from parent commit `78346ab` after T-0011.5 integration. The
subtask owns the smallest server/runtime seam that connects existing
`@spine-ts/server` metadata to `@spine-ts/transport` routing contracts. It must
not implement service hosting, handler dispatch, durable delivery, storage, or
process supervision.

## JVM Source Guardrail

Before implementation, the orchestrator inspected task-relevant
`core-jvm/server` notes and source:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/Server.java`.

Conclusion: add only immutable routing-plan metadata for later bus/worker
wiring. Keep actual command/event bus behavior, service hosting, storage,
delivery, scheduling, and process supervision outside this slice.

## Verification

- T-0011.6 setup dependency install on `2026-07-01 03:10 WEST`: sandboxed
  `corepack pnpm install --frozen-lockfile` was interrupted after npm registry
  `ENOTFOUND` retries while populating the fresh worktree. Escalated
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused 197 packages, and ran the approved `zeromq@6.5.0` install script.
- T-0011.6 setup baseline verification passed on `2026-07-01 03:11 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 280 tests,
  coverage 96.16% statements / 90.48% branches / 99.33% functions / 96.10%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 46 transport exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command used
  native IPC access because inherited ZeroMQ smoke tests bind `ipc://`
  endpoints.

## Files Changed

- `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/TASK.md`
- `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0011-6.md`
- `build-protocol/reviews/T-0011-6-server-runtime-wiring-integration.md`

## Open Items

- Spawn the T-0011.6 implementation sub-agent.
- Run all required reviewer lanes and close all participating sub-agents.
