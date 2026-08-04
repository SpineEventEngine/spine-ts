# T-0106: Unified Entity Inbox Handoff

Status: In Progress

## Objective

Routes Aggregate commands and Process Manager command/event handlers through
one context-owned Entity Inbox. The Inbox persists the routed signal before
handler dispatch, assigns the Entity to the context's configured shard, and
replays it only through the delivery runtime selected by `ServerEnvironment`.

## Classification

High-risk. The task changes command acknowledgement, transaction and replay
boundaries, Entity serialization, tenant isolation, shard routing, context
configuration, and the public bounded-context builder API.

## Baseline And Isolation

- Baseline: `origin/main@c1af7fd7`.
- Branch: `task/T-0106-unified-entity-inbox`.
- Worktree: `.worktrees/T-0106-unified-entity-inbox`.
- The primary checkout is coordination-only. Its unrelated dirty files remain
  outside this task.

## Acceptance Criteria

1. A command accepted for an Aggregate is persisted in the context-owned Inbox
   before its handler is invoked. The normal command route no longer invokes an
   Aggregate directly.
2. Process Manager `@Assign` commands and event reactions use that same Entity
   Inbox owner and replay path; Projection delivery remains separate.
3. `BoundedContextBuilder.withDeliveryStrategy(...)` selects a validated,
   immutable `DeliveryStrategy` for the built context. The default remains one
   shard. `ServerEnvironment` continues to select local or remote Inbox and
   work-registry ports; it does not duplicate target-routing configuration.
4. The Entity Inbox derives each row's shard from
   `strategy.shardFor(targetId, targetTypeUrl)`. Callers cannot supply a
   contradictory shard. Its endpoint descriptor enumerates every configured
   shard for each supported target label so startup recovery can discover all
   persisted work.
5. Aggregate command replay validates the stored target type, target identity,
   signal envelope, tenant, label, and shard before dispatch. Process Manager
   replay preserves equivalent checks for commands and events.
6. The same Entity is serialized by the shard lease and existing repository
   transaction guard. Duplicate signal persistence/replay is idempotent;
   handler rejection or failure cannot commit partial Entity state or events.
7. Single-tenant and multitenant storage contexts remain isolated. The tenant
   recorded by the command/event envelope must agree with the delivery scope.
8. Direct local mode persists and drains synchronously for current single-node
   behavior. Routed mode persists and acknowledges the handoff without running
   the handler in the posting request; an environment worker performs replay.
9. Existing public exports remain source-compatible except for the additive
   builder method. Public API and human/agent documentation explain the
   routing-versus-ports boundary in simple terms.
10. Focused tests prove acknowledgement-before-dispatch, no direct Aggregate
    invocation, PM command `@Assign`, same-Entity serialization, tenant/shard
    preservation, replay/idempotency, and transaction rollback.

## Explicit Exclusions

- No delivery-server Admin fan-out or multi-node pickup; T-0107 owns it.
- No Stand registry persistence or EventBus observation; T-0108/T-0109 own it.
- No Projection Inbox unification.
- No JVM source change or JVM build.

## Implementation Assignment

The existing `implementer` owns all production, focused test, API, and
documentation changes. Expected dispatch is explicit `gpt-5.6-terra` /
`medium`. The owner must use RED-first focused tests, must not spawn subagents,
must preserve unrelated work, and must push every commit to `origin`
immediately. Runtime self-introspection is unavailable on this surface;
acceptance uses the immutable configured role/profile plus explicit dispatch
fields and rejects any visible mismatch.

## Review Dispositions

- Style/maintainability: required for the unified deep-module boundary.
- Documentation: required because public context configuration and runtime
  behavior change.
- TypeScript/API docs: required for the additive builder contract and internal
  replay types.
- Performance/reliability: required for persistence, idempotency, sharding,
  concurrency, and transaction behavior.
- Security: N/A unless implementation changes a trust boundary; tenant
  correctness is covered by reliability review.

## Verification

Run focused repository, context, Inbox, delivery, typecheck, lint, formatting,
and documentation checks before review. After one converged review wave, run
`verify:release` once because shared server runtime and public API change.
