# T-0109 Implementation Brief

## Required Runtime Shape

Keep the implementation small and framework-owned. Stand is the EventBus
observer and the owner of node-local operational subscription attachments. The
durable `StandSubscriptionRegistry` remains the sole subscription-definition
store. `SpineServices` owns only active transport streams and their bounded
delivery queues; it must not retain a second definition, claim, tombstone, or
inactive-timer persistence system.

Use an internal Stand lifecycle seam rather than a new end-user-facing start
API. After repository state schemas are registered, Bounded Context starts
Stand observation/reconciliation with its EventBus and registry. The initial
complete snapshot starts immediately. Service activation must await Stand
readiness, so a synchronous context build cannot race an unobserved definition.

Stand keeps one serialized reconciliation tail and one unref'ed 10-second
timer. Each completed cycle may run one finite registry cleanup and then reads a
complete snapshot. For every active entry, it re-reads `get(id)` immediately
before attachment and requires the same active revision and canonical
subscription. Local attachments are keyed by subscription ID and revision. A
completed monotonic sweep removes definitions absent from that completed
snapshot. A close fence prevents later attachment, clears the timer, waits the
tail, unsubscribes all EventBus handles and stream callbacks, and completes
before EventBus or registry close.

Each reconciled event definition observes its declared domain event type. Each
reconciled Entity definition observes the frozen `EntityStateChanged` type and
matches the target state type, tenant, ID/columns, previous/new state departure,
and field mask. Move or deepen existing matcher/update encoding rather than
duplicating it. Internal system schemas must remain excluded from public event
routes by the existing `internal_all` filter.

`Subscribe` validates the topic/tenant through existing route logic, generates
the canonical `Subscription`, and calls the owning context registry's
`create()`. `Activate` calls `activate()`, installs one node-local stream callback
through Stand, and handles duplicate/local-close races without another durable
claim. `Cancel` physically deletes through the registry and immediately stops
the local stream; unknown cancellation remains bounded across configured
contexts. Iterator completion performs the same idempotent cancellation.

## Entity State Change Publication

Do not publish from `TransactionalEntity.commit()`: it precedes durable writes.
Capture independent old/new state and metadata, then publish the exact frozen
`EntityStateChanged` only after the family-specific durable seam:

- Aggregate: after deferred Stand/state history/aggregate history/EventStore
  persistence and before stored domain-event dispatch.
- Projection: after Stand and optional state-history persistence.
- Process Manager: after Stand/state history/diagnostic persistence and before
  follow-up events or commands.

Use a small shared internal publisher/value object rather than repeating event
construction. Pack Entity ID with the state type URL and source command/event ID
with the source signal type URL. Preserve actor/tenant/grand-origin causality in
the enclosing Event context. Include independent old/new state, timestamp, and
new version. A failed/rolled-back/non-changing transaction publishes nothing.
Publication/observer delivery is best effort after durable state: record a
bounded diagnostic failure and never roll back or re-run the Entity mutation.

## Test-First Evidence

Add focused RED/GREEN tests for:

1. Aggregate command/reactor, Projection, and Process Manager command/reactor
   exact system-event payload/context and one notification per durable commit.
2. Persistence failure, rejection, rollback, retry, and replay producing no
   phantom or duplicate committed-state event.
3. Plain event and Entity subscription updates with tenant, ID/column filters,
   field masks, and `no_longer_matching` behavior.
4. Startup snapshot, serialized periodic reconciliation, exact revision
   revalidation, delete during snapshot, stale-sweep fencing, post-delete cycle
   convergence, duplicate/reordered notice tolerance, and shutdown with zero
   timers/listeners.
5. SubscriptionService using only the configured registry for create/activate/
   physical delete, including custom/in-memory registry behavior.

Preserve current public behavior where it is not replaced by this task. Do not
modify JVM code, examples, Gateway fan-in, or protected human-review files. Use
`apply_patch` for edits. Push every coherent commit immediately. Run focused
tests and deterministic checks before handing back for specialist review.
