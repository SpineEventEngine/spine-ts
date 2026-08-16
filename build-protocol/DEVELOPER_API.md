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

Generated registry tooling handles the ordinary decorated-handler path. The
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
`HandlerMetadataRegistry` supplied by the caller.

Application packages that use bare decorators need a build step that runs after
their Protobuf-ES files are generated and before TypeScript compilation. The
step analyzes the package source, writes
`generated/handler/generated-handler-registry.ts`, and lets `tsc` compile that
ignored source artifact into the package output. Runtime assembly adds entity
classes to `BoundedContextBuilder` and calls `buildAsync()`, which loads the
compiled registry through framework discovery before constructing default
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
- `External<T>` as a type-only first-parameter marker for an external event or
  rejection receptor. Event receptors are domestic when the marker is absent.
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

@Subscribe
onTaskCreatedElsewhere(event: External<TaskCreated>, context: EventContext): void;
```

The generated registry must reject unsupported signatures, missing explicit
return types on emitting handlers, `@Subscribe` handlers without explicit
`void`, and ordinary end-user handlers that expose framework envelopes.
It must also reject missing first-parameter type annotations because signal
schema inference depends on that explicit type.

Generated registry version 3 records `origin: "domestic" | "external"` for
every handler. The analyzer accepts only the canonical exported `External<T>`
marker (including namespace and marker-containing aliases), rejects counterfeit
or unresolved markers, and rejects external command receivers. Event dispatch
selects domestic receptors for ordinary events and external receptors for
events whose `EventContext.external` flag is set. A method that produces a
command may consume an external event or rejection; the integration broker does
not carry external commands or state updates.

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

- aggregate state changes during framework command or reaction handling,
  through transaction/update helpers rather than application event appliers;
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
seams. Adapters implement `StorageFactory.createRecordStorage(context, spec, group?)`,
and framework delegates such as `EventStore` build on `RecordStorage`
plus `RecordSpec` instead of depending on a broad storage adapter surface.
`EventStore` currently stops at persistence and query behavior; it does not
implement bus dispatch, subscriber delivery, fan-out, retries, or inbox-style
delivery records automatically. The first `EventBus` appends to `EventStore`
before dispatch. Events with no registered dispatcher still resolve after
storage. The storage delegate remains a storage-only seam.

## Delivery and Inbox API

The root-public delivery surface includes `DeliveryBuilder`, immutable
`Delivery`, `DeliveryMonitor`, `DeliverySupervisor`, durable Inbox/work ports,
and the callback-visible `DeliveryEndpointMessage` snapshot. The builder
creates one finite shard drain; the supervisor observes bounded remote shard
work. The public slice deliberately excludes scheduled/timed retries and
persistent retry state:

- `Inbox` is the low-level durable delivery storage primitive in this slice. It
  accepts `InboxMessageInput` with `receive()` and lets framework delivery code
  read durable inbox rows by `ShardIndex`. `markDelivered()` is the narrow
  framework exact-message status update used by internal replay: missing
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
  pickup/renew/release across processes with a complete generated `WorkerId`.
  `renew(session)` is lease fencing for active drains, not retry policy;
- `DeliveryBuilder` snapshots the context, storage, worker, shard strategy,
  page size, ports, and monitor. `DeliveryMonitor` selects the failed-reception
  action; `DeliverySupervisor` connects a built delivery to a bounded
  `DeliverySource`; and
- `DeliveryLabel`, `DeliveryStatus`, `InboxId`, `InboxMessage`,
  `DeliveryEndpointMessage`, `DeliveryStorageCorruptionError`,
  `InboxMessageError`, `InboxMessageId`, `InboxMessageInput`,
  `InboxReadOptions`, `InboxWriteResult`, `InboxStorageOptions`, and
  `ShardedWorkRegistryOptions` describe the stable root-public inputs/outputs
  of this slice.

Built bounded contexts use the same storage boundary internally for three
narrow handoffs: process-manager command assignees with `HANDLE_COMMAND`,
process-manager event reactions with `REACT_UPON_EVENT`, and live projection
event subscribers with `UPDATE_SUBSCRIBER`. Pending and delivered
`InboxMessage` rows are stored directly. Shard ownership is the only exclusion
of concurrent workers; it creates neither a per-message claim nor a separate
dedup record. A delivered row is the deduplication fact. Handler effects and
the delivered-row compare-and-set are not one transaction, so a lost
acknowledgement can redeliver after restart and downstream effects must be
idempotent. `DeliveryMonitor` contains reception failures. Its default action
marks a failed reception delivered and continues independent targets; a custom
monitor may select one immediate repeat action. A failed durable action leaves
the row pending, stops later same-target messages, continues independent
targets, releases ownership, and allows a later run. The runtime adds no
attempt history, exhaustion policy, quarantine, receipts, markers, timers,
backoff, dead-letter storage, scheduler persistence, or delivery policy.

Public error contract for this slice is intentionally small: callers should
expect `InboxMessageError` for invalid inbox message input and
`DeliveryStorageCorruptionError` when durable delivery storage is corrupt or
out of contract. `ShardedWorkRegistry.pickUp()` caller validation for an
incomplete/blank `WorkerId`, or invalid clock values supplied through `now`,
currently throws plain `Error` before any storage read/write begins.
`ShardedWorkRegistryOptions.leaseMs` must be a safe integer from `1000` through
`2147483647` milliseconds. `InboxReadOptions.limit` must be positive and at
most `1000`. Recognized valid `DeliveryLabel` values for durable rows are
`HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, `REACT_UPON_EVENT`, and `CATCH_UP`.
Framework replay callbacks support only `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`,
and `REACT_UPON_EVENT`; valid `CATCH_UP` rows remain pending and skipped. New
`IMPORT_EVENT` inbox writes are invalid and rejected before durable storage
opens; legacy stored/wire `IMPORT_EVENT` rows remain recognizable only as
deprecated compatibility data and fail closed as storage corruption if read or
drained.

