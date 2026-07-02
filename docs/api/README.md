# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts, the `@spine-ts/core` metadata/type
registry and validation facade APIs, the first `@spine-ts/server`
descriptor-derived entity metadata, context-owned `Repository` registration,
set-once transition validation, explicit handler metadata APIs, the first
command/event bus exports, the first server runtime lifecycle/async queue
kernel, write-side signal intake result exports, the runtime-routing planner
seam, the first `@spine-ts/transport` contracts, and the first
`@spine-ts/storage` contracts.

Proto exports include message types, generated schemas, enum values and enum
descriptors, file descriptors, and the `type_url_prefix` custom option for the
validation, core signal envelope, actor/tenant/user/version context, time, net,
and UI language contracts.

Core exports include deterministic type URL derivation, registry and metadata
types, the default registry for the curated Spine schema set, single-message
validation result/check helpers, `ValidationException`, structured
`ValidationError` creation, and the initial transition-validation seam. Core
envelope construction exports include `packAny()`, `unpackAny()`,
`packCommand()`, `packEvent()`, `PackAnyOptions`, `PackCommandInput`, and
`PackEventInput`.

Server exports include `BoundedContext`, `BoundedContextBuilder`,
`ContextSpec`, `BoundedContextName`, `TenantMode`, `BoundedContextSnapshot`,
small immutable snapshot contracts, `CommandEndpoint`, `EventEndpoint`, and
`BoundedContextNameError` for bounded-context assembly.
The public entry points mirror Spine JVM's
`BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)`.
`ContextSpec` remains a framework-owned immutable value surfaced through
`builder.spec` and `context.spec`; the builder collects command and event
dispatchers; `withStorageFactory(factory)` selects the storage factory used for
the context event store and repository state storage; and `build()` returns a
`BoundedContext` that owns mutable `CommandBus` and `EventBus` instances
internally while exposing post-only `CommandEndpoint` and `EventEndpoint` values
through `commandBus()` and `eventBus()`. The shell validates
non-empty/non-blank names and records tenant mode. `builder.add(repository)` /
`builder.remove(repository)` maintain
the context-owned repository registration list, and `build()` registers those
repositories with the built context after opening state record storage through
the context `StorageFactory`. Repositories with authentic explicit handler
metadata now calculate deferred command/event routes, and built contexts install
internal repository dispatcher adapters. This slice does not create default
repositories from entity classes, invoke handlers, store entity records, manage
inboxes/delivery, run cache catch-up, create system contexts, expose stands,
write tenant indexes, expose gRPC services, or integrate transports.
Server exports also include the abstract `Entity` shell, `TransactionalEntity`,
`Aggregate`, `Projection`, `ProcessManager`, `EntityFamily`,
`TransactionalEntityScopeError`, `TransactionalEntityScopeErrorReason`,
`TransactionalEntityScopeOperation`, `EntityOptions`, `EntityVersionMetadata`,
`PlainEntityVersionMetadata`, and `EntityLifecycleFlags` for local OOP entity
state with identity, descriptor-derived metadata, cloned Protobuf-ES state
snapshots, caller-owned plain version metadata, lifecycle flags, and
active/archive/delete accessors.
`PlainEntityVersionMetadata<T>` is the compile-time plain-shape helper used by
entity inputs so ordinary metadata interfaces can be accepted while non-plain
types such as `Date` are rejected. The shell has protected hooks for future
framework-owned subclasses, but no public state setters, Java builders,
transaction execution, repository/storage writes, handler invocation, dispatch,
lifecycle events, automatic version increments, routing, query APIs, buses,
transports, or global runtime state.
`TransactionalEntity` adds only protected, scoped draft helpers over
`EntityTransaction`: one active transaction can read/update draft state, replace
draft version metadata, update draft lifecycle flags, commit accepted results
back into the entity, or roll back without applying state. Accepted commits
close the scope and update state/version/lifecycle; rejected commits keep the
scope active for correction or explicit rollback and apply nothing. The
`changed` signal reports accepted state changes or committed lifecycle flag
changes, not repository storage policy.
`Aggregate`, `Projection`, and `ProcessManager` are thin abstract family marker
classes over `TransactionalEntity` with the same `<Id, Schema, Version>` generic
shape and a stable readonly `entityFamily` property typed by `EntityFamily`.
They do not add public transaction mutators, repositories, dispatch, aggregate
event history, snapshots, subscriptions, command posting, query clients,
process workflow execution, handler invocation, storage, buses, or lifecycle
events.
`Repository`, `RepositoryOptions`, `RepositoryEntityType`,
`ConcreteRepositoryEntityType`, `RepositoryStateSchema`,
`RepositoryIdentitySnapshot`, `RepositoryIdentityError`,
`RepositoryIdentityErrorCode`, `RepositoryCommandRoute`,
`RepositoryEventRoute`, `RepositoryRouteInvocation`, and `RepositoryView` form
the repository
identity and context-owned registration seam. A repository records one
entity constructor, the inferred aggregate/projection/process-manager family,
the matching descriptor-backed state schema, descriptor metadata, state full
type name, and ID-field metadata. Snapshots are frozen fresh-copy values for
bounded-context duplicate/conflict checks. The seam rejects unsupported
constructors and entity-family/state-kind mismatches with simple
`RepositoryIdentityError` code/message diagnostics. Bounded-context assembly
rejects duplicate repository identities in one context build, spoofed structural
repository objects, and multi-context registration with ordinary registration
errors. Family inference trusts same-realm class constructor and instance
prototype metadata, so alias imports, member expressions, intermediate domain
base classes, and explicitly reparented ES classes with matching same-realm
prototype chains are treated as metadata. It opens state record storage only
through `BoundedContextBuilder.build()`; direct repository registration is not
public API. When explicit handler metadata is supplied, repository routing
calculates deferred command and event routes by generated message full type name,
readiness metadata, producer ID, or first-field ID. Bounded-context assembly
registers repository dispatcher adapters internally so buses can enqueue against
repository-owned routes without exposing registration internals. The repository
surface does not create/find/store entities, invoke handlers, write inboxes,
manage caches, run catch-up, expose stands, or start buses/transports.
`AggregateStorage`, `AggregateStorageOptions`, `AggregateSnapshot`,
`AggregateHistory`, and `AggregateId` form the minimal aggregate persistence
seam. It writes latest snapshots through `StorageFactory`/`RecordStorage`,
appends events through the storage event store, and reads aggregate history as
an optional snapshot plus events after the snapshot version. It validates
primitive aggregate IDs, route consistency, and aggregate version order before
storage. It does not implement handler invocation, delivery, catch-up,
read-side indexing, subscriptions, system events, or aggregate repository
caching.
Delivery exports include `Delivery`, `DeliveryOptions`, `DeliveryStrategy`,
`LocalDeliveryStrategy`, `Inbox`, `InboxId`, `InboxMessage`,
`InboxMessageId`, `InboxMessageInput`, `InboxReadOptions`,
`InboxWriteResult`, `InboxStorage`, `InboxStorageOptions`,
`DeliveryLabel`, `DeliveryStatus`, `ShardIndex`, `ShardSession`,
and `ShardedWorkRegistry`. This slice persists inbox messages and shard lease
records through `StorageFactory` / `RecordStorage`, deduplicates live inbox
writes by `(signalId, inboxId)` instead of record ID, keeps shard ordering
metadata on each message, and exposes a small storage-backed shard pickup /
release seam. It does not run conveyor stations, invoke repositories, manage
retry monitors, host gRPC services, or implement read-side catch-up loops.
Server metadata exports
include `describeEntityMetadata()`, `isEntitySchema()`,
`DescriptorMetadataError`, normalized entity kind/visibility types, first-field
routing hints, field metadata, and the descriptor-derived `EntityMetadata`
contract for handler registration, transaction validation, and later repository
assembly. Column metadata is exposed only for projection/process-manager
schemas, matching the underlying Spine option contract. Server transition
validation exports include `validateEntityStateTransition()`,
`EntityStateTransitionValidationRequest`, and
`EntityStateTransitionValidationResult` for built-in `(set_once)` checks derived
from descriptor metadata and shaped through the core transition validation
facade. Repeated, map-valued, and explicit optional `(set_once)` fields are
unsupported in this slice and fail closed with field-specific validation
violations. The transaction kernel exports `EntityTransaction`,
`createEntityTransaction()`, typed draft/commit/rollback result contracts,
version metadata contracts, lifecycle flags, status/updater/helper operation
types, `EntityTransactionStateError`, and
`EntityTransactionDraftStateError`. This public surface is an in-memory,
framework-owned draft/result boundary over one entity state. It is intentionally
not a storage-backed transaction API, repository unit of work, async-local
transaction context, dispatch phase, or lifecycle-event emitter. Lifecycle
helpers mutate only buffered draft flags, `updateVersionMetadata()` replaces
only caller-owned draft version metadata, and `requireActive()` rejects closed
transactions or active drafts already marked archived/deleted without including
state payloads. `commit()` validates the buffered draft and closes the
transaction only for accepted commits; rejected commits return violations and
leave the transaction active. `rollback()` closes the transaction and returns
the discarded draft evidence.
Server handler metadata exports include
`defineEntityHandlers()`, `HandlerRegistrationBuilder`, the five handler
metadata roles for command assignment, command reaction, event subscription,
event reaction, and event application, and `HandlerMetadataError` for
registration-time structural failures. Handler names must refer to own prototype
data methods declared with normal class method syntax. Decorator adapter exports
include `@Assign`, `@Command`, `@Subscribe`, `@React`, `@Apply`,
`materializeDecoratedEntityHandlers()`, `HandlerMethodDecorator`, and
`HandlerMethodValue`. Decorators require explicit Protobuf-ES schema arguments
and record standard per-class metadata that materializes into the same
`EntityHandlersMetadata` contract as explicit registration. The server registry
exports include `HandlerMetadataRegistry`,
`HandlerMetadataRegistryLookup`, `RegisteredHandlerMetadata`, and
`HandlerMetadataRegistryError` for caller-owned lookup-only registration and
duplicate-policy validation. These APIs are metadata-only and do not execute
handlers, access storage, dispatch buses, or start transport.
Command registration readiness exports include
`CommandRegistrationReadiness`, `CommandRegistrationReadinessLookup`, and
`CommandRegistrationAssigneeMetadata`. The readiness view is built from an
existing `HandlerMetadataRegistryLookup` or from `EntityHandlersMetadata`
values by first constructing a `HandlerMetadataRegistry`, so duplicate command
assignment enforcement remains the registry's policy. It reports deterministic
registered command message full type names and frozen copy-safe metadata for
the unique command assignee. It is not a command bus, command service,
dispatcher, router, command posting API, validator, repository runtime
registration hook, storage writer, transport adapter, handler invoker, or
Spine `Ack` producer.
Event registration readiness exports include `EventRegistrationReadiness`,
`EventRegistrationReadinessLookup`,
`EventRegistrationSubscriberMetadata`, `EventRegistrationReactorMetadata`, and
`EventRegistrationApplicationMetadata`. The readiness view is built from an
existing `HandlerMetadataRegistryLookup` or from `EntityHandlersMetadata`
values by first constructing a `HandlerMetadataRegistry`, so duplicate event
application enforcement remains the registry's per-entity-state/per-event
policy. It reports deterministic registered event message full type names and
frozen copy-safe metadata for event subscribers, event reactors, and event
applications grouped by event type. Subscriber and reactor lookups preserve
Spine fan-out semantics and do not reject multiple receivers for the same event
type. Domestic/external event classification and integration-broker
wanted-event publication are deferred because the current TypeScript handler
metadata has no external-event marker. It is not an event bus, integration
broker, import bus, event store, delivery mechanism, stand, subscription
service, command-result subscription, dispatcher, router, event posting API,
validator, repository dispatcher, storage writer, transport adapter, handler
invoker, or Spine `Ack` producer.
Bus exports include `CommandBus`, `CommandDispatcher`, `EventBus`, and
`EventDispatcher`. `CommandBus` accepts generated Spine `Command` envelopes,
queues accepted work asynchronously, and routes by enclosed message type URL to
exactly one registered dispatcher, rejecting duplicate dispatcher registration
for a command message type. `EventBus` accepts generated Spine `Event`
envelopes and uses `EventStore.acceptThenAppend()` to precheck event identity,
run matching dispatcher `accept()` hooks, and append with one captured storage
context. It then calls `dispatch()` in deterministic registration order. Events
with no registered dispatcher are stored and resolve. If the identity precheck
or dispatcher acceptance fails, the event is not stored by the bus. If append
fails, no `dispatch()` method runs, but dispatcher `accept()` hooks may already
have run. If dispatch rejects, earlier dispatchers may already have run, later
dispatchers are skipped, and the stored event remains. The bus layer does not
instantiate entities, invoke entity methods directly, create repositories, map
`Ack`, or introduce delivery/inbox behavior.
Runtime routing exports include `createServerRuntimeRoutingPlan()`,
`ServerRuntimeRoutingPlan`, `ServerRuntimeRoutingPlanInput`,
`CommandRuntimeRoutingPlan`, `EventRuntimeRoutingPlan`, and
`DeferredServerRuntimeRoutingSeam`. The planner requires a built
`BoundedContext`, plus optional concrete `CommandRegistrationReadiness` /
`EventRegistrationReadiness` instances, and derives immutable
`@spine-ts/transport` topics, subscriptions, and planner-local worker IDs plus
small sanitized route descriptors. Command routing produces one planner-local
command-worker competing-consumer subscription over registered command topics.
Event routing produces fan-out subscriptions and event-worker IDs
for subscriber, reactor, and application receiver groups while keeping handler
invocation from runtime workers, integrated runtime wiring, service hosting,
IPC endpoint naming, and process supervision deferred. Public route descriptors
expose only planner-local route and worker IDs, message full type names/type
URLs, stable receiver groups, and transport correlation keys back to the
top-level topics/subscriptions;
they do not retain raw readiness metadata, entity names, handler method names,
ZeroMQ endpoint data, socket topology, or duplicate full transport contracts on
each route. Query, subscription, and system routing remain explicit deferred
seams until concrete server readiness metadata exists.
Server runtime exports include `SingleProcessServerRuntime`,
`ServerRuntimeLifecycle`, `ServerRuntimeState`, `ServerRuntimeWork`,
`ServerRuntimeStateOperation`, `ServerRuntimeRejectedState`,
`RuntimeStateErrorCode`, and `ServerRuntimeStateError` for the first
single-process lifecycle and async queue kernel. The lifecycle state machine is
deterministic: `created -> running` on
`start()`, `created -> closed` when closed before start, and
`running -> closing -> closed` when close drains already accepted work.
`ServerRuntimeStateError.code` is stable taxonomy
`"INVALID_RUNTIME_STATE"`; the rejected runtime condition is exposed separately
as `state`. `close()` is idempotent, prevents new intake, and waits for
previously accepted work to settle. `enqueue()` accepts work only while the
runtime is running, returns that item's completion promise, and runs accepted
work in a later microtask in FIFO order. Enqueued callbacks are trusted
server-owned work only. The queue has no timeout, cancellation, fairness, queue
bound, or hostile-callback protection, so non-settling work can keep `close()`
pending. Same-runtime reentrant `enqueue()` and `close()` calls from active work
are rejected with `state: "running-work"` to avoid queue self-deadlocks. This
surface is a server-runtime kernel only; it is not a process-wide singleton,
process supervisor, generic job framework, command/event/import bus, durable
storage or inbox, read-side stand, repository dispatcher, integration broker,
gRPC server, ZeroMQ transport, or worker-process runtime.
The public runtime closure smoke path composes these exports with
`BoundedContext`, `Repository`, `HandlerMetadataRegistry`,
`CommandRegistrationReadiness`, `EventRegistrationReadiness`, and
`createServerRuntimeRoutingPlan()` to prove the metadata and lifecycle
interfaces fit together without adding new public API. That composition
produces context-scoped metadata, command/event readiness views, immutable
runtime-routing plans, and deterministic lifecycle state only. It deliberately
does not expose a `Server` export, service routing, command/event/import bus
behavior, handler invocation, read-side execution, transport lifecycle,
validation, delivery, integration-broker behavior, or Spine `Ack` mapping.
Write-side signal intake exports include `SignalKind`, `SignalIntakeResult`,
`SignalIntakeAccepted`, `SignalIntakeAcceptedFor`, `SignalIntakeFailure`,
`SignalIntakeFailureCode`, `SignalIntakeFailureDetails`,
`SignalIntakeFailureDiagnostics`, `acceptSignalIntake()`, and
`failSignalIntake()`. These immutable result values distinguish command/event
signals accepted for later asynchronous runtime work from immediate intake
failures. Accepted results do not enqueue work, store, dispatch, deliver,
handle, or acknowledge a signal. Failure results carry stable failure codes
(`"RUNTIME_NOT_ACCEPTING"`, `"MALFORMED_ENVELOPE"`, and
`"UNSUPPORTED_SIGNAL_KIND"`) plus frozen scalar diagnostic metadata. Diagnostics
copy only allowlisted own enumerable data properties with string, number,
boolean, or `null` values; unknown keys, accessor properties, and payload-shaped
metadata are discarded so the seam can be used without leaking full signal
data. The surface is not Spine `Ack`, a command bus, event bus, import bus,
filter chain, storage write, dispatcher, delivery mechanism, tenant/message
validator, service, transport, or handler invocation.

