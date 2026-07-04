# Implementation Report: T-0012.10 Real gRPC Services

Status: implemented
Branch: `task/T-0012-10-real-grpc-services`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-10-real-grpc-services`
Baseline commit: `caec16a`

## Summary

Implemented the first real public gRPC-compatible service slice for the Spine TS
server package:

- `CommandService.Post` posts through built bounded contexts' `CommandBus`
  instances and returns Spine `Ack` values.
- `QueryService.Read` reads entity state through the context-owned direct
  `Stand` and returns Spine `QueryResponse` values.
- `SubscriptionService.Subscribe`, `Activate`, and `Cancel` create opaque
  subscription IDs, stream `Stand` entity updates, and release resources on
  cancel/stream close.

The public construction API is intentionally small: `SpineServices` accepts
built contexts and registers generated service descriptors with a Connect
router. No broad server facade, client DSL, example app, custom protocol, or
transport API was added to domain/runtime classes.

## Contract And Tooling

- Copied the required Spine JVM service/support protobuf contracts verbatim
  into `proto/spine/...` and recorded their upstream provenance/checksums in
  `proto/spine-sources.json`.
- Preserved upstream service names and message definitions. Buf lint exceptions
  were added only for upstream JVM service naming patterns that conflict with
  this repository's default lint rules.
- Added `@connectrpc/connect@2.1.2` and
  `@connectrpc/connect-node@2.1.2` for real Node gRPC-compatible routing over
  Protobuf-ES v2 descriptors.
- Recorded the runtime decision and rejected alternatives in
  `build-protocol/DECISION_LOG.md` as `D-0056`.

## TDD Evidence

- RED:
  - Added focused real-service tests in
    `packages/server/test/services/spine-services.test.ts`.
  - `pnpm typecheck:build` passed.
  - `pnpm test packages/server/test/services/spine-services.test.ts` failed as
    expected with `TypeError: SpineServices is not a constructor`.
- GREEN:
  - Implemented `packages/server/src/services/spine-services.ts` and exported
    `SpineServices`.
  - Focused service tests pass over a real HTTP/2 gRPC transport when local
    loopback binding is allowed: 1 file, 10 tests passed.

## Verification

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm test packages/server/test/services/spine-services.test.ts` passed with
  local loopback escalation: 10 tests passed.
- `pnpm test` passed with local loopback escalation: 44 files, 513 tests passed.
- `pnpm test:coverage` passed with local loopback escalation: 44 files, 513
  tests passed; global branch coverage `90.31%`.
- `pnpm docs:check` passed, with the existing TypeDoc invalid-origin warning.
- `pnpm proto:lint` passed.
- `pnpm proto:generate` passed.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.

## Notes And Constraints

- Local JVM source lookup under `/private/tmp/spine-research/core-jvm` found
  placeholder directories only, so exact proto contracts were fetched from
  upstream Spine JVM sources and checksummed instead of rewritten.
- `QueryService.Read` intentionally supports the small ID-filtered state-read
  path backed by `Stand`. Broader query criteria, field masks, ordering, and
  catch-up behavior remain future work.
- `SubscriptionService` streams direct entity-state updates from `Stand`.
  Event subscriptions, projection catch-up, and durable subscription recovery
  remain future work.
- Real gRPC tests require local HTTP/2 loopback binding; sandboxed test runs
  fail with `listen EPERM` until escalated.
