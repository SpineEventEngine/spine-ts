# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas, explicit handler
metadata, and standard decorator metadata adapters.

Current slice exposes:

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
later framework-owned subclasses; there are no public state setters, automatic
version increments, transactions, handler invocation, repository writes,
storage calls, lifecycle events, routing, queries, buses, transports, or global
runtime state.

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
