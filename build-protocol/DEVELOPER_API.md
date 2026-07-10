# Developer API

Navigation: [README](README.md) | Previous:
[Runtime Architecture](RUNTIME_ARCHITECTURE.md) | Next:
[To-Do Example](TODO_EXAMPLE_SPEC.md)

## OOP Style

End-user code should look like domain objects, not wiring scripts. The
framework should expose generic base classes similar in spirit to Spine JVM:

```typescript
abstract class Aggregate<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class Projection<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class ProcessManager<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class Repository<I, E extends Entity<I, Message>> {}
```

The exact generic parameters may differ from JVM because Protobuf-ES does not
expose Java builder types. The design should still preserve:

- typed IDs;
- typed states;
- typed command/event handler parameters;
- typed returned events/commands/rejections where possible.

## Decorator-Based Handler Declaration

The preferred end-user mechanism is standard TypeScript decorators:

```typescript
class TaskAggregate extends Aggregate<TaskId, Task> {
  @Assign
  create(command: CreateTask, ctx: CommandContext): TaskCreated {
    return create(TaskCreatedSchema, { task: command.id, name: command.name });
  }
}
```

Decorator requirements:

- use TypeScript 5+ standard decorators when feasible;
- do not rely on legacy decorator metadata or `emitDecoratorMetadata` as a core requirement;
- do not rely on parameter decorators, because standard decorators do not
  provide the same legacy parameter-decorator model;
- do not require or allow explicit schema arguments in normal end-user
  application code;
- allow decorators to register metadata through class initializers or static metadata tables;
- provide a non-decorator registration fallback for environments where decorators are unavailable.

Implementation must use build-time registry generation or explicit static
metadata to recover schemas from TypeScript parameter and return types. Runtime
decorator metadata alone is not enough to justify schema-bearing decorators in
end-user code.

Handler discovery and decorated metadata materialization are framework
responsibilities. End-user applications must not define, import, or call helper
adapters such as `materializeDecoratedEntityHandlers()`.

Generated registry tooling owns the ordinary decorated-handler path. The
logical generated registry contains one entry per entity class with the entity
type, state schema, and handler records for bare `@Assign`, `@Command`,
`@Subscribe`, and `@React` declarations. Each handler record names the method,
the inferred first-parameter signal schema, the allowed public arity
`handler(signal)` or `handler(signal, context)`, and the explicit emitted
schemas inferred from the return type. `@Subscribe` records have no emitted
schemas because the required return type is explicit `void`. The generated
registry intentionally excludes `@Apply`; new aggregate behavior is
transactional rather than event-sourced.

Generated registry ingestion preserves each handler record's public arity in
canonical metadata. Existing explicit/schema-bearing handler registration
continues to default to one-argument invocation. Repository execution calls
generated one-argument handlers as `handler(signal)` and generated
two-argument command assignees/event subscribers as `handler(signal, context)`,
where `context` is the generated `CommandContext` or `EventContext` from the
incoming envelope. If the envelope omits context, the framework passes an empty
generated context message of the proper schema. `@Apply` has no two-argument
runtime support.

Generated registry modules are build artifacts under ignored `generated/`
directories. T-0015c implements the build-time analyzer that extracts
structured handler records. T-0015d adds the internal writer that turns those
records into deterministic version-1 TypeScript source and writes files only
when explicitly invoked into a caller-configured generated root that stays
under Git ignore. T-0015e adds `GeneratedRegistryDiscovery` as the small
runtime loader for these artifacts. Callers provide explicit filesystem paths
or clean `file:` URLs, or derive the conventional runtime file location
`generated/handler/generated-handler-registry.js` from a package or app root.
Discovery rejects unsupported non-`file:` URL schemes and `file:` URL
query/hash aliases deterministically before import. It does not scan package
trees or perform global automatic loading. Discovery validates the loaded
module shape, reports stable import/export and ingestion failure codes, and
registers the discovered metadata through `HandlerRegistryIngestor` into a
caller-owned `HandlerMetadataRegistry`.

