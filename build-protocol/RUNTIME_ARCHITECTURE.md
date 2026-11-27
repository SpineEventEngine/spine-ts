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
current runtime uses independent ServerEnvironment instances configured through
builders. Application assembles Bounded Contexts, shared read routes, Delivery,
monitoring, and one tenant index. Application build completes required setup before
Server opens listener intake. Closing a Server stops its endpoint work and resources
without closing shared Application services. Callers close successful endpoints
before Application, which closes Bounded Contexts, tenant storage, and environment
in dependency order. Failed cleanup retains unfinished phases for retry.

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

- Aggregate command handlers cannot query read-side projections as part of a
  write transaction. Process Managers may use their protected, read-only
  `select()` capability to query eventually consistent projection state while a
  repository invokes a handler; the capability carries the active actor and
  tenant, exposes no Stand mutation or tenant override, and becomes invalid
  after that invocation;
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

## Integration message channels

The process-local IntegrationBroker boundary uses typed message channels for
generated `ExternalMessage` exchange. The current complete-replica
Coordinator forwards generated unary Command and Query HTTP/2 calls to ordinary
child `SpineServices`, which remain the only Bus intake.

Production `ServerEnvironment` requires only `storageFactory` and the
complete application `typeRegistry`; it can optionally receive an
`integrationChannelFactory`.

Every built `BoundedContext` owns an internal `IntegrationBroker`, which obtains
a typed `TransportFactory` from `ServerEnvironment`. The factory creates typed
publisher/subscriber channels carrying only generated `ExternalMessage`
Protobuf frames. This private boundary has no request/respond operation,
routing plan, command/query/subscription responsibility, or process topology.

The broker keeps three logical exchanges distinct: status announces a context
online; configuration replaces each foreign context's complete wanted-event
set and withdraws the local set at close; events use one logical channel per
domain-event type. Local/test environments use `InMemoryTransportFactory`.
When no factory is configured, each application process uses its shared
in-memory factory. The broker adds no Inbox, deduplication record, cursor,
delivery retry, replay, or durability queue.

## Process Model

`Server.start()` and `Server.run()` create one ordinary application process;
neither supervises child processes. `ManagedServerApplication.run()` is the
separate Node deployment entrypoint when the framework owns `SIGINT` and
`SIGTERM`: it starts the deployer-configured number of complete replicas,
supervises their bounded replacement, and owns a front-facing Coordinator
listener at the deployer-supplied nonzero port. `ManagedServerApplication.start()`
starts the same managed cohort without process-signal handlers; its embedding
host owns signals and closes the returned handle. The Coordinator forwards
generated unary Command and Query calls once to a READY child. The Coordinator
fans each Gateway-owned logical subscription to the complete replica cohort,
merges their updates for the one public stream, and has no public child-topology
API. Delivery stays direct between every replica and the shared Delivery Server;
managed deployment does not add a second inter-process application-message
channel.

## Bus Semantics

### Command Bus

The command bus accepts packed Spine `Command` messages. It validates command
metadata and dispatches each command through repository routes to its one
effective `@Assign` or command-input `@Command` receptor; event- and
rejection-input `@Command` reactions remain on EventBus.

Requirements:

- one command input has one receptor: either an `@Assign` assignee or a
  command-input `@Command` substitution; event- and rejection-input
  `@Command` handlers remain EventBus reactions;
- `@Command` handlers are supported only by Process Manager repositories;
  Aggregate and Projection repositories reject both command-input
  substitutions and event- or rejection-input reactions during construction;
- default entity route by the first command field in Protobuf declaration
  order, not by numeric field index;
- Entity state declares the target ID type in its first field; complete
  generated message IDs retain every declared field, including nested fields;
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

When a repository selects a recipient, the framework stores an `InboxMessage`
with the recipient, original Command or Event, signal ID, shard and receive
time. For example, two independent submissions of Command C42 to Project p7
produce two different inbox IDs. Each write creates or replaces its inbox ID
in one database call. Delivery can recognize repeated signals for the same
recipient when it processes the shard.

With a Delivery server, all application nodes subscribe to
`ShardObservingService.ObserveAll`. Each notice contains a shard ID. A free
shard with pending work is visible to a newly connected node, and an unclaimed
shard is announced again after the configured interval. A worker picks up the
shard before reading its messages. Suppose node east has already picked up
shard 3. Writing another Command there produces no notice while east holds it.
Release or expiry makes any pending work visible again. The Admin interface
reports the total number of stored messages, including delivered messages
awaiting cleanup.

With application-managed storage, a custom observer can notify another node.
For example, it can send the shard ID to a cloud queue used by the application.
The consumer invokes `environment.delivery.deliverMessagesFrom(shard)`. After
a normal run releases the shard, the framework checks for a pending message
that arrived too late for the run and passes it to the observer. An observer
failure is logged. The original inbox write has already succeeded.

A worker validates the recipient, label, tenant and envelope before dispatch.
On remote storage it presents the session and exact message when acknowledging
or removing it. Acknowledgement sets a five-second retention deadline using the
Delivery server's clock. A repeated acknowledgement preserves that deadline.
A later pass can remove the message after the deadline. An interrupted worker
can leave a message pending after its handler has already committed, so a
subsequent attempt can invoke the handler again.

The optional repository guard for Aggregates and Process Managers examines
recent Events emitted by the selected Entity. For example, if Project p7
emitted an Event caused by C42, an attempt to dispatch C42 again can recognize
the duplicate even after the inbox retention interval. A handler that emitted
no Event leaves no such evidence. Agents keep their optional duplicate memory
within the running process. See the
[Entity guard reference](../packages/server/REFERENCE.md#duplicate-dispatch-at-an-entity).

## Environment Delivery Lifecycle Sequence

Each Application environment supplies shared Delivery to its Bounded Contexts.
Application first assembles all Bounded Contexts and registers their shared reads,
then activates integration, monitoring, and recovered work. Server attaches to an
already built Application and opens endpoint services. Two endpoints may expose the
same Application without rebuilding or reattaching its Bounded Contexts.

RunningServer.close() stops endpoint intake, sessions, subscriptions, and accepted
endpoint work. Application.close() follows successful endpoint cleanup and waits for
accepted Application operations before releasing Bounded Contexts, index, and
services. Failed pending-start listener cleanup remains reachable from Application
and prevents premature storage closure. Process-managed retirement is coordinated
per Application, including pending starts, and rejects mixed manual/managed usage
within one Application.

The lifecycle exposes no public delivery scheduler, monitor, action,
dead-letter, retry-timing, topology, adapter, supervision, or catch-up policy.
It does not add distributed transport, legacy `IMPORT_EVENT` delivery,
aggregate import, or a new aggregate event replay path.
