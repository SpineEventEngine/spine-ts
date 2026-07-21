# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts, the `@spine-ts/core` metadata/type
registry and validation facade APIs, the first `@spine-ts/server`
descriptor-derived entity metadata, context-owned `Repository` registration,
set-once transition validation, explicit handler metadata APIs, the first
command/event bus exports, the first server runtime lifecycle/async queue
kernel, write-side signal intake result exports, the runtime-routing planner
seam, the real Connect/Node `SpineServices` route registrar for the raw Spine
command/query/subscription services with durable inactive subscription recovery
over the same storage factory, a small local `Server` lifecycle owner for real
Connect/gRPC-compatible services, the first `@spine-ts/transport`
contracts, the first `@spine-ts/storage` contracts, and the minimal
`@spine-ts/testing` bounded-context fixture, optional Datastore storage, and
the MySQL-first RDBMS storage factory/errors/options.

Proto exports include message types, generated schemas, enum values and enum
descriptors, file descriptors, and the `type_url_prefix` custom option for the
validation, core signal envelope, actor/tenant/user/version context, time, net,
and UI language contracts.

Core exports include deterministic type URL derivation, registry and metadata
types, the default registry for the curated Spine schema set, single-message
validation result/check helpers, `ValidationException`, structured
`ValidationError` creation, the initial transition-validation seam,
`RejectionThrowable`, `createRejectionThrowable()`, and
`isRejectionThrowable()`. Generated rejection companions create validated
throwables through this factory contract. Repository command execution now
recognizes them only through the guard after rollback and schedules a regular
rejection event for independent EventBus posting. Build-time analysis
accepts descriptor-verified top-level rejection inputs for event-consuming
handlers while excluding assignment inputs and normal emitted values. Service
posting returns an OK acceptance `Ack` for handled domain rejections and
independently schedules the typed event through EventBus. A successful post can
be received by an active `SubscriptionService` stream with queue capacity;
inactive, saturated, or closed streams may not observe it. Client event updates
retain the typed rejection and ordinary event metadata but redact
rejected-command payload forms and throwable stack from
`EventContext.rejection`. A failed post is
recorded in `storedEventDispatchFailures()`, is not reflected in the client
`Ack`, and has no promised retry.
Core envelope construction exports include
`packAny()`, `unpackAny()`,
`packCommand()`, `packEvent()`, `PackAnyOptions`, `PackCommandInput`, and
`PackEventInput`.

