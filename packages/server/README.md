# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas, explicit handler
metadata, standard decorator metadata adapters, aggregate latest-state/event
journal storage, the first command/event bus seam, and the first runtime routing
plan seam over `@spine-ts/transport` contracts, plus the first direct
storage-backed `Stand` slice for latest entity state point/list reads and
in-process update subscriptions, and a small local `Server` lifecycle owner for
real Connect/gRPC-compatible services.

Current slice exposes:

- `BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)` for
  creating builder shells with immutable context names,
  `ContextSpec` values exposed through `builder.spec` and `context.spec`, tenant
  mode metadata, command/event dispatcher collection, storage-factory injection
  for event and repository record storage, repository registration lists, and
  built contexts that own `CommandBus`, `EventBus`, and a direct `Stand`;
  and
- `Entity<Id, Schema, Version>` for a common abstract OOP state shell with
  identity, descriptor-derived metadata, cloned Protobuf-ES state snapshots,
  caller-owned plain version metadata, lifecycle flags, and
  active/archive/delete accessors; and
- `TransactionalEntity<Id, Schema, Version>` for protected, scoped draft helpers
  over `EntityTransaction`, with one active in-memory transaction per entity;
  and
- `Aggregate`, `Projection`, and `ProcessManager` abstract family marker classes
  over `TransactionalEntity`, each exposing a stable `entityFamily` identity;
  and
- `new Repository({ entityType, schema })` for repository identity and bounded
  context registration over one entity constructor and matching entity state
  schema;
  and
- `BoundedContext.singleTenant(name).add(EntityClass).withGeneratedRegistryRoot(root).buildAsync()`
  for framework-owned generated repository assembly. The explicit trusted root
  points at the compiled package/app output that contains the conventional
  generated registry module. The builder finds metadata for each entity class,
  constructs default repositories, and preserves synchronous `build()` for
  explicit `add(repository)` assembly;
  and
- `new Repository({ entityType, schema, handlers })` route calculation through
  `routeCommand()` and `routeEvent()` when explicit handler metadata is supplied.
  Direct route calls only calculate routes and do not invoke handlers; built
  contexts use the same metadata to execute aggregate command handlers,
  projection event subscribers, and process-manager command assignees, event
  reactors, and event-commanding handlers. Process-manager command assignees
  and live process-manager event reactions use framework-owned durable inbox
  rows with `HANDLE_COMMAND` or `REACT_UPON_EVENT`, original command/event
  envelopes, and immediate exact-row local shard replay. Live projection event
  subscribers use the same handoff shape with `UPDATE_SUBSCRIBER` rows and
  replay only the routed row target before the projection transaction and
  `Stand` update. Before handler code runs, replay validates the tenant,
  payload/schema, target type URL, and routed target ID.
  Transport-backed/background workers, broker supervision,
  retained attempt history, and deployment hardening remain outside this local
  slice;
  and
- `context.stand()` / `new Stand({ context, storageFactory })` for direct
  read-side entity state registration, latest-state updates, latest-state point
  and list reads with caller-supplied version metadata, `Stand.clear()` for one
  known entity type, and explicit in-process subscription cleanup;
  and
- `context.catchUpReadSide(options?: ReadCatchUpOptions)` for the first
  framework-owned local read-side catch-up slice. It clears registered
  projection state in `Stand`, reads already stored events from the
  bounded-context event log, and replays them only through registered
  projection subscribers whose dispatcher schema matches each stored event type
  URL. It does not re-append events. Single-tenant contexts reject `tenantId`;
  multitenant contexts require the exact non-blank `tenantId`. The method
  returns `ReadCatchUpResult`, runs sequentially inside one local process, and
  intentionally excludes delivery jobs, schedulers, inbox lifecycle
  management, retries, and transport topology;
  and
- `new SpineServices({ contexts }).register(router)` for the first real
  Connect/Node route registration of Spine JVM `CommandService`,
  `QueryService`, and `SubscriptionService` contracts over built bounded
  contexts, including ID-filter reads for registered state routes and
  projection-state `Target.include_all` query reads. Inactive service
  subscription records are durable through the owning context storage factory,
  while active streams and queued updates remain process-local;
  and
- `Server`, `ServerOptions`, and `RunningServer` for a small framework-owned
  HTTP/2 listener lifecycle over `SpineServices`. The default host is
  local-only `127.0.0.1`; broad binding such as `0.0.0.0` is an explicit
  caller choice. `RunningServer.close()` stops network intake, closes active
  HTTP/2 sessions, then closes owned contexts/resources and reports aggregate
  close failures after attempting every close;
  and
- `CommandRefusalError` for the current immediate business refusal path from
  command handlers to non-ok `CommandService.Post` `Ack` errors;
  and
