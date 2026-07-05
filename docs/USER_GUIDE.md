# Spine TS User Guide

Current status: early framework guide for the descriptor registry,
single-message validation facade, core envelope construction helpers, the first
server entity, handler, repository, and bounded-context metadata
layers, the first command/event bus seam, the first server runtime routing
seam, the real Connect/Node `SpineServices` route registrar for the raw Spine
command/query/subscription services, adapter-agnostic transport contracts, and
the first storage contracts with an in-memory adapter.

This guide covers the behavior and contracts available now: Spine proto
descriptors are exposed through curated packages, `@spine-ts/core` can derive
and look up type metadata, framework users can validate one Protobuf message at
a time, and callers can pack already-built domain messages into generated Spine
`Command`/`Event` envelopes. `@spine-ts/server` now derives descriptor-backed
entity metadata from `(entity)`, `(column)`, `(set_once)`, `(is)`, and
`(every_is)` options, exposes a first common abstract entity state shell, and
defines explicit or decorator-collected handler metadata without invoking
handlers or mutating global runtime state. It also exposes built-in
`(set_once)` entity state transition validation, a buffered entity transaction
boundary, thin aggregate/projection/process-manager family base classes, a
caller-owned handler metadata registry for duplicate validation and lookup-only
views, a repository identity and registration seam, and a first
bounded-context builder shell.
`@spine-ts/transport` now exposes adapter-agnostic topics, subscriptions, and
publish/request handler interfaces; ZeroMQ remains an adapter-private local IPC
dependency rather than a public runtime API. `@spine-ts/server` can derive an
immutable `createServerRuntimeRoutingPlan()` from built context metadata plus
command/event readiness, yielding transport topics, subscriptions, and
planner-local route descriptors without opening sockets or invoking handlers.
The same package now also exposes a small executable `CommandBus` and
`EventBus` over registered dispatcher objects, with event storage delegated to
`EventStore` before event fan-out. `SpineServices` registers generated Spine
service descriptors with Connect/Node so callers can host `CommandService.Post`,
`QueryService.Read`, and `SubscriptionService.Subscribe/Activate/Cancel` over a
real gRPC-compatible runtime.
`@spine-ts/storage` exposes asynchronous record-oriented storage contracts and a
deterministic in-memory adapter for tests/development. Built bounded contexts
can now execute aggregate command assignees/appliers and dispatch produced
aggregate events to projection subscribers that update `Stand`; broader entity
runtime dispatch, transport endpoint execution, durable production storage,
broader server lifecycle, and the to-do application remain later slices.

## What Exists Now

- A pnpm workspace with package boundaries for proto, core, server, transport, storage, and testing.
- Strict TypeScript project references configured for ESM-first NodeNext packages.
- Tooling commands for type checking, linting, formatting, tests, coverage, TypeDoc, and Buf/Protobuf-ES generation.
- A first copied Spine proto set under `proto/`, with provenance checksums in
  `proto/spine-sources.json`.
- Curated Protobuf-ES schemas, descriptors, message types, and Spine custom
  options exported from `@spine-ts/proto` for the first intake set.
- A core type registry in `@spine-ts/core` that derives Spine type URLs,
  exposes a read-only default lookup view for the current curated schemas, and
  looks up descriptor-backed metadata by full type name, type URL, or schema.
- Canonical Spine core command/event envelope and context contracts are
  available from `@spine-ts/proto` and pre-registered in
  `spineCoreRegistry`, including `CommandSchema`, `EventSchema`,
  `ActorContextSchema`, `TenantIdSchema`, `UserIdSchema`, and
  `VersionSchema`.
- A core validation facade that validates single Protobuf messages through
  `@spine-event-engine/validation-ts` while returning repo-local Spine
  `ValidationError` and `ConstraintViolation` data.
- Core `packAny()`, `unpackAny()`, `packCommand()`, and `packEvent()` helpers
  for Spine-aware payload packing and generated command/event envelope
  construction.
- Server entity metadata helpers in `@spine-ts/server` that normalize entity
  kind and visibility, expose first-field routing hints, surface `(column)`
  fields for projections/process managers, surface `(set_once)` fields for all
  entity kinds, and preserve semantic tags from `(is)` and `(every_is)`.
- A common abstract server `Entity` shell that exposes identity,
  descriptor-derived metadata, cloned Protobuf-ES state snapshots, caller-owned
  plain version metadata, lifecycle flags, active/archive/delete accessors, and
  sticky lifecycle-change tracking.
- A protected `TransactionalEntity` base that wraps the transaction kernel with
  one active scoped draft per entity and applies only accepted commits back to
  the entity shell.
- Thin abstract `Aggregate`, `Projection`, and `ProcessManager` family marker
  classes over `TransactionalEntity`, each with stable `entityFamily` identity.
- A `Repository` identity API that binds one aggregate, projection, or
  process-manager constructor to one matching entity state schema and returns
  immutable fresh-copy snapshots for later checks. `BoundedContext` owns
  repository registration and opens state record storage through its storage
  factory.
