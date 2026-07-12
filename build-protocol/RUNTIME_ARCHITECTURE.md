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
- `Server`: gRPC service host and runtime supervisor.

Generic names should be familiar to JVM Spine users, but TypeScript API shape should be idiomatic.

The API should not expand these names into long, hyper-specific TypeScript
types unless the current implementation needs that precision. Prefer `Inbox`,
`Delivery`, `Repository`, `Stand`, `CommandBus`, and `EventBus` to invented
long names. Public standalone helper functions are disallowed unless a task log
records why a class/object/prototype method would be worse.

The first TS `Server` slice was intentionally narrower than Spine JVM's
complete server/runtime environment. It introduced a Node HTTP/2 listener over
`SpineServices`, defaulted to `127.0.0.1`, returned a `RunningServer` with
`host`, `port`, `baseUrl`, and idempotent `close()`, and did not introduce
`ServerEnvironment`, process supervision, worker management, durable
scheduling, or ZeroMQ-specific public API. Current source now also has a small
explicit `ServerEnvironment` for storage, transport, optional delivery/tracing
facilities, and close ownership. Its optional closeable delivery facility is
not an active delivery scheduler. Current server close still stops network
intake/sessions and then closes one flat group of contexts, resources, and an
optionally owned environment; there is no delivery-registration barrier yet.
D-0085 assigns a package-internal environment-owned bounded-run lifecycle to
future implementation, and D-0086 sequences it through six ordered children
without claiming that lifecycle is current behavior.

## Read-Side and Write-Side Segregation

The write side owns:

- command intake;
- command dispatch;
- aggregate/process manager state changes;
- event creation;
- event persistence;
- event delivery to subscribers/reactors/projections.

The read side owns:

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

## Transport Abstraction

ZeroMQ must not leak into domain, repository, or service APIs. The runtime depends on interfaces such as:

```typescript
interface SignalTransport {
  publish(envelope: SignalEnvelope): Promise<void>;
  subscribe(subscription: SignalSubscription, handler: SignalHandler): Promise<SubscriptionHandle>;
  request<TReq, TResp>(pattern: RequestPattern<TReq, TResp>, request: TReq): Promise<TResp>;
  close(): Promise<void>;
}
```

The final interface will be refined during implementation, but it must:

- represent command, event, query, subscription, system, and delivery topics;
- hide socket types and ZeroMQ-specific envelopes;
- support local process discovery or explicit process registration;
- support graceful close and broker restart handling;
- allow later replacement with another local IPC or distributed transport.

T-0016f adds the first executable server-side bridge over this abstraction.
`RuntimeTransportBinding.open()` consumes a `ServerRuntimeRoutingPlan`, a
supplied `SignalTransport`, a supplied `SingleProcessServerRuntime`, and
framework-owned `onCommand` / `onEvent` callbacks. It registers command routes
with request/respond semantics, registers event routes with publish/subscribe
semantics, validates incoming generated Spine command/event envelope shape plus
the enclosed message type URL before runtime intake, and enqueues accepted
callbacks through the runtime. Its handle is idempotent and closes transport
registrations before the runtime. It deliberately does not own the transport
instance, choose IPC endpoint names, expose ZeroMQ, supervise processes, retain
delivery attempts, retry work, or create a JVM-style server environment.

## ZeroMQ Local Broker

ZeroMQ is used only for local IPC between Node.js processes on one host.

The broker adapter may choose more than one ZeroMQ socket pattern:

- Pub/sub is natural for event fan-out by type URL and semantic tag.
- Command handling requires exactly one effective command dispatcher per command
  type; the adapter may implement this with broker-managed routing, worker
  registration, and load balancing rather than pure pub/sub.
- Query handling follows the gRPC `QueryService` contract; internally it may
  use request/reply to a read-side worker or process-local stand access.
- Subscription streaming follows `SubscriptionService`; internally it may use
  pub/sub for read-side updates plus a subscription registry.