- `COMMAND_VALIDATION_ERROR` `Ack` responses with message
  `Command payload validation failed.` and packed `spine.validation.ValidationError` details
  when `CommandBus` rejects an invalid accepted command payload before
  dispatcher execution, whether the dispatcher is a repository adapter or a
  custom `addCommandDispatcher()` registration; transition-validation
  rejections from the framework-owned aggregate command transaction surface as
  `COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with packed `ValidationError`
  details, while legacy/internal aggregate-history validation failures remain
  internal and sanitized as `COMMAND_POST_ERROR`;
  and
- `AggregateStorage` for the current finite primitive or single-field
  Protobuf message `AggregateId` latest-state and traceability event-journal
  seam, backed by `StorageFactory`, `RecordStorage`, and `EventStore`;
  `PrimitiveId` and `MessageId` expose the accepted public ID shapes;
  and
- `Delivery`, `DeliveryDrainOptions`, `DeliveryMessageDrainOptions`,
  `DeliveryEndpoint`, `DeliveryFailure`, `DeliveryLoop`, `DeliveryLoopOptions`,
  `DeliveryLoopRun`, `DeliveryLoopStatus`, `DeliveryRun`, `DeliveryWorker`,
  `DeliveryWorkerOptions`, `DeliveryWorkerRun`, `Inbox`, `InboxStorage`,
  `ShardIndex`, `ShardSession`, and `ShardedWorkRegistry` for the current durable delivery
  slice: inbox writes with durable `(signalId, inboxId)` live deduplication
  through internal guard records, shard ordering metadata with an explicit
  inbox-message UUID tie-breaker, bounded read paging via
  `InboxReadOptions.limit`, storage-backed shard pickup/release over atomic
  `RecordStorage.compareAndSet()` handles for one backing store,
  framework-owned `Delivery.drain()` runs that claim one shard,
  exact-message `Delivery.drainMessage()` runs that reject mismatched
  `message.id.shard`/`message.shard` snapshots and accept only `node` plus
  `onMessage`, a small `DeliveryLoop` that repeats those drains until idle,
  stopped, skipped, or a configured failure bound, and a closeable
  `DeliveryWorker` that owns configured shard loops for one worker node.
  Successful rows are marked `DELIVERED`; failed rows remain pending for later
  retry through the same durable `TO_DELIVER` state. Supported public delivery labels are
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, `REACT_UPON_EVENT`, and `CATCH_UP`;
  `IMPORT_EVENT` is rejected for new inbox writes before durable storage opens.
  Stored/wire legacy `IMPORT_EVENT` rows remain recognizable only as deprecated
  compatibility data and fail closed on read or drain rather than being
  delivered.
  `stop()` prevents future drain starts and does not interrupt an in-flight
  `Delivery.drain()`; `close()` calls `stop()` and waits for the current drain,
  if any, to finish. Built bounded contexts use the storage layer internally
  for process-manager command rows, process-manager event reaction rows, and
  live projection subscriber rows; their package-internal replay endpoints can
  also serve rows drained later by a delivery loop. This slice explicitly
  excludes transport topology, worker supervision, retry monitors,
  conveyor/stations, generic repository invocation, projection catch-up through
  inbox storage, broad production lifecycle, retained attempt history, durable
  catch-up storage, and example app work. Event import and aggregate importers are
  removed from the active plan by upstream ADR 0001 D1; aggregate `@React`
  handlers are ordinary generated reactor handlers with current transaction
  semantics, not event-sourcing import/applier work;
- `describeEntityMetadata(schema)` for deterministic entity kind/visibility metadata;
- `isEntitySchema(schema)` for pure descriptor checks;
- first-field routing hints from descriptor order;
- `(column)` discovery for projections/process managers, `(set_once)` field discovery for all entity kinds; and
- semantic tags from `(is)` and `(every_is)` with clear extraction errors,
  consumed by runtime routing topics through command-assignee tags and
  event-receiver tag unions; and
- `validateEntityStateTransition({ schema, previous, next })` for built-in
  `(set_once)` transition validation over descriptor-backed entity state; and
- `EntityTransaction` and `createEntityTransaction()` for a framework-owned,
  in-memory draft/commit/rollback boundary over one entity state, with draft
  lifecycle and explicit version metadata helpers; and
- `defineEntityHandlers(EntityClass, StateSchema, builder => [...])` for
  explicit, frozen handler metadata that binds generated Protobuf-ES schemas to
  entity method names in framework tests, generated-registry ingestion, and
  legacy non-decorator migration tooling. Ordinary applications should use bare
  decorators plus generated registry assembly instead; and
- `HandlerMetadataRegistry` for caller-owned metadata registration, deterministic
  lookup views, and duplicate command or legacy event application validation.
- `CommandRegistrationReadiness.fromRegistry()` /
  `CommandRegistrationReadiness.fromEntityHandlers()` for deterministic,
  metadata-only command type readiness over unique command assignments already
  validated by `HandlerMetadataRegistry`.
- `EventRegistrationReadiness.fromRegistry()` /
  `EventRegistrationReadiness.fromEntityHandlers()` for deterministic,
  metadata-only event type readiness over subscriber fan-out, reactor fan-out,
  and legacy event applications already validated by `HandlerMetadataRegistry`.
- `CommandBus` for async command posting to exactly one registered
  `CommandDispatcher`, with duplicate dispatcher rejection by command message
  type URL.
- `EventBus` for async event posting through an injected `EventStore` to
  matching registered `EventDispatcher`s in deterministic registration order.
  The bus runs `EventStore.acceptThenAppend()`, dispatcher `accept()` hooks,
  append, and then `dispatch()`; events with no dispatcher are still stored.
- `createRoutingPlan({ context, commands, events })` for the
  smallest immutable server/runtime wiring seam from built bounded-context
  metadata plus command/event readiness to transport topics, subscriptions,
  planner-local worker IDs, and explicit reserved routing seams.
- `RuntimeTransportBinding` for registering those command/event routes with a
  supplied `SignalTransport`, validating generated Spine command/event envelope
  shape and enclosed message type URL before runtime intake, and enqueuing
  accepted callbacks through `SingleProcessServerRuntime`.
- `ServerEnvironment` for a small explicit runtime environment boundary around
  storage, transport, optional delivery, optional tracing, and facility
  ownership during server assembly. Local environments use in-memory storage
  and same-process transport defaults; production environments require
  caller-supplied storage and transport before a server opens network intake.
  `Server` builds added `BoundedContextBuilder` values with the environment
  storage factory unless the builder already selected a local factory.
- `@Assign`, `@Command`, `@Subscribe`, and `@React` standard method decorators.
  Public decorators are bare-only ordinary application syntax. Schema-bearing
  handler metadata belongs to generated registry artifacts, internal tooling,
  and framework-owned materialization paths, not public decorator forms or
  end-user handler code. `@Apply` remains framework-only legacy metadata.
- `HandlerRegistryIngestor` for turning framework-generated handler registry
  artifacts into the same canonical `EntityHandlersMetadata` accepted by
  `HandlerMetadataRegistry`. The generated registry contract is versioned and
  contains entity type, state schema, handler kind, method name, inferred
  first-parameter signal schema, explicit one- or two-argument arity, and
  emitted schemas inferred from explicit return types. Build-time analysis
  derives and validates command/event roles from generated descriptors before
  writing those registry records. Generated `@Assign` and `@Command` producer
  records must declare at least one emitted schema; `@React` records may return
  generated event messages or explicit `void` with no emitted schemas.
  `@Subscribe` records return explicit `void` and declare no emitted schemas.
  Generated registry files live under ignored `generated/` output and are not
  committed.
- `GeneratedRegistryDiscovery` for framework/tooling loading of explicit
  generated registry
  filesystem paths or clean `file:` URLs, or the conventional runtime file
  location
  `generated/handler/generated-handler-registry.js`, then ingesting those
  registries into a caller-owned `HandlerMetadataRegistry`. Unsupported
  non-`file:` URL schemes and `file:` URL query/hash aliases fail
  deterministically before import.
- `SingleProcessServerRuntime` for the first explicit server-owned lifecycle
  and async queue kernel with `start()`, `close()`, deterministic states, and
  post-intake work execution in a later microtask.
- `acceptSignalIntake()` / `failSignalIntake()` and `SignalIntakeResult` for
  typed write-side command/event intake outcomes that distinguish
  accepted-for-async-work from immediate intake failure without implementing
  `Ack`, buses, filters, storage, dispatch, services, or transport.

```ts
import { create } from "@bufbuild/protobuf";
import { Aggregate, Assign, BoundedContext, React, Subscribe } from "@spine-ts/server";
import type { CreateTask } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema, type TaskCreated } from "./generated/tasks_pb.js";