- A direct storage-backed `Stand` owned by each built `BoundedContext`.
  Registered repositories make their entity state schemas known to the stand,
  which can record latest states, read them by schema and ID, and notify
  in-process subscribers.
- A small `BoundedContext.storedEventDispatchFailures()` diagnostic snapshot
  for asynchronous already-stored event redispatch failures after aggregate
  event storage has completed.
- A first `SpineServices` route registrar that adapts built bounded contexts to
  real Connect/Node `CommandService`, `QueryService`, and `SubscriptionService`
  routes without adding a broad server facade or client DSL. Command routes are
  selected from built-time bus registrations, queries preserve Stand-recorded
  versions, and subscriptions attach delivery only after explicit activation.
  Inactive subscriptions expire by default and active subscriptions use a small
  bounded update queue for slow consumers.
- A server entity state transition validator that enforces built-in
  `(set_once)` checks by comparing previous and proposed entity state through
  the core transition validation facade.
- A server entity transaction kernel with `createEntityTransaction()` for a
  framework-owned, in-memory buffered draft boundary that validates on commit
  and releases on rollback, plus draft lifecycle and explicit version metadata
  helpers.
- Server handler metadata helpers in `@spine-ts/server` that explicitly bind
  generated command/event schemas to entity method names for command assignment,
  command reaction, event subscription, event reaction, and event application.
- Server standard method decorators in `@spine-ts/server` that collect
  class-owned handler metadata with explicit generated schemas and materialize
  into the same `EntityHandlersMetadata` shape as explicit registration.
- A caller-owned server handler metadata registry that registers explicit
  entity handler metadata, rejects duplicate command assignments and duplicate
  event appliers for the same entity/event pair, and exposes frozen
  deterministic lookup views.
- A bounded-context builder shell in `@spine-ts/server` with
  `BoundedContext.singleTenant(name)`, `BoundedContext.multitenant(name)`,
  immutable context names, framework-owned `ContextSpec` values from
  `builder.spec` and `context.spec`, tenant mode metadata, dispatcher
  collection, storage-factory injection for event, repository state, and direct
  Stand/read-side state storage, internally owned built-context command/event
  buses, post-only context bus endpoints, and copy-safe small context snapshots.
- A first single-process server runtime lifecycle/queue kernel, typed
  write-side signal intake result values, and command/event
  registration-readiness metadata derived from handler metadata.
- A first executable `CommandBus`/`EventBus` layer that accepts generated Spine
  command/event envelopes, dispatches through registered dispatcher objects,
  rejects duplicate command dispatcher registration by message type, and
  appends events to `EventStore` before event fan-out.
- A smoke-tested public assembly path that combines a built bounded context,
  handler metadata registry, command/event
  readiness views, and `createServerRuntimeRoutingPlan()` without exposing a
  server facade, services, handler invocation, worker lifecycle registration,
  or transport endpoint execution.
- Adapter-agnostic transport contracts in `@spine-ts/transport` for immutable
  signal topics, logical subscriptions, publish/request operations, and async
  close behavior.
- A pinned adapter-private `zeromq@6.5.0` dependency and local IPC smoke tests
  for same-host publish/subscribe and request/reply behavior. The public
  transport API still hides ZeroMQ sockets, endpoint strings, multipart frames,
  native binding types, and production endpoint topology.
- Storage contracts in `@spine-ts/storage` for `StorageFactory`,
  `RecordStorage`, `RecordSpec`, deterministic record queries, and the first
  storage-only `EventStore` delegate.
- `InMemoryStorageFactory` and `InMemoryRecordStorage` for deterministic tests
  and local development. Storage objects opened by one factory share backing
  records by context name, tenant mode, tenant ID, and `RecordSpec` instance,
  keep tenant slices separate, clone stored values, return independently
  closeable handles, and are not durable across process restarts.
- A placeholder to-do example workspace.

## What Is Deferred

- Runtime ID generation, timestamp factories, actor/tenant context factories,
  event producer/version/origin policy, command system properties, and runtime
  metadata generation.
- Semantic tag registration from `(is)` and `(every_is)` into handler/routing
  registries. The server metadata APIs preserve entity tags and explicit
  handler declarations now, but no runtime registry consumes them yet.
- Default repository construction from entity classes, system context
  construction, import buses, richer gRPC service execution, tenant index
  persistence, ZeroMQ endpoint topology, broker process supervision, retry
  workers, durable delivery storage, transport-backed service execution,
  durable production storage, and to-do domain runtime behavior.
- Built bounded contexts can invoke aggregate command assignees and aggregate
  event appliers, then deliver stored aggregate-produced events to projection
  event subscribers that update read-side state through `Stand`, including
  tenant-scoped projection updates from the command tenant. Other
  handler/runtime execution remains deferred, including process-manager
  reactions, broader subscriber/reactor delivery semantics, and import/catch-up
  flows.

