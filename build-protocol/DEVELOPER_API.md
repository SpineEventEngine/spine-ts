# Developer API

Navigation: [README](README.md) | Previous: [Runtime Architecture](RUNTIME_ARCHITECTURE.md) | Next: [To-Do Example](TODO_EXAMPLE_SPEC.md)

## OOP Style

End-user code should look like domain objects, not wiring scripts. The framework should expose generic base classes similar in spirit to Spine JVM:

```typescript
abstract class Aggregate<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class Projection<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class ProcessManager<I, S extends Message> extends TransactionalEntity<I, S> {}
abstract class Repository<I, E extends Entity<I, Message>> {}
```

The exact generic parameters may differ from JVM because Protobuf-ES does not expose Java builder types. The design should still preserve:

- typed IDs;
- typed states;
- typed command/event handler parameters;
- typed returned events/commands/rejections where possible.

## Decorator-Based Handler Declaration

The preferred end-user mechanism is standard TypeScript decorators:

```typescript
class TaskAggregate extends Aggregate<TaskId, Task> {
  @Assign(CreateTaskSchema)
  create(command: CreateTask, ctx: CommandContext): TaskCreated {
    return create(TaskCreatedSchema, { task: command.id, name: command.name });
  }

  @Apply(TaskCreatedSchema)
  onCreated(event: TaskCreated): void {
    this.setState({ name: event.name });
  }
}
```

Decorator requirements:

- use TypeScript 5+ standard decorators when feasible;
- do not rely on legacy decorator metadata or `emitDecoratorMetadata` as a core requirement;
- do not rely on parameter decorators, because standard decorators do not provide the same legacy parameter-decorator model;
- require explicit schema arguments where runtime type metadata is otherwise unavailable;
- allow decorators to register metadata through class initializers or static metadata tables;
- provide a non-decorator registration fallback for environments where decorators are unavailable.

Implementation must investigate whether standard decorators plus explicit schema arguments are sufficient. If not, a custom code generation step may produce registration metadata from decorated source or from explicit static metadata.

## Handler Decorators

Initial decorator set:

- `@Assign(CommandSchema)` for command assignees that produce events or rejection outcomes.
- `@Command(CommandSchema)` for command receptors that produce commands or events according to the process manager model.
- `@Subscribe(EventSchema, options?)` for event subscribers/projection updaters.
- `@React(EventSchema, options?)` for reactors that emit new commands/events.
- `@Apply(EventSchema, options?)` for aggregate event appliers.
- `@External()` option for external event/command handlers.
- Field-filter options equivalent to Spine handler filtering.

Decorators define model metadata. They must not perform runtime registration by executing arbitrary global side effects during import unless the behavior is deterministic and testable.

## Entity Transactions

Entities mutate state only inside framework-controlled handling transactions:

- aggregate state changes only by applying events;
- projection state changes only by event subscription handling;
- process manager state changes by command/event handling where allowed;
- state validation runs before commit;
- `(set_once)` is enforced by comparing previous state with proposed next state;
- lifecycle flags prevent invalid updates when archived/deleted rules require it.

Because Protobuf-ES messages are plain immutable-ish message values rather than Java builders, the framework should expose transaction helpers such as:

```typescript
this.update((state) => ({ ...state, name: event.name }));
this.requireActive();
this.archive();
```

The final API must avoid hidden mutation that bypasses validation.

## Repositories and Bounded Context Assembly

End-user assembly should be concise:

```typescript
const tasks = BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .add(TaskProjection)
  .build();
```

The framework may create default repositories from entity classes, but it must also support custom repositories for:

- custom command routes;
- custom event routes;
- custom storage;
- dependency injection;
- domain-specific repository methods.

## Public Services

The TS framework must keep the Spine gRPC services:

- `CommandService`;
- `QueryService`;
- `SubscriptionService`.

Their message contracts come from copied Spine `.proto` files. Service implementations may use any Node gRPC library chosen during implementation, but transport-specific APIs must not leak into domain code.

## Validation API

End-user code should normally build messages with Protobuf-ES helpers and validate through the framework facade:

```typescript
const violations = validation.validate(CreateTaskSchema, command);
```

The facade wraps `@spine-event-engine/validation-ts` and adds framework checks for state-transition validation, command/event envelope validation, and domain runtime rules.

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
- structured handling of immediate `Ack` errors/rejections and later business rejection events.

## API Documentation

Every package must have:

- package `README.md`;
- TypeDoc-compatible public API docs;
- examples for the major user-facing APIs;
- architecture notes updated with each feature task;
- compatibility notes for deviations from Spine JVM behavior.