export class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, number> {
  @Assign
  create(command: CreateTask): TaskCreated {
    void command;
    return create(TaskCreatedSchema);
  }

  @Subscribe
  noteCreated(event: TaskCreated): void {
    void event;
  }

  @React
  reactToCreated(event: TaskCreated): TaskCreated {
    void event;
    return create(TaskCreatedSchema);
  }
}

const tasks = await BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .withGeneratedRegistryRoot(new URL("..", import.meta.url))
  .buildAsync();

tasks.commandBus().acceptedCommandTypes(); // generated command schemas
tasks.registeredRepositories().map((repository) => repository.entityType.name);
```

`buildAsync()` is the ordinary application bridge from bare decorators to
default repositories. Entity-class assembly requires
`withGeneratedRegistryRoot(compiledPackageRoot)` so the framework imports only
the conventional generated registry module under an explicit trusted root.
Generated registry discovery and ingestion stay inside the framework-owned
assembly path; application code adds entity classes, not
`HandlerMetadataRegistry` values. The low-level explicit registration API,
including `defineEntityHandlers()`, remains public only for framework tests,
generated-registry ingestion, and legacy non-decorator migration tooling. It
records command assignments, command reactions, event subscriptions, event
reactions, and legacy event applications in declaration order. Handler names
must refer to own prototype data methods declared with normal class method
syntax; accessors, `constructor`, inherited methods, and instance fields are
rejected without invoking user code. The API does not invoke handlers, enforce
transactions or `(set_once)`, build repositories, write storage, register buses,
start transport, or implement service adapters.

The decorator API is an adapter over that explicit contract. Decorators record
standard per-class metadata from public instance methods only. Bare
`@Assign`, `@Command`, `@Subscribe`, and `@React` are the ordinary application
forms and are the only public decorator signatures. Schema-bearing handler
metadata is internal/tooling input for generated registry assembly and
framework-owned `materializeDecoratedEntityHandlers()` paths, not an
application decorator form. Decorators do not use `emitDecoratorMetadata`,
`reflect-metadata`, parameter decorators, a global handler registry, or handler
invocation.

Generated handler registry tooling infers the signal schema from each
handler's explicit first parameter type, derives command/event schema roles
from generated descriptors, and infers emitted schemas from explicit return
types. `@Assign` emits generated domain events, `@Command` emits generated
domain commands, `@React` either emits generated domain events or returns
explicit `void` with no emitted schemas, and `@Subscribe` returns explicit
`void` and emits none. End-user handlers return generated domain messages;
repository execution wraps returned commands/events into framework envelopes
internally after the current transactional work succeeds. Ordinary application
code does not use schema-bearing decorators, does not define new `@Apply`
handlers, and does not own transactions manually.
Both `handler(signal)` and `handler(signal, context)` are part of the public
signature contract. `HandlerRegistryIngestor` validates version `1`, rejects
new generated `@Apply`/event-application records, checks generated arity and
emitted-schema/schema-shape rules, and then routes records through
`defineEntityHandlers()`. Canonical handler metadata records `parameterCount`;
explicit internal metadata registrations default to one-argument invocation,
while generated records preserve their declared arity. Built repository execution
calls generated two-argument command assignees with the generated
`CommandContext` from the command envelope. It calls generated two-argument
event subscribers, command reactions, and event reactors with the generated
`EventContext` from the event envelope. If an envelope omits context,
repository execution passes an empty generated context message of the proper
schema. `@Apply` remains one-argument only. The internal build-time writer
renders deterministic
registry modules under ignored `generated/` output only when explicitly
invoked. `GeneratedRegistryDiscovery` is the matching runtime anchor for
explicit file loading. It accepts caller-provided filesystem paths or clean
`file:` URLs, offers helpers for the conventional runtime file location
`generated/handler/generated-handler-registry.js`, rejects unsupported
non-`file:` URL schemes and query/hash aliases deterministically, validates
top-level module shape, reports stable import/export/module/ingestion failure
codes, and registers discovered metadata through `HandlerRegistryIngestor`.
Broad automatic scanning and global runtime loading remain out of scope.

`HandlerMetadataRegistry` registers existing `EntityHandlersMetadata` objects
and exposes frozen listing/lookup arrays by entity state full type name, handler
kind, and command/event message full type name. One registry rejects duplicate
command assignments for the same command message type and duplicate event
applications for the same entity state plus event message type. Command
reactions, event subscriptions, and event reactions may fan out to multiple
handlers for the same message type. The registry is caller-owned and
metadata-only: constructing or registering it does not instantiate entities,
invoke methods, unpack payloads, mutate global process state, write storage, or
start buses/transports.

`CommandRegistrationReadiness` is a read-only command-registration view over
the same handler metadata. It reports registered command message full type
names in deterministic order and returns frozen copy-safe assignee metadata for
the unique command assignment of a message type. Building from entity handler
metadata first constructs a `HandlerMetadataRegistry`, so duplicate command
assignment failures remain owned by the registry. This surface is not a command
bus, command service, dispatcher, router, validator, repository runtime
registration hook, storage writer, transport adapter, handler invoker, or
Spine `Ack` producer.

`EventRegistrationReadiness` is the matching read-only event-registration view
over the same handler metadata. It reports registered event message full type
names in deterministic code-unit order and returns frozen copy-safe metadata
for event subscribers, event reactors, and legacy event applications grouped by
event type. Subscriber and reactor lookups preserve Spine event fan-out, so multiple
entities may receive the same event type. Event application uniqueness remains
the registry policy: one entity state may apply a given event type once, while
multiple entity states may apply the same event type. Domestic/external event
classification and integration-broker wanted-event publication remain outside
the current surface because TypeScript handler metadata has no external-event
marker.
This surface is not an event bus, integration broker, import bus, event store,
delivery mechanism, stand, subscription service, command-result subscription,
dispatcher, router, validator, repository runtime registration hook, storage
writer, transport adapter, handler invoker, or Spine `Ack` producer.

`CommandBus` is the first executable write-side bus seam in this package. It
accepts generated Spine `Command` envelopes, snapshots them at post time,
queues accepted work on an internal single-process async runtime, and routes by
the enclosed message type URL to exactly one registered `CommandDispatcher`.
Dispatcher registration rejects duplicates for the same command message type
URL. The bus invokes dispatcher objects only; it does not instantiate
entities, invoke entity methods directly, validate tenants, map `Ack`, write
storage, or own repository routing.

`EventBus` is the matching executable multicast seam for generated Spine
`Event` envelopes. It snapshots accepted events at post time, finds matching
registered `EventDispatcher`s by event message schema, and runs
`EventStore.acceptThenAppend()` so event identity precheck, dispatcher
`accept()` hooks, and append share one captured storage context. It then calls
`dispatch()` in deterministic dispatcher registration order. Repository
dispatchers use `accept()` for fail-closed route validation before persistence.
If no dispatcher is registered for the event type, the stored event remains and
`post()` resolves. If the identity precheck or dispatcher acceptance fails, the
event is not stored by this bus. If append fails, no `dispatch()` method runs,
but dispatcher `accept()` hooks may already have run. If a dispatch call
rejects, earlier dispatchers may already have run, later dispatchers are not
invoked, and the stored event remains. The `EventStore` remains storage-only:
`EventBus` owns validation-before-append and append-before-dispatch ordering by
delegating to it, while `EventStore`
continues to avoid fan-out, retries, inbox, or delivery behavior on its own.
The current TypeScript event-dispatch contract is message-type-based only;
domestic/external filtering remains outside the current surface until handler
metadata exposes that distinction.

`createRoutingPlan()` is the first server-owned runtime-wiring seam
over that metadata. It requires a built `BoundedContext` and accepts optional
concrete `CommandRegistrationReadiness` / `EventRegistrationReadiness`
instances. When readiness is present, it derives command topics plus one
competing-consumer command-worker ID from command readiness and event
topics plus fan-out subscriptions and event-worker IDs from
subscriber/reactor/application readiness. Without readiness, the corresponding
command or event plan is empty. It returns immutable `@spine-ts/transport`
topics, subscriptions, planner-local worker IDs, and small server-owned route
descriptors. Those public route descriptors contain planner-local route and
worker IDs, sanitized message full type names/type URLs, stable receiver
groups, transport correlation keys for the topic/subscription arrays, and
planner-local worker IDs; they do not expose handler methods, entity type names, raw
readiness metadata, ZeroMQ endpoints, socket topology, or duplicate full
transport contracts on each route.
Query, subscription, and system routing remain explicit reserved seams because
this slice has no concrete server readiness metadata for them. The planner does
not open sockets, name IPC endpoints, start workers, dispatch handlers,
validate signals, store delivery state, supervise broker or worker processes,
run retry policy, or expose buses/services.

`RuntimeTransportBinding.open({ plan, transport, runtime, onCommand, onEvent })`
makes those command/event routes executable over the adapter-agnostic
`SignalTransport` contract. It registers command routes with request/respond
semantics and event routes with publish/subscribe semantics, validates inbound
generated Spine command/event envelopes before `SingleProcessServerRuntime`
intake, and queues accepted callbacks asynchronously. Command request handlers
return immutable signal-intake results. Event publish handlers throw
`RuntimeTransportEnvelopeError` for immediate envelope refusal. The returned
handle is idempotent and closes registered transport handles before closing the
runtime. The binding does not own the transport, choose endpoint names, expose
ZeroMQ types, supervise processes, retry failures, store events, or create a
server/environment owner. Local IPC deployments may supply the adapter-scoped
`createZeroMqTransport()` from `@spine-ts/transport/zeromq`, but the
server API continues to depend only on `SignalTransport`.

## Single-Process Runtime Kernel

Use `SingleProcessServerRuntime` as the small local lifecycle and asynchronous
intake kernel underneath command/event buses and later delivery,
process-supervision, and service-hosting runtime parts:

```ts
import { SingleProcessServerRuntime } from "@spine-ts/server";