## Type Registry

```ts
import { FieldPathSchema } from "@spine-ts/proto";
import { deriveTypeUrl, spineCoreRegistry } from "@spine-ts/core";

const typeUrl = deriveTypeUrl(FieldPathSchema);
const metadata = spineCoreRegistry.getByFullName("spine.base.FieldPath");
```

The shared `spineCoreRegistry` is lookup-only. Use `createSpineCoreRegistry()`
when application or test code needs a caller-owned mutable registry.

Spine files normally declare `option (type_url_prefix) = "type.spine.io"`.
`deriveTypeUrl()` composes that prefix with the schema's full Protobuf type
name. For files without the Spine option, the core registry uses the documented
fallback prefix `type.googleapis.com`.

The shared registry also contains the canonical core signal contracts:

```ts
import { CommandSchema, EventSchema } from "@spine-ts/proto";
import { spineCoreRegistry } from "@spine-ts/core";

const commandTypeUrl = spineCoreRegistry.getBySchema(CommandSchema).typeUrl;
const eventTypeUrl = spineCoreRegistry.getBySchema(EventSchema).typeUrl;
```

## Validation

Use `@spine-ts/core` for validation. Application code does not import
`@spine-event-engine/validation-ts` directly.

```ts
import { create } from "@bufbuild/protobuf";
import { checkValid, validateMessage, ValidationException } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const command = create(CreateTaskSchema, {});
const result = validateMessage(CreateTaskSchema, command);

if (!result.valid) {
  const fields = result.violations.map(
    (violation) => violation.fieldPath?.fieldName.join(".") ?? violation.typeName,
  );
  console.warn(`Command failed ${result.violations.length} validation rule(s).`, fields);
}

try {
  checkValid(CreateTaskSchema, command);
} catch (error) {
  if (error instanceof ValidationException) {
    const validationError = error.asMessage();
    console.warn(
      `Command rejected with ${validationError.constraintViolation.length} violation(s).`,
    );
  }
}
```

`validateMessage()` is for single-message Spine validation options such as
`(required)`, `(pattern)`, and `(validate)`. Returned
`ConstraintViolation`/`ValidationError` data is safe by default: raw invalid
field values are omitted, upstream and transition-rule placeholder values are
redacted, and upstream validation runtime failures are converted into repo-local
structured violations instead of leaking raw exceptions. Placeholder keys may
remain so callers can understand the template shape, but values do not expose
payload data.

Transition-only rules need previous state and proposed state, so they use the
separate framework seam:

```ts
import { validateTransition } from "@spine-ts/core";

const result = validateTransition({ schema: TaskSchema, previous, next }, rules);
```

`@spine-ts/server` provides the first built-in entity rule for `(set_once)`
fields:

```ts
import { validateEntityStateTransition } from "@spine-ts/server";

const result = validateEntityStateTransition({
  schema: TaskStateSchema,
  previous,
  next,
});
```

`validateEntityStateTransition()` derives set-once fields from
`describeEntityMetadata()`. Creation transitions where `previous === undefined`
may initialize supported set-once fields. Existing-state transitions fail when a
supported set-once field's value changes and pass when supported set-once values
remain equal. Violations are shaped by the core `validateTransition()` facade,
include the changed field path, and omit raw previous/next values. Repeated,
map-valued, and explicit optional `(set_once)` fields are explicitly unsupported
in this slice, matching the JVM generation boundary, and fail closed with
field-specific violations even when their contents are unchanged or the
transition is a creation. The server API is pure validation: it does not
instantiate entities, invoke handlers, read or write storage, assemble
repositories, dispatch buses, or start transport.

Rule-returned violations are sanitized before aggregation. If a transition rule
throws, the core seam records a structured transition-rule failure and continues
later rules in order.

## Entity Transactions

Use `createEntityTransaction()` when framework-controlled code needs an
in-memory buffered draft over previous entity state before accepting a commit
result:

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

`commit()` runs `validateEntityStateTransition()` before accepting the draft.
Rejected commits return validator violations and leave the transaction active;
accepted commits close the transaction. `rollback()` closes the transaction and
returns previous/draft evidence without accepting state.

Use `archive()`, `unarchive()`, `markDeleted()`, and `restore()` only for
buffered draft lifecycle metadata. They do not write storage, emit lifecycle
events, or filter queries. Use `updateVersionMetadata()` only when caller-owned
draft version metadata should be replaced explicitly; automatic version
increments, clocks, event versions, and producer metadata remain deferred.
`requireActive()` is the active-state guard future entity base classes can call
before state mutation: it rejects committed/rolled-back transactions and active
drafts already marked archived or deleted with deterministic errors that do not
include entity state payloads.

