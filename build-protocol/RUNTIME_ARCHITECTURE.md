# Runtime Architecture

Navigation: [README](README.md) | Previous:
[Protobuf Contract](PROTOBUF_CONTRACT.md) | Next:
[Developer API](DEVELOPER_API.md)

## Core Runtime Objects

The TS runtime centers on the same conceptual objects as Spine JVM:

- `BoundedContext`: a final runtime assembly object for a domain context.
- `BoundedContextBuilder`: mutable configuration object used before runtime start.
- `Repository<I, E>`: owner of entity storage, routing, and handler dispatch.
- `Aggregate<I, S>`, `Projection<I, S>`, `ProcessManager<I, S>`: OOP entity
  base classes.
- `CommandBus`, `EventBus`, `QueryBus`, `SubscriptionBus`: logical buses.
- `Stand`: read-side query/subscription facade.
- `Server`: gRPC service host and server lifecycle owner.

Generic names should be familiar to JVM Spine users, but TypeScript API shape should be idiomatic.

The API should not expand these names into long, hyper-specific TypeScript
types unless the current implementation needs that precision. Prefer `Inbox`,
`Delivery`, `Repository`, `Stand`, `CommandBus`, and `EventBus` to invented
long names. Public standalone helper functions are disallowed unless a task log
records why a class/object/prototype method would be worse.

The first TS `Server` slice was intentionally narrower than Spine JVM's
complete server/runtime environment. It introduced a Node HTTP/2 listener over
`SpineServices`, defaulted to `127.0.0.1`, and returned a `RunningServer` with
`host`, `port`, `baseUrl`, and idempotent `close()`; it did not yet include
`ServerEnvironment` or delivery managed by the environment. That is historical. The
current runtime exposes one process-wide `Environment`/`ServerEnvironment`
singleton graph for storage, transport, optional delivery/tracing facilities,
and their explicit process-close responsibility. Server startup completes finite
environment recovery and opens command/event transport intake before listener
intake. Server close stops network intake and sessions, drains accepted
transport work, detaches and quiesces delivery, then closes its contexts and
resources. Shared facilities remain open until every server has detached and
the process explicitly closes `ServerEnvironment.instance()`. This lifecycle
adds no process supervision, public delivery scheduler, retry-timing policy, or
production transport-topology policy.

## Read-Side and Write-Side Segregation

The write side contains:

- command intake;
- command dispatch;
- aggregate/process manager state changes;
- event creation;
- event persistence;
- event delivery to subscribers/reactors/projections.

The read side contains:

- projection state records;
- query execution;
- subscription matching and update streaming;
- query column indexes;
- lifecycle filtering for visible entities.

Rules:

- command handlers cannot query read-side projections as part of the write
  transaction;
- query handlers cannot mutate write-side entities;
- projections are updated by delivered events, not by direct command calls;
- service APIs may live in one process, but their internal dependencies must
  stay separated.

## Asynchronous Signal Processing

All domain signals are processed asynchronously after public intake:

- `CommandService.Post` validates and acknowledges intake, then hands command
  processing to the write-side runtime.
- Command handling produces events or immediate rejection/error outcomes according to Spine command semantics.
- Events are delivered to subscribers/reactors/projections through event
  delivery, not direct synchronous calls from aggregate code.
- Subscription updates are emitted from read-side changes.

For tests, a direct/local mode may exist, but it must be clearly marked as a
testing utility and must preserve the same observable ordering guarantees as
much as possible.

## Legacy Signal Transport (pending T-0212 removal)

The generic `SignalTransport` and its same-host ZeroMQ adapter are legacy
application-composed IPC. They remain documented only while T-0212 removes
their command/event deployment path. The current complete-replica Coordinator
does not use them: it forwards generated unary Command and Query HTTP/2 calls
to ordinary child `SpineServices`, which remain the only Bus intake.

ZeroMQ must not leak into domain, repository, or service APIs. The runtime depends on interfaces such as:

```typescript
interface SignalTransport {
  publish(envelope: SignalEnvelope): Promise<void>;
  subscribe(subscription: SignalSubscription, handler: SignalHandler): Promise<SubscriptionHandle>;
  request<TReq, TResp>(pattern: RequestPattern<TReq, TResp>, request: TReq): Promise<TResp>;
  close(): Promise<void>;
}
```

