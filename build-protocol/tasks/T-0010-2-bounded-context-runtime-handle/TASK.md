# T-0010.2: Bounded Context Runtime Handle

Status: Ready for Review
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 15:52 WEST`
Baseline commit: `d570bba`
Task log path: `build-protocol/tasks/T-0010-2-bounded-context-runtime-handle/TASK.md`
Branch: `task/T-0010-2-bounded-context-runtime-handle`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-2-bounded-context-runtime-handle`
Authoring sub-agent: Codex implementation sub-agent.
Reviewer sub-agents: security review finding fixed on `2026-06-30 16:17 WEST`.

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
- The constructor treats only an own `options.runtime` property as an injected
  lifecycle; inherited `runtime` properties are ignored so omitted runtime
  options always create a private `SingleProcessServerRuntime`.
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
- Review-fix regression verification on `2026-06-30 16:17 WEST`:
  `corepack pnpm vitest run packages/server/src/bounded-context.test.ts` first
  failed with 1 failed / 40 passed because an inherited lifecycle received
  `start` and `close`; after the constructor fix, the same command passed with
  1 test file / 41 tests.
- Review-fix full verification passed on `2026-06-30 16:20 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 224 tests in both
  normal and coverage runs, coverage 96.22% statements / 90.3% branches /
  99.15% functions / 96.15% lines, TypeDoc/API checks with 100 proto / 28 core
  / 106 server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean. TypeDoc emitted the existing
  non-blocking invalid-origin source-link warning.

## Implementation Evidence

- Added `BoundedContextRuntime` and `BoundedContextRuntimeOptions` in
  `packages/server/src/bounded-context.ts`.
- The handle accepts an already built `BoundedContext`, snapshots its metadata,
  creates and owns a private `SingleProcessServerRuntime` by default, or
  delegates to an injected `ServerRuntimeLifecycle`.
- The handle exposes `name`, `tenantMode`, `isMultitenant`, `spec`,
  `repositories`, `contextSnapshot`, `state`, `start()`, and `close()` only.
- Tests cover default lifecycle ownership, injected lifecycle delegation,
  inherited `options.runtime` rejection, context/repository snapshot copying,
  and absence of queue methods plus out-of-scope server graph members.
- Public exports, package README, API overview, and API export guard now include
  the handle and document that it is not a JVM `Server` equivalent and does not
  implement buses, services, storage, dispatch, stand, tenant index, system
  context, transport, delivery, or handler invocation.

## Human Questions And Answers

- None.
