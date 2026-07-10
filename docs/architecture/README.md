# Architecture Notes

Current status: early implementation notes through the first command/event bus,
runtime-routing, transport-foundation seams, and the real Connect/Node
`SpineServices` route registrar for the raw Spine command/query/subscription
services, including durable inactive subscription recovery over the same
storage factory, plus a small local `Server` lifecycle owner over those
services.

Architecture documentation starts from the build protocol and specification documents under `build-protocol/`. This folder is reserved for implementation-era architecture notes that evolve with actual package boundaries and runtime behavior.

## Proto Contract Boundary

The `proto/` tree now contains the first verbatim copied Spine contract
closures. `@spine-ts/proto` compiles those contracts and exposes a curated root
API with Protobuf-ES schemas, descriptors, message types, enum descriptors, enum
values, and custom options. This boundary is intentionally contract-only:

- generated schemas are available for later metadata and validation tasks;
- copied source provenance is verified by `proto/spine-sources.json`;
- canonical `Command`, `Event`, `Ack`, `Response`, `ActorContext`,
  `TenantId`, `UserId`, `Version`, diagnostics, enrichment, Spine client query,
  subscription, and service contracts, and transitive time/net/UI support
  contracts are available without hand-written TypeScript shapes; and
- buses, transport, and entity runtime behavior remain out of scope for this
  package boundary. Runtime signal metadata now lives in the server/runtime
  slice rather than the proto package.

## Core Metadata Registry

`@spine-ts/core` owns runtime lookup policy over generated schemas. The first
registry slice consumes curated exports from `@spine-ts/proto`, derives type
URLs from descriptor file options, and exposes immutable metadata by full type
name, type URL, and schema identity.

The shared `spineCoreRegistry` export is a read-only lookup view over the
curated schemas, including the core signal envelope/context closure. Mutable
registration stays on caller-owned `TypeRegistry` instances, including those
returned by `createSpineCoreRegistry()`, to avoid process-wide state mutation.

The registry fails fast on duplicate full names, duplicate type URLs, and
conflicting descriptor identities. This intentionally differs from the JVM
`TypeDictionary.Builder` overwrite behavior because silent replacement would
corrupt later routing and validation decisions.

Descriptor-backed metadata currently includes:

- full Protobuf type name and canonical type URL;
- generated schema/message descriptor;
- declaring file descriptor and file name;
- first declared field, preserving descriptor declaration order; and
- file option helpers for later validation/runtime tasks.

Semantic tag lookup is available as an API shape, but this core registry still
does not register tags. The current copied proto set defines the Spine `(is)`
and `(every_is)` options; descriptor-derived entity metadata preserves them,
and server runtime routing now copies those tags into command and event
transport topics.

## Core Validation Facade

`@spine-ts/core` owns the validation interface exposed to framework users.
Single-message validation is delegated to
`@spine-event-engine/validation-ts@2.0.0-snapshot.4`, pinned by D-0029, but
callers use `validateMessage()` and `checkValid()` from core. This keeps the
experimental upstream API and generated upstream validation error types behind a
framework seam.

The facade converts upstream violations into repo-local
`spine.validation.ConstraintViolation` messages and builds
`spine.validation.ValidationError` data through `createValidationError()`.
`ValidationException.asMessage()` returns that structured message data for
throwing validation paths. The public contract is the repo-local
`spine.validation.*` namespace.

Validation details are safe by default. The adapter omits raw invalid
`fieldValue` payloads, redacts every upstream or transition-rule placeholder
value while preserving placeholder keys, and translates upstream validator
exceptions into structured `spine.validation.ConstraintViolation` data instead
of leaking raw exception objects or messages.

State-transition validation is a separate framework-owned seam because rules
such as `(set_once)` need both previous and proposed state. The
`validateTransition()` API aggregates transition rule violations into the same
structured result shape and remains the sanitizer for server-owned built-in
entity rules. Rule-returned violations are sanitized before aggregation, and
throwing transition rules are isolated into structured transition-rule failures
so later rules still run deterministically.

## Core Envelope Construction

`@spine-ts/core` owns the Spine-aware `Any` packing seam. `packAny()` derives
the canonical type URL with `deriveTypeUrl(schema)` and serializes the payload
with Protobuf-ES `toBinary()`. The implementation intentionally does not call
Buf `anyPack()` directly for Spine domain payloads because that helper emits the
standard `type.googleapis.com/...` prefix rather than the Spine
`type.spine.io/...` prefix required for routing.

