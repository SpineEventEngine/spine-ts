# Implementation Report: T-0012.5 CommandBus, EventBus, And Handler Registration

Status: complete; verified and ready for parent integration
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

Review round 1 fixes remove public `dispatch()` from both buses so all public
intake goes through queued `post()`, switch dispatcher schema contracts to
`@spine-ts/core` `MessageSchema`, and make no-dispatch event posts store and
resolve. Event append failure now has regression coverage proving dispatchers
are not invoked.

Review round 2 docs cleanup removes stale wording that described command/event
buses or storage as deferred after this branch introduced them. Remaining
runtime deferrals are scoped to integrated service hosting, bounded-context
runtime wiring, handler invocation from runtime workers, transport/service
assembly, IPC endpoint naming, and process supervision.

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
- Review-fix focused checks passed:
  `pnpm test packages/server/test/bus packages/server/test/index.test.ts`,
  `pnpm typecheck:tooling`, and `pnpm typecheck:build`.
- Review-fix final verification passed:
  - `pnpm test packages/server/test/bus packages/server/test/index.test.ts`
    passed with 4 test files and 18 tests.
  - `pnpm typecheck` passed.
  - `pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
    warning only.
  - Sandbox `pnpm verify` reached 34 passed files plus 300 passed tests, then
    failed only on the known ZeroMQ local IPC permission error.
  - Escalated `pnpm verify` passed with 35 test files and 302 tests; coverage
    statements 95.61%, branches 90.08%, functions 98.37%, lines 95.60%.
- Escalated `env CI=true corepack pnpm verify` passed after rerunning outside
  the sandbox because the existing ZeroMQ local IPC smoke tests require local
  IPC permissions the sandbox blocks.
- Final `verify` evidence: 35 test files and 302 tests passed; coverage
  statements 95.61%, branches 90.08%, functions 98.37%, lines 95.60%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning
  only.
- Round 2 docs cleanup verification: `pnpm docs:check` passed with the existing
  invalid-`origin` TypeDoc warning only. TypeDoc JSON reported 100
  `@spine-ts/proto` exports, 28 `@spine-ts/core` exports, 126
  `@spine-ts/server` exports, 14 `@spine-ts/storage` exports, and 17
  `@spine-ts/transport` exports.
- Final T-0012.5 verification:
  - sandboxed `env CI=true corepack pnpm verify` reached 34 passed files and
    300 passed tests, then stopped only on the known ZeroMQ local IPC sandbox
    permission failure;
  - escalated `env CI=true corepack pnpm verify` passed with 35 test files and
    302 tests;
  - coverage remained statements 95.61%, branches 90.08%, functions 98.37%,
    lines 95.60%; and
  - docs/API/proto checks passed with the existing invalid-`origin` TypeDoc
    warning only.

## Reviewer Finding Disposition

- Stale deferred-bus/storage wording: fixed in user guide, package README, and
  API README by scoping deferred work to integrated runtime/service hosting,
  worker handler invocation, transport/service assembly, IPC endpoint naming,
  and process supervision.
- Contradictory final verification evidence: fixed by replacing the stale
  301-test coverage line with the review-fix final evidence: 35 files, 302
  tests, statements 95.61%, branches 90.08%, functions 98.37%, lines 95.60%.
- Round 2 documentation lanes were rerun until no findings remained.

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
