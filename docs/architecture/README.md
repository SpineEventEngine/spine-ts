# Architecture Notes

Current status: early implementation notes through the first command/event bus,
runtime-routing, and transport-foundation seams.

Architecture documentation starts from the build protocol and specification documents under `build-protocol/`. This folder is reserved for implementation-era architecture notes that evolve with actual package boundaries and runtime behavior.

## Proto Contract Boundary

The `proto/` tree now contains the first verbatim copied Spine contract
closures. `@spine-ts/proto` compiles those contracts and exposes a curated root
API with Protobuf-ES schemas, descriptors, message types, enum descriptors, enum
values, and custom options. This boundary is intentionally contract-only:

- generated schemas are available for later metadata and validation tasks;
- copied source provenance is verified by `proto/spine-sources.json`;
- canonical `Command`, `Event`, `ActorContext`, `TenantId`, `UserId`,
  `Version`, diagnostics, enrichment, and transitive time/net/UI support
  contracts are available without hand-written TypeScript shapes; and
- buses, transport, entity runtime behavior, and runtime metadata generation
  remain out of scope until later tasks.

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

Semantic tag lookup is available as an API shape, but no tags are registered in
this slice. The current copied proto set defines the Spine `(is)` and
`(every_is)` options but does not include registered message consumers that make
tag extraction provable.

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
responsibilities remain with later runtime slices.

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
  preserved in deterministic sorted order.

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

`defineEntityHandlers()` is the explicit metadata target that later decorators
must produce. It accepts an entity class, a state schema, and a builder callback
whose methods record command assignment, command reaction, event subscription,
event reaction, and event application metadata. Each handler record keeps the
generated Protobuf-ES schema, message full type name, handler kind, and entity
method name. Event application metadata also records `allowImport` for future
import/replay machinery.

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
contract. `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` require
explicit generated Protobuf-ES schemas, collect declarations from public
instance methods into standard per-class decorator metadata, and
`materializeDecoratedEntityHandlers()` confirms the recorded handler names are
still own prototype methods before producing ordinary `EntityHandlersMetadata`.
This keeps decorated classes compatible with `HandlerMetadataRegistry` and
preserves `defineEntityHandlers()` as the canonical fallback for environments
that avoid decorators. The adapter does not use legacy `emitDecoratorMetadata`,
`reflect-metadata`, parameter decorators, inferred message type metadata, or a
process-wide handler registry.

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
`lifecycleFlagsChanged` accessors. Protected replacement hooks give future
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
reject unknown state types before any future gRPC service layer exists.
This follows the JVM `Repository` identity surface (`entityClass()`,
`idClass()`, and `entityStateType()`) plus the first context-owned lifecycle
step. When authentic explicit handler metadata is supplied, repositories now
calculate deferred command/event routes and bounded-context assembly registers
internal dispatcher adapters for those routes. The TypeScript seam deliberately
omits `create`, `find`, `store`, record conversion, handler invocation,
entity storage/cache/catch-up, inbox/delivery, lifecycle monitors, gRPC
services, and transport.

`EntityTransaction` is the first server-owned draft/result commit boundary over
one entity state. It buffers a draft state, explicit previous/draft version
metadata, lifecycle flags, and visible status (`active`, `committed`, or
`rolled-back`). The compatibility contract is intentionally small and
JVM-familiar: this API owns only in-memory transaction evidence for future
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
  name, tenant mode, and event-storage metadata for future runtime work;
- `BoundedContextBuilder.addCommandDispatcher()` /
  `removeCommandDispatcher()` and `addEventDispatcher()` /
  `removeEventDispatcher()` collect dispatchers for the context being built;
- `BoundedContextBuilder.withStorageFactory(factory)` selects the
  `StorageFactory` used to create the context `EventStore` and repository state
  storage;
- `BoundedContextBuilder.add(repository)` and `remove(repository)` maintain the
  context-owned repository registration list;
- `BoundedContextBuilder.build()` is the only supported path for constructing a
  built `BoundedContext`; and
- built contexts expose name, tenant mode, spec, a copy-safe small snapshot,
  frozen snapshot-backed `RepositoryView` values, and post-only `commandBus()` /
  `eventBus()` endpoints backed by internally owned buses, plus a context-owned
  direct `stand()`.

