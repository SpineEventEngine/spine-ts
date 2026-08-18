# T-0203 Work Log

## 2026-08-18 — Baseline and current-state audit

- Inspected the protected primary checkout read-only and performed all planning
  in a fresh isolated clone.
- Fetched `origin/main` at
  `7980f0ebf5257d4df285ae07650c4ebb8d6eb1f2`; origin contained only `main` and
  no tags or unmerged feature work.
- Audited T-0195 through T-0202. Wave 13 is fully complete; this is a new
  architecture correction rather than unfinished broker implementation.
- Traced current IntegrationBroker, ServerEnvironment, generic signal routing,
  ZeroMQ adapters, Gateway dynamic subscriptions, application-node discovery,
  Stand registries, process hosting, RemoteDelivery, and DeliverySupervisor.

## 2026-08-18 — Delivery finding correction

The earlier statement that one node's Delivery work never notified other nodes
is stale on current main. Delivery Server Admin fan-out, RemoteDelivery
snapshot/update observation, DeliverySupervisor recovery, remote shard leases,
and a real two-process fan-out/fencing test are implemented. The new topology
must preserve this and connect every managed replica directly.

The remembered gap was real before Wave 6. It was closed in two stages:

- T-0094 on 2026-08-02 opened and wired `RemoteDelivery` with
  `ServerEnvironment` (`7accfc3c`, `74abd936`, and `3eec7820`).
- T-0107 on 2026-08-04 completed cross-node behavior: `015ef122` connected
  remote observations to every environment supervisor; `c9f9e4e0` and
  `5067b502` proved real gRPC/two-process fan-out; `d8891091` fenced remote
  commits. Follow-ups `c950cf02`, `09c17e5b`, and `184e99e6` covered shutdown
  lease release, reconnect/snapshot recovery, and real fault recovery.

## 2026-08-18 — Plan outcome

- Recorded 22 binding human requirements.
- Recorded D-0126 and reconciled the completion-plan frontier.
- Split implementation into T-0204 through T-0213 with one-writer ownership,
  handoffs, 41 behavioral acceptance cases, reviews, documentation, release,
  integration, and remote cleanup.
- No product source, test, generated artifact, dependency, or example changed.

## 2026-08-18 — Lifecycle decision closure

- The human selected degraded service with child replacement. A single child
  failure must not terminate the deployment node because it may be the only
  node.
- T-0206 now owns stable worker slots, fresh child incarnation identity,
  indefinite but rate-bounded restart, readiness recovery, synchronization
  before admission, no command retry, direct Delivery lease recovery, and
  graceful cancellation/cleanup.
- Frozen defaults are 250 ms initial delay, exponential doubling capped at 30
  seconds, reset after 60 seconds continuously READY, and at most the smaller
  of four or `processCount` concurrent starts. There is deliberately no
  permanent retry exhaustion.
- ZeroMQ removal was confirmed as the mandatory T-0212 deliverable. T-0211
  retains real HTTP/2 replacement evidence first; T-0212 then removes both
  ZeroMQ adapters, the generic signal layer, its native dependency, fixtures,
  exports, and documentation; T-0213 proves no fallback remains.