Compatibility note: this transaction kernel is the public draft/result boundary
for future framework-owned entity bases. It is not a storage-backed transaction
system, repository unit of work, handler dispatch phase, lifecycle-event
emitter, or async-local/global transaction context. The snapshots returned from
commit and rollback are evidence for later runtime layers, not persisted state.

## Transactional Entity Draft Helpers

Extend `TransactionalEntity` when framework-owned subclasses need protected
draft helpers over the transaction kernel:

```ts
import { TransactionalEntity } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskEntity extends TransactionalEntity<string, typeof TaskStateSchema, number> {
  rename(name: string): void {
    this.startTransaction();
    this.updateDraftState((state) => ({ ...state, name }));
    this.updateDraftVersionMetadata(this.version + 1);

    const result = this.commitTransaction();
    if (result.status === "rejected") {
      this.rollbackTransaction();
    }
  }
}
```

Only subclass code can use the draft scope. `startTransaction()` opens one
active transaction from the entity's current state, version metadata, and
lifecycle snapshots. Draft helpers return snapshots, so mutating returned state
or version data does not mutate the buffered draft. Accepted commits close the
scope and replace the entity state, explicit version metadata, and lifecycle
flags. Rejected commits keep the scope active for correction or explicit
rollback and apply nothing to the entity. `rollbackTransaction()` closes the
scope without applying state, version, or lifecycle changes.

`changed` becomes true when an accepted commit changes entity state or committed
lifecycle flags. It does not include version-only commits and does not decide
whether a repository should store the entity. Missing or duplicate scopes throw
`TransactionalEntityScopeError`. The base still does not invoke handlers, write
storage, expose Java builders, emit lifecycle events, increment versions
automatically, dispatch messages, or create async-local/global transaction
state.

## Entity Family Marker Classes

Extend `Aggregate`, `Projection`, or `ProcessManager` when code needs the
server-side OOP family type now, before runtime repositories and dispatch are
available:

```ts
import { Aggregate, Projection, ProcessManager } from "@spine-ts/server";
import { TaskProjectionSchema, TaskStateSchema, TaskWorkflowSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, bigint> {}
class TaskProjection extends Projection<string, typeof TaskProjectionSchema, number> {}
class TaskWorkflow extends ProcessManager<string, typeof TaskWorkflowSchema, number> {}

new TaskAggregate({ id, schema: TaskStateSchema, state, version: 1n }).entityFamily; // "aggregate"
```

These classes inherit `TransactionalEntity` behavior and expose only stable
family identity through `entityFamily`. They do not add public transaction
mutators, Java builders, event history, snapshots, subscriptions, command
posting, query clients, process workflow execution, handler invocation, storage,
buses, or lifecycle events.

## Repository Identity

Use `Repository` when code needs to record entity ownership metadata and let a
bounded context attach that repository during build:

```ts
import { Aggregate, BoundedContext, Repository } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, bigint> {}

const repository = new Repository({
  entityType: TaskAggregate,
  schema: TaskStateSchema,
});

repository.entityFamily; // "aggregate"
repository.metadata.fullTypeName; // TaskStateSchema.typeName
repository.snapshot.idField.name; // "id"

const context = BoundedContext.singleTenant("Tasks").add(repository).build();
context.registeredRepositories()[0]?.stateFullTypeName; // TaskStateSchema.typeName
```

`Repository` infers the family from the constructor and instance prototype
chains reaching the built-in family marker base class and checks it against the
state schema's `(entity).kind`. Alias imports, namespace/member base-class
expressions, and intermediate domain base classes are accepted. This is a
same-realm metadata boundary: code that explicitly reparents an ES class onto an
entity family is trusted as entity metadata, not rejected as an adversarial
sandbox escape. Mismatches, such as an aggregate constructor paired with a
projection state schema, throw `RepositoryIdentityError` with stable
code/message diagnostics. `snapshot` returns a frozen fresh copy suitable for
bounded-context duplicate and conflict checks. Repeated `add(repository)` calls
for one builder are idempotent. Registering the same repository instance with
another built context is rejected, as are duplicate entity or state identities
in one context build. Registration state belongs to `BoundedContext`, which
opens a `RecordStorage` for the repository state schema using the context
`StorageFactory`. Direct repository registration and registration status APIs
are not public API.

This slice still does not expose direct entity lookup/storage APIs; convert
entity records; write inboxes; manage delivery; manage entity caches; run
catch-up; emit lifecycle events; start buses from repositories; or use
gRPC/transport. Direct stands can store and read latest entity states;
projection updates reach them through framework-owned repository dispatch in
built contexts, not through a new application write-side read API. They do not
run catch-up. When a repository is constructed with authentic explicit handler
metadata and registered with a built bounded context, aggregate commands can
load or create one aggregate, invoke one assignee, apply the produced events,
persist history and snapshots through `AggregateStorage`, and queue
already-stored events for event-bus delivery. Projection repositories can
consume delivered domestic events, invoke matching event subscribers, and write
changed state through `Stand`.
Aggregate command execution requires `command.id` so produced events can carry
a contract-valid command origin; missing IDs reject before mutation or storage.

