# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts, the `@spine-ts/core` metadata/type
registry and validation facade APIs, the first `@spine-ts/server`
descriptor-derived entity metadata, metadata-only `Repository` identity,
set-once transition validation, explicit handler metadata APIs, and the first
server runtime lifecycle/async queue kernel with a bounded-context runtime
handle, write-side signal intake result exports, the first
`@spine-ts/transport` contracts, and the first `@spine-ts/storage` contracts.

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
`BuiltBoundedContextSnapshot`, immutable snapshot contracts,
`BoundedContextRuntime`, `BoundedContextRuntimeOptions`,
`BoundedContextNameError`, and
`BoundedContextRepositoryRegistrationError` for the first bounded-context
assembly shell.
The public entry points mirror Spine JVM's
`BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)`.
`ContextSpec` remains a framework-owned immutable value surfaced through
`builder.spec` and `context.spec`; `build()` currently returns a frozen
metadata-only `BoundedContext`; `.snapshot` returns a copy-safe immutable
snapshot; and `builder.add(repository)` / `builder.remove(repository)` record
explicit metadata-only `Repository` identities for later runtime slices. The
builder keeps repeated registration of the same repository identity idempotent
and rejects conflicting ownership when one entity constructor receives multiple
state schema identities or one state type is claimed by multiple constructors.
The shell validates non-empty/non-blank names and records tenant mode plus
repository ownership metadata for later runtime parts without creating default
repositories from entity classes, registering repositories at runtime, invoking
handlers, creating system contexts, opening storage, constructing buses/stands,
writing tenant indexes, exposing gRPC services, or integrating transports.
`BoundedContextRuntime` is the runtime-facing handle for one already built
context. It owns a private `SingleProcessServerRuntime` by default or accepts an
injected `ServerRuntimeLifecycle`; injected lifecycle sharing remains caller
owned. The handle delegates `state`, `start()`, and `close()`, and exposes
fresh immutable copies for the context name, spec, repository identity
snapshots, and `contextSnapshot`. It does not expose `enqueue()` for injected or
default runtimes and is not a JVM `Server` equivalent, command/event/import bus,
repository dispatcher, stand, event store, tenant index, integration broker,
system context, gRPC/ZeroMQ transport, service host, delivery inbox, or handler
invocation mechanism.
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
`RepositoryIdentityErrorCode`, and `RepositoryIdentityErrorDetails` form the
metadata-only repository identity seam. A repository identity records one
entity constructor, the inferred aggregate/projection/process-manager family,
the matching descriptor-backed state schema, descriptor metadata, state full
type name, and ID-field metadata. Snapshots are frozen fresh-copy values for
later bounded-context duplicate/conflict checks. The seam rejects unsupported
constructors and entity-family/state-kind mismatches with structured
`RepositoryIdentityError` details. Family inference trusts same-realm class
constructor and instance prototype metadata, so alias imports, member
expressions, intermediate domain base classes, and explicitly reparented ES
classes with matching same-realm prototype chains are treated as metadata. It
does not create/find/store entities, open storage, register contexts, route or
dispatch messages, write inboxes, invoke handlers, manage caches, run catch-up,
expose stands, or start buses/transports.
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
validator, repository runtime registration hook, storage writer, transport
adapter, handler invoker, or Spine `Ack` producer.
Server runtime exports include `SingleProcessServerRuntime`,
`ServerRuntimeLifecycle`, `ServerRuntimeState`, `ServerRuntimeWork`,
`ServerRuntimeStateOperation`, `ServerRuntimeStateErrorCode`, and
`ServerRuntimeStateError` for the first single-process lifecycle and async queue
kernel, plus `BoundedContextRuntime` for context-scoped lifecycle delegation
over a built bounded-context snapshot. The lifecycle state machine is
deterministic: `created -> running` on
`start()`, `created -> closed` when closed before start, and
`running -> closing -> closed` when close drains already accepted work.
`ServerRuntimeStateError.code` is stable taxonomy
`"INVALID_RUNTIME_STATE"`; the rejected lifecycle state is exposed separately as
`state`. `close()` is idempotent, prevents new intake, and waits for previously
accepted work to settle. `enqueue()` accepts work only while the runtime is
running, returns that item's completion promise, and runs accepted work in a
later microtask in FIFO order. Enqueued callbacks are trusted server-owned work
only. The queue has no timeout, cancellation, fairness, queue bound, or
hostile-callback protection, so non-settling or reentrant work can keep
`close()` pending. `BoundedContextRuntime` does not expose queue intake; it only
delegates lifecycle and exposes copied context metadata. This surface is a
server-runtime kernel only; it is not a
process-wide singleton, process supervisor, generic job framework,
command/event/import bus, durable storage or inbox, read-side stand, repository
dispatcher, integration broker, gRPC server, ZeroMQ transport, or worker-process
runtime.
The public runtime closure smoke path composes these exports with
`BoundedContext`, `Repository`, `HandlerMetadataRegistry`,
`CommandRegistrationReadiness`, and `EventRegistrationReadiness` to prove the
metadata and lifecycle interfaces fit together without adding new public API.
That composition produces context-scoped metadata, command/event readiness
views, and deterministic lifecycle state only. It deliberately does not expose a
`Server` export, service routing, command/event/import bus behavior,
repository runtime registration, storage lifecycle, read-side execution,
transport lifecycle, validation, delivery, integration-broker behavior, handler
invocation, or Spine `Ack` mapping.
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