Framework-packed payloads pass `writeUnknownFields: false` to the Protobuf-ES
binary writer. This gives the helper stable behavior for messages that carry
retained unknown fields. Protobuf-ES 2.12.1 does not expose deterministic
map-key ordering, so T-0007b does not claim fully canonical map ordering and
leaves any broader canonical serialization policy to a later task.

`unpackAny()` performs exact type URL matching against the requested schema
before binary decoding and returns `undefined` on decode failure, keeping type
URL comparison and malformed payload handling inside the core module interface.
Callers should not parse or concatenate type URL strings in their own code.

`packCommand()` and `packEvent()` construct generated `spine.core.Command` and
`spine.core.Event` messages from caller-supplied generated IDs, generated
contexts, schemas, and already-built domain messages. They validate the enclosed
domain message through the core validation facade by default, then pack it as
Spine-aware `Any`. Supplied IDs and contexts are cloned before embedding so
later caller-side mutation does not mutate returned envelopes.

The helpers deliberately do not own runtime policy. They do not generate UUIDs,
timestamps, actor or tenant context, event producer IDs, entity versions,
origins, command system properties, storage records, acknowledgements, delivery
state, bus dispatch, handler registration, or transport metadata. Those
responsibilities belong to the server/runtime layers that own the current
workflow.

## Server Entity Metadata

`@spine-ts/server` now owns the first descriptor-derived entity metadata layer,
following D-0034, the first explicit handler metadata layer, following D-0035,
the caller-owned handler registry, following D-0036, the first standard
decorator adapter, following D-0037, and built-in set-once transition
validation, following D-0038. It also owns the first thin entity-family marker
classes over the transactional entity shell. The package consumes curated
option exports from `@spine-ts/proto` and delegates transition result shaping
to `@spine-ts/core`.

Current server metadata is pure and deterministic:

- `(entity).kind` is normalized to server-facing entity kinds;
- `(entity).visibility` preserves explicit values and applies Spine defaults
  (`full` for projections, `none` for aggregates/process managers/generic
  entities);
- the first declared field becomes both the canonical entity ID field and the
  first-field routing hint for later handler/repository tasks;
- fields marked `(column) = true` are surfaced in descriptor order only for
  projections and process managers, `(set_once) = true` fields are surfaced for
  every entity kind, and
- semantic tags from message `(is)` and file `(every_is)` options are
  preserved in deterministic sorted order and consumed by server runtime
  routing topics.

The entity extractor throws typed `DescriptorMetadataError` failures for non-entity
schemas, unknown entity kinds, repeated/map column declarations, empty semantic
tag values, and other unsupported combinations in this slice. Aggregate and
generic entity column declarations are ignored to match the source option
contract.

Server-owned transition validation currently compares descriptor-derived
`(set_once)` fields through the core transition facade and Protobuf-ES
canonicalization for scalar, enum, bytes, and singular message values. Repeated,
map-valued, and explicit optional `(set_once)` fields are intentionally
unsupported in this slice, matching the JVM generation boundary; they fail
closed with field-specific violations and no raw previous/next value leakage.

`defineEntityHandlers()` is the low-level explicit metadata constructor that
remains public for framework tests, generated-registry ingestion, and legacy
non-decorator migration tooling. Ordinary application code should use bare
decorators plus generated registry assembly instead. The explicit constructor
accepts an entity class, a state schema, and a builder callback whose methods
record command assignment, command reaction, event subscription, event
reaction, and event application metadata. Each handler record keeps the
generated Protobuf-ES schema, message full type name, handler kind, and entity
method name. Event application metadata also records `allowImport` only for
legacy framework-owned `@Apply` compatibility metadata. It is retained only so
unsupported legacy metadata can be detected; event import is removed from the
active runtime plan by upstream ADR 0001 D1.

Handler metadata is deterministic and frozen. The all-handlers array preserves
the user declaration order, and role-specific arrays preserve the same relative
order after filtering. Registration validates only that explicitly named
handlers are own prototype data methods declared with normal class method
syntax; accessors, `constructor`, inherited methods, and instance fields are
rejected without invoking user code.