## Bounded Context Assembly

Use the JVM-familiar builder to assemble the first context-owned runtime parts:

```ts
import { BoundedContext } from "@spine-ts/server";
import { InMemoryStorageFactory } from "@spine-ts/storage";

const builder = BoundedContext.singleTenant("Tasks")
  .withStorageFactory(new InMemoryStorageFactory())
  .addCommandDispatcher(commandDispatcher)
  .addEventDispatcher(eventDispatcher);
const context = builder.build();

await context.commandBus().post(commandEnvelope);
await context.eventBus().post(eventEnvelope);
```

`addCommandDispatcher()` / `removeCommandDispatcher()` and
`addEventDispatcher()` / `removeEventDispatcher()` affect only contexts built
after the call. `withStorageFactory()` supplies the `StorageFactory` used to
create the context `EventStore`, repository state storage, and direct
Stand/read-side state storage; if omitted, the current builder uses in-memory
storage. `commandBus()` and `eventBus()` expose only `post()`; late dispatcher
registration stays on the builder and concrete bus classes. Event posting
stores through that event store before dispatcher fan-out.

`add(repository)` and `remove(repository)` maintain the builder's repository
registration list. `build()` registers the listed repositories with the built
context and opens their state record storage through the context
`StorageFactory`. Repeated `add(repository)` calls for the same instance are
idempotent, duplicate entity or state identities are rejected before storage is
opened for repositories, and `registeredRepositories()` returns a copy-safe
list of frozen snapshot-backed `RepositoryView` values. The built context also
owns `stand()`, and repository state schemas are registered with that stand as
known state types.
This slice still does not create default repositories, write inboxes, manage
delivery, emit lifecycle events, or start transport. Repositories with
authentic explicit handler metadata do contribute dispatcher adapters to the
built context's buses; aggregate repositories can therefore execute assignees
and appliers, persist through `AggregateStorage`, and queue already-stored
events for event-bus delivery. Aggregate command completion is not failed by
later redispatch errors, but those errors are visible for diagnostics and tests
via `context.storedEventDispatchFailures()`.

## Direct Stand

Use `context.stand()` for the first direct read-side entity state slice. The
stand is storage-backed by the same `StorageFactory` selected for the bounded
context.

```ts
const stand = tasks.stand();

await stand.update(TaskStateSchema, taskState, {
  version,
});

const latest = await stand.read(TaskStateSchema, taskId);
const versioned = await stand.readVersioned(TaskStateSchema, taskId);
const allVersioned = await stand.readAllVersioned(TaskStateSchema);
const tenantVersioned = await tenantTasks.stand().readAllVersioned(TaskStateSchema, {
  tenantId: "tenant-a",
});

const query = create(QuerySchema, {
  target: create(TargetSchema, {
    type: deriveTypeUrl(TaskStateSchema),
    criterion: { case: "includeAll", value: true },
  }),
  context: create(ActorContextSchema, {
    tenantId: create(TenantIdSchema, {
      kind: { case: "value", value: "tenant-a" },
    }),
  }),
});

const response = await queryClient.read(query);
const subscription = stand.subscribe(TaskStateSchema, (update) => {
  update.state;
});

subscription.unsubscribe();
```

`Stand.register(schema)` is available for direct stand instances; built bounded
contexts call it from registered repository metadata. Reads, updates, and
subscriptions reject unknown state schemas with `StandStateTypeError`.
`readAllVersioned()` returns `StandReadResult` entries in deterministic
`RecordStorage.query()` order and clones the stored state and caller-supplied
version metadata the same way `readVersioned()` does. Multitenant stands require
`{ tenantId }` for point reads, list reads, updates, and subscriptions; single-
tenant stands reject tenant options. `SpineServices` adapts built-context
stands to the first raw gRPC-compatible query and subscription routes, including
projection-state `QueryService.Read` calls with `Target.include_all = true`.
Include-all service reads use the same tenant-option behavior as direct stand
reads and return `EntityStateWithVersion` values packed from
`Stand.readAllVersioned()`. Direct subscriptions are in-process only and must be
cleaned up by calling `unsubscribe()`. Service subscriptions allocate IDs in
`Subscribe` and attach Stand delivery in `Activate`; updates recorded before
activation are not replayed by this first slice. This direct API does not
provide a client query DSL.

## Runtime Assembly Closure

Use the current runtime and transport foundation when framework-owned setup code
needs to assemble bounded-context metadata, command/event readiness, and
immutable transport routing contracts for later integrated service hosting,
bounded-context runtime wiring, and transport/service assembly:

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

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, bigint> {
  create(command: unknown): void {}
  onCreated(event: unknown): void {}
}