const runtime = new SingleProcessServerRuntime();

await runtime.start();

const accepted = runtime.enqueue(async () => {
  // Later runtime slices will enqueue server-owned signal work here.
});

await accepted;
await runtime.close();
```

The lifecycle states are deterministic: `created -> running` on `start()`,
`created -> closed` when closed before start, and
`running -> closing -> closed` when close drains already accepted work. Calling
`start()` while already running is a no-op. Calling `close()` more than once is
idempotent and returns the same close outcome. New work is accepted only while
the runtime is `running`; attempts to enqueue work while `created`, `closing`,
or `closed` throw `ServerRuntimeStateError`.

`enqueue()` is an intake boundary. It returns a promise for the accepted work
item, but the work itself runs in a later microtask and queued work runs in
FIFO order. A failed item rejects only its own returned promise and does not
stop later accepted items. `close()` prevents new intake and waits for already
accepted work to settle before the runtime becomes `closed`.

Enqueued callbacks are trusted server-owned work only. The queue has no
timeout, cancellation, fairness, queue bound, or hostile-callback protection,
so non-settling work can keep `close()` pending. Same-runtime reentrant
`enqueue()` and `close()` calls from active work are rejected to avoid queue
self-deadlocks; nested bus `post()` calls on the same bus surface that rejection.

This kernel is deliberately server-runtime-specific and single-process only. It
is not a global singleton, process supervisor, generic job framework, command
bus, event bus, import bus, repository dispatcher, event store, durable inbox,
read-side stand, tenant index, integration broker, gRPC server, ZeroMQ
transport, worker-process runtime, or storage-backed delivery mechanism.

## Runtime Signal Metadata

Use `SignalMetadata` when framework code or advanced local callers need a small
shared policy for generated Spine command/event metadata:

```ts
import { FixedClock, SignalIds, SignalMetadata } from "@spine-ts/server";

const metadata = new SignalMetadata({
  clock: new FixedClock(new Date("2026-07-09T10:11:12.345Z")),
  ids: new SignalIds(() => "signal-1"),
});