`HandlerMetadataRegistry` is the first caller-owned lookup and duplicate-policy
layer over explicit `EntityHandlersMetadata`. It registers existing metadata
objects, keeps deterministic frozen listing/lookup arrays in registration and
handler declaration order, and indexes handlers by entity state full type name,
handler kind, and command/event message full type name. The first duplicate
policy rejects one ambiguous command assignment per command message full type
name and one ambiguous event application per entity state full type name plus
event message full type name. Command reactions, event subscriptions, and event
reactions intentionally allow multiple handlers for the same message type so
later runtime fan-out remains possible.

The standard decorator adapter is metadata-only syntax over the same explicit
contract. Bare `@Assign`, `@Command`, `@Subscribe`, and `@React` are the
ordinary application syntax collected from public instance methods into
standard per-class decorator metadata. They are the only public decorator
signatures. Schema-bearing handler metadata is generated/internal tooling input
and framework materialization state, not an application decorator form.
`@Apply` and `materializeDecoratedEntityHandlers()` remain framework-only
compatibility. Generated registry tooling owns ordinary schema inference from
handler parameter and return types, keeps decorated classes compatible with
`HandlerMetadataRegistry`, and leaves `defineEntityHandlers()` available only
for framework tests, generated-registry ingestion, and legacy non-decorator
migration tooling. The adapter does not use legacy `emitDecoratorMetadata`,
`reflect-metadata`, parameter decorators, or a process-wide handler registry.

`validateEntityStateTransition()` is the first high-level server validation API
over previous and proposed entity state. It calls `describeEntityMetadata()` to
derive the schema's descriptor-ordered `(set_once)` fields, allows creation
transitions where `previous === undefined` to initialize supported set-once
fields, and rejects existing-state transitions when a supported set-once field
value changes. Repeated, map-valued, and explicit optional set-once fields are
unsupported and fail closed even on creation transitions. The low-level
set-once rule remains private; callers receive the core
`TransitionValidationResult` shape with repo-local `spine.validation.*`
messages, field paths, and no raw previous/next values.

`Entity` is the first common OOP entity state shell. It binds a caller-supplied
ID to one descriptor-backed Protobuf-ES state schema, derives and caches
`EntityMetadata`, snapshots state on construction and read access, snapshots
caller-owned plain version metadata without computing increments, and exposes
lifecycle flags plus `isActive`, `isArchived`, `isDeleted`, and sticky
`lifecycleFlagsChanged` accessors. Protected replacement hooks give
framework-owned subclasses a narrow place to apply accepted state/version or
lifecycle evidence, but the public shell has no state setters or Java builders
and does not own transactions, repositories, handler invocation, storage,
lifecycle events, routing, queries, buses, transports, or process-global runtime
state.

`TransactionalEntity` is the protected OOP draft layer over `EntityTransaction`.
It adds one active transaction slot per entity instance, scoped helpers for
reading and updating draft state, draft version metadata, and draft lifecycle
flags, and commit/rollback helpers that close over the existing transaction
kernel. Accepted commits apply only the accepted state, explicit version
metadata, and lifecycle flags back through the `Entity` replacement hooks.
Rejected commits apply nothing and intentionally keep the transaction active so
subclass code can correct the draft or roll it back explicitly, matching the
current `EntityTransaction.commit()` behavior. The `changed` signal records
accepted state changes or committed lifecycle flag changes without making
repository storage decisions. Scope errors are deterministic
`TransactionalEntityScopeError` instances for missing or duplicate active
transactions. The layer still avoids handler invocation, repositories, storage,
lifecycle events, Java builders, automatic version increments, transaction
listeners, recent history, async-local/global transaction state, and
entity-family-specific aggregate/projection/process-manager behavior.

`Aggregate`, `Projection`, and `ProcessManager` are now public abstract entity
family markers. Each extends `TransactionalEntity<Id, Schema, Version>` and
adds only a stable readonly `entityFamily` property typed by the exported
`EntityFamily` union. This follows the JVM family shape only as far as the
current TypeScript runtime can support safely: JVM `Projection` directly
extends `TransactionalEntity`, while JVM aggregate and process-manager behavior
is mostly supplied by assignee, dispatch, event-history, repository, querying,
and bounded-context collaborators that this slice has not implemented. The
TypeScript family classes therefore do not expose public transaction mutators,
repository hooks, dispatch APIs, command posting, query clients, aggregate event
history, snapshots, process workflow execution, idempotency guards, lifecycle
events, handler invocation, or async-local/global transaction state.