const repository = new Repository({
  entityType: TaskAggregate,
  schema: TaskStateSchema,
});
const tasks = BoundedContext.singleTenant("Tasks").add(repository).build();
const handlers = defineEntityHandlers(TaskAggregate, TaskStateSchema, (builder) => [
  builder.assign(CreateTaskSchema, "create"),
  builder.apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
]);
const registry = new HandlerMetadataRegistry([handlers]);

const commandReadiness = CommandRegistrationReadiness.fromRegistry(registry);
const eventReadiness = EventRegistrationReadiness.fromRegistry(registry);

const routingPlan = createServerRuntimeRoutingPlan({
  context: tasks,
  commands: commandReadiness,
  events: eventReadiness,
});

routingPlan.commands.routes[0]?.receiverGroup; // "command-assignee"
routingPlan.events.applicationRoutes[0]?.receiverGroup; // "application"
routingPlan.deferred.map(({ signalKind }) => signalKind); // ["query", "subscription", "system"]
```

This assembly records what a later runtime can consume: context identity,
repository ownership metadata, handler metadata, command assignment readiness,
event subscriber/reactor/applier readiness, transport-owned command/event
topics, subscriptions, planner-local worker IDs, and deferred
query/subscription/system routing seams. The routing plan is metadata:
route descriptors expose sanitized message type names/type URLs, receiver
groups, planner-local route/worker IDs, and correlation keys back to plan-level
transport arrays. They do not retain handler names, entity names, raw readiness
metadata, or ZeroMQ details.

It does not create a TypeScript `Server`, context runtime handle,
command/event/import bus, broad server lifecycle, storage lifecycle, delivery
engine, integration broker, transport endpoint, broker supervisor, retry worker,
durable delivery store, or handler invocation path. Accepted signal intake
values still mean only accepted for later asynchronous work; they are not `Ack`
messages and do not claim validation, storage, dispatch, delivery, or
successful handling.

When a caller already owns executable dispatchers, the current server package
also exposes the first small bus seam:

```ts
import { CommandBus, EventBus } from "@spine-ts/server";
import { EventStore, InMemoryStorageFactory } from "@spine-ts/storage";

const commandBus = new CommandBus([commandDispatcher]);
await commandBus.post(commandEnvelope);

const store = new EventStore({ name: "Tasks", multitenant: false }, new InMemoryStorageFactory());
const eventBus = new EventBus(store, [eventDispatcher]);
await eventBus.post(eventEnvelope);
```

`CommandBus` is unicast by enclosed message type URL: one registered
dispatcher handles a posted command. Registering a second dispatcher for the
same command type is rejected. `EventBus` is multicast by enclosed message type
URL: registered dispatchers for the event type run in registration order.
Before storage, `EventStore.acceptThenAppend()` prechecks event identity, lets
matching dispatchers reject an event through `accept()`, and appends the event
with one captured storage context. If no dispatcher is registered, the event is
still stored and `post()` resolves. If the identity precheck or dispatcher
acceptance fails, the event is not stored by the bus. If append fails, no
`dispatch()` method runs, but dispatcher `accept()` hooks may already have run.
If dispatch rejects, earlier dispatchers may already have run, later dispatchers
are not invoked, and the stored event remains.

## Transport Foundation

Use `@spine-ts/transport` when later runtime code needs to describe how a
signal should be routed without choosing a concrete adapter:

```ts
import { createTransportSubscription, createTransportTopic } from "@spine-ts/transport";

const topic = createTransportTopic({
  signalKind: "command",
  messageTypeUrl: "type.spine.io/todo.commands.CreateTask",
});

const subscription = createTransportSubscription({
  subscriberId: "command-worker-1",
  topic,
  mode: "competing-consumer",
});

topic.routing.routingKey; // "command:type.spine.io%2Ftodo.commands.CreateTask"
subscription.descriptorKey;
```

Topics are immutable and derive adapter-agnostic routing keys from signal kind,
message type URL, and sorted unique semantic tags. Subscriptions use logical
subscriber IDs and `"fan-out"` or `"competing-consumer"` delivery mode; they are
not process IDs, paths, hostnames, socket names, or endpoints. The transport
root does not model broker/worker lifecycle, worker registrations, delivery
attempt/result data, failure classification, retry eligibility, or inbox
storage. Those concepts belong to later delivery and lifecycle tasks.

ZeroMQ is present only as the current adapter-private local IPC foundation. The
workspace pins `zeromq@6.5.0` and explicitly allows its native install script.
Package-private smoke tests prove same-host `ipc://` publish/subscribe and
request/reply behavior over temporary endpoints. Public package exports do not
include ZeroMQ socket classes, endpoint strings, multipart frame layouts, native
binding types, production endpoint naming, broker topology, process
supervision, delivery retries, or server runtime wiring. Managed sandboxes may
reject `ipc://` binds with `EPERM`, so live IPC smoke verification can require
native filesystem/socket permissions outside the sandbox.

## Envelope Packing

Use `packAny()` when a domain message must be packed into
`google.protobuf.Any` with Spine routing semantics:

