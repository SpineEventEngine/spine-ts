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

The current TS runtime preserves only the first durable inbox slice:

- standalone delivery writes can be recorded before the asynchronous worker
  handoff point where durability is configured, but this slice does not yet
  integrate `CommandBus` or `EventBus` intake with that handoff;
- durable inbox rows store the inbox target identity, signal identity, shard,
  status, label, receive time, version, optional signal payload, and optional
  dedup retention;
- pending and final dedup guards block duplicate `(signalId, inboxId)` writes
  while allowing crash recovery from a durable inbox row;
- shard pickup persists lease-backed shard sessions through storage
  compare-and-set rather than process-local locks; and
- malformed, oversized, or key-mismatched inbox, dedup, and shard-session
  records fail closed as storage corruption.

This slice stops at durable storage and readback. It does not yet implement
worker loops, repository invocation from the inbox, retry monitors, attempt
counters, or retained delivery error details. Those concerns are deferred to a
later delivery task.