Storage exports include `Storage`, `StorageContext`, `StorageFactory`,
`RecordStorage`, `RecordSpec`, `RecordColumn`, `RecordQuery`, `RecordFilter`,
`RecordOrder`, `RecordReadOptions`, `RecordMask`, `InMemoryStorageFactory`,
`InMemoryRecordStorage`, `EventStore`, and `OnEventAccepted`. `StorageFactory`
owns one mandatory adapter seam, `createRecordStorage(context, spec)`.
`RecordStorage` persists identified Protobuf records with deterministic
ID/column/path queries, positive limits, and simple field masks over cloned
results. The in-memory adapter is process-local, tenant-aware through
`StorageContext`, shared by factory, context name, tenant mode, tenant ID, and
`RecordSpec` instance, and non-durable. Storage adapters must make repeated
`createRecordStorage(context, spec)` calls observe the same logical records
while returning independently closeable storage handles. `EventStore` is a
framework delegate over `RecordStorage<EventId, Event>` and is storage-only in
this slice: it persists and reads generated Spine events, rejects missing,
blank, or duplicate event IDs on the local append path, and can run
`OnEventAccepted` between precheck and append with one captured storage context.
It does not dispatch events, manage delivery, or fan out to subscribers.

Transport exports include `TransportSignalKind`, `TransportSemanticTag`,
`TransportTopicInput`, `TransportTopic`, `TransportRoutingDescriptor`,
`TransportSubscriptionInput`, `TransportSubscription`, `TransportSubscriptionMode`,
`PublishTransportOperation`, `RequestTransportOperation`,
`PublishTransportHandler`, `RequestTransportHandler`, `AsyncCloseable`,
`TransportSubscriptionHandle`, `SignalTransport`, `createTransportTopic()`, and
`createTransportSubscription()`. This surface is contract-only: it defines
immutable topic/subscription value objects, deterministic adapter-agnostic
routing keys, handler callback signatures, and graceful async close behavior.
It does not expose ZeroMQ socket types, endpoint strings, multipart frames,
production endpoint topology, broker processes, child process supervision,
participant lifecycle values, worker registrations, delivery attempt/result
values, retry policy, durable storage, runtime handler invocation, or server
runtime wiring.
The transport package pins `zeromq@6.5.0` for local IPC adapter work, but that
native dependency remains outside the public TypeDoc entry point.
Adapter-private wiring validates local IPC configuration and native module
typing, and package-private smoke tests prove same-host publish/subscribe and
request/reply IPC over temporary endpoints. Socket creation, endpoint strings,
multipart frames, and native binding types remain absent from the public API;
production endpoint layout, frame protocols, broker topology, process
supervision, worker registration handshakes, delivery retries, and server
runtime wiring remain deferred. Managed sandboxes may reject ZeroMQ `ipc://`
binds with `EPERM`, so live local IPC smoke tests can require native IPC
filesystem/socket permissions outside the sandbox.

The generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON, verifies that expected
`@spine-ts/proto`, `@spine-ts/core`, `@spine-ts/server`,
`@spine-ts/storage`, and `@spine-ts/transport` entry-point exports are present
in the API model, checks
`@spine-ts/server` and `@spine-ts/storage` root exports against source
allowlists, and rejects broad generated wildcard re-exports from the proto
package root.
