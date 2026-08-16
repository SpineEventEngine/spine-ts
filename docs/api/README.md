# API Reference

This is the detailed public-API index for framework maintainers and coding
agents. Application developers should begin with the [end-user guide](../USER_GUIDE.md)
and individual [package guides](../../README.md). TypeDoc is the canonical
declaration generator for this repository; this page explains how its entry
points fit together and records cross-package API limits.

## Interface-routing API

`EventRouting`, `CommandRouting`, and `StateUpdateRouting` each expose
`.route(Schema, via)` for one generated schema and `.route(Token, via)` for a
generated message-interface token. Exact schema wins; otherwise the first
registered matching token wins; otherwise the replacement/default applies.
Routes execute at accepted admission and retries use stored typed targets.
The legacy-named local `catchUpReadSide()` reset/replay helper reruns current
Projection subscriptions; it is not Projection catch-up. The [To-Do
guide](../../examples/todo/USER_GUIDE.md) contains executable source-linked
registration.

## 🧭 Start here

- Building a server: [`@spine-event-engine/server`](../../packages/server/README.md)
- Connecting a client: [Node](../../packages/client-node/README.md) or
  [browser](../../packages/client-web/README.md)
- Choosing storage: [`@spine-event-engine/storage`](../../packages/storage/README.md)
- Package-level limits: each package's `REFERENCE.md`

Use one detailed source for each subject rather than treating this page as a
tutorial:

| Need                                                     | Canonical detail                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Runtime and Bounded Context boundaries                   | [Architecture notes](../architecture/README.md)                                              |
| Server assembly, handlers, routing, filters, and logging | [Server reference](../../packages/server/REFERENCE.md)                                       |
| Cross-context external-event exchange                    | [Server external-event guide](../../packages/server/README.md#cross-context-external-events) |
| Integration message transport                            | [Transport reference](../../packages/transport/REFERENCE.md)                                 |
| Exact integration Protobuf contracts                     | [Proto reference](../../packages/proto/REFERENCE.md#integration-broker-contracts)            |
| Node client contract                                     | [Node client reference](../../packages/client-node/REFERENCE.md)                             |
| Browser client contract                                  | [Browser client reference](../../packages/client-web/REFERENCE.md)                           |
| React client contract                                    | [React client reference](../../packages/client-react/REFERENCE.md)                           |
| Storage, queries, provider layouts, and tenancy          | [Storage reference](../../packages/storage/REFERENCE.md)                                     |
| Remote delivery client and coordination contract         | [Delivery client reference](../../packages/delivery-client/REFERENCE.md)                     |
| Local in-memory Delivery server limits and lifecycle     | [Delivery server reference](../../packages/delivery-server/REFERENCE.md)                     |
| Common deployment and discovery contract                 | [Deployment reference](../../packages/deployment/REFERENCE.md)                               |
| GCE deployment operation                                 | [GCE deployment reference](../../packages/deployment-gce/REFERENCE.md)                       |
| GKE deployment operation                                 | [GKE deployment reference](../../packages/deployment-gke/REFERENCE.md)                       |

For the end-to-end browser/authentication extension contract, including the
exact trust-boundary limitations that TypeDoc declarations cannot convey, see
the [browser client and gateway guide](../BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md).

The generated TypeDoc reference contains the curated
`@spine-event-engine/proto` root API for copied Spine contracts, the `@spine-event-engine/core`
metadata/type registry and validation facade APIs, the `@spine-event-engine/server`
descriptor-derived entity metadata, the browser-safe injected-transport
`@spine-event-engine/client-web` protocol kernel (with explicit gRPC-Web and
Connect factories plus synchronous per-call metadata), the
`@spine-event-engine/client-node` Node transport factory and descriptor-backed query helpers,
context `Repository` registration,
set-once transition validation, explicit handler metadata APIs,
command/event bus exports, the server runtime lifecycle/async queue
kernel, write-side signal intake result exports, the runtime-routing planner
seam, the real Connect/Node `SpineServices` route registrar for the raw Spine
command/query/subscription services with storage-backed Stand subscription
definitions and local active streams, a small local `Server` lifecycle owner for real
Connect/gRPC-compatible services, `@spine-event-engine/transport`
contracts, `@spine-event-engine/storage` contracts, and the minimal
`@spine-event-engine/testing` BlackBox test boundary, optional Datastore storage, and
the MySQL-first RDBMS storage factory/errors/options.

The reference has 15 entry points, including `@spine-event-engine/client-web`,
`@spine-event-engine/client-node`, `@spine-event-engine/delivery-client`, and
`@spine-event-engine/delivery-server`. The latter is a listener-free, in-memory simple
server core; constructing a replacement core intentionally loses its state.
The delivery client facade provides curated delivery-server Inbox/Shard/Admin operations and remote
delivery ports; generated delivery RPC clients remain internal.

## Exact repository routing

`CommandRouting`, `EventRouting`, and `StateUpdateRouting` are the TypeScript
routing declarations. Each accepts an exact generated schema or a generated
interface token. Matching selects exact schema, then the first registered
matching token, then the replacement/default route. Route functions are
deterministic and side-effect-free during accepted admission, while durable
replay uses stored typed targets rather than calculating them again.

TypeScript consumes `ts_type` and ignores Java-only option fields. Frozen Proto
options remain preserved wire definitions; `ts_type` does not create transport
semantic tags or topics.
One `@Where({ eventField, equals })` equality filter may be used after type
routing on an event- or rejection-consuming `@Subscribe`, `@React`, or
`@Command` handler. `eventField` and `equals` are required typed string
literals; invalid or repeated declarations fail closed. It is not another
routing mechanism. See the [server reference](../../packages/server/REFERENCE.md)
for handler and default-route details.

## Browser client lifecycle contract

`@spine-event-engine/client-web` exports `Client` and the transport-neutral
request/subscription contracts. Compose a browser client with
`Client.forGrpcWeb(baseUrl, options)` for universal gRPC-Web, or with
`Client.forConnect(baseUrl, options)` only for a separately configured
Connect-capable endpoint. The factories never probe or fall back. Applications
may use local composition helpers such as `createGrpcWebClient` and
`createConnectClient`; those names are not additional package exports. The
package remains browser-safe: no Node transport, React, or Entity-column
generation dependency is exposed.

`forConnect()` uses binary Connect (`application/proto`) so a gateway must
permit it, including packed `Any` command/query payloads. It is explicit-only
and has no probing or fallback behavior.

Healthy browser subscription streams remain open across ordinary successive
updates. Delivery is still best effort: reconnect and an authoritative query
recover a real disconnect, duplicate, or possible gap, not normal termination.

`ClientRequest.post()` and `send()` cover commands and raw `QueryResponse`
queries. Commands are never retried. `createSubscription()` returns an inactive
handle; `activate()` begins remote work, and `cancel()` is terminal and makes
at most one bounded remote cancellation attempt per accepted wire; reconnects
can therefore clean multiple wires. Each remote cancellation is bounded to
1,000 ms. `updates` and `lifecycle` are separate bounded single-consumer
streams, with no cross-stream order guarantee. Defaults are 64 update
deliveries, 1,048,576 update bytes, 32 lifecycle notices, five retries after
the initial attempt, and 30,000 ms total retry elapsed time. The default delay
uses a 250 ms exponential base, ±20% jitter, and a 5,000 ms cap (minimum 1 ms).
Capacities, retry counts, elapsed time, and returned custom delay values are
positive safe integers; the scheduler clock is a non-negative safe integer.
Overflow is terminal, never a silent drop, and directly fails both streams with
the same error rather than enqueueing `failed`.

Each reconnect increments the lifecycle generation. Event recovery reports
`connecting`, `gapPossible`, then `connected` and continues; it does not replay
or establish cluster-complete delivery, so gaps remain possible. Entity recovery
evaluates the supplied raw/builder `authoritativeQuery` only on recovery,
requires a byte-equivalent Topic target, replaces only its request context,
reports `resynchronizing`, enqueues its authoritative raw `QueryResponse`
before held wire updates, then reports `connected`. Cancellation/client close
emits one `closed` notice before lifecycle completion only when no earlier
terminal state has won. Non-overflow terminal errors emit one `failed` notice
with the exact error before both streams fail. Signals scope an operation and
injected schedulers control retry timing; neither supplies a durable cursor, cache,
replay, ordering, or auth/session policy. Browser factories select/create their
transport but do not provide a platform close hook; `Client.close()` closes
subscription work created by the client, while an injected `ClientTransport.close()` is called
when supplied.

Proto exports include message types, generated schemas, enum values and enum
descriptors, file descriptors, and the `type_url_prefix` custom option for the
validation, core signal envelope, actor/tenant/user/version context, time, net,
and UI language contracts. Separately from that generated root reference, the
package supports imports from `@spine-event-engine/proto/client`,
`@spine-event-engine/proto/delivery`, and `@spine-event-engine/proto/delivery-server`. Those curated
wire-contract subpaths are package exports, not TypeDoc entrypoints. Arbitrary
`generated/**` paths and delivery runtime helpers are intentionally not public
APIs. The frozen source manifest pins each copied source to an upstream commit
and SHA-256. The generation workflow also compares the complete normalized
FileDescriptorSet against its frozen digest, removing only `source_code_info`
while preserving custom options and all other wire-relevant descriptor fields.
Proto package configuration is read through `ProtoConfig.read()`; manifest
creation and reading remain on the `ProtoManifest` API.

The curated Proto root also exports the integration wire contracts
`ChannelId`, `ExternalMessage`, `ExternalEventsWanted`, and
`BoundedContextOnline`, including their generated schemas and descriptors.
Broker channels carry these exact Protobuf messages; they do not use JSON or
V8 serialization.

Core exports include deterministic type URL derivation, registry and metadata
types, the default registry for the curated Spine schema set, single-message
validation result/check helpers, `ValidationException`, structured
`ValidationError` creation, the transition-validation seam,
`RejectionThrowable`, `RejectionThrowable.create()`, `RejectionThrowable.is()`,
`Identifiers`, `Stringifiers`, and `StringifierRegistry`. The storage helpers
pack supported typed IDs and map generated messages reversibly, using compact
Proto JSON by default and an application `TypeRegistry` when `Any` values must
be expanded. Generated rejection companions create validated
throwables through this factory contract. Repository command execution
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
`AnyMessages.pack()`, `AnyMessages.unpack()`,
`SignalEnvelopes.command()`, `SignalEnvelopes.event()`, `PackAnyOptions`, `PackCommandInput`, and
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
framework aggregate command transaction continue to surface as
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with packed `ValidationError`
details. Legacy/internal validation failures remain internal and are sanitized
as `COMMAND_POST_ERROR`; ordinary generated-registry aggregate loading uses the
latest persisted state. Dispatcher-thrown `ValidationException` values and other unexpected
command-bus failures remain sanitized as `COMMAND_POST_ERROR`.
The public entry points mirror Spine JVM's
`BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)`.
`ContextSpec` remains an immutable framework value surfaced through
`builder.spec` and `context.spec`; the builder collects command and event
dispatchers; `withStorageFactory(factory)` selects the storage factory used for
the context event store, repository state storage, and direct read-side stand;
and `build()` returns a
`BoundedContext` that contains mutable `CommandBus` and `EventBus` instances
internally while exposing a post-only `CommandEndpoint` and an event
listing/posting `EventEndpoint` through `commandBus()` and `eventBus()`, plus a
direct `Stand` for the context
through `stand()`. The shell validates
non-empty/non-blank names outside the reserved `__spine/` framework namespace
and records tenant mode. `builder.add(repository)` /
`builder.remove(repository)` maintain
the context repository registration list, and `build()` registers those
repositories with the built context after opening state record storage through
the context `StorageFactory`; registered repositories also make their entity
state schemas known to the context `Stand`. Built contexts also create the
internal system-pairing metadata and a framework tenant index:
single-tenant contexts use a constant index, and multitenant contexts use the
configured provider's tenant catalog. MySQL enumerates configured
tenant/database entries, Datastore enumerates native namespaces, and memory
enumerates tenant slices; no generic `TenantId` record is persisted. These
internals are not part of the end-user `BoundedContext` API. The full
system-context runtime,
command-log repositories, system event taxonomy, tracing/monitors/debug UI, and
broader JVM production runtime remain outside this public surface.
Repositories with authentic
explicit handler metadata still expose route-only `routeCommand()` /
`routeEvent()` calculations, and built contexts install internal repository
dispatcher adapters that execute aggregate command assignees in framework
transactions and execute projection subscribers. Aggregate command execution
requires `command.id` so produced events can carry a contract-valid command
origin; missing IDs reject before
mutation or storage. Aggregate command completion resolves after traceability
event-journal append and latest persisted state write; later already-stored
event redispatch failures are observable through the copy-safe
`storedEventDispatchFailures()` diagnostic snapshot on the corresponding
`BoundedContext`. Generated entity-class assembly creates default repositories
through `add(EntityClass).withGeneratedRegistryRoot(root).buildAsync()`. This
implementation does not invoke query handlers, run durable delivery catch-up, expose a
broad server lifecycle, or integrate transports. The supported durable inbox
handoffs are framework process-manager command replay, live
process-manager event replay, and live projection subscriber replay. The
local runtime writes the inbox row, drains the local shard immediately, requires
tenant-safe replay in multitenant contexts, and resolves only after that
received row is marked delivered. Process-manager event rows use
`REACT_UPON_EVENT`, projection subscriber rows use `UPDATE_SUBSCRIBER`, both
store the original `Event` envelope, and both replay only the routed row target
before the transaction and `Stand` update. Before handler code runs, replay
validates the row label, pending `TO_DELIVER` status, tenant, payload/schema,
target type URL, and routed target ID.
Pending and delivered `InboxMessage` rows are stored directly. Shard ownership
is the only concurrent-delivery exclusion; there is no per-message claim or
separate dedup record. Delivered rows are the deduplication fact. Handler
effects and the delivered-row compare-and-set are not one transaction, so a
lost acknowledgement can redeliver after restart and downstream handling must
be idempotent. `DeliveryMonitor` is the explicit failure-policy seam: by
default it marks a failed reception delivered and continues independent targets;
an application can instead choose the immediate repeat action.

Each delivery drain is bounded to one page, not to a total backlog: an active
lease owner can take later pages while its policy retains the shard. The
30-second Inbox deduplication window controls duplicate admission only. It is
not a replay-retention period; accepted rows follow their Inbox lifecycle and
may be replayed after the duplicate window has elapsed.
The framework persists no attempts, quarantine, receipts, markers, timers, backoff,
dead-letter storage, or scheduler policy.
Process-manager
repositories with authentic generated metadata do execute through the local
command/event buses: default command routing reads the first command field,
process-manager event routing reads the first event message field, state is
loaded/created and stored through `Stand`, and returned domain commands/events
are wrapped only after the current transaction and state write succeed.
`BoundedContext.catchUpReadSide(options?)` is a legacy-named, process-local
whole-read-side reset/replay maintenance helper. It is not the framework's
Projection catch-up boundary. It clears registered projection rows through
`Stand.clear()`, reads only already-stored events, and replays each event only
to registered projection subscribers whose dispatcher declares that event
message schema/type URL. It never re-appends events. Single-tenant contexts
reject `tenantId`; multitenant contexts require the exact non-blank `tenantId`.
The helper runs sequentially inside one local process and cannot select a
Projection repository, entity IDs, or a starting time. It does not return a
catch-up operation ID or implement durable progress, overlap admission, live
event coordination, delivery jobs, schedulers, inbox lifecycle, retries,
restart, resumption, or transport topology.
Server exports also include the abstract `Entity` shell, `TransactionalEntity`,
`Aggregate`, `Projection`, `ProcessManager`, `EntityFamily`,
`TransactionalEntityScopeError`, `EntityScopeReason`,
`TransactionalEntityScopeOperation`, `EntityOptions`, `EntityVersionMetadata`,
`PlainEntityVersionMetadata`, and `EntityLifecycleFlags` for local OOP entity
state with identity, descriptor-derived metadata, cloned Protobuf-ES state
snapshots, plain version metadata supplied by the caller, lifecycle flags, and
active/archive/delete accessors.
`PlainEntityVersionMetadata<T>` is the compile-time plain-shape helper used by
entity inputs so ordinary metadata interfaces can be accepted while non-plain
types such as `Date` are rejected. The shell has protected hooks used by
framework subclasses and repository/runtime seams, but no public state
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
event-history access, snapshots, subscriptions, command posting, query clients,
storage, buses, or lifecycle events. Aggregates and Process Managers do add the
protected, repository-bound event-history methods documented below;
Projections intentionally do not.
`Repository`, `RepositoryOptions`, `RepositoryEntityType`,
`ConcreteRepositoryEntityType`, `RepositoryStateSchema`,
`RepositoryIdentitySnapshot`, `RepositoryIdentityError`,
`RepositoryIdentityErrorCode`, `RepositoryCommandRoute`,
`RepositoryEventRoute`, `RepositoryRouteInvocation`, and `RepositoryView` form
the repository
identity and context registration seam. A repository records one
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
load or create one aggregate, invoke one assignee in a framework
transaction, persist the latest managed state, append the optional state history
and diagnostic event journal, then store returned domain events in the framework
event store before queueing them for event-bus delivery without appending them
again. Process-manager repositories
also participate in those adapters: command assignees are invoked from the
command bus through a durable process-manager inbox handoff. The local
runtime drains that inbox immediately, requires tenant-safe replay in
multitenant contexts, and resolves only after the received inbox row is marked
delivered. Live projection subscribers use the same local handoff shape with
`UPDATE_SUBSCRIBER` rows, original event IDs as dedup signal IDs, and exact-row
target replay through the Inbox delivery lifecycle. Live
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
`StandUpdate`, `StandSubscription`, and `StandStateTypeError` form the
direct read-side entity-state API. A stand registers known generated state
schemas, rejects unknown state types on read/update/subscribe, stores latest
states through `StorageFactory`/`RecordStorage`, reads latest state by schema
and entity ID, can return caller-supplied version metadata through
`readVersioned()`, can return storage-backed query results through
`queryVersioned()`, can return storage-order list results through
`readAllVersioned()`, can clear one registered state type through
`clear(schema, options?)`, and delivers direct in-process update notifications.
`Stand` reads durable version and lifecycle metadata from the authoritative
current entity record alongside the latest state.
Subscription cleanup is explicit via `unsubscribe()`, and multitenant stands
require a `tenantId` on point reads, list reads, updates, and subscriptions
while single-tenant stands reject tenant options.
`StandUpdate.previousState` is a copy-safe cloned snapshot of the stored state
before the update, omitted when no prior state existed, so subscribers may
retain or mutate it after delivery.
`SpineServices` adapts built-context command buses and stands to the real
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
`Subscribe` allocates an opaque ID, validates criteria, and creates one pending
definition in the context's Stand registry. `Activate` changes that definition
to active before attaching this process's delivery; missing or expired
definitions, and a definition already active for this process, produce no
updates. `Cancel` and stream finalization release local delivery and physically
delete the shared definition. Pending definitions expire after 30 seconds;
active definitions have no framework TTL.

The context builder's built-in registry capacity is from 1 through 100 admitted
definitions, or the builder may provide a custom registry. Separately,
`SpineServices.subscriptionLimit` defaults to 100 per service instance and
bounds concurrent unknown-ID cancellation work; it is not a registry or
distributed quota. `SpineServices.queueLimit` defaults to 100 queued updates
per active local stream and closes slow delivery when exhausted.
`Subscribe` accepts registered state targets and event targets exposed by
built-context event dispatchers. It rejects unknown/private targets, invalid
criteria, unsupported comparison operators, event filters, event field masks,
and unknown subscription field paths with `INVALID_ARGUMENT` before creating an
definition or attaching a listener. State `Target.include_all = true`
delivers every activated update. State `Target.filters` supports an optional ID filter plus
`ALL`/`EITHER` composite `EQUAL` field filters over generated entity state
fields, including nested message fields; missing ID filters match all IDs.
Filtered topics deliver matching new states and emit `no_longer_matching` when
the previous state matched but the new state does not. `Topic.field_mask` is
applied to delivered states, not to `no_longer_matching` updates. Event topics
support `include_all = true` in this runtime implementation and stream wire-level
`event_updates` with cloned framework `Event` envelopes. Application handlers
continue to receive generated domain event messages; framework envelopes remain
service/runtime data. Client rejection updates redact rejected-command payload
forms and throwable stack; internal generated handlers retain full defensive
context. Activation is by opaque ID. Definitions live in the configured Stand
registry: the default registry uses the application storage factory, a builder
may supply another implementation, and each definition occupies one record.
Pending definitions expire after 30 seconds; active definitions have no
framework TTL; and cancellation physically deletes the definition. Every node
reconciles a bounded complete snapshot every 10 seconds before attaching or
removing its local listener. Single-tenant subscriptions reject tenant options;
multitenant subscriptions require `tenantId`. Durable definitions do not make
live streams durable: active streams and their bounded queues remain
process-local and are not replayed after restart. `InMemorySubscriptionRegistry`
is valid for development and tests. A context using it emits a warning only
when attached to a production `ServerEnvironment`.
`Server`, `ServerOptions`, and `RunningServer` form the small public lifecycle
owner for hosting those routes over Node HTTP/2. `Environment`, `EnvironmentType`,
`ServerEnvironment`, and `ServerEnvironmentSettings` select one process-wide
storage, transport, optional delivery, and optional tracing facility set through
`ServerEnvironment.when(type).use(settings)`. `Server`
accepts built contexts and `BoundedContextBuilder` values; builders added
through `Server` use the environment storage factory unless
`withStorageFactory()` already selected a more specific local factory.
`Server.atPort(port)` defaults to local-only `127.0.0.1`; broader hosts are
explicit through `ServerOptions`. All servers share the lazily resolved
singleton; production configuration requires `storageFactory`, `transport`,
`transportFactory`, and `typeRegistry` before first resolution, and production selection itself requires
`NODE_ENV=production` before that first resolution. `RunningServer` exposes
`host`, `port`, `baseUrl`, and
idempotent `close()`. Close stops listener intake and active HTTP/2 sessions,
closes context transport intake and drains accepted work, then detaches and
quiesces environment delivery before closing contexts and explicit resources.
Shared facilities remain open when a server closes. Network or context-intake
close failure is a hard gate: delivery detach and dependency cleanup do not begin
until a later `close()` retry completes that step. After the hard gate,
remaining phases are attempted in order; failures are combined, and a later
close retries only unfinished cleanup. The API deliberately hides ZeroMQ, IPC
endpoint names, worker/process supervision, durable scheduling, and Java-style
delivery-topology configuration; it intentionally exposes this one JVM-style
global process environment configuration.

`ServerEnvironmentSettings` also accepts `transportFactory` and `typeRegistry`.
The former is the message-channel factory used by each context-owned integration
broker; the latter is the complete application schema lookup used by
`ThirdPartyContext`. Local/test resolution supplies `InMemoryTransportFactory`
and `spineCoreRegistry` when omitted. Production resolution rejects either
omission, so production applications must compose and configure their own
schema universe (for example with `TypeRegistry.from(...)`) and message
transport. The existing `transport: SignalTransport` setting remains separate
and continues to configure runtime command/event intake.

The server root exports `External<T>` (a type-only alias), `HandlerOrigin`,
`ThirdPartyContext`, and the generated registry v3 contract. The canonical
`External<T>` marker is recognized on a receptor's first parameter and produces
external metadata; unmarked handlers are domestic. `EventDispatcher` retains
the complete `messageSchemas()` set and may provide `externalEventSchemas()` as
the external subset. EventBus and repository dispatch select handlers by the
incoming `EventContext.external` flag, including per-handler filtering when a
repository mixes origins for one event type. External command inputs are
invalid; external events, rejections, and supported state subscriptions are
valid. See the [server reference](../../packages/server/REFERENCE.md) for
decorator and generated-registry details.

`ThirdPartyContext.singleTenant(name)` and `.multitenant(name)` create the
JVM-aligned hidden import context. `emittedEvent()` accepts a generated event
and a `UserId` (single-tenant) or `ActorContext` (multitenant), validates actor
tenancy, and publishes through the private broker. `close()` releases that
context and its broker resources.
`DurableSubscriptionBindings` and `DurableSubscriptionBindingsOptions` configure
the gateway storage registry used by production browser access.
`isDurableSubscriptionBindings` lets hosting code check that a supplied
`SubscriptionBindings` implementation declares this durable capability.
`@spine-event-engine/testing` exports exactly `BlackBox`, `BlackBoxOptions`,
`BlackBoxScope`, `BlackBoxTimeoutError`, and `BlackBoxClosedError`. `BlackBox`
starts an ephemeral `Server` from a built context or builder and provides
immutable guest/actor scopes over the public client contract. It supports
generated command and direct-event input, decoded Projection queries, typed
state/event subscriptions, bounded eventual assertions, and idempotent cleanup
through `close()`. It is Node/Vitest runner-neutral and deliberately exposes no raw Connect
envelopes, private server implementation types, or test-only construction seam.
Construction validates tenant, zone, `timeoutMs`, and `intervalMs` before a
context builder is built or server/client resources are acquired. Timing
values and per-`eventually()` overrides must be positive integers; invalid
overrides fail before the first read.
Repository execution uses shared entity current-record storage. Aggregates
restore the latest persisted state directly and append emitted events to a
separate diagnostic journal; neither is an event-reconstruction or snapshot
facility. `EventStore` remains the independent delivery journal. The repository
does not expose low-level persistence handles, handler invocation, delivery,
catch-up, read-side indexing, subscriptions, system events, or aggregate
repository caching.
Durable-delivery exports include the `Delivery` interface created by the builder,
`DeliveryBuilder`, `DeliveryEndpointMessage`, `DeliveryMonitor`,
`DeliveryResult`, `DeliveryRunOptions`, `DeliveryStrategy`, `DeliverySupervisor`,
`UniformAcrossAllShards`, `DeliveryStorageCorruptionError`, `Inbox`, `InboxId`,
`InboxMessage`, `InboxMessageError`, `InboxMessageId`, `InboxMessageInput`,
`InboxReadContinuation`, `InboxReadOptions`, `InboxWriteResult`, `InboxStorage`,
`InboxStorageOptions`, `DeliveryLabel`, `DeliveryStatus`, `ShardIndex`,
`ShardSession`, `ShardedWorkRegistry`, and `ShardedWorkRegistryOptions`.
`DeliveryBuilder` snapshots storage, node, shard strategy, monitor, and bounded
read options. A run picks up one shard with complete `WorkerId` fencing and
reads direct pending rows in bounded, stable order. It neither exposes pages or
retained summaries nor creates guard records, per-message claims, attempt
history, a retry policy, or a scheduler. Direct inbox writes require
`InboxMessage.id.shard` to match `InboxMessage.shard`; delivered rows are the
deduplication fact. Framework replay handles `HANDLE_COMMAND`,
`UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; `CATCH_UP` remains pending and
`IMPORT_EVENT` fails closed as storage corruption.

Pickup, renewal, acknowledgement, and release use compare-and-set fencing at
each operation. A completed `WorkerId` can recover its own unexpired session;
a different worker is excluded until it expires, and a stale owner cannot
release a newer session. `DeliveryMonitor` contains reception failures: by
default it marks the row delivered and continues independent targets; an
application may choose immediate repeat dispatch instead. There is no
callback/failure budget or timer-driven renewal model.

`DeliveryMonitor` contains endpoint failures. Its default reception action
marks the row delivered; a custom monitor may repeat dispatch immediately.
If that durable action fails, the row remains pending, later messages for that
target stop, independent targets continue, and a later run can retry. Shard
ownership protects only concurrent workers, not endpoint effects. Therefore a
lost acknowledgement can redeliver after a handler runs, and downstream effects
must be idempotent. The delivery model has no attempt history, exhaustion,
claims, quarantine, receipts, markers, timers, backoff, dead-letter storage,
or scheduler persistence.
The package does not expose a raw worker callback API; framework replay
stays behind validated endpoints. Renewal is checked through shard fencing at
protected delivery operations rather than by a timer around callbacks.
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
implementation does not add retry schedulers, persistent attempt history,
conveyor/station abstractions, generic repository delivery, projection catch-up
through Inbox storage, or production read-side catch-up workers. A
`DeliverySupervisor` repeatedly invokes finite drains, including over a remote
delivery topology, without turning delivery failures into persisted retry jobs.
Event import and aggregate importers are removed from the active plan by
upstream ADR 0001 D1. Aggregate
`@React` handlers are ordinary generated reactor handlers with
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
unsupported here and fail closed with field-specific validation
violations. The transaction kernel exports `EntityTransaction`,
`createEntityTransaction()`, typed draft/commit/rollback result contracts,
version metadata contracts, lifecycle flags, status/mutator/helper operation
types, `EntityTransactionStateError`, and
`DraftStateError`. This public surface is an in-memory,
framework draft/result boundary over one entity state. It is intentionally
not a storage-backed transaction API, repository unit of work, async-local
transaction context, dispatch step, or lifecycle-event emitter. It is a
framework compatibility seam, not an end-user manual-transaction API.
Application handlers must not start, commit, roll back, or otherwise control
transactions manually. Lifecycle
helpers mutate only buffered draft flags, `updateVersionMetadata()` replaces
only draft version metadata supplied by the caller, and `requireActive()` rejects closed
transactions or active drafts already marked archived/deleted without including
state payloads. `commit()` validates the buffered draft and closes the
transaction only for accepted commits; rejected commits return violations and
leave the transaction active. `rollback()` closes the transaction and returns
the discarded draft evidence.
Server handler metadata exports include
`EntityHandlers.define()`, `HandlerRegistrationBuilder`, the five handler
metadata roles for command assignment, command reaction, event subscription,
event reaction, and legacy event application, `HandlerParameterCount` for
canonical arity metadata, and `HandlerMetadataError` for registration-time
structural failures. Handler names must refer to prototype data methods
declared with normal class method syntax. `EntityHandlers.define()` remains
public for framework tests, generated-registry ingestion, and legacy
non-decorator migration tooling; ordinary application code should use bare
decorators plus generated registry assembly instead. Decorator adapter exports
include `@Assign`, `@Command`, `@Subscribe`, `@React`, legacy/framework-only
`@Apply`, framework-only `materializeDecoratedEntityHandlers()`,
`HandlerMethodDecorator`, and `HandlerMethodValue`. Bare `@Assign`, `@Command`,
`@Subscribe`, and `@React` are the only public decorator signatures and the
ordinary application syntax. Generated handler registries perform ordinary schema
inference. Schema-bearing handler metadata is internal/tooling input for
generated registry assembly and framework materialization; it is not a
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
The root server export is the generated-registry v3 application contract. The
exported `@spine-event-engine/server/internal/generated-handler-registry` subpath
exists only to give generated registry implementation source its required type-only
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
type. Origin classification is retained in each handler record: unmarked
handlers are domestic and canonical first-parameter `External<T>` handlers are
external. The readiness view exposes the complete event schema set and the
external subset used by the context-owned integration broker to publish wanted
events. It is not an event bus, integration
broker, import bus, event store, delivery mechanism, stand, subscription
service, command-result subscription, dispatcher, router, event posting API,
validator, repository dispatcher, storage writer, transport adapter, handler
invoker, or Spine `Ack` producer.
Bus exports include `CommandBus`, `CommandDispatcher`, `EventBus`, and
`EventDispatcher`. `CommandBus` accepts generated Spine `Command` envelopes,
queues accepted work asynchronously, and routes by enclosed message type URL to
exactly one registered dispatcher, rejecting duplicate dispatcher registration
for a command message type. `EventBus` accepts generated Spine `Event`
envelopes whose schemas are known through a registered repository producer or
dispatcher. It uses `EventStore.acceptThenAppend()` to precheck event identity,
run matching dispatcher `accept()` hooks, and append with one captured storage
context. It then calls `dispatch()` in deterministic registration order. Events
with no matching dispatcher are stored and resolve when their schema is known.
If the identity precheck
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
`@spine-event-engine/transport` topics, subscriptions, and planner-local worker IDs plus
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
does not manage the transport instance, open IPC endpoints, expose ZeroMQ details,
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
server work only. The queue has no timeout, cancellation, fairness, queue
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
registries, materialize application handlers, manage transport, storage, tracing,
or end-user envelope APIs.
It does not broaden end-user APIs into framework `Command`/`Event` envelopes,
does not reintroduce `@Apply`, and does not expose manual transaction-control
APIs.
Copied Proto semantic-tag options are wire metadata only. They are not
TypeScript `TypeRegistry` or entity metadata, repository-routing input, or
runtime-topic input. `TransportTopics.create()` and its routing key use only a
signal kind and payload type URL. Broader handler materialization remains
outside this runtime metadata surface.
The public runtime closure smoke path composes these exports with
`BoundedContext`, `Repository`, `HandlerMetadataRegistry`,
`CommandRegistrationReadiness`, `EventRegistrationReadiness`, and
`createRoutingPlan()` to prove the metadata and lifecycle
interfaces fit together. That composition produces context-scoped metadata,
command/event readiness views, immutable runtime-routing plans, and
deterministic runtime state only. The public `Server` export is a
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
`StorageGroup`,
`RecordStorage`, `RecordEntry`, `RecordSpec`, `RecordColumn`, `RecordQuery`,
`RecordContinuation`, `RecordContinuationValue`, `RecordFilter`,
`RecordOrder`, `RecordReadOptions`, `RecordMask`, `InMemoryStorageFactory`,
`InMemoryStorageBackend`, `InMemoryRecordStorage`, `EventStore`,
`OnEventAccepted`, `EntityStateHistoryStorage`, and `EntityEventStorage`.
`StorageFactory` defines one mandatory adapter seam,
`createRecordStorage(context, spec, group?)`.
`RecordStorage` persists identified Protobuf records with deterministic
ID/column/path queries, stable continuations after sorted row keys,
non-negative offsets, positive limits, and simple field masks over cloned
results. The in-memory adapter is process-local, tenant-aware through
`StorageContext`, and non-durable. A factory without an
`InMemoryStorageBackend` provides an isolated backend; independently constructed
factories deliberately share compatible tenant and record-family slices only
when supplied the same backend token.
`StorageGroup` is an optional named identity that separates record families
with the same source type. Calls in one logical backend share backing records
only when their tenant boundary, source type, and group identity match; two
omitted groups identify the same ungrouped family. Bounded Context names are
diagnostic and never enter physical storage identity. Each call still returns
an independently closeable storage handle.
`RecordStorage.delete(id)`, `read(id)`, and
`compareAndSet(id, expected, next)` address actual storage slot IDs.
`RecordStorage.query()` and `RecordStorage.queryEntries()` also filter
`RecordQuery.ids` against actual storage slot IDs; `queryEntries()` returns
those slot IDs beside each record for callers that need slot-addressed
validation or repair. `RecordStorage.index()` is the deliberate exception: it
returns logical record IDs derived from each record body through the
`RecordSpec`.
`RecordSpec` rejects duplicate declared `RecordColumn` names in its constructor,
before a factory or adapter receives the specification. It requires exactly one
ID descriptor: either Protobuf `idSchema` or a nonblank primitive `idKind`.
Every `RecordColumn` requires a typed `type` mapping.
`RecordStorage.compareAndSet(id, expected, next)` must be atomic across those
handles for one logical backing store; `next: undefined` is a conditional
delete, and `false` means the expected value did not match so no mutation was
applied. The `atomicCompareAndSet` capability defaults to `false`; a provider
sets it to `true` only when it supplies this cross-handle atomicity. Code that
requires the guarantee must reject a handle that does not declare it.
`EventStore` is a framework delegate over
`RecordStorage<EventId, Event>` and is storage-only here: it persists
and reads generated Spine events, rejects missing, blank, or duplicate event
IDs on the local append path, and can run `OnEventAccepted` between precheck
and append with one captured storage context. It does not dispatch events,
manage delivery, or fan out to subscribers.

Transport exports include `TransportSignalKind`, `TransportTopicInput`,
`TransportTopic`, `TransportRoutingDescriptor`,
`TransportSubscriptionInput`, `TransportSubscription`, `TransportSubscriptionMode`,
`TransportSignalEnvelope`,
`PublishTransportOperation`, `RequestTransportOperation`,
`PublishTransportHandler`, `RequestTransportHandler`, `AsyncCloseable`,
`TransportSubscriptionHandle`, `SignalTransport`, `TransportTopics.create()`, and
`TransportSubscriptions.create()`, `TransportOperations.hasKind()`, and
`TransportTopics.hasKind()`. This root surface is contract-only: it defines
immutable topic/subscription value objects, deterministic adapter-agnostic
routing keys, handler callback signatures, and graceful async close behavior.
It does not expose ZeroMQ socket types, endpoint strings, multipart frames,
production endpoint topology, broker processes, child process supervision,
participant lifecycle values, worker registrations, delivery attempt/result
values, retry policy, durable storage, runtime handler invocation, or server
runtime wiring.

The same root also exports the separate integration message-channel contracts:
`MessageChannel`, `Publisher`, `Subscriber`, `ExternalMessageConsumer`, and
`TransportFactory`, plus `InMemoryTransportFactory`; generated `ChannelId`
comes from `@spine-event-engine/proto`, and the ZeroMQ adapter subpath exports
`createZeroMqTransportFactory()`. These channels carry only exact generated
`ExternalMessage` Protobuf frames for the private context-owned integration
broker. They are not `SignalTransport` and expose no routing plans, signal
kinds, request/reply operations, subscriber IDs, sockets, endpoint paths, or
manifests. The ZeroMQ message adapter uses a unique manifest-backed PULL
endpoint per subscriber and dedicated PUSH connections for discovered
subscribers. Bind-before-manifest and remove-before-close ordering protects
discovery; delivery is best effort, not durable or exactly once. The private
manifest is discovery metadata, never a wire frame or broker persistence.
The transport package pins `zeromq@6.5.0` for local IPC adapter work, but that
native dependency remains outside the root TypeDoc entry point. The
adapter-scoped `@spine-event-engine/transport/zeromq` subpath exports exactly
`ZeroMqConfig`, `ZeroMqConfigInput`, `createZeroMqTransport()`,
`createZeroMqTransportFactory()`, `ZeroMqTransportScope`, and
`ZeroMqTransportOptions` for local IPC deployments. It derives deterministic
IPC endpoints from adapter config and transport routing descriptors internally,
then exposes only the
`SignalTransport` contract to runtime binding code. Socket creation, endpoint
strings, multipart frames, and native binding types remain absent from the root
API; remote signal transport, process supervision, worker
registration handshakes, delivery retries, and broad health checks are outside
this API. The adapter provides no exactly-once, durable-redelivery,
retry, restart, or remote-delivery guarantee. For transport topics marked
`command` or `event`, the private adapter uses generated Buf Protobuf binary;
the reserved `query`, `subscription`, and `system` kinds have no Protobuf wire
contract and currently retain private V8 encoding. `TransportSignalEnvelope`
correlates command/event operations and handlers with generated `Command` and
`Event` while preserving caller-selected types for other kinds. Widened or
union operations and topics can be narrowed through their fixed canonical kind
paths:

```ts
// docs-snippet-path: packages/transport/test/index.test.ts
import {
  TransportOperations,
  TransportTopics,
  type RequestTransportOperation,
  type TransportTopic,
} from "@spine-event-engine/transport";

function onTransportRequest(operation: RequestTransportOperation<{ readonly id: string }>): void {
  if (TransportOperations.hasKind(operation, "command")) {
    operation.envelope; // Inferred as the generated Command type.
  }
}

function onTransportTopic(topic: TransportTopic): void {
  if (TransportTopics.hasKind(topic, "event")) {
    topic.signalKind; // Inferred as "event".
  }
}
```

`TransportOperations.hasKind()` always compares `operation.topic.signalKind`, and
`TransportTopics.hasKind()` always compares `topic.signalKind`. They provide type
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
background-worker setting. Runtime transport tests include a native
ZeroMQ-backed command and event callback proof through the public
`SignalTransport` contract.

The generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

### Storage identity and maintenance

`@spine-event-engine/storage` identifies a record family by its source type and
optional `StorageGroup`. Use the same named group whenever handles must access
the same grouped backing; use distinct groups to separate otherwise equal
source-type families. Omitting the group selects the ungrouped family.
`InMemoryStorageBackend` is a root-exported opaque token for deliberate
in-memory sharing: factories constructed without one are isolated, while
factories supplied the same token share only compatible tenant and
record-family slices.
Closing one such factory does not clear the backend for its siblings.
The public entity-history surface is deliberately limited to
`EntityStateHistoryStorage` (`trim`, `truncate`) and `EntityEventStorage`
(`truncate`). Entity row ports and in-memory conformance seams remain internal
provider implementation details until the repository/provider milestones freeze
their SPI. Provider adapters use the explicitly marked
`@spine-event-engine/storage/internal/entity-history` subpath; it is a narrow
cross-package SPI, not an end-user root export.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON and verifies ten expected
entry points in the API model: `@spine-event-engine/proto`, `@spine-event-engine/client-web`, `@spine-event-engine/core`,
`@spine-event-engine/server`, `@spine-event-engine/storage`, `@spine-event-engine/storage-datastore`,
`@spine-event-engine/storage-rdbms`, `@spine-event-engine/transport`,
`@spine-event-engine/transport/zeromq`, and `@spine-event-engine/testing`. The
`@spine-event-engine/transport/zeromq` entry point has an exact six-export
gate. It also checks
`@spine-event-engine/server`, `@spine-event-engine/storage`, `@spine-event-engine/storage-datastore`, and
`@spine-event-engine/storage-rdbms` root exports against source
allowlists, and rejects broad generated wildcard re-exports from the proto
package root.