const commandId = metadata.commandId();
const eventId = metadata.eventId();
const timestamp = metadata.timestamp();
```

`SignalMetadata` owns the local policy for command IDs, event IDs, timestamps,
actor/tenant command context, source-event/source-command origin chains,
primitive producer IDs, and `Version` values. Deterministic tests inject a
`Clock` (`SystemClock` or `FixedClock`) and `SignalIds` instance instead of
relying on mutable global time or ID state. Repository-produced follow-up
commands/events use this seam for timestamp/origin/producer/version metadata in
the supported local runtime paths.

This slice is intentionally small. It does not change end-user handler APIs,
materialize application handlers, own storage or transport, register process
globals, trace signals, or expose a broad container/service abstraction.
Handlers still return generated domain command/event messages rather than
framework `Command`/`Event` envelopes, `@Apply` remains absent for new
aggregate behavior, and this metadata seam does not add manual transaction
control for end-user code.
Descriptor-derived semantic tags now flow into runtime routing topics:
command topics copy command-assignee entity tags, and event topics copy the
deduplicated union of receiver entity tags. Broader handler materialization and
application-owned semantic-tag registration remain outside this slice.

## Write-Side Signal Intake Results

Use `SignalIntakeResult` when later command/event intake code needs to report
whether a signal was accepted for future asynchronous runtime work or failed
immediately at the intake edge:

```ts
import { acceptSignalIntake, failSignalIntake } from "@spine-ts/server";

const accepted = acceptSignalIntake("command");
accepted.status; // "accepted"
accepted.acceptedFor; // "async-work"

const failed = failSignalIntake("event", "RUNTIME_NOT_ACCEPTING", {
  boundedContext: "Tasks",
  runtimeState: "closed",
});
failed.failure.code; // "RUNTIME_NOT_ACCEPTING"
```

Accepted results are immutable values only. They mean the runtime accepted
responsibility for later asynchronous work; they do not mean the signal was
stored, dispatched, delivered, handled, acknowledged, or successfully applied.

Failure results carry a stable `SignalIntakeFailureCode` and frozen scalar
diagnostics. Diagnostic values are copied only from allowlisted own enumerable
data properties, limited to strings, numbers, booleans, or `null`; unknown keys,
accessor properties, and payload-shaped metadata are discarded. This keeps
immediate intake evidence useful for later mapping without exposing full signal
data.

This seam deliberately does not call `SingleProcessServerRuntime.enqueue()`,
create Spine `Ack` messages, validate tenants or messages, filter signals,
store events, dispatch handlers, run services, or expose transport behavior.

## Metadata And Routing Smoke Slice

Framework tests and non-decorator migrations can still assemble explicit
handler metadata with repository identity and registration-readiness views when
they need to inspect routing descriptors directly:

```ts
import {
  Aggregate,
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  HandlerMetadataRegistry,
  Repository,
  RuntimeTransportBinding,
  SingleProcessServerRuntime,
  createRoutingPlan,
  defineEntityHandlers,
} from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, number> {
  create(command: unknown): void {}
  onCreated(event: unknown): void {}
}

const taskRepository = new Repository({
  entityType: TaskAggregate,
  schema: TaskStateSchema,
});
const tasks = BoundedContext.singleTenant("Tasks").add(taskRepository).build();
const handlers = defineEntityHandlers(TaskAggregate, TaskStateSchema, (builder) => [
  builder.assign(CreateTaskSchema, "create"),
  builder.subscribe(TaskCreatedSchema, "onCreated"),
]);
const registry = new HandlerMetadataRegistry([handlers]);
const routingPlan = createRoutingPlan({
  context: tasks,
  commands: CommandRegistrationReadiness.fromRegistry(registry),
  events: EventRegistrationReadiness.fromRegistry(registry),
});

CommandRegistrationReadiness.fromRegistry(registry).registeredCommandMessageFullTypeNames();
EventRegistrationReadiness.fromRegistry(registry).registeredEventMessageFullTypeNames();
routingPlan.commands.topics;
```

This assembly proves the low-level metadata and routing-plan seams fit
together. To execute the command/event routes locally, pass that plan to
`RuntimeTransportBinding.open()` with a `SignalTransport`, a
`SingleProcessServerRuntime`, and framework-owned `onCommand` / `onEvent`
callbacks. The binding still does not provide delivery, storage policy, service
hosting, `Ack` behavior, endpoint ownership, or a process supervisor. Route
calculation remains a metadata and transport-plan concern; the routing plan
deliberately does not create worker registrations, lifecycle handles, queues,
buses, repositories, storage, services, or transport endpoints.

## Bounded Context Assembly

Create a bounded-context shell through the JVM-familiar entry points:

```ts
import { BoundedContext } from "@spine-ts/server";

const tasks = BoundedContext.singleTenant("Tasks").build();
const customers = BoundedContext.multitenant("Customers").build();

tasks.name.value; // "Tasks"
tasks.tenantMode; // "single-tenant"
customers.isMultitenant; // true
```

Names must be non-empty, non-blank, and outside the reserved `__spine/`
framework namespace. `ContextSpec` is a framework-owned immutable value exposed
from the builder and built context. `build()` returns a `BoundedContext` that
owns mutable command/event buses internally while exposing a post-only
`commandBus()` endpoint and an event listing/posting `eventBus()` endpoint. The
endpoints do not expose
late dispatcher registration. Builders collect dispatchers and can inject the
`StorageFactory` used to create the context `EventStore` and repository record
storages, plus the direct stand state storage:

```ts
import { BoundedContext } from "@spine-ts/server";
import { InMemoryStorageFactory } from "@spine-ts/storage";

const tasks = BoundedContext.singleTenant("Tasks")
  .withStorageFactory(new InMemoryStorageFactory())
  .addCommandDispatcher(commandDispatcher)
  .addEventDispatcher(eventDispatcher)
  .build();