```ts
import { create } from "@bufbuild/protobuf";
import { packAny, unpackAny } from "@spine-ts/core";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";

const payload = create(CreateTaskSchema, { title: "Ship the thin slice" });
const any = packAny(CreateTaskSchema, payload);
const unpacked = unpackAny(any, CreateTaskSchema);
```

`packAny()` derives the type URL through the core registry policy, so Spine
messages use `type.spine.io/...` when their `.proto` file declares the Spine
`type_url_prefix` option. The helper serializes with Protobuf-ES binary
serialization and validates the enclosed message by default. Pass
`{ validate: false }` only for already-trusted messages. Framework packing omits
unknown fields for stable helper output, but this slice does not claim fully
canonical map ordering because Protobuf-ES 2.12.1 does not provide a
deterministic map-order option.

Command and event helpers wrap the same packing behavior in generated Spine
envelopes:

```ts
import { packCommand, packEvent } from "@spine-ts/core";

const command = packCommand({
  id: commandId,
  context: commandContext,
  schema: CreateTaskSchema,
  message: payload,
});

const event = packEvent({
  id: eventId,
  context: eventContext,
  schema: TaskCreatedSchema,
  message: taskCreated,
});
```

The caller supplies generated IDs and contexts. The core helpers do not create
UUIDs, timestamps, actor/tenant contexts, producer IDs, versions, origins,
system properties, bus deliveries, storage records, or transport metadata.
Validation errors are structured through `ValidationException` and do not expose
packed bytes or payload contents. `unpackAny()` returns `undefined` for type URL
mismatches or malformed payload bytes. Command and event envelopes snapshot the
supplied generated IDs and contexts before returning.

## Entity Metadata

Use `@spine-ts/server` when later runtime code needs deterministic metadata for
entity schemas:

```ts
import { describeEntityMetadata } from "@spine-ts/server";

const metadata = describeEntityMetadata(TaskProjectionStateSchema);

metadata.kind; // "projection"
metadata.visibility; // "full" when `(entity).visibility` is omitted on projections
metadata.idField.name; // "id"
metadata.firstFieldRoutingHint.field.name; // "id"
metadata.columns.map((field) => field.name);
metadata.setOnceFields.map((field) => field.name);
metadata.semanticTags;
```

`describeEntityMetadata()` is pure and descriptor-backed. It does not register
handlers, perform routing, touch storage, or mutate a global registry. Built-in
`(set_once)` enforcement lives in `validateEntityStateTransition()`, which
consumes this descriptor metadata. `describeEntityMetadata()` throws
`DescriptorMetadataError` when a caller requires
entity metadata from a non-entity schema or when the descriptor uses
unsupported combinations such as repeated/map `(column)` fields on projections
or process managers. Aggregate and generic entity `(column)` declarations are
ignored in this slice, matching the Spine option contract.

## Entity Shells

Extend `Entity` when framework-owned code needs a local OOP holder for entity
identity, state, plain version metadata, lifecycle flags, and descriptor
metadata:

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

task.metadata.kind;
task.state; // cloned Protobuf-ES state snapshot
task.isActive; // true unless archived or deleted
```

`Entity` snapshots supplied and returned state with Protobuf-ES binary cloning,
so caller mutation does not mutate stored shell state. Version metadata is
caller-owned plain snapshot data: primitives, `null`, arrays, and plain objects
are cloned, while functions, typed arrays, buffers, dates, maps, sets, class
instances, and other non-plain objects are rejected. The shell does not
increment versions, compute timestamps, or derive producer/event metadata.
Lifecycle flags default to active/not deleted, and `lifecycleFlagsChanged`
becomes true only when future subclass/runtime code changes lifecycle flags
through protected hooks.

The shell is deliberately not a transaction or runtime. It does not expose
public state setters, invoke handlers, write repositories or storage, emit
lifecycle events, route IDs, query read models, start buses/transports, or use
global runtime state.

## Handler Metadata

Use explicit handler metadata when an entity class needs to declare which
methods later runtime slices should inspect. This remains the canonical
metadata contract and the fallback for codebases that avoid decorators:

```ts
import { defineEntityHandlers } from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  create(command: unknown): void {}

  onCreated(event: unknown): void {}
}

const taskHandlers = defineEntityHandlers(TaskAggregate, TaskStateSchema, ({ assign, apply }) => [
  assign(CreateTaskSchema, "create"),
  apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
]);

