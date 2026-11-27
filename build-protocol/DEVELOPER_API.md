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

In the TypeScript implementation, the state parameter is the generated schema
type, such as `typeof TaskSchema`. There is no third version parameter.
`entity.version` is always the generated Spine `Version`, returned as a copy.
The framework initializes, advances, and stores that version; application
handlers do not update it manually.

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
unversioned generated registry contains mixed `receivers`: Entity records carry
an entity type and state schema, while standalone records name the exact
constructor of an instance registered through the builder. Each handler record
names the method, inferred first-parameter signal schema, allowed public arity
`handler(signal)` or `handler(signal, context)`, and emitted schemas inferred
from the return type. `@Subscribe` records have no emitted schemas because the
required return type is explicit `void` or `Promise<void>`. Aggregate behavior
is transactional rather than event-sourced.

Native unions describe one selected result, for example
`CreateAccessGrant | ExtendAccessGrant`. Native tuples describe multiple results
in order, for example `[AccessGrantCreated, AccessRequestCompleted]`.
Readonly tuples, optional tuple positions, named aliases, and an outer `Promise`
use the same schema inference. No Pair or Either wrapper classes are needed.
The invoked handler's returned-schema list limits the messages it may return;
another handler's declarations do not widen that list.

`@Assign` and Command-input `@Command` require a nonempty successful result.
An Event/rejection-input `@Command` or `@React` may return an empty typed array,
or declare `undefined` alone or alongside concrete output types in any union
position. One outer `Promise` may wrap these declarations. Only subscriptions
may declare `void` or `Promise<void>`. TypeScript enforces
tuple structure, while runtime checks actual message types and return order.
Invalid results fail before Entity commit or output publication. Subscribers
must return no value, including no empty array. Absent results use `undefined`,
not `null`; valid no-output reactions still save state changes.
See the [handler return guide](../docs/USER_GUIDE.md#choose-what-a-handler-returns)
for supported forms and restrictions.

Generated registry ingestion preserves each handler record's public arity in
canonical metadata. Existing explicit/schema-bearing handler registration
continues to default to one-argument invocation. Repository execution calls
generated one-argument handlers as `handler(signal)` and generated
two-argument command assignees/command substitutions/event subscribers as
`handler(signal, context)`, where substitutions receive `CommandContext` and
event handlers receive `EventContext` from the incoming envelope. If the
envelope omits context, the framework passes an empty generated context message
of the proper schema.

`@Command` handlers are supported only by Process Manager repositories.
Aggregate and Projection repositories reject both command-input substitution
and event- or rejection-input reaction metadata during generated ingestion and
repository construction; registry and handler-registration types remain generic
and do not provide compile-time rejection.

For a generated Process Manager, a command-input `@Command` method returns a
distinct generated Command and may receive `CommandContext`:

```ts
@Command
approve(command: ApproveProject, context: CommandContext): ScheduleProject {
  return create(ScheduleProjectSchema, { project: command.project, status: command.status });
}
```

The generated metadata records `ApproveProjectSchema` as the input and
`ScheduleProjectSchema` as the emitted schema. The normal generation pipeline
writes this information to `generated/spine-metadata.ts`, alongside Entity,
standalone receiver, Proto, and App Query descriptions. These are descriptions;
the application still chooses the classes and instances to register.

Import the generated application bootstrap before assembling the application:

<!-- docs-snippet-path: examples/todo/src/todo-app.ts -->

```typescript
import "../generated/spine-bootstrap.js";
```

The bootstrap imports the application's metadata and metadata from participating
runtime dependencies. During generation, Spine follows the installed dependency
graph and finds packages that publish a `./spine` export. It generates static
imports for those packages. Application startup therefore needs no filesystem
scan and no `withGeneratedRegistryRoot` call.

For example, a package containing Entity classes can publish its generated
metadata while the application package constructs the Bounded Context. The
application imports those classes, adds them to its builder, and awaits
`build()`. The builder selects their metadata by the exact class references.
This also works when a Bounded Context uses classes from several packages.
Importing a dependency does not automatically add its Entities to a Bounded
Context or instantiate its App Query handlers.

The metadata and bootstrap are ignored generated files. Generate Proto files
and TypeScript metadata before compiling the application. Missing or conflicting
metadata prevents the selected handler from running. Model-only packages publish
Proto metadata without receivers; browser clients use their ordinary Proto
module without importing Server code.

## Entity constructor dependencies

Both `new Repository({ entityType, schema, onCreate })` and
`builder.add(EntityClass, { onCreate })` let the application construct an Entity
with services it needs. Spine passes `EntityOptions` to `onCreate`; the callback
returns `new EntityClass(options, service)`. Supply this callback whenever the
constructor requires arguments beyond `EntityOptions`; optional parameters and
parameters with defaults do not require it. Services are not stored
in generated metadata, and the Entity still has two type parameters: its ID and
state schema.

Use constructor injection rather than assigning dependencies after creation.
The callback runs for new and restored objects, not merely for new domain IDs.
Classes that need only `EntityOptions` require no callback. Spine still sets up
history access, queries, transactions and handlers. Queries of stored state do
not construct Entities. If the callback throws, the handler does not run and no
Entity changes are committed; Spine reports a processing failure, not a domain
rejection.

## Handler Decorators

Initial decorator set:

- `@Assign` for command assignees that produce one or more generated domain
  event messages or rejection outcomes.
- `@Command` for methods producing generated domain Commands. Command-input
  handlers must return at least one; Event/rejection reactions may return none.
- `@Subscribe` for event subscribers/projection updaters. These handlers must
  declare explicit `void` or `Promise<void>` return types.
- `@React` for reactors that return generated domain Events or `undefined`.
- `External<T>` as a type-only first-parameter marker for an external event or
  rejection receptor. Event receptors are domestic when the marker is absent.
- Field-filter options equivalent to Spine handler filtering.

Decorators define model metadata. They must not perform runtime registration by
executing arbitrary global side effects during import unless the behavior is
deterministic and testable.

Spine TS aggregates are not event-sourced. Aggregate command handlers mutate state in
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

Generated registry output records `origin: "domestic" | "external"` for every
handler. The analyzer accepts only the canonical exported `External<T>`
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

An Entity ID may be a supported primitive or a complete generated Protobuf
message. The Entity state's first field declares the ID type. When that field is
a message, every declared field in the ID message participates in the identity,
including nested messages. Route admission validates the complete message
against the declared schema and its generated validation rules. When the
selected route candidate is a message but the Entity ID type is primitive, use
a custom route that returns a compatible primitive value.

Without a custom route, Command routing reads the Command's declared first
field. Event routing uses a compatible producer ID when available and otherwise
reads the Event's declared first field. State-update routing selects the first
state field compatible with the Entity ID.

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

<!-- docs-snippet-path: examples/todo/src/todo-app.ts -->

```typescript
import "../generated/spine-bootstrap.js";
import { BoundedContext } from "@spine-event-engine/server";
import { TaskAggregate } from "./todo-domain.js";

const tasks = await BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .build();
```

The framework may create default repositories from entity classes, but it must also support custom repositories for:

- custom command routes;
- custom event routes;
- custom storage;
- dependency injection;
- domain-specific repository methods.

The generated bootstrap must have been imported before this code runs. The
builder then uses the registered descriptions to construct default repositories.
`build()` is asynchronous because assembly prepares resources and integrations.
The explicit-repository path also returns a Promise:

```typescript
const tasks = await BoundedContext.singleTenant("Tasks")
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

Applications submit Commands and Events through a Bounded Context's buses.
After a repository selects a recipient, the framework generates an inbox
message ID and writes the message. Two independent submissions can therefore
store the same Command for the same Project under different inbox IDs. The
worker checks for duplicates while delivering that shard. Storage adapters
write an explicit inbox ID in one create-or-update operation. Writing the same
inbox ID twice leaves the second message in storage.

With a Delivery server, all application nodes use the remote builder. The
server sends each connected node the identity of a free shard with pending
work. A notice lets a node attempt pickup. The server suppresses work notices
while a worker holds the shard. A newly connected node also learns about
available work that predates its connection.

<!-- docs-snippet-path: packages/delivery-client/src/index.ts -->

```ts
import { DeliveryBuilder } from "@spine-event-engine/delivery-client";

const delivery = DeliveryBuilder.remote({ endpoint: "http://localhost:50051" });
```

Application-managed storage can use a custom observer. For example, if the
application publishes shard IDs to a cloud queue, a consumer on any
identically configured node can start processing the shard it received.

<!-- docs-snippet-path: packages/server/src/index.ts -->

```ts
import { ShardIndex, type ServerEnvironment } from "@spine-event-engine/server";

declare const environment: ServerEnvironment;
declare const notification: { index: number; ofTotal: number };

const shard = new ShardIndex(notification.index, notification.ofTotal);
const result = await environment.delivery.deliverMessagesFrom(shard);
```

The framework records successful processing by marking the inbox message
delivered. It retains that message for five seconds from acknowledgement so
a worker can recognize a second copy of the signal for the same recipient.
On remote storage, the Delivery server sets the deadline. A repeated
acknowledgement preserves it. A later pass over the shard can remove the
message when that time has passed. The handler's business effect and the
inbox acknowledgement are separate writes. If the handler finishes but its
acknowledgement fails, a later worker can process the pending message again.

The package guides describe configuration, the results of a delivery attempt
and what the framework does when a handler fails.
[Server delivery reference](../packages/server/REFERENCE.md#inbox-writes-and-delivery)
and [Delivery client reference](../packages/delivery-client/REFERENCE.md).

## Runtime lifecycle

Runtime lifecycle queues accepted local framework work through
`SingleProcessServerRuntime`. Normal command and event behavior remains owned
by bounded-context buses and generated services.

## Public Services

The TS framework must keep the Spine gRPC services:

- `CommandService`;
- `QueryService`;
- `SubscriptionService`.

Their message contracts come from copied Spine `.proto` files. Service
implementations may use any Node gRPC library chosen during implementation, but
transport-specific APIs must not leak into domain code.

The accepted Application API replaces the singleton lifecycle. Implementation is
tracked in [Application API and lifecycle](tasks/application-migration/TASK.md):

```typescript
const environment = ServerEnvironment.newBuilder().build();

const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("Tasks"))
    .build();

