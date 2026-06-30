# T-0010.3: Write-Side Signal Intake Result

Status: Setup Baseline Verified; Implementation Handoff Pending
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 16:31 WEST`
Baseline commit: `4d58ba8`
Task log path:
`build-protocol/tasks/T-0010-3-write-side-signal-intake-result/TASK.md`
Branch: `task/T-0010-3-write-side-signal-intake-result`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-3-write-side-signal-intake-result`
Authoring sub-agent: pending implementation handoff.
Reviewer sub-agents: pending implementation.

## Objective

Introduce internal write-side signal intake result types that distinguish
signals accepted for later asynchronous work from immediate intake failure. The
result seam should be small enough for later command/event intake tasks to use
without depending on `Ack`, buses, dispatchers, storage, delivery, handlers, or
transport.

## Required JVM Shape

The setup inspection looked closely at task-relevant Spine JVM
`core-jvm/server` code before selecting scope:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/bus/Bus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- existing TS `packages/server/src/runtime.ts`;
- existing TS `packages/server/src/bounded-context.ts`;
- existing core envelope helpers in `packages/core/src/index.ts`.

Observed JVM shape:

- `Bus.post()` converts a signal to an envelope, notifies listeners, filters
  the envelope, stores accepted signals, acknowledges accepted signals with
  `Ack`, then dispatches.
- Filter failures are immediate post-time outcomes delivered as `Ack` statuses;
  `StreamObserver.onError()` is not used for normal post results.
- `CommandBus` wraps observers with command ack monitoring and keeps command
  acknowledgement distinct from later dispatch outcomes.
- `EventBus` appends events to an `EventStore` before dispatch and uses a
  no-op observer when callers do not care about event acknowledgement.

T-0010.3 must preserve this conceptual split without implementing the JVM bus
graph. The TS slice should add typed intake result values only: accepted means
the runtime accepted responsibility for later asynchronous processing; rejected
means intake failed immediately. Later tasks own `Ack`, filters,
store-before-dispatch, bus dispatch, command/event services, delivery, and
user-facing failure mapping.

## Acceptance Criteria

- Add a small public or internal-exported TypeScript API for write-side signal
  intake results.
- Represent accepted-for-async-work separately from immediate intake failure.
- Include enough structured metadata for later command/event intake to identify
  signal kind and failure reason without leaking message payloads.
- Keep result objects immutable and copy-safe where they carry diagnostics.
- Do not introduce `Ack`, `CommandBus`, `EventBus`, `ImportBus`, storage,
  filters, dispatch, handlers, tenant validation, services, or transport.
- Unit tests cover accepted result creation, immediate failure creation,
  immutability/copy safety, stable failure codes, and absence of async work or
  dispatch behavior.
- README and TypeDoc/API docs describe the seam and its exclusions.
- All five required review lanes complete cleanly, and all participating
  sub-agents are closed.

## Out Of Scope

- `Ack`, gRPC command service semantics, command/event/import buses, bus
  filters, store-before-dispatch, command/event dispatch, delivery inbox,
  tenant validation, message validation, handler invocation, event store,
  system context, integration broker, ZeroMQ, worker processes, and repository
  runtime registration.

## Tooling And Dependencies

No new dependencies are selected for this subtask. Use existing TypeScript,
Vitest, TypeDoc, and the current server package tests.

## Verification

- Setup baseline verification passed on `2026-06-30 16:35 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 224 tests,
  coverage 96.22% statements / 90.3% branches / 99.15% functions / 96.15%
  lines, TypeDoc/API checks with 100 proto / 28 core / 106 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Human Questions And Answers

- None.
