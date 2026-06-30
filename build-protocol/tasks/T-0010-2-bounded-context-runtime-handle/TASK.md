# T-0010.2: Bounded Context Runtime Handle

Status: Setup Baseline Verified; Implementation Handoff Pending
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 15:52 WEST`
Baseline commit: `d570bba`
Task log path: `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/TASK.md`
Branch: `task/T-0010-2-bounded-context-runtime-handle`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-2-bounded-context-runtime-handle`
Authoring sub-agent: pending implementation handoff.
Reviewer sub-agents: pending implementation.

## Objective

Introduce the smallest runtime-facing handle for an already built
`BoundedContext` snapshot. The handle should bind a built context's immutable
metadata to the single-process runtime lifecycle/queue created by `T-0010.1`,
so later command/event intake tasks can reference a context-scoped runtime
boundary without adding buses, services, storage, delivery, stand, tenant index,
system context, or transport behavior.

## Required JVM Shape

The setup inspection looked closely at the corresponding Spine JVM
`core-jvm/server` classes before selecting scope:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/Server.java`;
- existing TS `packages/server/src/bounded-context.ts`;
- existing TS `packages/server/src/runtime.ts`;
- existing TS `packages/server/src/bounded-context.test.ts`;
- existing TS `packages/server/README.md` and `docs/api/README.md`.

Observed JVM shape:

- JVM `BoundedContextBuilder.build()` creates a system context and a domain
  context, initializes tenant index, command bus, and stand, then registers
  repositories, command dispatchers, event dispatchers, and delivery
  dispatchers.
- JVM `BoundedContext` owns command/event/import buses, integration broker,
  stand, tenant index, visibility guard, internal access, and close hooks.
- JVM `Server.Builder` takes bounded-context builders, builds contexts, and
  wires them into command/query/subscription gRPC services.

T-0010.2 must not recreate that graph. The TS implementation should keep the
current metadata-only `BoundedContext` build contract intact and add only a
context-scoped runtime handle that exposes copied context metadata plus
explicit `start()`/`close()` lifecycle delegation. Repository registration,
dispatcher readiness, command/event intake, service hosting, transport,
delivery, read-side stand behavior, system contexts, tenant-index materializing,
and repository runtime registration remain future subtasks.

## Acceptance Criteria

- Add an OOP-style public server API for a bounded-context runtime handle,
  scoped to a built `BoundedContext`.
- The handle exposes immutable copy-safe context metadata and registered
  repository identity snapshots without leaking mutable internals.
- The handle owns or accepts a `ServerRuntimeLifecycle`/queue boundary and
  delegates deterministic `start()` and `close()` lifecycle behavior.
- The handle must not execute handlers, register repositories at runtime,
  create command/event/import buses, construct a stand, open storage, expose
  gRPC/ZeroMQ, or implement dispatch.
- `BoundedContext` builder/build semantics remain backward compatible.
- Unit tests prove lifecycle delegation, context snapshot copying, repository
  snapshot copying, and out-of-scope runtime members remain absent.
- README and TypeDoc/API docs describe the handle and its exclusions.
- All five required review lanes complete cleanly, and all participating
  sub-agents are closed.

## Out Of Scope

- `CommandBus`, `EventBus`, `ImportBus`, `Stand`, `Server`, `CommandService`,
  query/subscription services, `Ack`, delivery inbox, event store, tenant index,
  system context, integration broker, ZeroMQ, worker processes, repository
  dispatch, and handler invocation.

## Tooling And Dependencies

No new dependencies are selected for this subtask. Use existing TypeScript,
Vitest, TypeDoc, and the server package tests. ZeroMQ and transport tooling
remain deferred.

## Verification

- Setup baseline verification passed on `2026-06-30 15:56 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 219 tests,
  coverage 96.33% statements / 90.87% branches / 99.12% functions / 96.26%
  lines, TypeDoc/API checks with 100 proto / 28 core / 104 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Human Questions And Answers

- None.