Application packages that use bare decorators need a build step that runs after
their Protobuf-ES files are generated and before TypeScript compilation. The
step analyzes the package source, writes
`generated/handler/generated-handler-registry.ts`, and lets `tsc` compile that
ignored source artifact into the package output. Runtime assembly adds entity
classes to `BoundedContextBuilder` and calls `buildAsync()`, which loads the
compiled registry through framework-owned discovery before constructing default
repositories.
If the registry is missing, stale, malformed, or rejected during ingestion,
context creation should fail deterministically before any handler is invoked.

## Handler Decorators

Initial decorator set:

- `@Assign` for command assignees that produce one or more generated domain
  event messages or rejection outcomes.
- `@Command` for command-producing methods that produce one or more generated
  domain command messages.
- `@Subscribe` for event subscribers/projection updaters. These handlers must
  declare explicit `void` return types.
- `@React` for reactors that emit generated domain event messages or explicitly
  emit nothing with `void`.
- `@External()` option for external event/command handlers.
- Field-filter options equivalent to Spine handler filtering.

Decorators define model metadata. They must not perform runtime registration by
executing arbitrary global side effects during import unless the behavior is
deterministic and testable.

`@Apply` must not be introduced for new aggregate behavior. Spine TS aggregates
are planned as non-event-sourced, so aggregate command handlers mutate state in
framework-controlled transactions and return generated domain event messages
for publication.

End-user emitting handlers must not return framework `Command` or `Event`
envelopes. The framework wraps generated domain messages into envelopes
internally.

Allowed public signatures include:

```typescript
@Assign
create(command: CreateTask): TaskCreated;

@Assign
rename(command: RenameTask, context: CommandContext): ReadonlyArray<TaskRenamed>;

@Command
whenTaskCreated(event: TaskCreated, context: EventContext): NotifyOwner;

@React
whenTaskCompleted(event: TaskCompleted): TaskArchived;

@React
observeTaskCompleted(event: TaskCompleted): void;

@Subscribe
onTaskRenamed(event: TaskRenamed, context: EventContext): void;
```

The generated registry must reject unsupported signatures, missing explicit
return types on emitting handlers, `@Subscribe` handlers without explicit
`void`, and ordinary end-user handlers that expose framework envelopes.
It must also reject missing first-parameter type annotations because signal
schema inference depends on that explicit type.

## Command Target Routing

Default command routing follows Spine JVM's first-field convention. The first
field of the command message in Protobuf declaration order is the default
target entity ID. The default command route must validate this before invoking
a handler.

End-user handlers should receive route-valid commands and must not implement
default target-ID checks such as:

```typescript
const id = requireTaskId(command.id);
```

If the first field is absent, blank, or not assignable to the repository ID
type, the default command route must reject the command before handler
invocation. Custom command routes belong to the corresponding entity repository
and must be explicit. A custom route replaces the default first-field route, so
the framework must not enforce the first-field requirement for commands handled
by that custom route unless the route explicitly does so.

## Entity Transactions

Entities mutate state only inside framework-controlled handling transactions:

- aggregate state changes during framework-owned command or reaction handling,
  through transaction/update helpers rather than app-owned event appliers;
- projection state changes only by event subscription handling;
- process manager state changes by command/event handling where allowed;
- state validation runs before commit;
- `(set_once)` is enforced by comparing previous state with proposed next state;
- lifecycle flags prevent invalid updates when archived/deleted rules require it.

Because Protobuf-ES messages are plain immutable-ish message values rather than
Java builders, the framework should expose transaction helpers such as:

```typescript
this.update((state) => ({ ...state, name: event.name }));
this.requireActive();
this.archive();
```

The final API must avoid hidden mutation that bypasses validation.

## Repositories and Bounded Context Assembly

End-user assembly should be concise:

```typescript
const tasks = await BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .add(TaskProjection)
  .withGeneratedRegistryRoot(compiledPackageRoot)
  .buildAsync();
```

The framework may create default repositories from entity classes, but it must also support custom repositories for:

- custom command routes;
- custom event routes;
- custom storage;
- dependency injection;
- domain-specific repository methods.

Generated entity-class assembly is asynchronous because the builder loads the
compiled generated handler registry module before constructing default
repositories. It requires an explicit trusted compiled package/app root through
`withGeneratedRegistryRoot(root)`. Synchronous `build()` remains the explicit
repository path:

```typescript
const tasks = BoundedContext.singleTenant("Tasks")
  .add(new TaskRepository())
  .build();
```

The current storage API is intentionally smaller than those future repository
seams. Adapters implement `StorageFactory.createRecordStorage(context, spec)`,
and framework-owned delegates such as `EventStore` build on `RecordStorage`
plus `RecordSpec` instead of depending on a broad storage adapter surface.
`EventStore` currently stops at persistence and query behavior; it does not
implement bus dispatch, subscriber delivery, fan-out, retries, or inbox-style
delivery records on its own. The first `EventBus` appends to `EventStore`
before dispatch. Events with no registered dispatcher still resolve after
storage. The storage delegate remains a storage-only seam.

## Delivery and Inbox API

The current public delivery surface is the durable inbox handoff point and a
small framework-owned shard drain for one bounded context. It is intentionally
smaller than the later scheduler/retry stack:

- `Delivery` groups `Inbox` and `ShardedWorkRegistry` for one storage context;
- `Delivery.drain(shard, { node, onMessage, limit })` picks up one shard with
  framework-owned lease fencing, reads `TO_DELIVER` rows in inbox order, skips
  rows unavailable to this worker before callback invocation, and passes a
  public `InboxMessage` snapshot to the supplied framework endpoint callback.
  Callbacks run only for `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and
  `REACT_UPON_EVENT`; unsupported labels fail closed before callback
  invocation. Successful rows are marked `DELIVERED`; failures leave the row
  `TO_DELIVER` for a later run. The run returns simple `DeliveryRun` statistics
  (`status`, `processed`, `claimed`, `delivered`, `failed`, and `failures`) and
  releases the shard in a `finally` path. If the shard is already owned by
  another live worker lease, the run returns `SKIPPED` with zero counts and does
  not invoke the callback;
- `Delivery.drainMessage(message, { node, onMessage })` picks up the message's
  shard and drains only that exact stored row. It has no `limit` option because
  it never scans unrelated rows from the shard;
- `DeliveryLoop` repeats `Delivery.drain()` for one shard until idle, skipped,
  stopped, or the configured failure bound is reached. `DeliveryWorker` is the
  closeable owner for one node's configured shard loops; it starts those loops,
  aggregates their run results, and `close()` stops future drains while waiting
  for active drains to finish;
- `Inbox` is the low-level durable delivery storage primitive in this slice: it
  accepts `InboxMessageInput` with `receive()` and lets framework delivery code
  read durable inbox rows by `ShardIndex`. `markDelivered()` is the narrow
  worker-owned exact-message status update used by `Delivery.drain()`: missing
  rows, non-pending rows, and mismatched caller snapshots return `undefined`;
  already-delivered matching rows are returned idempotently. Its `storage`
  property is an
  intentional low-level escape hatch for storage-focused tests and
  integrations, not an application-facing query facade;
- `InboxStorage` is the lower-level durable storage seam behind `Inbox`,
  including the same narrow `markDelivered()` status update. It remains useful
  for framework tests or storage-focused integrations rather than as an
  application-facing read-side/query facade;
- `ShardIndex` identifies one delivery shard, `ShardSession` is the durable
  lease snapshot for that shard, and `ShardedWorkRegistry` persists shard
  pickup/renew/release across processes. `renew(session)` is framework-owned
  lease fencing for active drains, not an application retry or supervision
  policy; and
- `DeliveryDrainOptions`, `DeliveryMessageDrainOptions`, `DeliveryEndpoint`,
  `DeliveryFailure`, `DeliveryLabel`, `DeliveryLoopOptions`,
  `DeliveryLoopRun`, `DeliveryLoopStatus`, `DeliveryRun`, `DeliveryStatus`,
  `DeliveryWorkerOptions`, `DeliveryWorkerRun`, `InboxId`, `InboxMessage`,
  `DeliveryStorageCorruptionError`, `InboxMessageError`, `InboxMessageId`,
  `InboxMessageInput`, `InboxReadOptions`, `InboxWriteResult`,
  `InboxStorageOptions`, `DeliveryOptions`, and `ShardedWorkRegistryOptions`
  describe the stable inputs/outputs of this slice.

Public error contract for this slice is intentionally small: callers should
expect `InboxMessageError` for invalid inbox message input and
`DeliveryStorageCorruptionError` when durable delivery storage is corrupt or
out of contract. `ShardedWorkRegistry.pickUp()` caller validation for blank or
oversized `node` values, or invalid clock values supplied through `now`,
currently throws plain `Error` before any storage read/write begins.
Supported delivery labels are `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`,
`REACT_UPON_EVENT`, and `CATCH_UP`. New `IMPORT_EVENT` inbox writes are invalid
and rejected before durable storage opens; legacy stored/wire `IMPORT_EVENT`
rows remain recognizable only as deprecated compatibility data and fail closed
as storage corruption if read or drained.

Current usage is deliberately narrow:

```typescript
const delivery = new Delivery({
  context,
  storageFactory,
  leaseMs: 30_000,
});

