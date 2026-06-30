# T-0010.1: Runtime Lifecycle And Async Queue Kernel

Status: Implementation Complete; Author Verification Passed
Start: `2026-06-30 15:08 WEST`
Baseline commit: `70692a9`
Parent task: `T-0010 Single-Process Async Runtime`
Task log path: `build-protocol/tasks/T-0010-1-runtime-lifecycle-queue/TASK.md`
Branch: `task/T-0010-1-runtime-lifecycle-queue`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-1-runtime-lifecycle-queue`
Authoring sub-agent: Codex implementation sub-agent.
Reviewer sub-agents: pending implementation.

## Objective

Add the smallest server-owned single-process async lifecycle and queue kernel
for future runtime tasks. The subtask must provide an explicit lifecycle
contract with deterministic state transitions and a queue boundary that proves
queued work runs after intake returns.

This is not a command bus, event bus, repository dispatcher, storage layer,
delivery engine, server supervisor, gRPC service, ZeroMQ transport, read-side
stand, system context, tenant index, or generic job framework.

## Acceptance Criteria

- A server runtime lifecycle contract exists with `start()` and `close()`.
- Lifecycle state transitions are deterministic and documented.
- Closing is idempotent and prevents new queued work.
- Queued work is not executed synchronously during intake; tests observe that
  separation.
- No global singleton, import-time registration, process supervision, gRPC,
  ZeroMQ, durable storage, read-side stand, repository dispatch, or hidden
  process-wide state is introduced.
- TypeDoc/API docs and package README explain that this is a single-process
  async kernel only.
- Tests are written/updated before or alongside implementation and keep
  coverage above 90%.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. Parent setup inspected:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `build-protocol/RUNTIME_ARCHITECTURE.md`;
- `build-protocol/DEVELOPER_API.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/bus/Bus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`.

Implementation impact:

- Mirror only the JVM distinction between posting/intake and later processing,
  plus explicit close-oriented lifecycle.
- Defer JVM bus filters, storage-before-dispatch, dispatch registries,
  delivery monitors, system events, integration broker, tenant index, stand,
  and server supervision.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Applicable skills for the implementer:

- `test-driven-development` / `javascript-testing-patterns`: this is async
  runtime behavior and must have tests that prove scheduling and lifecycle
  semantics.
- `nodejs-backend-patterns`: lifecycle and queue behavior must be idiomatic for
  Node.js.
- `typescript-advanced-types`: public API types should be narrow and generic
  only where useful.
- `architecture-patterns`, `cqrs-implementation`, and `codebase-design`: keep
  write-side async runtime separate from read-side behavior and avoid broad
  speculative infrastructure.
- `verification-before-completion`: required before claiming completion.

Adjacent skills such as `event-store-design`, `projection-patterns`, and
`saga-orchestration` are intentionally out of scope for this subtask.

## Expected Files

Likely touched:

- `packages/server/src/runtime.ts`
- `packages/server/src/runtime.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- this task/report/work/review log set

## Verification

- Setup baseline verification passed on `2026-06-30 15:11 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Author verification passed on `2026-06-30 15:25 WEST`:
  `CI=true corepack pnpm verify` passed with 18 test files / 219 tests,
  coverage 96.33% statements / 90.87% branches / 99.12% functions / 96.26%
  lines, TypeDoc/API checks with 100 proto / 28 core / 103 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Implementation Result

- Added `SingleProcessServerRuntime` with explicit `start()` / `close()`
  lifecycle, deterministic `created | running | closing | closed` states, and
  idempotent close.
- Added `enqueue()` as a server-runtime-specific intake boundary that accepts
  work only while running, schedules accepted work after intake returns, runs
  work FIFO in the same process, returns per-item completion, and lets later
  accepted work continue after one item fails.
- Closing prevents new intake and waits for already accepted work to settle
  before the runtime reaches `closed`.
- Updated package root exports, API guard, TypeDoc-facing docs, and package
  README.
- Deferred boundaries remain unchanged: no global singleton, import-time
  registration, process supervision, gRPC, ZeroMQ, durable storage, read-side
  stand, repository dispatch, command/event/import buses, `Ack`, event store,
  tenant index, system context, integration broker, worker processes, or full
  repository dispatch.

## Human Questions And Answers

- None.