The public framework model still describes publishers and subscribers. The
adapter chooses socket topology based on bus semantics.

## Process Model

The framework must support these modes:

- single-process mode for tests and simple development;
- multi-process local mode with a broker and role-specific workers;
- supervised mode where the main process starts and monitors broker/workers;
- externally supervised mode where process manager tooling starts workers.

Each worker process must declare:

- bounded context name;
- tenant mode;
- role;
- handled signal types;
- supported entity/repository types;
- health and readiness state.

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
  the default first-field route and define their own route-validity behavior;
- preserve immediate `Ack` semantics separately from later command result subscriptions;
- isolate command handler failure from broker failure.

### Event Bus

The event bus accepts packed Spine `Event` messages and dispatches them to all
eligible subscribers/reactors/projections.

Requirements:

- topic matching by concrete event type URL and semantic tags;
- domestic/external event distinction;
- event enrichment before delivery where configured;
- delivery through inbox-like durable records when persistence is enabled;
- idempotence for event redelivery/replay and projection updates.

### Query and Subscription Buses

Queries and subscriptions preserve Spine gRPC service contracts.

Requirements:

- query request/response shape follows `QueryService`;
- subscription creation, activation, update streaming, and cancellation follow `SubscriptionService`;
- unknown-target subscription fallback may fan out internally to multiple
  bounded contexts, while the client sees one opaque `Subscription`;
- read-side workers own filtering, ordering, lifecycle filtering, and response formatting.

## Storage Boundaries

The framework starts storage with one adapter seam:

- `StorageFactory.createRecordStorage(context, spec)`;
- `RecordSpec` for identified Protobuf records and query columns;
- `RecordStorage` for write/read/delete/query operations;
- `EventStore` as a delegate over `RecordStorage<EventId, Event>`.

For now `EventStore` is storage-only. It persists and queries `Event` records,
but it does not dispatch those events on its own to buses, subscribers,
delivery workers, or retry infrastructure. The first TS `EventBus` now owns
append-before-dispatch by delegating to `EventStore`; events with no registered
dispatcher still remain stored and resolve.

Later repository, delivery, and read-side storage layers must delegate to this
record-storage seam instead of widening the adapter interface prematurely.

Initial implementation may include in-memory storage, but production storage is
pluggable. The bus transport is not storage.

Storage is the first corrected implementation layer. The common `Storage`
contract must not contain in-memory-specific behavior; in-memory storage is one
adapter behind the same contract.

## Delivery and Reliability

The current TS runtime preserves the first durable inbox slice and a small local
delivery worker boundary:

- standalone delivery writes can be recorded before the asynchronous worker
  handoff point where durability is configured, and package-internal
  framework-owned replay can drain one shard through validated endpoints. Built
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
- pending and final dedup guards block duplicate `(signalId, inboxId)` writes
  during the same 30-second local retention window as JVM local delivery while
  allowing crash recovery from a durable inbox row;
- shard pickup, renewal, and release persist lease-backed shard sessions through
  storage compare-and-set rather than process-local locks. Renewal extends only
  an unexpired current session for the same session ID and node;