await delivery.inbox.receive({
  inboxId,
  signalId,
  label: "UPDATE_SUBSCRIBER",
  status: "TO_DELIVER",
  shard: ShardIndex.single(),
  whenReceived: new Date(),
  version: 1n,
});

const session = await delivery.shards.pickUp(ShardIndex.single(), "node-a");
const pending = await delivery.inbox.read(ShardIndex.single(), {
  statuses: ["TO_DELIVER"],
  limit: 100,
});

const run = await delivery.drain(ShardIndex.single(), {
  node: "worker-a",
  limit: 100,
  async onMessage(message) {
    await frameworkEndpoint(message);
  },
});

const worker = new DeliveryWorker({
  delivery,
  shards: [ShardIndex.single()],
  node: "worker-a",
  async onMessage(message) {
    await frameworkEndpoint(message);
  },
});

await worker.start();
await worker.close();
```

Keep the write/read split intact at the application/service/domain level. These
storage primitives and the direct shard drain are framework internals; they are
not user-facing read-side facades. Built bounded contexts use this boundary for
three narrow local handoffs: process-manager command assignees with
`HANDLE_COMMAND`, process-manager event reactions with `REACT_UPON_EVENT`, and
live projection event subscribers with `UPDATE_SUBSCRIBER`. Process-manager
event and projection subscriber rows store the original `Event` envelope as the
signal payload, the original event ID as `signalId`, the target state type URL
plus routed entity ID as `inboxId`, `TO_DELIVER` status, `ShardIndex.single()`,
and the local 30-second dedup retention window. The context drains the local
shard immediately and replays only the exact row target before running the
process-manager or projection transaction and `Stand` update. Before handler
code runs, replay validates tenant, payload/schema, target type URL, and
routed target ID.
`InboxStorage` remains the durable dedup authority.

Beyond caller-started `DeliveryLoop` and `DeliveryWorker` loops, the current API
does not provide a process-wide or production scheduler/supervisor, expose a
generic repository delivery engine, run projection catch-up through inbox
storage, run retry monitors, open transport topology, supervise worker
processes, or retain attempt/error history beyond the returned run object.
Event import and aggregate importers are removed from the active plan by
upstream ADR 0001 D1; ordinary aggregate `@React` handlers are generated
reactor handlers with current transaction semantics, not event-sourcing
import/applier work.

## Runtime Transport Binding

Framework runtime code can make command/event routing plans executable with:

```typescript
const handle = await RuntimeTransportBinding.open({
  plan,
  transport,
  runtime,
  onCommand(command, route) {
    return frameworkCommandIntake(command, route);
  },
  onEvent(event, route) {
    return frameworkEventIntake(event, route);
  },
});

