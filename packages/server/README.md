# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas, explicit handler
metadata, standard decorator metadata adapters, aggregate snapshot/event storage,
the first command/event bus seam, and the first runtime routing plan seam over
`@spine-ts/transport` contracts, plus the first direct storage-backed `Stand`
slice for latest entity state point/list reads and in-process update
subscriptions.

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
- `new Repository({ entityType, schema, handlers })` route calculation through
  `routeCommand()` and `routeEvent()` when explicit handler metadata is supplied.
  Direct route calls only calculate routes and do not invoke handlers; built
  contexts use the same metadata to execute aggregate command handlers and
  projection event subscribers through the command and event buses;
  and
- `context.stand()` / `new Stand({ context, storageFactory })` for direct
  read-side entity state registration, latest-state updates, latest-state point
  and list reads with caller-supplied version metadata, and explicit in-process
  subscription cleanup;
  and
- `new SpineServices({ contexts }).register(router)` for the first real
  Connect/Node route registration of Spine JVM `CommandService`,
  `QueryService`, and `SubscriptionService` contracts over built bounded
  contexts, including projection-state ID-filter and `Target.include_all`
  query reads;
  and
- `CommandRefusalError` for the current immediate business refusal path from
  command handlers to non-ok `CommandService.Post` `Ack` errors;
  and
- `AggregateStorage` for the current primitive-`AggregateId`
  snapshot/history seam, backed by `StorageFactory`, `RecordStorage`, and
  `EventStore`;
  and
- `Delivery`, `Inbox`, `InboxStorage`, `ShardIndex`, `ShardSession`, and
  `ShardedWorkRegistry` for the first durable delivery slice: inbox writes with
  durable `(signalId, inboxId)` live deduplication through internal guard
  records, shard ordering metadata with an explicit inbox-message UUID
  tie-breaker, bounded read paging via `InboxReadOptions.limit`, and
  storage-backed shard pickup/release over atomic
  `RecordStorage.compareAndSet()` handles for one backing store. This slice
  explicitly excludes worker loops, retry monitors, conveyor/stations,
  repository invocation, broad server lifecycle, transport retries, and example
  app work;
- and
- `describeEntityMetadata(schema)` for deterministic entity kind/visibility metadata;
- `isEntitySchema(schema)` for pure descriptor checks;
- first-field routing hints from descriptor order;
- `(column)` discovery for projections/process managers, `(set_once)` field discovery for all entity kinds; and
- semantic tags from `(is)` and `(every_is)` with clear extraction errors; and
- `validateEntityStateTransition({ schema, previous, next })` for built-in
  `(set_once)` transition validation over descriptor-backed entity state; and
- `EntityTransaction` and `createEntityTransaction()` for a framework-owned,
  in-memory draft/commit/rollback boundary over one entity state, with draft
  lifecycle and explicit version metadata helpers; and
- `defineEntityHandlers(EntityClass, StateSchema, builder => [...])` for
  explicit, frozen handler metadata that binds generated Protobuf-ES schemas to
  entity method names; and
- `HandlerMetadataRegistry` for caller-owned metadata registration, deterministic
  lookup views, and duplicate command/applier validation.
- `CommandRegistrationReadiness.fromRegistry()` /
  `CommandRegistrationReadiness.fromEntityHandlers()` for deterministic,
  metadata-only command type readiness over unique command assignments already
  validated by `HandlerMetadataRegistry`.
- `EventRegistrationReadiness.fromRegistry()` /
  `EventRegistrationReadiness.fromEntityHandlers()` for deterministic,
  metadata-only event type readiness over subscriber fan-out, reactor fan-out,
  and event applications already validated by `HandlerMetadataRegistry`.
- `CommandBus` for async command posting to exactly one registered
  `CommandDispatcher`, with duplicate dispatcher rejection by command message
  type URL.
- `EventBus` for async event posting through an injected `EventStore` to
  matching registered `EventDispatcher`s in deterministic registration order.
  The bus runs `EventStore.acceptThenAppend()`, dispatcher `accept()` hooks,
  append, and then `dispatch()`; events with no dispatcher are still stored.
- `createServerRuntimeRoutingPlan({ context, commands, events })` for the
  smallest immutable server/runtime wiring seam from built bounded-context
  metadata plus command/event readiness to transport topics, subscriptions,
  planner-local worker IDs, and explicit deferred routing seams.
- `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` standard method
  decorators that require explicit Protobuf-ES schemas and materialize into the
  same handler metadata contract.
- `SingleProcessServerRuntime` for the first explicit server-owned lifecycle
  and async queue kernel with `start()`, `close()`, deterministic states, and
  post-intake work execution in a later microtask.
- `acceptSignalIntake()` / `failSignalIntake()` and `SignalIntakeResult` for
  typed write-side command/event intake outcomes that distinguish
  accepted-for-async-work from immediate intake failure without implementing
  `Ack`, buses, filters, storage, dispatch, services, or transport.