- one direct drain run holds a shard through `ShardedWorkRegistry`, reads
  `TO_DELIVER` rows in inbox order, and keeps the storage lease renewed while
  the drain is active. Rows unavailable to the active worker are skipped before
  endpoint invocation, including rows owned by another active worker and
  worker-unsupported labels such as `CATCH_UP`. Validated endpoints and
  returned ordinary failures receive independent message snapshots only for
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; their `Date`
  values and `Any.value` bytes are copied. Exhausted-row failure snapshots use
  the same supported label/status shape but omit `signal`, avoiding payload
  copies before callback-free finalization. `CATCH_UP` remains pending and never
  reaches those endpoints or failures. The callback limit caps endpoint
  callbacks that actually run. Newly observed rows stop at the storage read cap
  plus that limit while the scan advances by a stable inbox row continuation
  over `receivedAt`, `version`, and message ID. A skipped-only paused loop drops
  that internal continuation before a later external run so earlier rows that
  become available are reconsidered;
  successful delivery marks the row `DELIVERED`, endpoint callback failures
  leave the row pending only after framework cleanup succeeds, and endpoint
  callback cleanup failures, lease/fencing failures, and delivery-status update
  failures are reported without an immediate retry guarantee. Supported
  endpoint failures also write internal sanitized delivery-attempt records with
  message/inbox/shard identity, label, node, attempted time, accepted flag, and
  stable failure stage/reason; these records do not store raw `Any.value`
  payload bytes, raw user errors, stack traces, or unbounded exception text. A
  package-internal pre-callback gate reads the 100 retained slots for one exact
  inbox message. At that bound it skips the callback and another attempt,
  claims the exact row, synchronizes the active claim to the live shard fence,
  and marks it `DELIVERED` without accepted-work or failure-budget use.
  Lease/fencing failure through the final guard before durable marking remains
  `LEASE` / `LEASE_INACTIVE`, retains one bounded attempt at the 100-slot cap,
  records one failure without accepted work, and leaves the row `TO_DELIVER`.
  If the mark fails and cleanup succeeds, the authoritative row remains
  `TO_DELIVER` and one frozen, bounded, stack-free exhaustion-facts object is
  returned. If cleanup also fails, the row remains `TO_DELIVER` and the same
  one-failure accounting returns a `CLEANUP` result whose `AggregateError`
  contains the original mark error plus cleanup error; that error has no frozen,
  bounded, or stack-free guarantee. This does not expose public
  monitor/action, scheduler/backoff, dead-letter, production-topology,
  catch-up, or adapter policy. Pre-callback
  claim, validation, and lease/fencing failures do not increment accepted work,
  but they do increment failed work and count toward a loop's `maxFailures`
  bound. Once the endpoint callback or `onMessage` path has been
  invoked, endpoint failures and later framework cleanup/status-update failures
  are accepted work and may appear in failed work. Live shard ownership plus
  live per-message ownership block competing callback dispatch while ownership
  is current; expired per-message ownership may be replaced during claim
  compare-and-set using the storage clock as abandoned-work recovery. If a
  stale owner continues running after losing renewal, endpoint callback side
  effects are at-least-once/replay-safe: later final fencing can prevent stale
  finalization, but it cannot uninvoke a callback that already ran. Broader
  production supervision, cancellation, and retry-monitor policy remains future
  work. The run returns
  simple counts plus
  per-message failures and releases the shard in a `finally` path;
- Package-internal loop code repeats those direct drains for one shard. Renewal
  is framework-owned lease fencing for active drains. The package does not
  expose a raw worker callback API; normal replay stays behind validated framework
  endpoints. This is a lifecycle wrapper over the direct primitive, not
  production retry policy, production supervision, or transport topology.
  Direct drains/pages remain bounded. At the start of a new loop epoch, the
  loop performs exactly one adapter-neutral inbox read and admits at most the
  storage read limit, currently 1,000 ordered pending rows, into an immutable
  canonical row snapshot. Admission detaches `Date` and `Any.value` state once;
  the loop then passes its private frozen retained array directly to read-only
  drain internals. This snapshot, rather than a caller-controlled
  ordering key or a work counter, defines epoch membership, so a write between
  storage pages cannot join the active epoch and callback writes remain outside
  it. Admitted drains do not reread each row by ID; supported rows still pass
  through durable claim and mark compare-and-set operations, so a status or
  claim change after admission skips stale work without invoking the endpoint.
  Each explicit `run()` starts at most two bounded drains. If admitted members remain,
  `PAUSED` retains the snapshot and opaque index for a later explicit run;
  otherwise `IDLE` completes the epoch. Capped epochs advance through finite
  admission sweeps whose depth doubles after each pass. Each pass restarts at
  the inbox head, so a post-admission row written behind a retained boundary is
  eligible in a later explicit epoch, while increasing pass depth still makes
  forward progress through an arbitrarily large finite unsupported prefix.
  The sweep retains only one ordering continuation and two counters; it does
  not retain an ever-growing set of prior rows. A stop observed
  while admission is in flight prevents the first drain from starting. The
  worker's package-internal invocation associates one opaque obligation with
  configured shards and returns ordered fulfilled/rejected evidence. Fulfilled `FAILED` and
  `SKIPPED` shards park, `IDLE` completes, `STOPPED` stops, and only `PAUSED`
  or explicitly retriggered rejected work remains eligible for that obligation.
  Rejected evidence preserves the original cause and last safely completed
  epoch counters while fulfilled sibling evidence remains available. The
  public/direct worker adapter still throws one original cause or an ordered
  `AggregateError`. No cursor, epoch, obligation, shard result, or selective
  invocation is exported from the package root, and no run starts
  automatically. Renewal runs on the same JavaScript event loop as the endpoint
  callback, so a CPU-bound synchronous callback can still starve timer-driven
  renewal; this slice treats that as an in-process trust-boundary limitation;
  and