taskHandlers.entity.fullTypeName;
taskHandlers.handlers.map((handler) => handler.kind);
taskHandlers.commandAssignments[0]?.methodName; // "create"
taskHandlers.eventApplications[0]?.allowImport; // true
```

`defineEntityHandlers()` calls `describeEntityMetadata()` for the state schema,
checks that named methods are own prototype data methods declared with normal
class method syntax, and returns frozen metadata arrays preserving declaration
order. Accessors, `constructor`, inherited methods, and instance fields are
rejected without invoking user code. The builder exposes `assign()`,
`command()`, `subscribe()`, `react()`, and `apply()` for the five first handler
roles. `apply(..., { allowImport: true })` records importability for future
event import/replay work.

Use the standard decorators when TypeScript 5+ decorator syntax fits your
project. Every decorator requires an explicit generated Protobuf-ES schema; the
framework does not infer message types through `emitDecoratorMetadata`,
`reflect-metadata`, or parameter decorators:

```ts
import {
  Apply,
  Assign,
  HandlerMetadataRegistry,
  materializeDecoratedEntityHandlers,
} from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  @Assign(CreateTaskSchema)
  create(command: unknown): void {}

  @Apply(TaskCreatedSchema, { allowImport: true })
  onCreated(event: unknown): void {}
}

const taskHandlers = materializeDecoratedEntityHandlers(TaskAggregate, TaskStateSchema);
const registry = new HandlerMetadataRegistry([taskHandlers]);

registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"
```

`@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` record standard
per-class metadata from public instance methods only.
`materializeDecoratedEntityHandlers()` confirms the recorded handler names are
still own prototype methods and returns the same frozen `EntityHandlersMetadata`
shape as `defineEntityHandlers()`. Decorators do not instantiate the entity,
invoke methods, unpack payloads, register in a global handler registry, validate
transactions, write storage, start buses, or start transport.

Use `HandlerMetadataRegistry` when application assembly or tests need a
caller-owned lookup view over one or more `EntityHandlersMetadata` objects:

```ts
import { HandlerMetadataRegistry, defineEntityHandlers } from "@spine-ts/server";

const registry = new HandlerMetadataRegistry([taskHandlers]);

registry.findEntityHandlersByState(TaskStateSchema.typeName);
registry.findHandlersByKind("event-application");
registry.findHandlersByMessageFullTypeName(TaskCreatedSchema.typeName);
registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"
```

Registry listing and lookup methods return frozen arrays in registration and
handler declaration order. One registry permits only one command assignment for
each command message full type name and only one event application for each
entity state full type name plus event message full type name. Command
reactions, event subscriptions, and event reactions may have multiple handlers
for the same message type, preserving later fan-out behavior. The registry is
metadata-only and caller-owned: it does not instantiate entities, invoke
handlers, unpack `Any` payloads, log payloads, mutate a global registry,
implement an import bus, validate transactions, assemble repositories, write
storage, or start transport.

## Storage

Use `@spine-ts/storage` when a test or later runtime slice needs framework-owned
record storage without a repository runtime or database adapter:

```ts
import { create } from "@bufbuild/protobuf";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { EventStore, InMemoryStorageFactory, RecordColumn, RecordSpec } from "@spine-ts/storage";

const factory = new InMemoryStorageFactory();
const spec = new RecordSpec({
  schema: EventSchema,
  idSchema: EventIdSchema,
  extractId: (event) => {
    if (event.id === undefined) {
      throw new Error("Expected event.id.");
    }

    return event.id;
  },
  columns: [new RecordColumn("typeUrl", (event) => event.message?.typeUrl)],
});
const storage = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

await storage.write(
  create(EventSchema, {
    id: create(EventIdSchema, { value: "event-1" }),
  }),
);

const records = await storage.query({
  sort: [{ field: "id", direction: "asc" }],
});

const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
await eventStore.append(
  create(EventSchema, {
    id: create(EventIdSchema, { value: "event-2" }),
  }),
);
```

`StorageFactory` owns one mandatory seam: `createRecordStorage(context, spec)`.
Repeated calls for the same logical storage context and record specification
must observe the same backing records and return independently closeable
handles.
`RecordSpec` binds a generated record schema, optional generated ID schema, ID
extraction, and query columns. `RecordStorage` then provides cloned writes,
point reads, deletes, deterministic ID queries, exact column filters, sorting
by `id`/columns/dotted paths, positive limits, and simple masks on read/query
results.

`InMemoryStorageFactory` and `InMemoryRecordStorage` are the first concrete
adapter. Storage objects opened by one factory share backing records by context
name, tenant mode, tenant ID, and `RecordSpec` instance. They clone records on
write and read, and are not durable across process restarts.

`EventStore` is the first higher-level delegate over `RecordStorage<EventId,
Event>`. In this slice it is storage-only: it persists and reads generated
Spine `Event` messages and rejects missing, blank, or duplicate event IDs on
append, but it does not dispatch them to subscribers, manage delivery attempts,
or implement retry/bus behavior.

Aggregate snapshot/history storage is available through `AggregateStorage`,
using primitive `AggregateId` values for this slice. Delivery records, tenant
indexes, diagnostics, repository storage policy, and read-side projection stores
are deferred.

## First Commands

```shell
pnpm install
pnpm proto:verify
pnpm proto:generate
pnpm docs:check
pnpm verify
```

Generated API docs are written to `docs/api/reference` and are ignored by Git.