await tasks.commandBus().post(commandEnvelope);
await tasks.eventBus().post(eventEnvelope);
```

`add(repository)` appends a repository to the builder registration list, and
`remove(repository)` removes it before build. `build()` registers the listed
repositories with the built context, opens repository `RecordStorage` through
the context storage factory, and exposes `registeredRepositories()` as a
copy-safe list of frozen snapshot-backed views for runtime registration
inspection. Repository state schemas are also registered with the context-owned
`stand()` as known state types.
Repeated `add(repository)` calls before `build()` are idempotent.
Registering the same repository instance with another built context is rejected.
Aggregate command execution requires `command.id` so produced events can carry
a contract-valid command origin; missing IDs reject before mutation or storage.
`CommandBus` validates accepted command payloads before dispatcher callbacks,
including custom `addCommandDispatcher()` routes. For repository-backed
aggregate dispatchers, that still means validation happens before route
calculation, latest persisted state load, traceability event-journal append,
latest-state write, or stored-event dispatch. `CommandService.Post` maps
command-bus payload validation failures to `COMMAND_VALIDATION_ERROR` with
message `Command payload validation failed.` and packed
`spine.validation.ValidationError` details. If a command handler throws
`CommandRefusalError`, `CommandService.Post`
returns a non-ok `Ack` with that stable error type and message instead of
`COMMAND_POST_ERROR`. If an aggregate command handler produces an invalid
state transition, command execution rejects with
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` before storing produced
traceability events or latest state; the validation details remain the
framework transaction / `validateEntityStateTransition()` result.
Legacy/internal aggregate-history replay failures remain internal and are
sanitized as `COMMAND_POST_ERROR`; ordinary generated-registry aggregate
loading uses the latest persisted state instead of replaying stored events.
Dispatcher-thrown `ValidationException` values and other unexpected command-bus
failures remain sanitized as `COMMAND_POST_ERROR`.
Aggregate command completion resolves after traceability event-journal append
and latest-state write even though already-stored event redispatch continues
asynchronously. If that later redispatch fails in dispatcher acceptance,
dispatcher execution, projection subscribers, or `Stand` updates, the owning
context records a copy-safe diagnostic snapshot through
`storedEventDispatchFailures()`; it does not retry or run catch-up delivery.

Generated entity-class assembly creates default repositories through
`add(EntityClass).withGeneratedRegistryRoot(root).buildAsync()`. Built contexts
now create internal system-pairing metadata and a framework-owned tenant index:
single-tenant contexts use a constant index, and multitenant contexts persist
tenant IDs through the configured storage factory. This slice still does not
invoke query handlers, construct the full system-context runtime, provide
command-log repositories, emit the full system event taxonomy, provide
tracing/monitors/debug UI, start query/subscription buses, expose a broad
production lifecycle, or integrate transports. Process-manager command
assignees, process-manager event reactors and event-commanding handlers, and
live projection subscribers now write durable inbox rows before the current
local shard drain replays them, and the post does not resolve until that
received row is marked delivered. The package also exposes a small closeable
`DeliveryWorker` wrapper for configured shard loops. Scheduler/retry workers,
cross-process recovery, production delivery policy, retained attempt history,
and supported catch-up work remain open production gaps.

## Direct Stand

Use the context-owned `Stand` for direct latest-state reads, storage-backed
latest-state queries, and in-process entity update notifications:

```ts
const stand = tasks.stand();

await stand.update(TaskStateSchema, taskState, { version });
const latest = await stand.read(TaskStateSchema, taskId);
const all = await stand.readAllVersioned(TaskStateSchema);
const newest = await stand.queryVersioned(TaskStateSchema, {
  sort: [{ field: "createdAt", direction: "desc" }],
  limit: 10,
});

const subscription = stand.subscribe(TaskStateSchema, (update) => {
  update.state;
});
subscription.unsubscribe();
```

Repositories registered with a built context make their state schemas known to
that context's stand. Stand reads, updates, and subscriptions reject unknown
state schemas with `StandStateTypeError`. Multitenant stands require
`{ tenantId }` on point reads, list reads, updates, and subscriptions; single-
tenant stands reject tenant options. `queryVersioned()` accepts the storage
`RecordQuery` slice for IDs, exact filters, masks, ordering, and positive
limits; `readAllVersioned()` is the no-filter convenience path. Both return
`StandReadResult` entries in deterministic storage query order and reuse the
same caller-supplied version metadata as point reads. Stand version metadata is
process-local and in-memory only; the current slice persists latest state
records through storage, but not the side-map that associates those states with
versions. Direct subscriptions are deterministic in-process callbacks and must
be cleaned up explicitly. `clear(schema, options?)` deletes the stored rows and
process-local version metadata for one registered state schema and is the
framework-owned reset step used by `catchUpReadSide()`.

`catchUpReadSide(options?)` is intentionally narrow: it replays only
already-stored events into registered projection subscribers, clears then
rebuilds projection rows in `Stand`, never re-appends events, and remains a
process-local sequential helper rather than a durable live-traffic Delivery
replacement. Custom event dispatchers, delivery jobs, schedulers, inbox
lifecycle, retries, and transport topology remain out of scope for this slice.
`SpineServices` adapts built-context command
buses and stands to the first `CommandService`, `QueryService`, and
`SubscriptionService` methods, including `QueryService.Read` support for
ID filters on any registered state route and projection-state
`Target.include_all = true` reads. Projection queries also support top-level
`EQUAL` filters over declared projection `(column)` proto field names,
`ResponseFormat.field_mask`, repeated `ResponseFormat.order_by` over declared
proto column names, and positive `limit` values when at least one ordering
directive is present. Use proto column names such as `open_task_count`, not
generated TS local names such as `openTaskCount`. Undeclared columns,
unsupported operators, nested/disjunctive composites, limits without ordering,
missing criteria, and `include_all = false` return `INVALID_QUERY` before
reading Stand storage.

`SubscriptionService.Subscribe` accepts known registered state targets and
known event targets exposed by built-context event dispatchers. Unknown or
private targets, invalid criteria, unsupported comparison operators, event
filters, event field masks, and unknown subscription field paths are rejected
with `INVALID_ARGUMENT` before creating a subscription or attaching delivery.
Accepted subscriptions are inactive, opaque records stored through the owning
bounded context storage factory; a new `SpineServices` instance over the same
storage factory can recover and activate a previously returned ID. Activation
consumes the durable row before live attachment, so durable storage contains
inactive records only. Updates recorded before `Activate` are not replayed.
`Activate` attaches state subscriptions to the context `Stand` and event
subscriptions to a framework-internal `EventBus` listener by subscription ID. State
`Target.include_all = true` delivers every activated update.
State `Target.filters` supports an optional ID filter plus
`ALL`/`EITHER` composite `EQUAL` field filters over generated entity state
fields, including nested message fields. Missing ID filters match all IDs. For
filtered topics, matching new states are delivered; if the previous state
matched and the new state no longer matches, the update carries
`no_longer_matching` instead. `Topic.field_mask` is applied to delivered
state updates and is not applied to `no_longer_matching` updates. Event topics
support `include_all = true` in this runtime slice and stream wire-level
`event_updates` containing cloned framework `Event` envelopes for matching
event message type URLs. Application handlers continue to receive generated
domain event messages through handler dispatch; framework `Event` envelopes are
service/runtime data. Single-tenant subscriptions reject tenant options;
multitenant subscriptions require `tenantId`; state and event delivery are scoped to that
tenant slice. Missing, unknown, canceled, or expired activation IDs complete
without updates, and duplicate activation for an already-active ID completes
without updates while leaving the active stream attached. `Cancel` returns OK
for unknown, missing, canceled, or already-cleaned IDs and removes matching
durable inactive records. Cleanup is idempotent when a client cancels, an
activation iterator closes, an inactive record expires, or the active queue
limit is exceeded. Malformed and inconsistent durable rows are deleted instead
of failing repeatedly. The inactive TTL defaults to 30 seconds and the active
queue limit defaults to 100 queued updates. Active service streams, queued updates,
direct Stand subscriptions, Stand version metadata, and the in-memory storage
adapter's backing data remain process-local development/test state, not durable
delivery or catch-up storage. Cross-context fallback, client query DSLs,
comparison subscription operators, retained update replay, active-stream
persistence, and durable cross-process Delivery/subscription recovery catch-up
remain outside this slice.