Server exports include `BoundedContext`, `BoundedContextBuilder`,
`ContextSpec`, `BoundedContextName`, `TenantMode`, `BoundedContextSnapshot`,
small immutable snapshot contracts, `CommandEndpoint`, `EventEndpoint`,
`ReadCatchUpOptions`, `ReadCatchUpResult`, `StoredEventDispatchFailure`,
`DispatchErrorSnapshot`, `Stand`, direct stand
read/version/list/update/subscription/clear contracts, and
`BoundedContextNameError` for bounded-context assembly. `CommandEndpoint`
also exposes accepted command message type URLs so service adapters can route
without dispatch-probing unrelated contexts.
Generated rejection companions are the public domain-rule failure contract.
When a repository handler throws one, rollback completes before an independent
typed rejection event is scheduled, command dispatch resolves, and
`CommandService.Post` returns an OK acceptance `Ack`. A successful follow-up
post stores the event through EventBus; an active `SubscriptionService` stream
with queue capacity may receive it, while inactivity, saturation, or closure
may prevent observation. Post failure is recorded in
`storedEventDispatchFailures()`, is not visible to the command client, and is
not currently retried. OK does not mean a state transition or rejection-event
delivery succeeded. `CommandService.Post` still returns
`COMMAND_VALIDATION_ERROR` with message `Command payload validation failed.` and
packed `spine.validation.ValidationError` details when `CommandBus` rejects an
invalid accepted command payload before dispatcher callbacks,
including custom `addCommandDispatcher()` routes. For repository-backed
aggregate dispatchers, validation still happens before route calculation,
latest persisted state load, traceability event-journal append, latest-state
write, or stored-event dispatch. Transition validation failures from the
framework-owned aggregate command transaction continue to surface as
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with packed `ValidationError`
details. Legacy/internal aggregate-history validation failures remain internal
and are sanitized as `COMMAND_POST_ERROR`; ordinary generated-registry
aggregate loading uses the latest persisted state rather than replaying stored
events. Dispatcher-thrown `ValidationException` values and other unexpected
command-bus failures remain sanitized as `COMMAND_POST_ERROR`.
The public entry points mirror Spine JVM's
`BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)`.
`ContextSpec` remains a framework-owned immutable value surfaced through
`builder.spec` and `context.spec`; the builder collects command and event
dispatchers; `withStorageFactory(factory)` selects the storage factory used for
the context event store, repository state storage, and direct read-side stand;
and `build()` returns a
`BoundedContext` that owns mutable `CommandBus` and `EventBus` instances
internally while exposing a post-only `CommandEndpoint` and an event
listing/posting `EventEndpoint` through `commandBus()` and `eventBus()`, plus a
context-owned direct `Stand`
through `stand()`. The shell validates
non-empty/non-blank names outside the reserved `__spine/` framework namespace
and records tenant mode. `builder.add(repository)` /
`builder.remove(repository)` maintain
the context-owned repository registration list, and `build()` registers those
repositories with the built context after opening state record storage through
the context `StorageFactory`; registered repositories also make their entity
state schemas known to the context `Stand`. Built contexts also create the
first internal system-pairing metadata and a framework-owned tenant index:
single-tenant contexts use a constant index, and multitenant contexts persist
tenant IDs through the configured storage factory. These internals are not part
of the end-user `BoundedContext` API. The full system-context runtime,
command-log repositories, system event taxonomy, tracing/monitors/debug UI, and
broader JVM production runtime remain outside the current public surface.
Repositories with authentic
explicit handler metadata still expose route-only `routeCommand()` /
`routeEvent()` calculations, and built contexts install internal repository
dispatcher adapters that execute aggregate command assignees in framework-owned
transactions and execute projection subscribers. Aggregate command execution
requires `command.id` so produced events can carry a contract-valid command
origin; missing IDs reject before
mutation or storage. Aggregate command completion resolves after traceability
event-journal append and latest persisted state write; later already-stored
event redispatch failures are observable through the copy-safe
`storedEventDispatchFailures()` diagnostic snapshot on the owning
`BoundedContext`. Generated entity-class assembly creates default repositories
through `add(EntityClass).withGeneratedRegistryRoot(root).buildAsync()`. This
slice does not invoke query handlers, run durable delivery catch-up, expose a
broad server lifecycle, or integrate transports. The supported durable inbox
handoffs are framework-owned process-manager command replay, live
process-manager event replay, and live projection subscriber replay. The current
local runtime writes the inbox row, drains the local shard immediately, requires
tenant-safe replay in multitenant contexts, and resolves only after that
received row is marked delivered. Process-manager event rows use
`REACT_UPON_EVENT`, projection subscriber rows use `UPDATE_SUBSCRIBER`, both
store the original `Event` envelope, and both replay only the routed row target
before the transaction and `Stand` update. Before handler code runs, replay
validates the row label, pending `TO_DELIVER` status, tenant, payload/schema,
target type URL, and routed target ID.
For supported rows, an internal pre-callback gate reads the 100 retained
attempt slots for the exact inbox message. At that bound it skips the callback
and another attempt, claims the exact row under the live shard fence, and marks
it `DELIVERED` without accepted-work or failure-budget use. A lease/fencing
failure through the final guard before durable marking remains
`LEASE` / `LEASE_INACTIVE`, retains one bounded attempt at the 100-slot cap,
reports one failure with no accepted work, and leaves the row `TO_DELIVER`. If
the mark fails and cleanup succeeds, the authoritative row remains `TO_DELIVER`
and the local run returns one frozen, bounded, stack-free exhaustion-facts
object. If cleanup also fails, the same one-failure accounting instead returns
a `CLEANUP` result whose `AggregateError` contains the original mark error plus
the cleanup error; that error is not promised frozen, bounded, or stack-free. It
is not a public
monitor/action, scheduler/backoff, dead-letter, production-topology, catch-up,
or adapter policy. Broader inbox lifecycle management and transport topology
are outside the initial release; no future policy is committed.
Process-manager
repositories with authentic generated metadata do execute through the local
command/event buses: default command routing reads the first command field,
process-manager event routing reads the first event message field, state is
loaded/created and stored through `Stand`, and returned domain commands/events
are wrapped only after the current transaction and state write succeed.
`BoundedContext.catchUpReadSide(options?)` is the current framework-owned
read-side catch-up boundary. It clears registered projection rows through
`Stand.clear()`, reads only already-stored events, and replays each event only
to registered projection subscribers whose dispatcher declares that event
message schema/type URL. It never re-appends events. Single-tenant contexts
reject `tenantId`; multitenant contexts require the exact non-blank `tenantId`.
The helper runs sequentially inside one local process and does not implement
delivery jobs, schedulers, inbox lifecycle, retries, or transport topology.
Server exports also include the abstract `Entity` shell, `TransactionalEntity`,
`Aggregate`, `Projection`, `ProcessManager`, `EntityFamily`,
`TransactionalEntityScopeError`, `EntityScopeReason`,
`TransactionalEntityScopeOperation`, `EntityOptions`, `EntityVersionMetadata`,
`PlainEntityVersionMetadata`, and `EntityLifecycleFlags` for local OOP entity
state with identity, descriptor-derived metadata, cloned Protobuf-ES state
snapshots, caller-owned plain version metadata, lifecycle flags, and
active/archive/delete accessors.
`PlainEntityVersionMetadata<T>` is the compile-time plain-shape helper used by
entity inputs so ordinary metadata interfaces can be accepted while non-plain
types such as `Date` are rejected. The shell has protected hooks used by
framework-owned subclasses and repository/runtime seams, but no public state
setters, Java builders, transaction execution, repository/storage writes,
handler invocation, dispatch, lifecycle events, automatic version increments,
routing, query APIs, buses, transports, or global runtime state.
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
storage, buses, or lifecycle events.
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
calculates command and event routes by generated message full type name,
readiness metadata, producer ID, or first-field ID. Built bounded contexts
register repository dispatcher adapters internally so aggregate commands can
load or create one aggregate, invoke one assignee in a framework-owned
transaction, pack and store returned domain events, persist the latest managed
state through `AggregateStorage`, and then queue already-stored events for
event-bus delivery without appending them again. Process-manager repositories
also participate in those adapters: command assignees are invoked from the
command bus through a durable process-manager inbox handoff. The current local
runtime drains that inbox immediately, requires tenant-safe replay in
multitenant contexts, and resolves only after the received inbox row is marked
delivered. Live projection subscribers use the same local handoff shape with
`UPDATE_SUBSCRIBER` rows, original event IDs as dedup signal IDs, and exact-row
target replay during the 30-second local retention window. Live
process-manager event reactors and event-commanding handlers use the same
durable inbox handoff with `REACT_UPON_EVENT` rows, original `Event`
envelopes, and exact-row target replay. Before handler code runs, replay
validates the row label, pending `TO_DELIVER` status, tenant, payload/schema,
target type URL, and routed target ID.
State is stored in tenant-scoped `Stand` records with numeric
versions, returned commands are wrapped and posted after state storage, and
returned event messages are wrapped with process-manager-emitted event schemas
and appended through the event store before follow-up dispatch. The repository
surface still does not expose direct entity lookup/storage APIs, inboxes,
caches, catch-up, or transport startup. Built bounded contexts use repository
metadata to register known state types with their direct read-side `Stand`.
`Stand`, `StandOptions`, `StandRegisterOptions`, `StandReadOptions`,
`StandReadResult`, `StandUpdateOptions`, `StandSubscribeOptions`,
`StandUpdate`, `StandSubscription`, and `StandStateTypeError` form the first
direct read-side entity-state API. A stand registers known generated state
schemas, rejects unknown state types on read/update/subscribe, stores latest
states through `StorageFactory`/`RecordStorage`, reads latest state by schema
and entity ID, can return caller-supplied version metadata through
`readVersioned()`, can return storage-backed query results through
`queryVersioned()`, can return storage-order list results through
`readAllVersioned()`, can clear one registered state type through
`clear(schema, options?)`, and delivers direct in-process update notifications.
Version metadata is process-local and in-memory only in the current `Stand`;
the latest state record is storage-backed, but the state-to-version metadata
map is not persisted.
Subscription cleanup is explicit via `unsubscribe()`, and multitenant stands
require a `tenantId` on point reads, list reads, updates, and subscriptions
while single-tenant stands reject tenant options.
`StandUpdate.previousState` is a copy-safe cloned snapshot of the stored state
before the update, omitted when no prior state existed, so subscribers may
retain or mutate it after delivery.
`SpineServices` adapts built-context command buses and stands to the first real
Connect/Node `CommandService`, `QueryService`, and `SubscriptionService`
routes. `QueryService.Read` supports ID-filter reads for any registered state
route and projection-state `Target.include_all = true` reads, packing
`EntityStateWithVersion` replies from
`Stand.queryVersioned()`. Projection queries also support top-level `EQUAL`
filters over declared projection `(column)` proto field names, field masks,
repeated ordering directives over declared proto column names, and positive
limits when ordering is present. Absent or zero wire limits use an implicit
1,000-row cap without requiring ordering; only a positive limit without
ordering returns `INVALID_QUERY`. Use proto column names such as
`open_task_count`, not generated TS local names such as `openTaskCount`.
Undeclared columns, unsupported operators, nested or `EITHER` composites, limits
with a positive value but without ordering, missing criteria, and `include_all = false` return
`INVALID_QUERY` before reading Stand storage.
`Subscribe` allocates opaque IDs, validates subscription criteria,
`Activate` attaches delivery, and `Cancel`/stream finalization release
in-process handles. Never-activated subscriptions have a configurable inactive
TTL: it defaults to 30 seconds; non-positive or non-finite values become 1;
positive finite values are floored; and an effective value above 2,147,483,647
milliseconds throws synchronously before storage or timer work. Active delivery
uses a configurable queue limit for slow consumers.
`Subscribe` accepts registered state targets and event targets exposed by
built-context event dispatchers. It rejects unknown/private targets, invalid
criteria, unsupported comparison operators, event filters, event field masks,
and unknown subscription field paths with `INVALID_ARGUMENT` before creating an
inactive record or attaching a listener. State `Target.include_all = true`
delivers every activated update. State `Target.filters` supports an optional ID filter plus
`ALL`/`EITHER` composite `EQUAL` field filters over generated entity state
fields, including nested message fields; missing ID filters match all IDs.
Filtered topics deliver matching new states and emit `no_longer_matching` when
the previous state matched but the new state does not. `Topic.field_mask` is
applied to delivered states, not to `no_longer_matching` updates. Event topics
support `include_all = true` in this runtime slice and stream wire-level
`event_updates` with cloned framework `Event` envelopes. Application handlers
continue to receive generated domain event messages; framework envelopes remain
service/runtime data. Client rejection updates redact rejected-command payload
forms and throwable stack; internal generated handlers retain full defensive
context. Activation is by opaque ID. Inactive records are stored
through the owning bounded context storage factory, so a new `SpineServices`
instance over the same storage factory can activate a previously returned ID.
Activation compare-and-sets the exact inactive row to a unique-owner claim and
retains that claim while the local stream is active. Single-tenant subscriptions reject tenant
options; multitenant subscriptions require `tenantId`; state and event
delivery are scoped to that tenant slice. Unknown, canceled, expired,
malformed, inconsistent, and already active IDs complete without updates.
Cancellation of a missing, unknown, already-canceled, or already-cleaned
subscription returns OK only after admission to the bounded unknown-removal
pool. Overflow returns `RESOURCE_EXHAUSTED` before storage access. An exact
inactive row or same-instance claim moves
through a cancel marker to absence; a foreign active claim returns `ABORTED`.
Cleanup is idempotent across cancellation, activation-stream finalization,
inactive expiry, and slow-consumer queue closure. Malformed durable rows remain
inert. `SpineServicesOptions.subscriptionLimit` defaults to 100 and must be a
positive safe integer; it bounds pending, inactive, active, and recovered
subscriptions owned by one `SpineServices` instance. Each instance has its own
bound, not a process-wide or distributed quota. Unknown-ID cancellation uses a
separate internal pool of the same size. Known-local cancellation retains its
normal subscription capacity until durable cancellation settles. If that
persistence fails, `Cancel` returns Connect `INTERNAL` with `Subscription
cancellation failed.`; retry `Cancel` with the same returned `Subscription`
message containing its ID. That retry contract does not apply to internal cleanup after an
initial failed `Subscribe`. If a normal inactive-expiry timer fires and durable
cleanup fails, its timer stays cleared, the local record and its capacity remain,
and no automatic retry or new timer is scheduled; `Cancel` with that same
returned `Subscription` message containing its ID can retry the durable cleanup and release the capacity. Defaults are 30 seconds for inactive expiry and 100
queued updates per active subscription. Active streams and queued updates remain
process-local and are not replayed after activation or restart. This is not a
client DSL, broad server lifecycle, projection catch-up loop, cross-process
stream ownership, or durable retained update queue. A crashed owner can leave a
stale claim because this contract has no lease, heartbeat, routing, supervision,
or automatic reclamation.
`Server`, `ServerOptions`, and `RunningServer` form the small public lifecycle
owner for hosting those routes over Node HTTP/2. `ServerEnvironment`,
`ServerEnvironmentLocalOptions`, and `ServerEnvironmentProductionOptions` select
storage, transport, optional delivery, optional tracing, and facility ownership
for server assembly without introducing a process-wide singleton. `Server`
accepts built contexts and `BoundedContextBuilder` values; builders added
through `Server` use the environment storage factory unless
`withStorageFactory()` already selected a more specific local factory.
`Server.atPort(port)` defaults to local-only `127.0.0.1`; broader hosts are
explicit through `ServerOptions`. When no environment is supplied, `Server`
creates and owns a local environment with in-memory storage and same-process
transport defaults. Supplied environments are caller-owned unless
`ownsEnvironment` is true. Production environment construction requires
`storageFactory` and `transport` and rejects missing facilities before a
listener is opened. `RunningServer` exposes `host`, `port`, `baseUrl`, and
idempotent `close()`. Close stops listener intake and active HTTP/2 sessions,
closes context transport intake and drains accepted work, then detaches and
quiesces environment delivery before closing contexts, explicit resources, and
the environment when the server owns it. Network or context-intake close
failure is a hard gate: delivery detach and dependency cleanup do not begin
until a later `close()` retry completes that phase. After the hard gate,
remaining phases are attempted in order; failures are combined, and a later
close retries only unfinished cleanup. The API deliberately hides ZeroMQ, IPC
endpoint names, worker/process supervision, durable scheduling, and Java-style
global environment configuration.
`@spine-ts/testing` exports `BoundedContextFixture`,
`BoundedContextFixtureOptions`, and `FixtureSubscription`. The fixture wraps one
built `BoundedContext`, captures the in-process `SpineServices` handlers, and
lets tests post generated `Command` envelopes, post generated `Event` envelopes,
read generated `Query` envelopes, poll query responses for asynchronous
projection consequences, and subscribe to generated `Topic` envelopes. It clones
protobuf messages at its boundary and keeps command, query, and subscription
behavior on the real framework paths. It does not expose a broad client DSL,
start a server/process, manage browser tooling, or simulate service outcomes.
`AggregateStorage`, `AggregateStorageOptions`, `AggregateSnapshot`,
`AggregateHistory`, `AggregateId`, `PrimitiveId`, and `MessageId` form the
low-level aggregate persistence seam. It writes latest persisted state through
`StorageFactory`/`RecordStorage`, appends events through the storage event store
as a traceability journal, and retains history reads for legacy/internal
compatibility. Ordinary generated-registry repository loading uses the latest
persisted state and does not rely on snapshot-plus-replay loading. It validates
finite primitive or single-field Protobuf message aggregate IDs, route
consistency, and aggregate version order before storage. It does not implement
handler invocation, delivery, catch-up, read-side indexing, subscriptions,
system events, or aggregate repository caching.
Durable-delivery exports include `DeliveryEndpointMessage`,
`DeliveryStorageCorruptionError`, `Inbox`, `InboxId`, `InboxMessage`,
`InboxMessageError`, `InboxMessageId`, `InboxMessageInput`,
`InboxReadContinuation`, `InboxReadOptions`, `InboxWriteResult`,
`InboxStorage`, `InboxStorageOptions`, `DeliveryLabel`, `DeliveryStatus`,
`ShardIndex`, `ShardSession`, `ShardedWorkRegistry`, and
`ShardedWorkRegistryOptions`. This slice persists inbox messages and shard
lease records through `StorageFactory` / `RecordStorage`, deduplicates live
inbox writes durably by `(signalId, inboxId)` through small internal guard
records, and keeps shard ordering metadata on each message with receive time
(`whenReceived`), `version`, and inbox-message UUID ordering. Direct inbox
writes require `InboxMessage.id.shard` to match
`InboxMessage.shard`. Recognized valid `DeliveryLabel` values for durable rows
are `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, `REACT_UPON_EVENT`, and `CATCH_UP`;
framework replay callbacks support only `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`,
and `REACT_UPON_EVENT`. `IMPORT_EVENT` is recognized only as deprecated legacy
stored/wire data and fails closed on read or framework replay.

Built contexts use storage-backed shard pickup, renewal, and release internally
through atomic `RecordStorage.compareAndSet()` fencing. Framework-owned replay
scans pending rows in inbox order, skips unavailable rows before endpoint
invocation, and supplies independent message snapshots only for
`HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`. `Date` values
and `Any.value` bytes are copied. Its callback limit caps endpoint callbacks
actually invoked. Newly observed rows stop at the storage read cap plus
`limit` while pending scans continue after stable inbox row keys instead of
moving absolute offsets.
Valid worker-unsupported labels such as `CATCH_UP` remain pending and are
skipped before callback invocation, acceptance, failure recording, or
failure-budget consumption. Malformed or deprecated stored `IMPORT_EVENT` data
fails closed as `DeliveryStorageCorruptionError` before replay begins.

Endpoint failures leave rows pending for a later framework run only when
cleanup succeeds. Pre-callback claim, validation, and lease-fencing failures do
not increment accepted work, but they increment failed work and count toward
the framework failure bound. Once an endpoint callback has been invoked,
endpoint failures and framework cleanup or delivery-status failures after that
callback are accepted work and may appear in failed work. Supported endpoint
failures are also retained internally as sanitized attempt records with
message/inbox/shard identity, label, node, attempted time, accepted flag, and
stable failure stage/reason. Retained records do not include raw `Any.value`
payload bytes, raw user errors, stack traces, or unbounded exception text.
Before a supported callback runs, the internal retained-attempt count for that
exact inbox message is checked against the same 100-slot bound. An exhausted
row skips the callback and another retained attempt, then is claim-fenced and
marked `DELIVERED` without accepted-work or failure-budget use. Lease/fencing
through the final pre-mark guard retains `LEASE` / `LEASE_INACTIVE` attempt
facts and one-failure accounting without accepted work. A mark failure
with successful cleanup leaves the authoritative row `TO_DELIVER` and
contributes one frozen, bounded, stack-free exhaustion-facts observation. If
cleanup also fails, direct run and loop accounting still record one `CLEANUP`
failure whose `AggregateError` contains the original mark error plus cleanup
error and has no frozen, bounded, or stack-free guarantee. This narrow gate is
internal; it does not add public retry-policy configuration or public
monitor/action behavior. Live shard ownership plus live per-message ownership
block competing callback dispatch while
ownership is current; expired per-message ownership may be replaced during
claim compare-and-set using the storage clock as abandoned-work recovery. If a
stale owner continues after losing renewal, endpoint callback side effects are
at-least-once/replay-safe: later final fencing can prevent stale finalization,
but it cannot uninvoke a callback that already ran. Broader production
supervision, cancellation, and retry-monitor policy are outside the initial
release; no future policy is committed.
The package does not expose a raw worker callback API; framework-owned replay
stays behind validated endpoints. Lease renewal uses same-event-loop timers
around in-process callbacks, so CPU-bound synchronous callbacks can still starve
renewal; this slice treats that as an in-process trust-boundary limitation rather
than timer-protected preemption.
`InboxReadOptions.limit` remains the page-size control for a single ordered
inbox read and must be positive and at most `1000`.
`InboxReadContinuation` names the stable row key used to read the next ordered
inbox page after a previous message: message ID, receive time, and version.
`ShardedWorkRegistryOptions.leaseMs` must be between `1000` and `2147483647`
milliseconds inclusive. `Inbox.markDelivered()` and
`InboxStorage.markDelivered()` return `undefined` for missing rows, non-pending
rows, or caller snapshots that do not match the stored message;
already-delivered matching rows are returned idempotently. Built contexts use
this storage boundary internally for process-manager command rows,
process-manager event reaction rows, and live projection subscriber rows. This
slice does not run process-wide transport-backed scheduler workers, retry
monitors, conveyor/stations, generic repository delivery, projection catch-up
through inbox storage, broad production lifecycle, transport retries, example
app work, or production read-side catch-up workers.
Event import and aggregate importers are removed from the active plan by
upstream ADR 0001 D1. Aggregate
`@React` handlers are ordinary generated reactor handlers with current
transaction semantics, not event-sourcing import/applier work.
Server metadata exports
include `describeEntityMetadata()`, `isEntitySchema()`,
`DescriptorMetadataError`, normalized entity kind/visibility types, first-field
routing hints, field metadata, and the descriptor-derived `EntityMetadata`
contract for handler registration, transaction validation, repository assembly,
and bounded-context assembly. Column metadata is exposed only for projection/process-manager
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
transaction context, dispatch phase, or lifecycle-event emitter. It is a
framework-owned compatibility seam, not an end-user manual-transaction API.
Application handlers must not start, commit, roll back, or otherwise control
transactions manually. Lifecycle
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
event reaction, and legacy event application, `HandlerParameterCount` for
canonical arity metadata, and `HandlerMetadataError` for registration-time
structural failures. Handler names must refer to own prototype data methods
declared with normal class method syntax. `defineEntityHandlers()` remains
public for framework tests, generated-registry ingestion, and legacy
non-decorator migration tooling; ordinary application code should use bare
decorators plus generated registry assembly instead. Decorator adapter exports
include `@Assign`, `@Command`, `@Subscribe`, `@React`, legacy/framework-only
`@Apply`, framework-only `materializeDecoratedEntityHandlers()`,
`HandlerMethodDecorator`, and `HandlerMethodValue`. Bare `@Assign`, `@Command`,
`@Subscribe`, and `@React` are the only public decorator signatures and the
ordinary application syntax. Generated handler registries own ordinary schema
inference. Schema-bearing handler metadata is internal/tooling input for
generated registry assembly and framework-owned materialization; it is not a
public decorator form. `@Apply` and `materializeDecoratedEntityHandlers()`
remain framework-only compatibility paths; new application code must not use
them.
Ordinary generated assembly uses
`await BoundedContext.singleTenant(name).add(EntityClass).withGeneratedRegistryRoot(compiledPackageRoot).buildAsync()`.
`withGeneratedRegistryRoot(root)` accepts a trusted compiled package/app root as
a filesystem path, `URL`, or `file:` URL string. It rejects malformed URL
strings, non-`file:` URL schemes, and `file:` aliases carrying query/hash
suffixes, and it is required before `buildAsync()` can assemble entity classes
from generated metadata. The builder loads the conventional generated registry
module under that root, matches entity-class metadata, constructs default
repositories, and keeps synchronous `build()` for explicit `add(repository)`
assembly. The server registry exports
include `HandlerMetadataRegistry`, `HandlerMetadataRegistryLookup`,
`RegisteredHandlerMetadata`, and `HandlerMetadataRegistryError` for low-level
lookup-only registration and duplicate-policy validation. These APIs are
metadata-only and do not execute handlers, access storage, dispatch buses, or
start transport.
Generated handler registries are the intended ordinary bridge from bare
decorators to canonical metadata. Their logical contract is a versioned list of
entity handler groups with entity type, state schema, handler kind, method name,
first-parameter signal schema, explicit one- or two-argument arity, and emitted
schemas inferred from explicit return types. Build-time analysis derives and
validates command, event, and distinct rejection roles from generated
descriptors before writing those registry records. A rejection role requires a
top-level message declared in a source file ending `rejections.proto`.
Rejections are accepted as inputs by `@Subscribe`, `@React`, and
event-to-command `@Command`, but not by `@Assign`; they cannot be normal emitted
values. Generated `@Assign` and `@Command` producer records must declare at
least one emitted schema; `@React` records may return generated event messages
or explicit `void` with no emitted schemas. `@Subscribe` records return
explicit `void` and declare no emitted schemas. They are generated build
artifacts under ignored `generated/` directories and are not committed.
The exported `@spine-ts/server/internal/generated-handler-registry` subpath
exists only to give that generated registry source its required type-only
`GeneratedHandlerRegistry` import. It is a generated-artifact/package-internal
entry point, not an application import, package-root API, or TypeDoc entry.
`HandlerRegistryIngestor` preserves generated arity in canonical metadata, and
`GeneratedRegistryDiscovery` loads explicit registry paths or clean `file:`
URLs for framework/tooling paths. Application package builds run registry
generation after Protobuf-ES generation and before `tsc`; normal context
assembly lets `buildAsync()` load the compiled registry module from the explicit
trusted package output tree passed to `withGeneratedRegistryRoot(root)`.
Repository execution calls generated two-argument command assignees, event
subscribers, command reactions, and event reactors with generated
`CommandContext` or `EventContext` values from the incoming envelope; if the
envelope omits context, execution supplies an empty generated context message
of the proper schema. Rejection subscribers receive the typed rejection payload
and `EventContext`, never the enclosing `Event`; each matching subscriber
receives defensive payload and context values. For framework-produced rejection
events, `EventContext.rejection.command` contains a defensive clone of the
rejected original `Command`, and `EventContext.rejection.stacktrace` carries the
generated rejection throwable's available stack. This full context is an
internal generated-handler contract. Client-facing `SubscriptionService`
updates clone the event and redact rejected-command payload forms and throwable
stack while preserving the typed payload and other event metadata. Generated
producer handlers return
domain messages; the framework wraps returned commands/events internally and
dispatches produced signals only after the current storage/transactional work
succeeds.
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
wanted-event publication remain outside the current surface because TypeScript
handler metadata has no external-event marker. It is not an event bus, integration
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
Runtime routing exports include `createRoutingPlan()`,
`ServerRuntimeRoutingPlan`, `RoutingPlanInput`,
`CommandRuntimeRoutingPlan`, `EventRuntimeRoutingPlan`, and
`DeferredRoutingSeam`. The planner requires a built
`BoundedContext`, plus optional concrete `CommandRegistrationReadiness` /
`EventRegistrationReadiness` instances, and derives immutable
`@spine-ts/transport` topics, subscriptions, and planner-local worker IDs plus
small sanitized route descriptors. Command routing produces one planner-local
command-worker competing-consumer subscription over registered command topics.
Event routing produces fan-out subscriptions and event-worker IDs
for subscriber, reactor, and application receiver groups while keeping handler
invocation from runtime workers, integrated runtime wiring, service hosting,
IPC endpoint naming, and process supervision outside the planner. Public route descriptors
expose only planner-local route and worker IDs, message full type names/type
URLs, stable receiver groups, and transport correlation keys back to the
top-level topics/subscriptions;
they do not retain raw readiness metadata, entity names, handler method names,
ZeroMQ endpoint data, socket topology, or duplicate full transport contracts on
each route. Query, subscription, and system routing remain explicit reserved
seams until concrete server readiness metadata exists.
Runtime transport exports include `RuntimeTransportBinding`,
`RuntimeTransportBindingInput`, `RuntimeTransportBindingHandle`,
`CommandRuntimeTransportHandler`, `EventRuntimeTransportHandler`, and
`RuntimeTransportEnvelopeError`. `RuntimeTransportBinding.open()` registers
command routes with `SignalTransport.respond()` and event routes with
`SignalTransport.subscribe()`, validates generated Spine command/event
envelope shape and enclosed message type URL before runtime intake, and enqueues
accepted callbacks through the supplied `SingleProcessServerRuntime`. Its close
handle is idempotent and closes transport registrations before the runtime. It
does not own the transport instance, open IPC endpoints, expose ZeroMQ details,
supervise processes, retry work, store events, or create a public server
environment.
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
broad gRPC server lifecycle, ZeroMQ transport, or worker-process runtime.
Runtime metadata exports include `SignalMetadata`, `SignalIds`, `Clock`,
`SystemClock`, `FixedClock`, `SignalMetadataOptions`, `ActorContextInput`,
`CommandContextInput`, and `EventContextInput`. `SignalMetadata` creates
generated command IDs, event IDs, timestamps, actor/tenant command context,
source-command/source-event origin chains, primitive (`string | number |
boolean`) producer IDs, and validated int32 `Version` metadata through one
small shared policy surface. Deterministic tests inject `Clock` and
`SignalIds` instances instead of mutating process-wide globals. This seam is
local runtime metadata only; it does not discover handlers, load generated
registries, materialize application handlers, own transport, storage, tracing,
or end-user envelope APIs.
It does not broaden end-user APIs into framework `Command`/`Event` envelopes,
does not reintroduce `@Apply`, and does not expose manual transaction-control
APIs.
Semantic tags now flow into runtime routing topics in this slice:
command topics copy command-assignee entity tags, and event topics copy the
deduplicated union of receiver entity tags. Broader handler materialization and
application-owned semantic-tag registration remain outside this runtime
metadata surface.
The public runtime closure smoke path composes these exports with
`BoundedContext`, `Repository`, `HandlerMetadataRegistry`,
`CommandRegistrationReadiness`, `EventRegistrationReadiness`, and
`createRoutingPlan()` to prove the metadata and lifecycle
interfaces fit together. That composition produces context-scoped metadata,
command/event readiness views, immutable runtime-routing plans, and
deterministic runtime state only. The public `Server` export added later is a
separate local HTTP/2 service host over `SpineServices`; it does not broaden the
runtime-routing plan into service routing, command/event/import bus behavior,
handler invocation, read-side execution, transport lifecycle, validation,
delivery, integration-broker behavior, or Spine `Ack` mapping.
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
`RecordStorage`, `RecordEntry`, `RecordSpec`, `RecordColumn`, `RecordQuery`,
`RecordContinuation`, `RecordContinuationValue`, `RecordFilter`,
`RecordOrder`, `RecordReadOptions`, `RecordMask`, `InMemoryStorageFactory`,
`InMemoryRecordStorage`, `EventStore`, and `OnEventAccepted`. `StorageFactory`
owns one mandatory adapter seam, `createRecordStorage(context, spec)`.
`RecordStorage` persists identified Protobuf records with deterministic
ID/column/path queries, stable continuations after sorted row keys,
non-negative offsets, positive limits, and simple field masks over cloned
results. The in-memory adapter is process-local, tenant-aware through
`StorageContext`, shared by factory, context name, tenant mode, tenant ID, and
`RecordSpec` instance, and non-durable. Storage adapters must make repeated
`createRecordStorage(context, spec)` calls observe the same logical records
while returning independently closeable storage handles.
`RecordStorage.delete(id)`, `read(id)`, and
`compareAndSet(id, expected, next)` address actual storage slot IDs.
`RecordStorage.query()` and `RecordStorage.queryEntries()` also filter
`RecordQuery.ids` against actual storage slot IDs; `queryEntries()` returns
those slot IDs beside each record for callers that need slot-addressed
validation or repair. `RecordStorage.index()` is the deliberate exception: it
returns logical record IDs derived from each record body through the
`RecordSpec`.
`RecordSpec` rejects duplicate declared `RecordColumn` names in its constructor,
before a factory or adapter receives the specification.
`RecordStorage.compareAndSet(id, expected, next)` must be atomic across those
handles for one logical backing store; `next: undefined` is a conditional
delete, and `false` means the expected value did not match so no mutation was
applied. `EventStore` is a framework delegate over
`RecordStorage<EventId, Event>` and is storage-only in this slice: it persists
and reads generated Spine events, rejects missing, blank, or duplicate event
IDs on the local append path, and can run `OnEventAccepted` between precheck
and append with one captured storage context. It does not dispatch events,
manage delivery, or fan out to subscribers.

Transport exports include `TransportSignalKind`, `TransportSemanticTag`,
`TransportTopicInput`, `TransportTopic`, `TransportRoutingDescriptor`,
`TransportSubscriptionInput`, `TransportSubscription`, `TransportSubscriptionMode`,
`TransportSignalEnvelope`,
`PublishTransportOperation`, `RequestTransportOperation`,
`PublishTransportHandler`, `RequestTransportHandler`, `AsyncCloseable`,
`TransportSubscriptionHandle`, `SignalTransport`, `createTransportTopic()`, and
`createTransportSubscription()`, `isTransportOperationKind()`, and
`isTransportTopicKind()`. This root surface is contract-only: it defines
immutable topic/subscription value objects, deterministic adapter-agnostic
routing keys, handler callback signatures, and graceful async close behavior.
It does not expose ZeroMQ socket types, endpoint strings, multipart frames,
production endpoint topology, broker processes, child process supervision,
participant lifecycle values, worker registrations, delivery attempt/result
values, retry policy, durable storage, runtime handler invocation, or server
runtime wiring.
The transport package pins `zeromq@6.5.0` for local IPC adapter work, but that
native dependency remains outside the root TypeDoc entry point. The
adapter-scoped `@spine-ts/transport/zeromq` subpath exports exactly
`createZeroMqAdapterConfig()`, `createZeroMqTransport()`,
`ZeroMqAdapterConfig`, `ZeroMqAdapterConfigInput`, `ZeroMqTransportScope`, and
`ZeroMqTransportOptions` for local IPC deployments. It derives deterministic
IPC endpoints from adapter config and transport routing descriptors internally,
then exposes only the
`SignalTransport` contract to runtime binding code. Socket creation, endpoint
strings, multipart frames, and native binding types remain absent from the root
API; remote transport, broker topology, process supervision, worker
registration handshakes, delivery retries, and broad health checks are outside
the initial release. The adapter provides no exactly-once, durable-redelivery,
retry, restart, or remote-delivery guarantee. For transport topics marked
`command` or `event`, the private adapter uses generated Buf Protobuf binary;
the reserved `query`, `subscription`, and `system` kinds have no Protobuf wire
contract and currently retain private V8 encoding. `TransportSignalEnvelope`
correlates command/event operations and handlers with generated `Command` and
`Event` while preserving caller-selected types for other kinds. Widened or
union operations and topics can be narrowed through their fixed canonical kind
paths:

```ts
import {
  isTransportOperationKind,
  isTransportTopicKind,
  type RequestTransportOperation,
  type TransportTopic,
} from "@spine-ts/transport";