await handle.close();
```

The binding registers command routes through `SignalTransport.respond()` and
event routes through `SignalTransport.subscribe()`. It validates incoming Spine
command/event envelopes and the enclosed message type URL before calling
`SingleProcessServerRuntime.enqueue()`. The returned handle closes registered
transport handles before closing the runtime and can be closed repeatedly. It
does not expose ZeroMQ, own endpoint naming, supervise processes, retry work,
or create a public server/environment owner.

## Public Services

The TS framework must keep the Spine gRPC services:

- `CommandService`;
- `QueryService`;
- `SubscriptionService`.

Their message contracts come from copied Spine `.proto` files. Service
implementations may use any Node gRPC library chosen during implementation, but
transport-specific APIs must not leak into domain code.

The first public server lifecycle API is deliberately small:

```typescript
const running = await Server.atPort(8080).add(tasks).start();

running.host; // "127.0.0.1" by default
running.port;
running.baseUrl;

await running.close();
```

`ServerOptions.host` defaults to local-only `127.0.0.1`; broader binding such
as `0.0.0.0` must be explicit. `RunningServer.close()` is idempotent and stops
the HTTP/2 listener before closing active sessions and then owned
contexts/resources. If one close fails, the server still attempts every
remaining close and rejects with an aggregate failure. This API reuses
`SpineServices` directly and keeps ZeroMQ, IPC endpoints, worker supervision,
durable scheduling, broad resource ownership, and any singleton
`ServerEnvironment` out of the public surface.

## Validation API

End-user code should normally build messages with Protobuf-ES helpers and
validate through the framework facade:

```typescript
const violations = validation.validate(CreateTaskSchema, command);
```

The facade wraps `@spine-event-engine/validation-ts` and adds framework checks
for state-transition validation, command/event envelope validation, and domain
runtime rules.

The first server-owned transition validation API is:

```typescript
const result = validateEntityStateTransition({
  schema: TaskStateSchema,
  previous,
  next,
});
```

It derives `(set_once)` fields from descriptor-backed `EntityMetadata` and
delegates result shaping to the core `validateTransition()` facade. Creation
transitions where `previous === undefined` may initialize supported set-once
fields; existing-state transitions fail when a supported set-once field
changes. Violations include the changed field path and omit raw previous/next
values. Repeated, map-valued, and explicit optional `(set_once)` fields are
unsupported in this slice and fail closed with field-specific violations,
including on creation transitions.

## Client/SDK API

The client SDK should expose:

- actor-scoped request factories;
- `post(command)` and command result subscription helpers;
- `read(query)` and typed query builders;
- subscription builders for entity state and events;
- typed consumers for updates;
- structured handling of immediate `Ack` errors/rejections and later business
  rejection events.

## API Documentation

Every package must have:

- package `README.md`;
- TypeDoc-compatible public API docs;
- examples for the major user-facing APIs;
- architecture notes updated with each feature task;
- compatibility notes for deviations from Spine JVM behavior.

## Testing API

The first public `@spine-ts/testing` surface is intentionally smaller than the
full Spine JVM black-box test library. `BoundedContextFixture` wraps one built
`BoundedContext` and drives generated command, event, query, and topic envelopes
through the real in-process `CommandService`, bounded-context event endpoint,
`QueryService`, and `SubscriptionService` seams. It returns cloned protobuf
service messages and offers `readEventually()` for asynchronous projection
consequences. It does not start processes, host a gRPC server, provide browser
tooling, expose a broad fluent client DSL, or simulate command/query/subscription
outcomes.