```ts
import {
  Apply,
  Assign,
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  HandlerMetadataRegistry,
  React,
  Subscribe,
  createServerRuntimeRoutingPlan,
  defineEntityHandlers,
  materializeDecoratedEntityHandlers,
} from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  @Assign(CreateTaskSchema)
  create(command: unknown): void {}

  @Subscribe(TaskCreatedSchema)
  noteCreated(event: unknown): void {}

  @React(TaskCreatedSchema)
  reactToCreated(event: unknown): void {}

  @Apply(TaskCreatedSchema, { allowImport: true })
  onCreated(event: unknown): void {}
}

const decoratedTaskHandlers = materializeDecoratedEntityHandlers(TaskAggregate, TaskStateSchema);

const explicitTaskHandlers = defineEntityHandlers(
  TaskAggregate,
  TaskStateSchema,
  ({ assign, subscribe, react, apply }) => [
    assign(CreateTaskSchema, "create"),
    subscribe(TaskCreatedSchema, "noteCreated"),
    react(TaskCreatedSchema, "reactToCreated"),
    apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
  ],
);

decoratedTaskHandlers.handlers.map((handler) => handler.kind);
decoratedTaskHandlers.eventApplications[0]?.allowImport; // true

const registry = new HandlerMetadataRegistry([decoratedTaskHandlers]);
registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"

const readiness = CommandRegistrationReadiness.fromRegistry(registry);
readiness.registeredCommandMessageFullTypeNames(); // [CreateTaskSchema.typeName]
readiness.findCommandAssignee(CreateTaskSchema.typeName)?.handler.methodName; // "create"

const eventReadiness = EventRegistrationReadiness.fromRegistry(registry);
eventReadiness.registeredEventMessageFullTypeNames(); // [TaskCreatedSchema.typeName]
eventReadiness.findEventSubscribers(TaskCreatedSchema.typeName)[0]?.handler.methodName;
// "noteCreated"
eventReadiness.findEventReactors(TaskCreatedSchema.typeName)[0]?.handler.methodName;
// "reactToCreated"
eventReadiness.findEventApplications(TaskCreatedSchema.typeName)[0]?.handler.allowImport; // true

const routingPlan = createServerRuntimeRoutingPlan({
  context: BoundedContext.singleTenant("Tasks").build(),
  commands: readiness,
  events: eventReadiness,
});
routingPlan.commands.workerIds[0]; // "command-worker-1"
routingPlan.commands.routes[0]?.message.typeUrl; // "type.spine.io/..."
routingPlan.commands.routes[0]?.receiverGroup; // "command-assignee"
routingPlan.events.subscriberRoutes[0]?.subscriptionDescriptorKey; // correlate to top-level subscriptions
routingPlan.events.subscriberRoutes[0]?.workerId; // planner-local event worker id
routingPlan.deferred.map(({ signalKind }) => signalKind);
// ["query", "subscription", "system"]

explicitTaskHandlers.handlers.map((handler) => handler.methodName); // same contract
```

The explicit registration API records command assignments, command reactions,
event subscriptions, event reactions, and event applications in declaration
order. Handler names must refer to own prototype data methods declared with
normal class method syntax; accessors, `constructor`, inherited methods, and
instance fields are rejected without invoking user code. The API does not
invoke handlers, enforce transactions or `(set_once)`, build repositories, write
storage, register buses, start transport, or implement service adapters.

The decorator API is an adapter over that explicit contract. Decorators record
standard per-class metadata from public instance methods only, require explicit
generated schemas, and materialize after confirming the handler names still
refer to the entity class's own prototype methods. Decorators do not use
`emitDecoratorMetadata`, `reflect-metadata`, parameter decorators, inferred
message types, a global handler registry, or handler invocation.

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
for event subscribers, event reactors, and event appliers grouped by event
type. Subscriber and reactor lookups preserve Spine event fan-out, so multiple
entities may receive the same event type. Event application uniqueness remains
the registry policy: one entity state may apply a given event type once, while
multiple entity states may apply the same event type. Domestic/external event
classification and integration-broker wanted-event publication are deferred
because the current TypeScript handler metadata has no external-event marker.
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
domestic/external filtering remains deferred until handler metadata exposes that
distinction.

`createServerRuntimeRoutingPlan()` is the first server-owned runtime-wiring seam
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
Query, subscription, and system routing remain explicit deferred seams because
this slice has no concrete server readiness metadata for them. The planner does
not open sockets, name IPC endpoints, start workers, dispatch handlers,
validate signals, store delivery state, supervise broker or worker processes,
run retry policy, or expose buses/services.

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

The current slice can be assembled with repository identity and
registration-readiness metadata, but the result is still metadata and routing
descriptors only:

```ts
import {
  Aggregate,
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  HandlerMetadataRegistry,
  Repository,
  createServerRuntimeRoutingPlan,
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
  builder.apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
]);
const registry = new HandlerMetadataRegistry([handlers]);
const routingPlan = createServerRuntimeRoutingPlan({
  context: tasks,
  commands: CommandRegistrationReadiness.fromRegistry(registry),
  events: EventRegistrationReadiness.fromRegistry(registry),
});

CommandRegistrationReadiness.fromRegistry(registry).registeredCommandMessageFullTypeNames();
EventRegistrationReadiness.fromRegistry(registry).registeredEventMessageFullTypeNames();
routingPlan.commands.topics;
```

This assembly proves the current public seams fit together; it does not turn
registered command/event metadata into runtime dispatch, delivery, handler
invocation, service hosting, or `Ack` behavior. Route calculation remains a
metadata and transport-plan concern; the routing plan deliberately does not
create worker registrations, lifecycle handles, queues, buses, repositories,
storage, services, or transport endpoints.

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

Names must be non-empty and non-blank. `ContextSpec` is a framework-owned
immutable value exposed from the builder and built context. `build()` returns a
`BoundedContext` that owns mutable command/event buses internally while exposing
post-only `commandBus()` and `eventBus()` endpoints. The endpoints do not expose
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
Repository aggregate execution validates the unpacked command payload before
route calculation, aggregate history load, event append, snapshot write, or
stored-event dispatch. If an aggregate command handler throws
`CommandRefusalError`, `CommandService.Post` returns a non-ok `Ack` with that
stable error type and message instead of `COMMAND_POST_ERROR`. If an event
applier commits a transaction rejected by entity transition validation, command
execution rejects with `COMMAND_STATE_TRANSITION_VALIDATION_FAILED` before
storing produced events or snapshots; the validation details remain the
`EntityTransaction`/`validateEntityStateTransition()` result.
Aggregate command completion resolves after aggregate event storage and
snapshot handling even though already-stored event redispatch continues
asynchronously. If that later redispatch fails in dispatcher acceptance,
dispatcher execution, projection subscribers, or `Stand` updates, the owning
context records a copy-safe diagnostic snapshot through
`storedEventDispatchFailures()`; it does not retry or run catch-up delivery.

This slice deliberately does not create default repositories from entity
classes, invoke query/process handlers, construct system contexts, start
query/subscription buses, write tenant indexes, expose a broad server
lifecycle, or integrate transports.

## Direct Stand

Use the context-owned `Stand` for direct latest-state reads, storage-order
latest-state list reads, and in-process entity update notifications:

```ts
const stand = tasks.stand();

await stand.update(TaskStateSchema, taskState, { version });
const latest = await stand.read(TaskStateSchema, taskId);
const all = await stand.readAllVersioned(TaskStateSchema);

const subscription = stand.subscribe(TaskStateSchema, (update) => {
  update.state;
});
subscription.unsubscribe();
```

Repositories registered with a built context make their state schemas known to
that context's stand. Stand reads, updates, and subscriptions reject unknown
state schemas with `StandStateTypeError`. Multitenant stands require
`{ tenantId }` on point reads, list reads, updates, and subscriptions; single-
tenant stands reject tenant options. `readAllVersioned()` returns
`StandReadResult` entries in deterministic storage query order and reuses the
same caller-supplied version metadata as point reads. Direct subscriptions are
deterministic in-process callbacks and must be cleaned up explicitly.
`SpineServices` adapts built-context command
buses and stands to the first `CommandService`, `QueryService`, and
`SubscriptionService` methods, including `QueryService.Read` support for
projection-state ID filters and `Target.include_all` reads. Cross-context
fallback, client query DSLs, event subscriptions, field filtering, and
projection catch-up remain outside this slice.

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
does not mutate stored entity state. Protected replacement hooks exist only for
later framework-owned subclasses; there are no public state setters, Java
builders, automatic version increments, transactions, handler invocation,
repository writes, storage calls, lifecycle events, routing, queries, buses,
transports, or global runtime state.

`TransactionalEntity` is the small protected draft layer for future
framework-owned entity families. Subclasses can start one active transaction,
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
the right OOP family type before repositories and dispatch runtime exist:

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
`add(repository)` calls before
`build()` are idempotent. Registering the same repository instance with another
built context is rejected. When explicit handler metadata is supplied,
`routeCommand()` and `routeEvent()` calculate deferred repository routes for the
current storage/routing slice. This seam follows Spine `core-jvm` `Repository`
identity and registration concepts closely. This API does not create, find, or
store entities; invoke handlers; write inboxes; manage caches; emit lifecycle
events; or touch transport.

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

Compatibility note: `EntityTransaction` is the public draft/result shape that
future framework-owned entity bases can use around handler execution. It is not
a storage-backed transaction, a unit-of-work implementation, or a process-wide
runtime context; applications should treat its returned snapshots as evidence
for later runtime layers rather than as persisted state.

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

This is only an in-memory commit boundary for future entity base classes. It
does not instantiate entities, invoke handlers, write repositories or storage,
apply snapshots, dispatch messages, register buses, start transport, or provide
async-local/global transaction state.
