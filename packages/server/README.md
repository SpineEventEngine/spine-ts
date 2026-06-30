# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas, explicit handler
metadata, and standard decorator metadata adapters.

Current slice exposes:

- `BoundedContext.singleTenant(name)` and `BoundedContext.multitenant(name)` for
  creating metadata-only builder shells with immutable context names,
  `ContextSpec` values exposed through `builder.spec` and `context.spec`, tenant
  mode metadata, explicit `Repository` identity registration, deterministic
  repository ownership conflict checks, and copy-safe built context snapshots;
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
- `new Repository({ entityType, schema })` for metadata-only repository identity
  over one entity constructor and matching entity state schema;
  and
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
- `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply` standard method
  decorators that require explicit Protobuf-ES schemas and materialize into the
  same handler metadata contract.
- `SingleProcessServerRuntime` for the first explicit server-owned lifecycle
  and async queue kernel with `start()`, `close()`, deterministic states, and
  post-intake work execution in a later microtask.
- `BoundedContextRuntime` for a context-scoped runtime handle that binds one
  built `BoundedContext` snapshot to a lifecycle without exposing queue intake,
  buses, storage, services, dispatch, or repository runtime registration.
- `acceptSignalIntake()` / `failSignalIntake()` and `SignalIntakeResult` for
  typed write-side command/event intake outcomes that distinguish
  accepted-for-async-work from immediate intake failure without implementing
  `Ack`, buses, filters, storage, dispatch, services, or transport.

```ts
import {
  Apply,
  Assign,
  HandlerMetadataRegistry,
  defineEntityHandlers,
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

const decoratedTaskHandlers = materializeDecoratedEntityHandlers(TaskAggregate, TaskStateSchema);

const explicitTaskHandlers = defineEntityHandlers(
  TaskAggregate,
  TaskStateSchema,
  ({ assign, apply }) => [
    assign(CreateTaskSchema, "create"),
    apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
  ],
);

decoratedTaskHandlers.handlers.map((handler) => handler.kind);
decoratedTaskHandlers.eventApplications[0]?.allowImport; // true

const registry = new HandlerMetadataRegistry([decoratedTaskHandlers]);
registry.findCommandAssignment(CreateTaskSchema.typeName)?.handler.methodName; // "create"
registry.findEventApplication(TaskStateSchema.typeName, TaskCreatedSchema.typeName)?.handler
  .methodName; // "onCreated"

explicitTaskHandlers.handlers.map((handler) => handler.methodName); // same contract
```

The explicit registration API records command assignments, command reactions,
event subscriptions, event reactions, and event applications in declaration
order. Handler names must refer to own prototype data methods declared with
normal class method syntax; accessors, `constructor`, inherited methods, and
instance fields are rejected without invoking user code. The API does not
invoke handlers, enforce transactions or `(set_once)`, build repositories, write
storage, register buses, start transport, or implement gRPC services.

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

## Single-Process Runtime Kernel

Use `SingleProcessServerRuntime` when a server runtime part needs an explicit
local lifecycle and an asynchronous intake boundary before command/event buses,
delivery, storage, or service hosting exist:

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
so non-settling or reentrant work can keep `close()` pending.

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

## Bounded Context Runtime Handle

Use `BoundedContextRuntime` when later runtime code needs a context-scoped
lifecycle handle for an already built `BoundedContext`:

```ts
import { BoundedContext, BoundedContextRuntime } from "@spine-ts/server";

const tasks = BoundedContext.singleTenant("Tasks").build();
const runtime = new BoundedContextRuntime(tasks);

runtime.name.value; // "Tasks"
runtime.contextSnapshot.repositories; // copied built-context metadata

await runtime.start();
await runtime.close();
```

By default the handle creates and owns a private `SingleProcessServerRuntime`.
You may inject a `ServerRuntimeLifecycle` when a caller owns the lifecycle
object:

```ts
const runtime = new BoundedContextRuntime(tasks, { runtime: sharedLifecycle });
```

Injected lifecycle ownership stays with the caller. The handle delegates
`state`, `start()`, and `close()` deterministically to that lifecycle and
returns fresh immutable copies for `name`, `spec`, `repositories`, and
`contextSnapshot`.

The handle deliberately does not expose `enqueue()` unless a later typed
context queue boundary is designed. It is not a JVM `Server` equivalent, a
running bounded-context graph, command/event/import bus, repository dispatcher,
stand, event store, tenant index, integration broker, command/query/subscription
service, gRPC server, ZeroMQ transport, system context, delivery inbox, or
handler invocation mechanism.

## Bounded Context Shell

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
immutable value exposed from the builder and built context, `build()` returns a
frozen metadata-only `BoundedContext`, and `.snapshot` returns a copy-safe
immutable `BuiltBoundedContextSnapshot` / `BoundedContextSnapshot`. Builders
accept explicit metadata-only `Repository` identity objects:

```ts
import { Aggregate, BoundedContext, Repository } from "@spine-ts/server";
import { TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate extends Aggregate<string, typeof TaskStateSchema, number> {}

const taskRepository = new Repository({
  entityType: TaskAggregate,
  schema: TaskStateSchema,
});

const tasks = BoundedContext.singleTenant("Tasks").add(taskRepository).build();

tasks.repositories[0]?.stateFullTypeName; // TaskStateSchema.typeName
```

Adding the same repository identity repeatedly is idempotent. The builder
rejects conflicting ownership when one entity constructor is paired with a
different state schema identity, or when one state type is claimed by multiple
entity constructors. Returned repository arrays and built context snapshots are
fresh frozen copies. `BuiltBoundedContextSnapshot` is a public name for this
closed registration contract; it is not a runtime context handle.

This slice deliberately does not create default repositories from entity
classes, perform runtime repository registration, invoke handlers, open storage,
construct system contexts, start command/event/query/subscription buses, write
tenant indexes, expose gRPC services, or integrate transports.

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

Use `Repository` when a `BoundedContextBuilder` needs to record that one entity
constructor owns one descriptor-backed state schema:

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
tasks.repositories[0]?.stateFullTypeName; // TaskStateSchema.typeName
```

The constructor derives descriptor metadata with `describeEntityMetadata()` and
infers the entity family from same-realm constructor and instance prototype
chains reaching `Aggregate`, `Projection`, or `ProcessManager`. Alias imports,
namespace/member base-class expressions, and intermediate domain base classes
are accepted. Explicitly reparented same-realm ES classes are trusted as
metadata; this is not a sandbox boundary. The API rejects constructors outside
those families and rejects mismatched family/schema pairs, such as an aggregate
class with a projection state schema, with structured `RepositoryIdentityError`
codes and details. `BoundedContextBuilder.add(repository)` uses these
metadata-only identities for duplicate and conflict checks before
`builder.build()` creates an immutable bounded-context snapshot. Runtime
context registration remains deferred. This identity seam follows Spine
`core-jvm` `Repository` identity concepts closely. This API is
metadata-only: it does not create, find, or store
entities; open storage; register with a bounded context; route messages; invoke
handlers; write inboxes; manage caches; emit lifecycle events; start buses; or
touch transport.

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
