# Implementation Report: T-0012.5 CommandBus, EventBus, And Handler Registration

Status: implemented
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`

## Summary

Implemented the first executable bus layer after storage:

- `CommandBus` with async posting, unicast dispatch by enclosed message type
  URL, and duplicate dispatcher rejection for one command message type;
- `EventBus` with async posting, append-before-dispatch through injected
  `EventStore`, multicast dispatch to every matching dispatcher, and
  deterministic registration order; and
- small `CommandDispatcher` / `EventDispatcher` contracts over generated Spine
  envelopes plus public exports, tests, and documentation updates.

The implementation remains intentionally small. It does not add bounded-context
runtime wiring, repositories, delivery/inbox behavior, stand/query/subscription
execution, gRPC, transport execution, or direct entity method invocation from
the buses.

## JVM Alignment

Spine JVM establishes:

- `CommandBus` as a unicast bus with duplicate dispatcher rejection;
- `EventBus` as a multicast bus that appends events to `EventStore` before
  dispatch;
- `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` as the familiar
  handler vocabulary.

This task should keep that conceptual shape without implementing later
bounded-context, repository, delivery, stand, or service layers.

## Verification

Fresh implementation verification:

- `pnpm test packages/server/test` passed with 16 test files and 217 tests.
- `pnpm test packages/storage/test` passed with 5 test files and 18 tests.
- `pnpm typecheck:build` passed.
- Escalated `env CI=true corepack pnpm verify` passed after rerunning outside
  the sandbox because the existing ZeroMQ local IPC smoke tests require local
  IPC permissions the sandbox blocks.
- Final `verify` evidence: 35 test files and 301 tests passed; coverage
  statements 95.51%, branches 90.10%, functions 97.97%, lines 95.49%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning
  only.

## Changed Files

- `packages/server/src/bus/command-bus.ts`
- `packages/server/src/bus/command-dispatcher.ts`
- `packages/server/src/bus/command-dispatcher-registry.ts`
- `packages/server/src/bus/event-bus.ts`
- `packages/server/src/bus/event-dispatcher.ts`
- `packages/server/src/bus/event-dispatcher-registry.ts`
- `packages/server/src/index.ts`
- `packages/server/package.json`
- `packages/server/tsconfig.json`
- `packages/server/test/bus/command-bus.test.ts`
- `packages/server/test/bus/event-bus.test.ts`
- `packages/server/test/bus/index.test.ts`
- `packages/server/test/index.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `docs/USER_GUIDE.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
