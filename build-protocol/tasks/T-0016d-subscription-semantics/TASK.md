# T-0016d: Subscription Semantics Closure

Status: in progress
Start: `2026-07-08T11:12:49Z`
Baseline commit: `a7c3a5c`
Branch: `task/T-0016d-subscription-semantics`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016d-subscription-semantics`

## Objective

Close the first public `SubscriptionService` semantics slice without expanding
the server module into a broad subscription engine. Define and test known and
unknown target behavior, activation and cancellation lifecycle, subscription
identity, queue limits, and in-memory durability boundaries.

## Requirements

- Keep `SubscriptionService` a small route adapter over built bounded contexts.
- Keep `Stand` as the direct read-side update source; do not introduce a
  separate durable subscription store in this task.
- Reject invalid topics before creating a subscription.
- Create subscriptions as inactive records first; activation attaches delivery
  to `Stand`.
- Unknown subscription activation must complete without updates. Cancellation
  of an unknown or missing-ID subscription must return OK and have no effect.
- Active subscription cleanup must be explicit and idempotent when an activation
  iterator closes, cancellation is requested, a slow-consumer queue closes, or
  a never-activated subscription expires.
- Queue limits must remain bounded and documented.
- In-memory durability boundaries must be explicit in package docs, user guide,
  API docs, and architecture docs.
- Use real gRPC service tests and direct handler tests where each gives better
  signal.
- Keep code names short and JVM-familiar. Do not add speculative delivery
  abstractions, storage-specific subscription repositories, or long error-detail
  hierarchies.

## Spine JVM Inspection

Current upstream files inspected before implementation:

- `server/src/main/java/io/spine/server/SubscriptionService.java`
- `server/src/main/java/io/spine/server/stand/Stand.java`
- `server/src/main/java/io/spine/server/stand/TopicValidator.java`
- `server/src/main/java/io/spine/server/stand/SubscriptionValidator.java`
- `server/src/main/java/io/spine/server/stand/SubscriptionRegistry.java`
- `server/src/main/java/io/spine/server/stand/SubscriptionCallback.java`

Implementation impact:

- JVM `SubscriptionService` delegates `subscribe`, `activate`, and `cancel` to
  context-owned `Stand`; Spine TS should keep the same service/Stand split.
- JVM `TopicValidator` rejects unsupported topic targets. Spine TS should keep
  unsupported state targets as `INVALID_ARGUMENT` at subscription creation.
- JVM `Stand.subscribe()` stores inactive subscriptions in a registry before
  activation. Spine TS already has this shape with `#subscriptions` and an
  inactive TTL; this task should test and document the lifecycle instead of
  replacing it.
- JVM `SubscriptionValidator` validates activation/cancellation against the
  registry. Spine TS intentionally completes unknown activation streams and
  treats unknown cancellation as OK for the current Connect/Node surface; this
  divergence must be tested and documented as a minimal local-service behavior.
- JVM cancellation removes only registered subscriptions and acknowledges once.
  Spine TS should keep idempotent cleanup and no duplicate completion/update
  behavior.

## Likely Files

- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/test/services/spine-services.test.ts`
- `packages/server/test/stand/stand.test.ts`
- `examples/todo/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/work-logs/T-0016d.md`
- `build-protocol/reviews/T-0016d-subscription-semantics.md`

## Acceptance Criteria

- Subscription service behavior for known and unknown targets is explicit,
  tested, and documented.
- Activation, cancellation, identity, queue limits, abandoned inactive
  subscriptions, activation iterator cleanup, and in-memory durability
  boundaries are tested and documented.
- The implementation remains small and does not add a durable subscription
  store or transport-specific public API.
- Public TypeDoc/API docs and user-facing docs match the implemented behavior.
- Required review lanes are clean: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
- `corepack pnpm verify` passes, with local listener/IPC sandbox limitations
  recorded if unsandboxed execution is required.

## Review Plan

After the implementation sub-agent reports completion, run five separate
reviewer sub-agents:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed every finding back to an implementation/fix sub-agent and repeat review
rounds until all lanes are clean.