`Repository` is now the entity ownership and context-owned registration seam.
It accepts one entity constructor and one
descriptor-backed state schema, infers the family from a declared ES class
constructor whose constructor and instance prototype chains reach `Aggregate`,
`Projection`, or `ProcessManager`, and verifies that the state schema's
`(entity).kind` matches that family. Alias imports, namespace/member base-class
expressions, and intermediate domain base classes are valid because the runtime
trusts the actual same-realm prototype metadata rather than parsing source base
names. This is a metadata boundary, not a sandbox boundary: same-realm code that
explicitly reparents an ES class onto an entity family is trusted as an entity
constructor. The snapshot surface records only immutable identity facts:
constructor identity, family, state schema, descriptor metadata, state full type
name, and ID-field metadata. `BoundedContextBuilder.build()` owns repository
registration, rejects duplicate entity or state identities, opens state record
storage through the context `StorageFactory`, and exposes registered
repositories as frozen snapshot-backed `RepositoryView` values. Direct
repository registration is not public API. Built contexts also register
repository state schemas with their owned direct `Stand`, so the read side can
reject unknown state types before service adapters execute queries or
subscriptions.
This follows the JVM `Repository` identity surface (`entityClass()`,
`idClass()`, and `entityStateType()`) plus the first context-owned lifecycle
step. When authentic explicit handler metadata is supplied, repositories now
calculate command/event routes and bounded-context assembly registers internal
dispatcher adapters for those routes. Aggregate repositories can then load or
create one aggregate, invoke one assignee in a framework-owned transaction,
pack and store returned domain events, persist the latest managed state through
`AggregateStorage`, and queue already-stored events for event-bus delivery
without a second append. The TypeScript seam still omits public `create`,
`find`, `store`, record conversion APIs,
entity storage/cache/catch-up, inbox/delivery, lifecycle monitors, gRPC server
lifecycle, and transport.

`EntityTransaction` is the first server-owned draft/result commit boundary over
one entity state. It buffers a draft state, explicit previous/draft version
metadata, lifecycle flags, and visible status (`active`, `committed`, or
`rolled-back`). The compatibility contract is intentionally small and
JVM-familiar: this API owns only in-memory transaction evidence for
framework-controlled entity bases, not repository storage, database
transactions, dispatch phases, event emission, or process-wide transaction
state. `update()` replaces only the buffered draft, while `previous` and
`currentDraft` accessors return snapshots so callers do not mutate the
transaction's stored previous state by accident. `archive()`, `unarchive()`,
`markDeleted()`, and `restore()` replace only buffered lifecycle flags, and
`updateVersionMetadata()` replaces only caller-owned draft version metadata.
These helpers deliberately do not compute automatic version increments, emit
lifecycle events, write storage, or filter read-side queries. `requireActive()`
is the local active-state guard: it rejects committed/rolled-back transactions
and active drafts already marked archived or deleted with deterministic errors
that do not include entity state payloads. `commit()` validates the
previous-to-draft transition through `validateEntityStateTransition()` before
returning an accepted result. Ordinary validation failures return a rejected
result with validator violations and leave the transaction active for caller
policy to decide; rollback closes the transaction and returns discarded draft
evidence.

The server metadata and validation layer still does not execute routes, invoke
handlers, instantiate entities, deserialize `Any` payloads, assemble
repositories, mutate storage, register buses, mutate a global registry, provide
async-local transaction state, or start transport.

## Server Bounded-Context Shell

`@spine-ts/server` now exposes the first bounded-context assembly shell for
server metadata. It follows the Spine JVM entry points closely while keeping
the implementation boundary deliberately smaller than the eventual runtime.

Current bounded-context scope is intentionally limited to a small assembly
surface:

- `BoundedContext.singleTenant(name)` and
  `BoundedContext.multitenant(name)` are the only public entry points for
  starting context assembly;
- `ContextSpec` is a framework-owned immutable value exposed through
  `builder.spec` and `context.spec`; it carries the validated bounded-context
  name, tenant mode, and event-storage metadata used when
  `withStorageFactory()` creates the context `EventStore`;
- `BoundedContextBuilder.addCommandDispatcher()` /
  `removeCommandDispatcher()` and `addEventDispatcher()` /
  `removeEventDispatcher()` collect dispatchers for the context being built;
- `BoundedContextBuilder.withStorageFactory(factory)` selects the
  `StorageFactory` used to create the context `EventStore` and repository state
  storage, plus direct `Stand`/read-side state storage;