One finite public delivery run looks like this:

```typescript
import { create } from "@bufbuild/protobuf";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { DeliveryBuilder, ShardIndex } from "@spine-event-engine/server";

const delivery = new DeliveryBuilder()
  .withContext(context)
  .withStorageFactory(storageFactory)
  .withWorker(
    create(WorkerIdSchema, {
      nodeId: { value: "node-a" },
      value: "process-start-42",
    }),
  )
  .build();

await delivery.run({
  shard: ShardIndex.single(),
  onMessage: (message) => {
    console.log(message.label, message.inboxId);
    return Promise.resolve();
  },
});
```

Keep the write/read split intact at the application/service/domain level. These
storage primitives are framework internals; they are not user-facing read-side
facades. Built bounded contexts use this boundary for three narrow local
handoffs: process-manager command assignees with
`HANDLE_COMMAND`, process-manager event reactions with `REACT_UPON_EVENT`, and
live projection event subscribers with `UPDATE_SUBSCRIBER`. Process-manager
event and projection subscriber rows store the original `Event` envelope as the
signal payload, the original event ID as `signalId`, the target state type URL
plus routed entity ID as `inboxId`, `TO_DELIVER` status, `ShardIndex.single()`,
and optional row retention. The context drains the local
shard immediately and replays only the exact row target before running the
process-manager or projection transaction and `Stand` update. Before handler
code runs, replay validates the row label, pending `TO_DELIVER` status, tenant,
payload/schema, target type URL, and routed target ID.
At the lower-level Inbox boundary, `keepUntil` is optional: a delivered row
suppresses a matching duplicate until that deadline, or indefinitely when it is
absent. Built-context repository handoffs deliberately set `keepUntil` to 30
seconds after `whenReceived`; this is their retention choice, not a separate
dedup authority or a universal Inbox rule.

Built contexts replay through validated framework endpoints. A public delivery
callback is an integration boundary; it does not bypass row validation or
ownership fencing. `DeliverySupervisor` and remote delivery ports can supervise
bounded shard work, as demonstrated by the distributed Message Board example.
The current API does not provide a timed retry scheduler, attempt/exhaustion
history, quarantine, dead-letter storage, or exactly-once downstream effects.
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
does not expose ZeroMQ, define endpoint naming, supervise processes, retry work,
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
as `0.0.0.0` must be explicit. `RunningServer.close()` is idempotent: it stops
listener intake and sessions, closes context transport intake and accepted work,
then detaches delivery before closing contexts and resources. Process-wide
facilities remain open until explicit `ServerEnvironment.instance().close()`
shutdown. A failed close retains unfinished phases for a later retry.

`ServerEnvironment` is the supported process-wide server-assembly value.
Configure it before first resolution with
`ServerEnvironment.when(EnvironmentType.Local).use(...)` or
`ServerEnvironment.when(EnvironmentType.Production).use(...)`; `Server`
always uses the resolved singleton. The singleton remains open when one server
closes and can be reused after detach; `ServerEnvironment.close()` permanently
closes an unused singleton and rejects non-destructively while it is in use.
The selected `EnvironmentType` comes from `NODE_ENV` at first resolution, so a
production process sets `NODE_ENV=production` before `Server.atPort()`,
`Environment.instance()`, or `ServerEnvironment.instance()` first runs.
The public lifecycle does not provide a delivery scheduler, monitor, retry
policy, worker supervision, topology policy, or internal lifecycle controls.

## Validation API

End-user code should normally build messages with Protobuf-ES helpers and
validate through the framework facade:

```typescript
const violations = validation.validate(CreateTaskSchema, command);
```

The facade wraps `@spine-event-engine/validation` `2.0.0-snapshot.7` and adds framework checks
for state-transition validation, command/event envelope validation, and domain
runtime rules.

The first server transition validation API is:

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
