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

The first TS `Server` slice is intentionally narrower than Spine JVM's complete
server/runtime environment. It owns a Node HTTP/2 listener over `SpineServices`,
defaults to `127.0.0.1`, returns a `RunningServer` with `host`, `port`,
`baseUrl`, and idempotent `close()`, and shuts down in this order: stop network
intake, close active HTTP/2 sessions, then close owned contexts/resources. It
does not introduce `ServerEnvironment`, process supervision, worker management,
durable scheduling, or ZeroMQ-specific public API.

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
  returned failures receive independent message snapshots only for
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; their `Date`
  values and `Any.value` bytes are copied. `CATCH_UP` remains pending and never
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
  and marks it `DELIVERED` without accepted-work or failure-budget use. A failed
  mark leaves the authoritative row `TO_DELIVER` and returns one bounded,
  stack-free exhaustion failure. This does not expose public
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
  production retry policy, production supervision, or transport topology. A
  paused loop resumes from a saved
  internal cursor and safely resets that cursor if earlier pending rows
  disappeared. Renewal runs on the same JavaScript event loop as the endpoint
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