- `BoundedContextBuilder.add(repository)` and `remove(repository)` maintain the
  context-owned repository registration list;
- `BoundedContextBuilder.build()` is the only supported path for constructing a
  built `BoundedContext`; and
- built contexts expose name, tenant mode, spec, a copy-safe small snapshot,
  frozen snapshot-backed `RepositoryView` values, a post-only `commandBus()`
  endpoint, an event listing/posting `eventBus()` endpoint backed by internally
  owned buses, plus a context-owned direct `stand()`.

This keeps the TypeScript API JVM-familiar without pretending that later
runtime collaborators already exist. Application code does not subclass
`BoundedContext` or directly instantiate shell classes. Runtime constructor
guards also reject direct JavaScript escape hatches so callers cannot bypass
name validation or the builder-only build path by passing ad hoc objects.

The current `Stand` slice is intentionally direct and storage-backed. It owns
known generated state schemas, latest-state `RecordStorage`, direct
read/update methods, versioned point reads, storage-backed queries through
`Stand.queryVersioned()`, storage-order list reads through
`Stand.readAllVersioned()`, and deterministic in-process subscription handles
with explicit `unsubscribe()`. Its version metadata map is process-local and
in-memory only; latest state records go through storage, but state-to-version
metadata is not persisted by this slice. It preserves read-side/write-side segregation by
remaining the query/subscription facade over read-side state. Built bounded
contexts may update it internally when repository event dispatch invokes
projection subscribers, but application code still does not receive a
repository read/write-side storage API. It does not run catch-up from events or
provide a client query DSL. `SpineServices` adapts this direct read side and
the context command bus to the first real Connect/Node `CommandService`,
`QueryService`, and `SubscriptionService` routes. Projection-state
`QueryService.Read` calls with `Target.include_all = true` are satisfied through
`Stand.queryVersioned()` over the stand's `RecordStorage.queryEntries()` path.
ID-filter reads for any registered state route use the same path with a storage
ID filter. Projection queries also support top-level `EQUAL` filters over
declared projection `(column)` proto field names, field masks, repeated ordering
directives over declared proto column names, and positive limits when ordering
is present. Use proto column names such as `open_task_count`, not generated TS
local names such as `openTaskCount`. Undeclared columns, unsupported operators,
nested or `EITHER` composites, limits without ordering, missing criteria, and
`include_all = false` return `INVALID_QUERY` before Stand storage reads.
Direct list reads and `QueryService.Read` include-all calls follow the same
tenant rules as point reads: single-tenant contexts reject tenant options, and
multitenant contexts require `tenantId`.
Service subscription delivery starts only when a client activates the opaque
subscription ID, abandoned inactive subscriptions expire after a small
configurable TTL, slow consumers are bounded by a small configurable update
queue, and stream/cancel cleanup releases the direct Stand or event-bus
listener handle. `Subscribe` accepts registered state targets and event targets
exposed by built-context event dispatchers. It rejects unknown/private targets,
invalid criteria, unsupported comparison operators, event filters, event field
masks, and unknown subscription field paths before creating a service-owned
inactive record or attaching a listener. The inactive record is stored through
the owning bounded context storage factory, so a fresh `SpineServices` adapter
over the same storage factory can recover it by opaque subscription ID.
Activation consumes the durable row before live attachment, so that storage
contains inactive records only. State
include-all topics deliver each activated Stand update. Filtered state topics
support optional ID filters plus
`ALL`/`EITHER` composite `EQUAL` field filters over generated entity state
fields, including nested message fields. Missing ID filters match all IDs.
Filtered delivery compares previous and new Stand state: matching new states
are delivered, and matched-to-unmatched transitions emit `no_longer_matching`.
Topic masks are applied only to delivered states. Event topics support
`include_all = true` in this runtime slice and stream wire-level
`event_updates` with cloned framework `Event` envelopes for matching event
message type URLs. Application handlers remain on generated domain event
messages; framework envelopes stay inside service/runtime data. Single-tenant
subscriptions reject tenant options; multitenant subscriptions require
`tenantId`; state and event delivery are scoped to that tenant slice. Activation
and cancellation are keyed by subscription ID: unknown, canceled, expired, and
already-active activations complete without updates, and unknown or duplicate
cancellations return OK. Cleanup is idempotent across cancel, stream
finalization, inactive expiry, and queue-limit closure. Direct Stand subscriber
sets, active service delivery handles, queued updates, Stand version metadata,
and in-memory storage adapter backing data are local process state; this slice
does not persist subscription positions, replay missed updates, coordinate
cross-process stream ownership, or recover active subscriptions after restart.

