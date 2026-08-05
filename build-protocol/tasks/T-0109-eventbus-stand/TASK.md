# T-0109: EventBus-Driven Stand And SubscriptionService

Status: In Progress

## Objective

Makes Stand observe the EventBus for domain events and committed Entity state
changes, moves native subscription lifecycle to the configurable Stand registry,
and reconciles each node's local listeners from complete registry snapshots at
startup and every 10 seconds.

## Classification

High-risk. This task changes event publication, post-commit behavior, durable
subscription lifecycle, multi-node convergence, timer/close ownership, tenant
matching, and listener fencing.

## Baseline And Isolation

- Baseline: `origin/main@cceb72ca`.
- Branch: `task/T-0109-eventbus-stand`.
- Worktree: `.worktrees/T-0109-eventbus-stand`.
- The dirty primary checkout remains coordination-only and untouched.
- Baseline `verify:release` passed during T-0108 post-merge verification: 182
  passed files, 3 skipped files, 3,620 passed tests, and 25 skipped tests.

## Acceptance Criteria

1. Stand observes domain events from its Bounded Context EventBus and emits
   matching native event-subscription updates; Message Board messages remain
   Entity updates, not events.
2. Every successful Aggregate, Process Manager, and Projection state commit
   publishes the exact frozen `EntityStateChanged` system event after durable
   commit, with entity identity, new/old state, source signal IDs, timestamp,
   version, and tenant context preserved.
3. Failed or rolled-back commits publish no state-change event. Replay and retry
   do not produce duplicate committed state changes beyond actual commits.
4. Stand converts matching `EntityStateChanged` events into Entity subscription
   updates with correct Entity type, tenant, ID/filter, and topic semantics.
5. `SubscriptionService` creates, activates, obtains, and physically deletes
   definitions through `StandSubscriptionRegistry`; it does not retain a second
   process-local definition or claim/cancel registry.
6. Each node performs one complete snapshot reconciliation at startup and then
   every 10 seconds. Runs are serialized and never poll Entity state.
7. Before attaching a listener, reconciliation revalidates the current registry
   ID and revision. Missing, replaced, or changed definitions are not attached.
8. A monotonic completed-snapshot sweep removes listeners absent from the latest
   completed snapshot and prevents an older run from overwriting newer local
   state. Cancellation converges after the first completed cycle begun after
   physical deletion.
9. Duplicate or reordered best-effort notices are tolerated; queries remain the
   authoritative source of Entity state.
10. Reconciliation, pending cleanup, timers, EventBus observation, listeners,
    and registry operations stop deterministically with the Bounded Context.
11. Focused tests cover event and Entity subscriptions, Projection/Aggregate/
    Process Manager visibility, tenant/filter matching, stale-sweep fencing,
    delete-during-snapshot, post-delete convergence, and shutdown.
12. All four canonical review concerns receive dispositions. Security remains
    N/A unless implementation introduces a new trust boundary. Final
    `verify:release`, merge, post-merge verification, and remote synchronization
    are required.

## Explicit Exclusions

- No Entity-state polling.
- No Gateway multi-backend fan-in; T-0110 owns it.
- No new distributed example; T-0111 owns it.
- No stronger exactly-once, ordered, gap-free, or cluster-complete guarantee.
- No JVM build or JVM source modification.

## Initial Read-Only Assignments

| Function | Scope                                                                     | Expected profile           | Dispatch                 |
| -------- | ------------------------------------------------------------------------- | -------------------------- | ------------------------ |
| Explorer | Current Stand/EventBus/SubscriptionService seams and tests                | `gpt-5.6-terra` / `medium` | Explicit fields required |
| Explorer | Entity commit paths and exact post-commit event publication points        | `gpt-5.6-terra` / `medium` | Explicit fields required |
| Explorer | Registry reconciliation, Bounded Context lifecycle, timer/close ownership | `gpt-5.6-terra` / `medium` | Explicit fields required |

Runtime self-introspection may be unavailable. Each result must record exposed
runtime metadata or the limitation before acceptance; an omitted dispatch field,
visible mismatch, or fallback requires redispatch.