function onTransportRequest(operation: RequestTransportOperation<{ readonly id: string }>): void {
  if (isTransportOperationKind(operation, "command")) {
    operation.envelope; // Inferred as the generated Command type.
  }
}

function onTransportTopic(topic: TransportTopic): void {
  if (isTransportTopicKind(topic, "event")) {
    topic.signalKind; // Inferred as "event".
  }
}
```

`isTransportOperationKind()` always compares `operation.topic.signalKind`, and
`isTransportTopicKind()` always compares `topic.signalKind`. They provide type
narrowing, not validation of untrusted input or envelope content, and neither
inspects the envelope. The topic helper narrows only the top-level
`signalKind`; it does not validate or narrow the routing descriptor or
`routing.signalKind`. Every inbound
`Subscriber`, `Request`, and `Reply` frame has an exact 8,388,608-byte rejection
ceiling, not a fixed allocation. Publish and request messages use route frame 1
and payload frame 2: command/event payloads use Buf, while reserved
query/subscription/system payloads use private V8. A successful request result
uses the private V8 wrapper in reply frame 1 and is not Spine `Ack`; generated-
message-shaped results, including objects with a string `$typeName`, are
rejected before V8 serialization. Trailers are ignored only after zeromq.js
materializes the full multipart message, so SF-013 remains accepted and
unbounded in aggregate. Old V8 command/event peers are wire-incompatible with
Buf peers and cooperating peers must upgrade together. The adapter is for
trusted same-host runtime peers only; `ipcDirectory` must be private to those
peers. Managed sandboxes may reject ZeroMQ `ipc://` binds with `EPERM`, so live
local IPC tests can require native IPC filesystem/socket permissions outside
the sandbox. `requestTimeoutMs` defaults to 2,000 milliseconds and accepts only
integers from 1 through 2,147,483,647; invalid values fail before filesystem or
socket work. It bounds request/reply send and receive but does not actively
cancel an already-sent request, while `receiveTimeoutMs` remains the separate
background-worker setting. Runtime transport tests now include a native
ZeroMQ-backed command and event callback proof through the public
`SignalTransport` contract.

The generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON and verifies nine expected
entry points in the API model: `@spine-ts/proto`, `@spine-ts/core`,
`@spine-ts/server`, `@spine-ts/storage`, `@spine-ts/storage-datastore`,
`@spine-ts/storage-rdbms`, `@spine-ts/transport`,
`@spine-ts/transport/zeromq`, and `@spine-ts/testing`. The
`@spine-ts/transport/zeromq` entry point has its own exact-six-public-export
gate. It also checks
`@spine-ts/server`, `@spine-ts/storage`, `@spine-ts/storage-datastore`, and
`@spine-ts/storage-rdbms` root exports against source
allowlists, and rejects broad generated wildcard re-exports from the proto
package root.