The current command service error contract remains intentionally small.
`CommandBus` validates each accepted command payload with the existing core
facade before dispatcher callbacks run, including custom
`addCommandDispatcher()` routes. For repository-backed aggregate dispatchers,
that still means validation happens before route calculation, latest persisted
state load, traceability event-journal append, latest-state write, or
stored-event dispatch.
`CommandService.Post` maps invalid payloads to `COMMAND_VALIDATION_ERROR`,
message `Command payload validation failed.`, and packed
`spine.validation.ValidationError` details. Handler-thrown `CommandRefusalError`
values are the one immediate business refusal path mapped to stable non-ok
`Ack` errors. Managed aggregate command handlers use framework-owned
`EntityTransaction.commit()` for transition validation. When that transaction is
rejected, repository execution raises
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with packed `ValidationError`
details before traceability events or latest state are stored. Legacy/internal
aggregate-history replay or validation failures remain internal and are
sanitized as `COMMAND_POST_ERROR`; ordinary generated-registry aggregate loading
uses the latest persisted state instead of replaying stored events.
Unexpected command-bus failures remain sanitized as `COMMAND_POST_ERROR`.

The following runtime pieces remain outside the verified local/example slice:

- visibility/type-supplier registration and lifecycle callbacks over the
  repository identity seam;
- query/subscription execution over repository routes. A limited local
  read-side catch-up slice now exists on
  `BoundedContext.catchUpReadSide(options?)`: it clears registered projection
  state rows for one tenant slice, replays already-stored events only to
  matching projection subscribers through the same EventBus runtime queue as
  live intake, does not re-append events, and excludes production delivery
  worker orchestration, inbox lifecycle, retries, and cross-process catch-up
  control;
- process-wide transport-backed delivery workers, production catch-up
  orchestration, durable production storage adapters, entity storage/cache
  catch-up, and production tenant-index policy. Durable inbox records, dedup
  guards, shard leases, the direct local shard drain, the local one-shard
  `DeliveryLoop`, and the internal tenant index are present;
- richer query filtering, retained subscription update replay, and
  cross-process subscription stream ownership;
- full system-context runtime, command-log repositories, system event taxonomy,
  tracing/monitors/debug UI, deployment/authentication/tracing/health
  hardening, and broader production server verification; and
- remote/multi-host transport topology, broker topology, process supervision,
  retry monitors/workers, and production transport-backed worker execution
  beyond the current local `RuntimeTransportBinding`.

## Server Runtime Closure

T-0010 closes the first single-process runtime slice as an assembly seam rather
than a server graph. Its verified public composition is:

- build a `BoundedContext` through the existing builder, optionally collecting
  dispatchers and a storage factory;
- derive command and event registration-readiness metadata from existing
  `HandlerMetadataRegistry` entries; and
- post executable commands/events through the first small `CommandBus` and
  `EventBus` seams when a caller already owns dispatchers and an `EventStore`;
- optionally use `SingleProcessServerRuntime` directly where a caller needs the
  current lifecycle/queue kernel.

T-0011.6 and T-0011.7 then close the metadata-only runtime-routing/transport
foundation layer. That later closure derives an immutable runtime-routing plan
from the built context plus command and event readiness using
`createRoutingPlan()`.