## Local Server Lifecycle

Use `Server` when a local Node process should host the built Spine services over
HTTP/2:

```ts
import { BoundedContext, Server, ServerEnvironment } from "@spine-ts/server";
import type { StorageFactory } from "@spine-ts/storage";
import type { SignalTransport } from "@spine-ts/transport";

declare const durableStorageFactory: StorageFactory;
declare const deploymentSignalTransport: SignalTransport;

const tasks = await BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .withGeneratedRegistryRoot(new URL("..", import.meta.url))
  .buildAsync();

const server = await Server.atPort(8080).add(tasks).start();

server.host; // "127.0.0.1" by default
server.baseUrl; // "http://127.0.0.1:8080"

await server.close();
```

`Server` reuses `SpineServices` directly and keeps ZeroMQ, local IPC endpoints,
worker supervision, and retry policy out of the public API.
`Server.atPort(port)` binds to `127.0.0.1`; pass `{ host: "0.0.0.0" }` only
when this process should accept non-local clients. The returned `RunningServer`
exposes `host`, `port`, `baseUrl`, and an idempotent `close()`.

The server uses a small explicit `ServerEnvironment`. Omitting it creates a
server-owned local environment with `InMemoryStorageFactory` and same-process
transport defaults. Supplying one leaves it caller-owned unless
`ownsEnvironment: true` is explicit:

```ts
const environment = ServerEnvironment.production({
  storageFactory: durableStorageFactory,
  transport: deploymentSignalTransport,
});

await Server.atPort(8080, { environment }).add(tasks).start();
```

Production construction rejects missing `storageFactory` or `transport` before
network intake opens. Production mode validates explicit facility injection
only; durable production storage adapters remain an open production gap, and
`InMemoryStorageFactory` is local/test-only. The environment selects and owns
facilities for server assembly. `Server` accepts built contexts and
`BoundedContextBuilder` values; builders added through `Server` use
`ServerEnvironment.storageFactory` unless `withStorageFactory()` selected a
more specific local factory first. This object is not a Java-style process-wide
singleton, and it does not introduce endpoint topology or worker execution.

Shutdown is deterministic: the listener stops accepting new requests first,
then active HTTP/2 sessions close, then owned contexts and explicit
framework-owned resources close, then environment-owned facilities close when
the server owns the environment. Resource cleanup continues after failures and
throws one `AggregateError` containing every close failure. A later `close()`
retry attempts only the close hooks that failed previously. Listener-based
tests may fail with `EPERM` in managed sandboxes that block loopback binds;
rerun those checks natively when verifying this lifecycle.

## Entity State Shell

Extend `Entity` when framework-owned code needs a common base for local entity
state and metadata without introducing repository/runtime behavior:

```ts
import { Entity } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskEntity extends Entity<string, typeof TaskStateSchema, number> {}

const task = new TaskEntity({
  id: "task-1",
  schema: TaskStateSchema,
  state: taskState,
  version: 7,
});

task.id; // "task-1"
task.metadata.fullTypeName; // TaskStateSchema.typeName
task.state; // cloned state snapshot
task.isActive; // true unless archived or deleted
```

The constructor derives metadata with `describeEntityMetadata(schema)`, snapshots
the supplied Protobuf-ES state, defaults lifecycle flags to active/not deleted,
and snapshots plain version metadata values. Version metadata accepts primitives,
`null`, arrays, and plain objects; functions, typed arrays, buffers, dates,
maps, sets, class instances, and proxies are rejected. The exported
`PlainEntityVersionMetadata<T>` type helper preserves ordinary plain metadata
interfaces at entity input boundaries while rejecting known non-plain types such
as `Date`. State and version access return cloned snapshots so caller mutation
does not mutate stored entity state. Protected replacement hooks are current
framework-owned seams used by `TransactionalEntity` and repository code to
apply accepted drafts; there are no public state setters, Java
builders, automatic version increments, transactions, handler invocation,
repository writes, storage calls, lifecycle events, routing, queries, buses,
transports, or global runtime state.

`TransactionalEntity` is the small protected draft layer used by the current
entity family base classes. Subclasses can start one active transaction,
read/update the draft state snapshot, replace explicit draft version metadata,
adjust draft lifecycle flags, and then commit or roll back. Accepted commits
apply state, version metadata, and lifecycle flags back into the entity through
the base protected replacement hooks. Rejected commits do not apply anything and
keep the transaction active so subclass code can correct the draft or roll it
back explicitly. `changed` reports accepted state changes or committed
lifecycle flag changes only; it is not a repository storage decision. Missing
or duplicate transaction scopes throw `TransactionalEntityScopeError`
deterministically. Public state, version, and lifecycle accessors remain cloned
snapshots, and the class still does not invoke handlers, write storage, emit
events, increment versions, route messages, or provide async-local/global
transaction state.

`Aggregate`, `Projection`, and `ProcessManager` are the first public entity
family base classes. They are thin abstract subclasses of `TransactionalEntity`
with the same `<Id, Schema, Version>` generic pattern and a stable
readonly `entityFamily` property returning `"aggregate"`, `"projection"`, or
`"process-manager"`. Use them when application or framework-owned code needs
the right OOP family type for repositories and built contexts:

```ts
import { Aggregate } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, number> {}
```

The family marker classes inherit identity, metadata, cloned snapshots,
lifecycle accessors, `changed`, and protected transaction helpers from
`TransactionalEntity`. They do not add public transaction mutators, command
posting, event history, snapshots, subscriptions, query clients, process
workflow execution, handler invocation, storage, buses, or lifecycle events.

## Repository Identity

