# T-0012.5: CommandBus, EventBus, And Handler Registration

Status: Complete; verified and ready for parent integration
Start: `2026-07-01 21:52 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`

## Goal

Add the first write-side buses after storage:

- `CommandBus` with unicast command dispatcher registration;
- `EventBus` with multicast event dispatcher registration;
- event store-before-dispatch through `@spine-ts/storage` `EventStore`;
- small handler registration adapters over existing handler metadata and
  decorators.

## Must Preserve

- Follow the corrected implementation order from `D-0047`.
- Keep strict read-side/write-side segregation.
- Process signals asynchronously.
- Do not add bounded-context assembly, repositories, delivery, inbox, stand,
  gRPC services, scheduler, import bus, system audit, or ZeroMQ behavior.
- Keep names short and JVM-familiar. No name may exceed four semantic
  components.
- Prefer OOP-style TypeScript APIs with generics.
- Do not export standalone helper functions unless there is a strong recorded
  reason.
- Preserve generated Protobuf contracts and use generated message APIs.
- Tests remain outside `src` and mirror source semantic folders.

## JVM Evidence

The task must inspect and follow:

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandDispatcherRegistry.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/command/CommandDispatcher.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/command/Assign.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcher.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcherRegistry.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/React.java`;
- copied/generated Spine core `Command` and `Event` contracts.

## Required Changes

- Add semantic bus source folders under `packages/server/src`.
- Add mirrored tests under `packages/server/test`.
- Update `packages/server/README.md`, `docs/USER_GUIDE.md`,
  `docs/architecture/README.md`, `docs/api/README.md`,
  `build-protocol/RUNTIME_ARCHITECTURE.md`, and
  `build-protocol/DEVELOPER_API.md` as needed for public API changes.
- Update API-doc expectations in `scripts/check-api-docs.mjs` if exports
  change.
- Update this task log, implementation report, work log, and review log.

## Acceptance

- A command message has at most one effective dispatcher.
- Duplicate command dispatcher registration for the same command type is
  rejected.
- Events are appended to `EventStore` before any event dispatch happens.
- Event dispatch is multicast and deterministic.
- Buses expose small async APIs and do not instantiate repositories or invoke
  entity methods directly.
- Handler decorators/metadata remain small and JVM-named.
- No delivery, stand, gRPC, repository, bounded-context runtime, or transport
  behavior is introduced.

## Baseline Verification

Fresh baseline in this worktree:

- Command: `env CI=true corepack pnpm verify`.
- Result: passed.
- Evidence: 32 test files, 294 tests, coverage statements 95.64%, branches
  90.44%, functions 98.31%, lines 95.64%.
- Existing warning only: TypeDoc cannot build source links because the local
  `origin` remote is not valid.

## Process

- One implementation sub-agent owns the code change.
- Required reviewer lanes after implementation:
  - code style/maintainability;
  - documentation;
  - TypeScript/API docs;
  - security;
  - performance/reliability.
- Reviewer comments feed back to the authoring sub-agent until all lanes are
  clean.
- All participating sub-agents are closed after their role is complete.

## Review Round 1 Fix Log

- `2026-07-01 22:30 WEST`: T-0012.5 review-fix worker accepted round 1
  findings. Public bus intake is now `post()` only, dispatcher contracts use
  `MessageSchema`, no-dispatch event posts store and resolve, append failure
  skips dispatchers, event failure semantics are documented, stale current docs
  are corrected, and task/review/work logs were updated.
- `2026-07-01 22:35 WEST`: Focused bus tests, typecheck, docs/API checks,
  lint, and escalated full `pnpm verify` passed. The first non-escalated full
  verify stopped only on the known sandboxed ZeroMQ IPC permission failure.

## Final Review And Verification

- `2026-07-01 22:47 WEST`: Required review lanes were clean after the final
  focused documentation re-review. All participating sub-agents with known IDs
  were closed.
- `2026-07-01 22:49 WEST`: Final sandboxed
  `env CI=true corepack pnpm verify` reached 34 passed files and 300 passed
  tests, then stopped only on the known ZeroMQ local IPC sandbox permission
  failure.
- `2026-07-01 22:50 WEST`: Escalated
  `env CI=true corepack pnpm verify` passed with 35 test files and 302 tests.
  Coverage: statements 95.61%, branches 90.08%, functions 98.37%, lines
  95.60%. Docs/API/proto checks passed with the existing invalid-`origin`
  TypeDoc warning only.