- malformed, oversized, or key-mismatched inbox, dedup, and shard-session
  records fail closed as storage corruption. Deprecated legacy stored
  `IMPORT_EVENT` rows are one such corruption path and abort read/drain with
  `DeliveryStorageCorruptionError` before any `DeliveryRun` is returned.

This slice stops at durable storage, ordered readback, narrow built-context
process-manager command, process-manager event, and live projection subscriber
handoffs, one direct drain call, and a closeable loop owner. It does not yet
implement a generic repository delivery engine, projection catch-up through
inbox storage, retry monitors, public or production retry-attempt counter
policy beyond the internal retained-attempt gate, retained raw delivery error
details, production worker supervision, or transport-backed topology. Event
import and aggregate importers are removed from the active plan by upstream ADR
0001 D1. Aggregate `@React` handlers, when present, use ordinary
generated-reactor transaction semantics rather than event-sourcing
applier/import delivery. `IMPORT_EVENT` is no longer a supported public
delivery label for new inbox writes; stored/wire legacy rows using it are
recognized only as deprecated compatibility data and fail closed before
delivery.

## Environment Delivery Lifecycle Sequence

Current built-context handoffs construct short-lived tenant-specific
`Delivery` instances, persist supported inbox work, and immediately exact-drain
that row. Built contexts retain the storage factory actually used to build them
behind `boundedContextAccess`; a builder-specific factory can differ from the
environment default. The tenant index can enumerate recorded multitenant
tenants, but server startup does not currently enumerate those scopes for
recovery. T-0036's finite epochs and ordered fulfilled/rejected per-shard
evidence remain package-internal, explicitly invoked, and unchanged.

D-0086 maps the future D-0085 lifecycle into six strict slices:

1. T-0037a owns context delivery descriptors, actual storage, tenant startup
   scopes, endpoint/shard facts, and post-persist readiness.
2. T-0037b owns serialized/coalesced finite generation runs and per-shard
   interpretation of T-0036 evidence.
3. T-0037c owns bounded canonical operational obligations and one-time cause
   reporting.
4. T-0037d owns environment registration cardinality, startup recovery, and
   registration-scoped rollback.
5. T-0037e owns detach, generation stop/retirement/reuse, close refusal, and
   permanent environment close.
6. T-0037f owns server listener/startup and network/context/resource/facility
   shutdown ordering.

The first future handoff is T-0037a's package-internal
`boundedContextAccess` descriptor/readiness seam. It does not start a worker or
change environment ownership by itself. JVM evidence supports only placing
delivery ownership at environment level and submitting readiness after durable
local persistence. The TS sequence rejects JVM singleton state, per-message
threads, repeat callbacks, public monitor actions, catch-up stations, and
global storage-factory copying. Retry timing and all public scheduler,
monitoring, health, topology, adapter, and catch-up policy remain deferred.
