# T-0016g Implementation Report

Status: implemented and verified

Baseline: `60a2a4c`

## Summary

Implemented the small public `Server` lifecycle API for local real
Connect/gRPC-compatible services. The API exposes `Server`, `ServerOptions`,
and `RunningServer`, reuses `SpineServices` directly, defaults to local-only
`127.0.0.1`, and returns `host`, `port`, `baseUrl`, and idempotent `close()`.

Shutdown order is:

1. Stop HTTP/2 listener intake.
2. Close active HTTP/2 sessions.
3. Close owned contexts and explicit framework-owned resources.

Owned cleanup attempts every close hook and reports failures through one
`AggregateError`.

Focused lifecycle fix completed after implementation review:

- `BoundedContext` now exposes an idempotent `close()` method.
- `CommandBus.close()` closes its single-process runtime.
- `EventBus.close()` closes its runtime and event store, attempting both.
- `Stand.close()` rejects later direct Stand use and clears direct
  subscriptions.
- `BoundedContext.close()` closes command bus, event bus, stand, repository
  runtime bindings, and repository storage handles in deterministic order,
  attempting all owned closes and reporting aggregate failures.
- `Server.close()` now closes real built `BoundedContext` instances rather than
  only duck-typed close hooks.

## Code Changes

- Added `packages/server/src/server/server.ts`.
- Exported `Server`, `ServerOptions`, and `RunningServer` from
  `packages/server/src/index.ts`.
- Added minimal close hooks to `BoundedContext`, `CommandBus`, `EventBus`, and
  `Stand`.
- Added focused lifecycle tests under `packages/server/test/server`.
- Added focused bounded-context close tests in
  `packages/server/test/context/bounded-context.test.ts`.
- Migrated `packages/server/test/services/spine-services.test.ts` from its
  duplicated HTTP/2 start/close helper to the public `Server` API.
- Migrated `examples/todo/src/index.ts` from ad-hoc HTTP/2 lifecycle code to
  `Server.atPort(port, { host }).add(context).start()`.

## Documentation Changes

- Updated `packages/server/README.md`, `docs/api/README.md`,
  `docs/USER_GUIDE.md`, and `docs/architecture/README.md`.
- Updated `build-protocol/RUNTIME_ARCHITECTURE.md` and
  `build-protocol/DEVELOPER_API.md`.
- Recorded implementation progress in `build-protocol/work-logs/T-0016g.md`.

The docs now describe local binding defaults, explicit broad binding, shutdown
order, aggregate close failures, and native listener verification when managed
sandboxes reject loopback binds with `EPERM`.

## TDD Notes

RED captured before production code:

- `pnpm --config.verify-deps-before-run=false vitest run
  packages/server/test/server/server.test.ts`
- Result: all five new lifecycle tests failed because `Server` was missing from
  the public package export surface.

GREEN captured after implementation:

- Managed sandbox rerun failed with expected local listener `EPERM`.
- Native rerun exposed one close-order behavior gap, which was fixed by waiting
  for active sessions and yielding once after network shutdown.
- Native focused lifecycle test then passed: 5 tests.

## Verification So Far

- `pnpm --config.verify-deps-before-run=false typecheck:build`: passed.
- Native `pnpm --config.verify-deps-before-run=false vitest run
  packages/server/test/server packages/server/test/services/spine-services.test.ts
  examples/todo/src/index.test.ts`: passed, 3 files and 74 tests.

Full required verification completed successfully.

## Final Verification

- Native `pnpm --config.verify-deps-before-run=false vitest run
  packages/server/test/context/bounded-context.test.ts
  packages/server/test/server/server.test.ts
  packages/server/test/services/spine-services.test.ts
  examples/todo/src/index.test.ts`: passed, 4 files and 105 tests.
- `pnpm --config.verify-deps-before-run=false typecheck`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed. TypeDoc
  still reports the pre-existing invalid `origin` source-link warning.
- `git diff --check`: passed.

## Scope Notes

- No `ServerEnvironment`, process supervisor, worker manager, durable scheduler,
  or ZeroMQ-specific public API was introduced.
- `BoundedContext.close()` closes context-opened event-store and repository
  storage handles but does not close a caller-supplied `StorageFactory`; factory
  ownership remains explicit.
- `scripts/check-api-docs.mjs` was updated even though it was not listed in the
  initial write scope because `docs:check` treats that script as the API export
  expectation gate. Without adding `Server`, `ServerOptions`, and
  `RunningServer` there, the required docs verification rejects the documented
  public exports.