The implemented abstraction hides socket types and ZeroMQ-specific envelopes,
supports adapter-neutral command/event request and publication flows, and manages
graceful handle closure. The same interface is used by the in-process adapter
and the same-host ZeroMQ adapter.

T-0016f adds the first executable server-side bridge over this abstraction.
`RuntimeTransportBinding.open()` consumes a `ServerRuntimeRoutingPlan`, a
supplied `SignalTransport`, a supplied `SingleProcessServerRuntime`, and
framework `onCommand` / `onEvent` callbacks. It registers command routes
with request/respond semantics, registers event routes with publish/subscribe
semantics, validates incoming generated Spine command/event envelope shape plus
the enclosed message type URL before runtime intake, and enqueues accepted
callbacks through the runtime. Its handle is idempotent and closes transport
registrations before the runtime. It deliberately does not manage the transport
instance, choose IPC endpoint names, expose ZeroMQ, supervise processes, retain
delivery attempts, retry work, or create a JVM-style server environment.

This signal-routing authority is separate from cross-context external events.
Every built `BoundedContext` owns an internal `IntegrationBroker`, which obtains
a typed `TransportFactory` from `ServerEnvironment`. The factory creates typed
publisher/subscriber channels carrying only generated `ExternalMessage`
Protobuf frames. It has no signal kind, subscriber ID, routing plan,
request/respond operation, or command/query/subscription responsibility.

The broker keeps three logical exchanges distinct: status announces a context
online; configuration replaces each foreign context's complete wanted-event
set and withdraws the local set at close; events use one logical channel per
domain-event type. Local/test environments use `InMemoryTransportFactory`.
When no factory is configured, each application process uses its shared
in-memory factory. A configured adapter remains optional for the separate
external-event transport responsibility. Delivery, retry, replay, and
durability remain transport responsibilities; the broker adds no Inbox,
deduplication record, cursor, or retry queue.

## Legacy ZeroMQ Same-Host Adapter

ZeroMQ provides the legacy local IPC path between application-composed Node.js
processes. It is not used inside CommandBus or EventBus and is not used by the
complete-replica Coordinator. T-0212 removes this path after its Coordinator,
Delivery, and subscription replacements have acceptance evidence.

## Process Model

`Server.start()` and `Server.run()` create one ordinary application process;
neither supervises child processes. `ManagedServerApplication.run()` is the
separate Node deployment entrypoint: it starts the deployer-configured number
of complete replicas, supervises their bounded replacement, and owns a
front-facing Coordinator listener at the deployer-supplied nonzero port. The
Coordinator forwards generated unary Command and Query calls once to a READY
child; it has no public child-topology API and does not yet fan out
subscriptions. Delivery stays direct between every replica and the shared
Delivery Server. The legacy ZeroMQ path above is pending T-0212 removal, not a
parallel requirement for managed deployment.

## Bus Semantics

### Command Bus

The command bus accepts packed Spine `Command` messages. It validates command
metadata and dispatches commands through repository routes to matching command
assignee/reactor endpoints.

Requirements:

- command assignees and command reactors may both observe the same command type
  when registered in one bounded context;
- default entity route by the first command field in Protobuf declaration
  order, not by numeric field index;
- commands handled by the default route whose first-field target ID is absent,
  blank, or not assignable to the repository ID type must be rejected by the
  default route before handler invocation;
- end-user handlers must not perform default target-ID extraction or validation;
- support explicit custom command routes in repositories; custom routes replace
  the default first-field route and define route-validity behavior;
- preserve immediate `Ack` semantics separately from later command result subscriptions;
- isolate command handler failure from broker failure.

### Event Bus

The event bus accepts packed Spine `Event` messages and dispatches them to all
eligible subscribers/reactors/projections.

Requirements:

- topic matching by concrete event type URL and semantic tags;
- domestic/external distinction from generated handler `origin` metadata and
  `EventContext.external`; a dispatcher may declare an external schema subset,
  and mixed repository routes filter individual receptors by origin;
- producer-side integration observes only requested domestic events, while
  imported events reach only external receptors, preventing re-export loops;
- event enrichment before delivery where configured (not implemented by the
  current TypeScript runtime);
- delivery through inbox-like durable records when persistence is enabled;
- idempotence for event redelivery/replay and projection updates.

### Query and Subscription Buses

Queries and subscriptions preserve Spine gRPC service contracts.

Requirements:

