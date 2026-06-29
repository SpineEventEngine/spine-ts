# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas, explicit handler
metadata, and standard decorator metadata adapters.

Current slice exposes:

- `describeEntityMetadata(schema)` for deterministic entity kind/visibility metadata;
- `isEntitySchema(schema)` for pure descriptor checks;
- first-field routing hints from descriptor order;
- `(column)` discovery for projections/process managers, `(set_once)` field discovery for all entity kinds; and
- semantic tags from `(is)` and `(every_is)` with clear extraction errors; and
- `validateEntityStateTransition({ schema, previous, next })` for built-in
  `(set_once)` transition validation over descriptor-backed entity state; and
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
