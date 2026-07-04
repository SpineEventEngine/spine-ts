# Implementation Report: T-0012.10 Real gRPC Services

Status: review round 3 fixes verified
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
  subscription IDs, stream `Stand` entity updates only after activation, and
  release resources on cancel/stream close.

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

## Review Round 1 Fixes

- Added regression tests for activation-only subscription delivery, no replay of
  pre-activation updates, stream finalization cleanup, command tenant
  mismatches, query tenant errors, query version preservation, contractual
  unsupported-subscription rejection, sanitized dispatcher failures, and command
  routing without posting to wrong contexts.
- RED evidence: `pnpm test packages/server/test/services/spine-services.test.ts`
  failed against the round-1-reviewed implementation with 9 expected behavioral
  failures covering version loss, unsanitized command errors, tenant dispatch,
  context probing, query tenant transport errors, pre-activation delivery,
  stream cleanup, and unsupported subscription success.
- GREEN evidence: after the service, Stand, command endpoint, scoped TypeScript
  config, and docs/log changes, `pnpm typecheck` passed and focused service
  tests passed with 18 tests.
- Connect's public types require `HeadersInit`, so `DOM` was removed from
  `tsconfig.base.json` and scoped to `packages/server/tsconfig.json`.

## Review Round 2 Fixes

- Added regression tests for abandoned inactive subscription cleanup,
  slow-consumer queue overflow handling, and known-target malformed subscription
  topics missing required `Topic`/`Target` fields.
- RED evidence: the focused service suite failed against the round-2-reviewed
  implementation with expected failures for inactive subscription expiry,
  slow-consumer closure, and malformed known-target topic acceptance.
- GREEN evidence: `SpineServices` now applies a configurable inactive
  subscription TTL (`inactiveTtlMs`, default 30 seconds), a configurable active
  delivery queue cap (`queueLimit`, default 100), and required topic field
  validation. Focused service tests passed with local loopback escalation: 1
  file, 21 tests passed.
- Documentation was refreshed in the user guide, API guide, architecture
  overview, proto README, work log, and review log.

## Review Round 3 Fixes

- Added TDD regression tests for command, query, and subscription tenant checks
  using `TenantId.domain` and `TenantId.email` variants.
- RED evidence: focused service tests failed against the round-3-reviewed
  implementation with 3 expected failures showing domain/email tenants were
  treated as absent or accepted by single-tenant services.
- GREEN evidence: `SpineServices` now treats `TenantId.value`,
  `TenantId.domain`, and `TenantId.email` as tenant presence. `value` keeps its
  raw storage key; `domain` and `email` derive stable `domain:<value>` and
  `email:<value>` keys for Stand options. Focused service tests passed with
  local loopback escalation: 1 file, 24 tests passed.
- `TASK.md` now reflects the round-3 state, and the proto README clarifies that
  service-support protos such as `Ack`, `Response`, and `spine/client` services
  are available through generated subpaths rather than broad package-root
  re-exports.

## Verification

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm test packages/server/test/services/spine-services.test.ts` passed with
  local loopback escalation: 24 tests passed.
- Full `pnpm test`/`pnpm test:coverage` were not rerun for round 3 because this
  follow-up only changed the service tenant-key helper plus focused service
  regressions and documentation; the focused real-service suite covers the
  touched command/query/subscription behavior, and round 2 had the full
  44-file/524-test coverage pass.
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
  `Subscribe` only allocates an opaque ID; `Activate` attaches delivery. Event
  subscriptions, projection catch-up, and durable subscription recovery remain
  future work.
- Real gRPC tests require local HTTP/2 loopback binding; sandboxed test runs
  fail with `listen EPERM` until escalated.