const running = await Server.atPort(8080).setApplication(application).start();

running.host; // "127.0.0.1" by default
running.port;
running.baseUrl;

await running.close();
await application.close();
```

`ServerOptions.host` defaults to local-only `127.0.0.1`; broader binding such
as `0.0.0.0` must be explicit. `RunningServer.close()` is idempotent: it stops
listener intake and sessions, then waits for accepted endpoint work and releases
endpoint resources. Shared Bounded Contexts, Delivery, reads, and monitoring stay
available until Application cleanup. A failed close retains unfinished phases
for a later retry. Callers close successful endpoints before Application.close().

`ServerEnvironment.newBuilder().under(EnvironmentType.Local, callback).build()`
creates separate configured services. The callback uses `use({...})` for named
settings. Application build performs asynchronous service setup. Environment
profile selection still comes from `NODE_ENV` through `Environment`; selecting
Production is optional and current memory defaults remain available.

Application requires one open environment and at least one Bounded Context. Its
synchronous `contexts()` returns the build-order list, and `tenantIndex()` returns
one stable index handle without initiating storage I/O. A custom index can use a
separate storage provider. Application-wide create/check operations accept explicit
structurally valid TenantIds without requiring index membership; request admission
continues to require membership. No-argument preparation enumerates registered
tenants and includes single-tenant Bounded Contexts. The narrower Bounded Context
runtime operations remain available. Compatibility checks inspect declared Bounded
Context structures and do not guarantee that other services create no structures.

Application construction accepts preparation and monitoring options, both enabled
by default. Disabling both defers their work. Administrative preparation failure
does not close an established Application; required startup failure prevents it
from serving. One Application may serve multiple independently closed endpoints.
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