- query request/response shape follows `QueryService`;
- subscription creation, activation, update streaming, and cancellation follow `SubscriptionService`;
- unknown-target subscription fallback may fan out internally to multiple
  bounded contexts, while the client sees one opaque `Subscription`;
- read-side workers perform filtering, ordering, lifecycle filtering, and response formatting.

Wave 12 implements this lifecycle: a healthy browser activation remains open across ordinary successive updates.
The universal acceptance path is a real browser over gRPC-Web, Envoy, the
Gateway, native subscription forwarding, and the application server. Reconnect
and authoritative re-query recover real best-effort disconnects; they do not
make normal stream termination acceptable. Cancellation and shutdown are
bounded and release every iterator, relay, Stand attachment, session, and
listener.

## Storage Boundaries

The framework starts storage with one adapter seam:

- `StorageFactory.createRecordStorage(context, spec, group?)`;
- `RecordSpec` for identified Protobuf records and query columns;
- `RecordStorage` for write/read/delete/query operations;
- `EventStore` as a delegate over `RecordStorage<EventId, Event>`.

For now `EventStore` is storage-only. It persists and queries `Event` records,
but it does not dispatch those events automatically to buses, subscribers,
delivery workers, or retry infrastructure. The first TS `EventBus` now manages
append-before-dispatch by delegating to `EventStore`; events with no registered
dispatcher still remain stored and resolve.

Repository current state, optional histories, Event Store, Stand, inbox rows,
shard sessions, leases, and subscription records now delegate to this seam.
The common contract remains provider-neutral: memory, MySQL, and Datastore are
adapters behind it, while bus transport is not storage. Physical identity is
tenant boundary plus record family; Bounded Context names are diagnostic only.
MySQL selects a configured database per complete tenant and Datastore selects a
native namespace. Typed ID/column mappings are identical for writes and Query
operands; applications provide generated type metadata when compact Proto JSON
must expand `Any`.

Wave 12 implements this provider contract. Provider query capability is an execution promise. MySQL admits only normalized
plan features it can translate to parameterized SQL and pushes their predicate,
ordering, and finite limit into the selected tenant database and resolved
storage-group table. It never silently reads a whole group for Node filtering.
Datastore joins common conformance for its overlapping pushdown features.
Normalized plans do not gain offset in Wave 12; the separate `RecordQuery`
offset remains unchanged. Native provider runs, statement/parameter evidence,
and V8 coverage are reported independently.

## Delivery and Reliability

The current TS runtime provides direct durable inbox rows, finite local drains,
and transport-backed worker supervision:

- standalone delivery writes can be recorded before the asynchronous worker
  handoff point where durability is configured, and package-internal
  framework replay can drain one shard through validated endpoints. Built
  bounded
  contexts integrate `CommandBus` intake for process-manager command assignees
  and live `EventBus` intake for process-manager event reactions and projection
  subscribers with durable local inbox handoff. Other inbox-routed event
  endpoint kinds remain deferred;
- durable inbox rows store the inbox target identity, signal identity, shard,
  status, label, receive time, version, optional signal payload, and optional
  dedup retention;
- built bounded contexts now use this storage boundary for three narrow local
  handoffs: process-manager command assignees with `HANDLE_COMMAND`, live
  process-manager event reactions with `REACT_UPON_EVENT`, and live projection
  event subscribers with `UPDATE_SUBSCRIBER`;
- process-manager event rows store the original `Event` envelope as the signal
  payload, use the original event ID as `signalId`, target the process-manager
  state type URL plus routed process-manager ID, drain the local single shard
  immediately, and replay only that inbox row target before process-manager
  handler execution. Before handler code runs, replay validates the row label,
  pending `TO_DELIVER` status, tenant, payload/schema, target type URL, and
  routed target ID;
- live projection subscriber rows store the original `Event` envelope as the
  signal payload, use the original event ID as `signalId`, target the
  projection state type URL plus routed projection ID, drain the local single
  shard immediately, and replay only that inbox row target before running the
  projection transaction and `Stand` update. Before handler code runs, replay
  validates the row label, pending `TO_DELIVER` status, tenant, payload/schema,
  target type URL, and routed target ID;
- pending and delivered `InboxMessage` rows are stored directly; delivered rows
  are the deduplication fact, with no per-message claim or separate dedup
  record;