Use `Repository` to describe that one entity constructor owns one
descriptor-backed state schema:

```ts
import { Aggregate, BoundedContext, Repository } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, number> {}

const repository = new Repository({
  entityType: TaskAggregate,
  schema: TaskStateSchema,
});

repository.entityFamily; // "aggregate"
repository.stateFullTypeName; // TaskStateSchema.typeName
repository.snapshot.stateFullTypeName; // immutable fresh-copy snapshot

const tasks = BoundedContext.singleTenant("Tasks").add(repository).build();
tasks.registeredRepositories()[0]?.stateFullTypeName; // TaskStateSchema.typeName
```

The constructor derives descriptor metadata with `describeEntityMetadata()` and
infers the entity family from same-realm constructor and instance prototype
chains reaching `Aggregate`, `Projection`, or `ProcessManager`. Alias imports,
namespace/member base-class expressions, and intermediate domain base classes
are accepted. Explicitly reparented same-realm ES classes are trusted as
metadata; this is not a sandbox boundary. The API rejects constructors outside
those families and rejects mismatched family/schema pairs, such as an aggregate
class with a projection state schema, with simple `RepositoryIdentityError`
code/message diagnostics. `BoundedContextBuilder.add(repository)` and
`remove(repository)` maintain the builder registration list, and `build()`
attaches each listed repository to the built context. Registration state belongs
to `BoundedContext`, which exposes `registeredRepositories()` as frozen
snapshot-backed `RepositoryView` values. The context opens state `RecordStorage`
using the repository state schema and the context `StorageFactory`. Repeated
`add(repository)` calls before `build()` are idempotent. Registering the same
repository instance with another built context is rejected. When explicit
handler metadata is supplied, `routeCommand()` and `routeEvent()` calculate
repository routes for the current storage/routing slice.
Process-manager command routing uses the first command message field as the
process-manager ID; process-manager event routing uses the first event message
field, not the producer ID fallback used by aggregate/projection event routes.
Built contexts use the same metadata to run process-manager command assignees,
event reactors, and event-commanding handlers. Process-manager state is loaded
or created through the context `Stand`, stored back as a tenant-scoped Stand
record when changed, and uses numeric `Version.number` metadata. End-user
process-manager handlers return generated domain commands/events; repository
execution wraps them in framework `Command`/`Event` envelopes only after
transaction commit and state storage. Process-manager produced events are
posted through the event bus so they are appended to the `EventStore` before
fan-out; post-commit dispatch failures are recorded in
`storedEventDispatchFailures()`. Process-manager command assignees,
process-manager event reactors and event-commanding handlers, and live
projection subscribers now use the framework-owned durable inbox handoff with
immediate local shard replay/drain. Process-manager event rows use
`REACT_UPON_EVENT`, keep the original `Event` envelope as the payload, use the
original event ID as `signalId`, and replay only the stored target row before
handler execution. Before handler code runs, replay validates tenant,
payload/schema, target type URL, and routed target ID.
Supported delivery workers, scheduler/retry workers, cross-process recovery,
retry monitors, retained attempt history, production delivery policy, and
supported catch-up work remain open production gaps. This seam follows Spine
`core-jvm` `Repository` identity and registration concepts closely. The direct
repository API does not create, find, or store entities; invoke handlers; write
inboxes; manage caches; emit lifecycle events; or touch transport.

## Entity State Transition Validation

Use `validateEntityStateTransition()` when framework-controlled transaction
code or tests need the built-in entity state rules without creating entities or
repositories:

```ts
import { validateEntityStateTransition } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

const result = validateEntityStateTransition({
  schema: TaskStateSchema,
  previous,
  next,
});

if (!result.valid) {
  result.violations.map((violation) => violation.fieldPath?.fieldName.join("."));
}
```

The validator derives `(set_once)` fields from `describeEntityMetadata()`.
Creation transitions where `previous === undefined` may initialize supported
set-once fields. Once a previous state exists, each supported set-once field
must remain equal in the proposed next state. Violations are returned through
the `@spine-ts/core` transition validation facade as repo-local
`spine.validation.*` messages, carry the `fieldPath`, and do not include raw
previous or next values. Repeated, map-valued, and explicit optional
`(set_once)` fields are not supported in this slice, matching the JVM generation
boundary; they fail closed with field-specific violations even when their
contents are unchanged or the transition is a creation.

## Entity Transactions

Use `createEntityTransaction()` when framework-controlled code needs an
in-memory buffered draft over previous state before accepting a commit result:

```ts
import { createEntityTransaction } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

const transaction = createEntityTransaction({
  schema: TaskStateSchema,
  previous,
  version: { previous: 7, draft: 8 },
});

transaction.update((state) => ({ ...state, name: "Ready" }));
transaction.archive();
transaction.updateVersionMetadata(9);

const result = transaction.commit();

if (result.status === "accepted") {
  result.next; // accepted state snapshot
  result.lifecycle.archived; // true
  result.version.committed; // 9
}
```

`commit()` calls `validateEntityStateTransition({ schema, previous, next })`.
Ordinary validation failures, such as changing a `(set_once)` field, return a
rejected result with the validator violations instead of throwing:

```ts
transaction.update((state) => ({ ...state, id: "different-id" }));

const result = transaction.commit();

if (result.status === "rejected") {
  result.validation.violations.map((violation) => violation.fieldPath?.fieldName.join("."));
}
```

Compatibility note: `EntityTransaction` is the public draft/result shape used
by framework-owned entity bases around state mutation. It is not a
storage-backed transaction, a unit-of-work implementation, or a process-wide
runtime context; applications should treat its returned snapshots as validation
and commit evidence rather than as persisted state.

`rollback()` releases the transaction and returns previous/draft evidence
without accepting state. `archive()`, `unarchive()`, `markDeleted()`, and
`restore()` mutate only buffered lifecycle flags; `updateVersionMetadata()`
replaces only caller-owned draft version metadata and does not compute version
increments, clocks, producer metadata, or event versions. `requireActive()`
guards active-only state mutation by rejecting committed/rolled-back
transactions and active drafts already marked archived or deleted. After an
accepted commit or rollback, active-only helpers throw
`EntityTransactionStateError` deterministically; archived/deleted active drafts
throw `EntityTransactionDraftStateError` without embedding entity state payloads.

This is only an in-memory commit boundary for entity base classes and
repository-owned execution. It does not instantiate entities, invoke handlers,
write repositories or storage, apply snapshots, dispatch messages, register
buses, start transport, or provide async-local/global transaction state.