This is intentionally enough for later runtime tasks to share vocabulary and
tests around "context metadata plus lifecycle plus readiness." It is not an
equivalent of Spine JVM `Server` or a running JVM-style `BoundedContext`.
The readiness views remain metadata-only and do not dispatch or invoke
handlers. The runtime-routing plan does not open transport endpoints, expose
ZeroMQ details, or start workers; it only turns existing metadata into
transport-owned topics, subscriptions, planner-local worker IDs, explicit
reserved seams, and sanitized route descriptors. Those route descriptors expose
message type names/type URLs plus stable receiver-group and local route/worker
identities, along with transport correlation keys back to topic/subscription
arrays and planner-local worker IDs; they do not retain entity names, handler
names, raw readiness metadata, or duplicate full transport contracts on each
route. `RuntimeTransportBinding` is the first executable transport bridge over
that plan: it registers command routes through `SignalTransport.respond()`,
event routes through `SignalTransport.subscribe()`, checks incoming generated
Spine command/event envelope shape and enclosed message type URL, parses
accepted envelopes into clean generated messages before enqueue, and queues
accepted callbacks through `SingleProcessServerRuntime`. Its close handle is
idempotent, stops binding intake before unregistering transport handles, attempts
every transport registration close even after one rejects, and closes the
runtime after transport registrations. The package root now exports a small
executable bus layer, direct Stand, repository-backed handler invocation through
built contexts, command payload validation and refusal/Ack mapping through
`SpineServices`, the `SpineServices` route registrar, and this local runtime
transport binding. The package now also exports `Server` as a small HTTP/2
owner over `SpineServices`: it defaults to `127.0.0.1`, returns
`host`/`port`/`baseUrl`, and builds its service routing once when `start()` is
called. `ServerEnvironment` is an explicit assembly object for storage,
transport, optional delivery, optional tracing, and facility ownership. Local
servers get in-memory storage and same-process transport defaults; production
environment construction requires storage and transport before any listener is
opened. The environment selects facilities for server assembly; `Server` now
builds added `BoundedContextBuilder` values before listener open and uses the
environment storage factory unless the builder chose one explicitly. Shutdown stops
intake, closes active sessions, closes owned contexts/resources, then closes
environment-owned facilities when the server owns the environment. Failed close
attempts are retryable without rerunning close hooks that already succeeded. It
still does not export a production transport endpoint runner, integration
broker, durable retry owner, process supervisor, event storage policy beyond
current seams, retained active-stream/update replay storage, worker topology,
or a Java-style process-wide
`ServerEnvironment` singleton as part of this closure.

The same local runtime boundary now owns a narrow generated-signal metadata
policy through `SignalMetadata`. Repository-produced follow-up commands/events
share one policy for command/event IDs, timestamps, actor/tenant command
context, event origin chains, primitive producer IDs, and validated int32
version metadata. Tests inject `SignalIds` and `Clock` instead of mutating
process-global time or ID state. This seam is still metadata-only: end-user
handlers continue to accept generated domain messages instead of framework
`Event` envelopes, `@Apply` remains absent, manual transaction controls are
not introduced, and the seam does not discover handlers, load generated
registries, materialize application handlers, or widen into transport,
storage, tracing, or application-owned handler APIs.

The architectural consequence is that later work must add the remaining
collaborators as explicit tasks at their own seams. Event intake and broader
transport integration can consume the existing readiness views and
runtime-routing plan, but must still design event-side validation, filtering,
storage-before-dispatch, dispatch outcomes, delivery, and integration behavior
separately.

## Storage Boundary

`@spine-ts/storage` now owns a smaller record-storage seam. The package exports
`StorageFactory` with one mandatory adapter method,
`createRecordStorage(context, spec)`, plus `RecordStorage`, `RecordSpec`,
`RecordColumn`, query/mask contracts, and an in-memory implementation. It does
not implement repositories, transactions, buses, delivery workers, service
APIs, ZeroMQ transport, or production database adapters.

`RecordSpec` binds one generated Protobuf record schema, optional generated ID
schema, ID extraction, and deterministic query columns. `RecordStorage` stores
identified Protobuf records, clones them on write/read, deletes by ID, and
queries by exact IDs, exact column filters, deterministic sort order on `id`,
stored columns, or dotted record paths, positive limits, and simple masks on
cloned results. `StorageContext` carries the bounded-context storage namespace
plus optional tenant scoping for multitenant storages.

`EventStore` is a higher-level framework delegate over
`RecordStorage<EventId, Event>`. It is intentionally created directly by
framework code rather than by `StorageFactory`, so the foundational storage
package stays independent of the event layer. In this slice `EventStore`
remains storage-only: it persists and reads generated Spine events, and
`EventBus` calls `EventStore.acceptThenAppend()` so event identity fails closed
before custom dispatcher code sees the event and append uses the same captured
storage context. `EventStore` rejects missing, blank, or duplicate event IDs on
the local append path, but still does not dispatch on its own, manage delivery
attempts, fan out to subscribers, or implement retry/bus behavior.

`InMemoryStorageFactory` and `InMemoryRecordStorage` are the first
test/development adapter. They are process-local, share backing records by
factory, context name, tenant mode, tenant ID, and `RecordSpec` instance,
return independently closeable handles, and clone stored values so later caller
mutation cannot affect stored records. Payloads must remain cloneable, which
preserves byte arrays used by packed Protobuf `Any` payloads.