- `keepUntil` is the optional
  deduplication-protection deadline, not a second
  retention setting. A delivered row becomes cleanup-eligible when the deadline
  is absent or has elapsed. Cleanup runs one bounded page under current shard
  ownership, plus at most one continuation only after a full protected page
  makes no removal. Each exact delete validates the fence in one
  provider-atomic operation, and
  preserves every pending, retryable, non-delivered, or still-protected row.
  The environment delivery lifecycle owns cleanup and awaits it at shutdown;
  Wave 12 adds no second retention configuration, timer, or scheduler;
- shard pickup, renewal, and release persist lease-backed shard sessions through
  storage compare-and-set rather than process-local locks. A complete `WorkerId`
  can pick up or renew its own unexpired session; another worker is excluded
  until expiry, and a stale owner cannot release a replacement session;
- one direct drain run holds a shard through `ShardedWorkRegistry`, reads
  `TO_DELIVER` rows in inbox order, and keeps the storage lease renewed while
  the drain is active. Rows unavailable to the active worker are skipped before
  endpoint invocation, including rows owned by another active worker and
  worker-unsupported labels such as `CATCH_UP`. Validated endpoints and
  returned ordinary failures receive independent message snapshots only for
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; their `Date`
  values and `Any.value` bytes are copied. `CATCH_UP` remains pending and never
  reaches those endpoints. A successful callback marks the row delivered.
  `DeliveryMonitor` contains reception failure: its default marks the failed
  reception delivered and continues independent targets; a custom monitor may
  choose one immediate repeat action. A durable acknowledgement failure leaves
  the row pending, stops later same-target rows for that run, continues
  independent targets, and releases ownership for a later run. Handler effects
  and the delivered-row compare-and-set are not one transaction, so lost
  acknowledgement can redeliver and downstream handling must be idempotent.
  No attempt history, per-message claim, quarantine, receipt, marker, timer,
  backoff, dead-letter storage, scheduler persistence, or delivery policy is
  added. The run releases its shard in a `finally` path;
- Package-internal loop code runs one bounded direct drain for one shard at a
  time. It has no epoch snapshot, retained array, claim, `PAUSED` state,
  doubled sweep, second drain, timer renewal, cursor, or public worker callback
  API. Renewal occurs through fencing at pickup, before callback work, and
  before acknowledgement; loss of that fence stops the shard before the next
  protected operation. The loop is a lifecycle wrapper, not retry policy,
  supervision, or transport topology; and
- malformed, oversized, or key-mismatched inbox and shard-session records fail
  closed as storage corruption. Deprecated legacy stored
  `IMPORT_EVENT` rows are one such corruption path and abort read/drain with
  `DeliveryStorageCorruptionError` before any `DeliveryRun` is returned.

This slice stops short of scheduled or timed retries, attempt/exhaustion
counters, raw delivery-error history, quarantine/dead-letter storage, and an
exactly-once side-effect guarantee. `DeliveryMonitor` is the customizable
per-reception policy seam, and `DeliverySupervisor` plus remote delivery ports
provide the bounded transport-backed worker topology used by the distributed
Message Board example. Event import and aggregate importers are
removed from the active plan by upstream ADR 0001 D1. Aggregate `@React`
handlers, when present, use ordinary generated-reactor transaction semantics
rather than event-sourcing applier/import delivery. `IMPORT_EVENT` is no longer
a supported public delivery label for new inbox writes; stored/wire legacy rows
using it are recognized only as deprecated compatibility data and fail closed
before delivery.

## Environment Delivery Lifecycle Sequence

The process-wide `ServerEnvironment` manages the delivery lifecycle for attached
contexts.
`Server.start()` builds its contexts and completes finite environment recovery
before opening listener intake. If recovery rejects, startup rejects and the
listener is not opened. Recovery completion does not claim that every pending
delivery was completed.

`RunningServer.close()` stops listener intake and sessions, closes context
transport intake and drains accepted work, detaches delivery and waits for
quiescence, then closes contexts and resources. It never closes process-wide
facilities. After all sibling servers detach, explicit
`ServerEnvironment.instance().close()` closes the singleton. Retriable close
failures retain unfinished work and do not duplicate completed phases.
`ServerEnvironment.close()` is permanent only after it is no longer in use; an
in-use close rejects without tearing down its configured facilities.

The lifecycle exposes no public delivery scheduler, monitor, action,
dead-letter, retry-timing, topology, adapter, supervision, or catch-up policy.
It does not add distributed transport, legacy `IMPORT_EVENT` delivery,
aggregate import, or a new aggregate `@Apply` path.