Storage exports include `StorageAdapter`, `StorageRecord`,
`WriteSideRecordStore`, `ReadSideRecordStore`, aggregate event history
contracts, tenant/diagnostic stores, `StorageVersionConflictError`,
`StoragePayloadCloneError`, `InMemoryStorageAdapter`, and
`createInMemoryStorageAdapter()`. These APIs document optimistic version
checks, safe structured-clone failure reporting, write-side/read-side
segregation, deterministic in-memory behavior, and non-durability.

Transport exports include `TransportSignalKind`, `TransportSemanticTag`,
`TransportTopicInput`, `TransportTopic`, `TransportRoutingDescriptor`,
`TransportSubscriptionInput`, `TransportSubscription`, `TransportSubscriptionMode`,
`PublishTransportOperation`, `RequestTransportOperation`,
`PublishTransportHandler`, `RequestTransportHandler`, `AsyncCloseable`,
`TransportSubscriptionHandle`, `SignalTransport`, `TransportParticipantKind`,
`TransportWorkerRole`, `TransportLifecycleState`, `TransportReadinessState`,
`TransportParticipantIdentityInput`, `TransportParticipantIdentity`,
`BrokerTransportParticipantInput`, `TransportWorkerParticipantInput`,
`TransportWorkerRegistrationInput`, `TransportWorkerRegistration`,
`TransportLifecycleSnapshotInput`, `TransportLifecycleSnapshot`,
`TransportLifecycleParticipant`, `createTransportTopic()`,
`createTransportSubscription()`, `createBrokerTransportParticipant()`,
`createTransportWorkerParticipant()`, `createTransportParticipantIdentity()`,
`createTransportWorkerRegistration()`, and
`createTransportLifecycleSnapshot()`. This surface is contract-only: it defines
immutable topic/subscription value objects, deterministic adapter-agnostic
routing keys, stable broker/worker lifecycle identities, subscription-backed
worker registrations, readiness/lifecycle snapshots, handler callback
signatures, and graceful async close behavior. It does not expose ZeroMQ
socket types, endpoint strings, multipart frames, broker processes, child
process supervision, delivery retries, durable storage, runtime handler
invocation, or server runtime wiring.
The transport package pins `zeromq@6.5.0` for later local IPC adapter work, but
that native dependency remains outside the public TypeDoc entry point.
Adapter-private wiring validates local IPC configuration and native module
typing, and package-private smoke tests prove same-host publish/subscribe and
request/reply IPC over temporary endpoints. Socket creation, endpoint strings,
multipart frames, and native binding types remain absent from the public API;
production endpoint layout, frame protocols, broker/worker lifecycle, delivery
retries, and server runtime wiring remain deferred. Managed sandboxes may
reject ZeroMQ `ipc://` binds with `EPERM`, so live local IPC smoke tests can
require native IPC filesystem/socket permissions outside the sandbox.

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
`@spine-ts/transport`, and `@spine-ts/storage` entry-point exports are present
in the API model, and rejects broad generated wildcard re-exports from the
proto package root.