This keeps the TypeScript API JVM-familiar without pretending that later
runtime collaborators already exist. Application code does not subclass
`BoundedContext` or directly instantiate shell classes. Runtime constructor
guards also reject direct JavaScript escape hatches so callers cannot bypass
name validation or the builder-only build path by passing ad hoc objects.

The current `Stand` slice is intentionally direct and storage-backed. It owns
known generated state schemas, latest-state `RecordStorage`, direct
read/update methods, and deterministic in-process subscription handles with
explicit `unsubscribe()`. It preserves read-side/write-side segregation by
requiring callers to record state updates directly; it does not invoke
repository handlers, run projections, catch up from events, expose gRPC
QueryService/SubscriptionService, or provide a client query DSL.

The following runtime pieces are still deferred to later explicit tasks:

- default repository construction from entity classes,
  visibility/type-supplier registration, and lifecycle callbacks over the
  repository identity seam;
- handler invocation over the deferred repository routes;
- inbox/delivery storage, durable storage lifecycle, entity storage/cache
  catch-up, and tenant-index persistence;
- gRPC query/subscription service execution and richer query filtering;
- system-context pairing and server/gRPC services; and
- ZeroMQ endpoint topology and transport-backed runtime execution.

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
`createServerRuntimeRoutingPlan()`.

This is intentionally enough for later runtime tasks to share vocabulary and
tests around "context metadata plus lifecycle plus readiness." It is not an
equivalent of Spine JVM `Server` or a running JVM-style `BoundedContext`.
The readiness views remain metadata-only and do not dispatch or invoke
handlers. The runtime-routing plan does not open transport endpoints, expose
ZeroMQ details, or start workers; it only turns existing metadata into
transport-owned topics, subscriptions, planner-local worker IDs, explicit
deferred seams, and sanitized route descriptors. Those route descriptors expose
message type names/type URLs plus stable receiver-group and local route/worker
identities, along with transport correlation keys back to topic/subscription
arrays and planner-local worker IDs; they do not retain entity names, handler
names, raw readiness metadata, or duplicate full transport contracts on each
route. The package root now exports a small executable bus layer, but still
does not export service, transport, delivery, stand, integration-broker,
handler invocation/runtime wiring, command/event intake validation, or `Ack`
mapping as part of this closure.

The architectural consequence is that later work must add those collaborators
as explicit tasks at their own seams. Command and event intake can consume the
existing readiness views and runtime-routing plan, but must still design
validation, `Ack` mapping, filtering, storage-before-dispatch, dispatch
outcomes, delivery, and transport integration separately.

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

Aggregate snapshot/history storage is available through the current
`AggregateStorage` seam. Delivery records, tenant indexes, diagnostics,
repository storage policy, read-side projection stores, and durable production
storage remain deferred.

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
choose ZeroMQ socket topology, endpoint naming, durable delivery, retry loops
or timers, process supervision, readiness probes over IPC, handler invocation,
repository dispatch, storage lifecycle, read-side execution policy,
participant lifecycle, worker registrations, delivery attempts/results, or
retry classification. Those decisions remain in later transport and runtime
tasks.

The transport package now pins the maintained official `zeromq@6.5.0` line for
the local IPC adapter foundation. That native dependency is adapter-private: current
helper code validates a local IPC configuration shape and keeps native module
typing out of the public entry point, while package-private smoke tests prove
same-host publish/subscribe and request/reply IPC over temporary endpoints. The
tests do not define production endpoint layout, frame protocols, broker
topology, worker registration handshakes, delivery retries, process
supervision, or server runtime wiring. The workspace explicitly approves the
`zeromq` install script in pnpm configuration, so dependency restoration must
run in an environment that permits native package build/install scripts.
Managed sandboxes may reject ZeroMQ `ipc://` binds with `EPERM`, so live local
IPC smoke tests can require native IPC filesystem/socket permissions outside
the sandbox. Per D-0007, this adapter path is for same-host IPC only; scaling
beyond one host remains the job of a different transport behind the same public
contract.