Aggregate latest-state and traceability event-journal storage is available
through the current `AggregateStorage` seam. Its history-read API remains
legacy/internal compatibility support; ordinary generated-registry aggregate
loading uses the latest persisted state rather than snapshot-plus-replay
loading. Delivery now persists durable inbox rows through `RecordStorage`,
keeps live deduplication guards beside those rows, coordinates shard ownership
with durable shard leases, and exposes `Delivery.drain()` plus `DeliveryLoop`
for local framework-owned shard draining. `DeliveryLoop` repeats one-shard
drains until idle, skipped, stopped, or a configured failure bound; failed rows
remain `TO_DELIVER` for later retry rather than being copied into a separate
attempt log. `stop()` prevents future drain starts and does not interrupt an
in-flight `Delivery.drain()`; `close()` calls `stop()` and waits for the
current drain, if any, to finish. Local posting handoffs now cover command
rows, projection subscriber rows, and process-manager event rows. Command
handlers and projection subscribers wait for the exact received row to replay
and reach `DELIVERED` before their posting path resolves. Live
process-manager event routing writes `REACT_UPON_EVENT` rows carrying the
original `Event` payload, original event ID as `signalId`, the
process-manager state type URL, and the routed process-manager ID target, then
replays that exact row. Process-manager replay validates tenant context,
payload/schema, target type URL, and routed target ID before handler code.
Bounded contexts now create internal system-pairing metadata and a
tenant index. Single-tenant indexes are constant and reject tenant recording;
multitenant indexes persist tenant IDs through the configured storage factory.
Raw system contexts and tenant indexes remain internal framework details.
Durable catch-up storage, transport-backed worker supervision, retry monitor
hierarchies, retained delivery-attempt history, diagnostics, repository storage
policy, read-side projection stores, and durable production storage adapters
remain open production gaps.

## Transport Boundary

`@spine-ts/transport` now owns the first adapter-agnostic routing contract for
local multi-process work. The package does not import `@spine-ts/server`
runtime code or expose ZeroMQ through its root API. It defines immutable value
objects and interfaces that later adapters can implement:

- `TransportSignalKind` names framework-level signal families (`command`,
  `event`, `query`, `subscription`, and `system`);
- `createTransportTopic()` builds immutable topics from a signal kind, a payload
  type URL, and optional semantic tags;
- `TransportRoutingDescriptor.routingKey` is derived deterministically from the
  signal kind, payload type URL, and sorted unique semantic tags;
- `createTransportSubscription()` builds immutable logical subscription
  descriptors from a topic, a logical subscriber ID, and a transport delivery
  mode; and
- `SignalTransport` plus publish/request handler contracts define the minimal
  adapter seam for later runtime integration and graceful async close behavior.

The boundary is intentionally smaller than a bus implementation. It does not
choose durable delivery, retry loops or timers, process supervision, readiness
probes over IPC, repository dispatch, storage lifecycle, read-side execution
policy, participant lifecycle, worker registrations, delivery attempts/results,
or retry classification. Those decisions remain in later transport and runtime
tasks.

The transport package now pins the maintained official `zeromq@6.5.0` line for
the local IPC adapter. The package root stays adapter-neutral, while the
`@spine-ts/transport/zeromq` subpath exposes the local IPC config helper and a
`SignalTransport` factory. The adapter derives compact deterministic IPC socket
paths from `ZeroMqAdapterConfig` plus transport routing descriptors and keeps
endpoint strings, multipart frames, socket classes, and native module types out
of framework APIs. Native tests prove publish/subscribe, request/reply, and
`RuntimeTransportBinding` command/event callbacks over the ZeroMQ transport. The
implementation does not add remote transport, broker topology, worker
registration handshakes, delivery retries, process supervision, or broad health
checks. The workspace explicitly approves the `zeromq` install script in pnpm
configuration, so dependency restoration must run in an environment that permits
native package build/install scripts. Managed sandboxes may reject ZeroMQ
`ipc://` binds with `EPERM`, so live local IPC tests can require native IPC
filesystem/socket permissions outside the sandbox. Per D-0007, this adapter path
is for same-host IPC only; scaling beyond one host remains the job of a
different transport behind the same public contract.

The ZeroMQ adapter serializes envelopes with Node's V8 serializer. Its `ipc://`
frames are trusted same-host runtime traffic only, and `ipcDirectory` must be a
private directory shared only by the cooperating runtime peers.
