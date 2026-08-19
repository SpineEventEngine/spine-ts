# To-Do Example Application Specification

Navigation: [README](README.md) | Previous: [Developer API](DEVELOPER_API.md) | Next: [Build Protocol](BUILD_PROTOCOL.md)

## Purpose

The framework implementation must include a standalone server-side to-do list example built on top of the TypeScript framework. The example is not part of the current docs-only task, but it is a required deliverable during implementation.

## Timing

The example should be developed after the framework is defined enough to
support a fully fledged app. In-memory storage is acceptable for the example,
but gRPC, query, and subscription behavior must be real, not simulated.

Prerequisites:

- copied Spine Protobuf definitions;
- domain `.proto` generation with Protobuf-ES;
- command posting;
- aggregate command handling;
- event production and delivery;
- projection updates;
- queries;
- subscriptions;
- validation;
- test utilities.
- real gRPC `CommandService`, `QueryService`, and `SubscriptionService`
  interfaces matching Spine JVM service definitions.

## Required Domain Shape

The example should model a small but representative bounded context:

- `TaskId`;
- `Task` aggregate state;
- commands such as `CreateTask`, `RenameTask`, `CompleteTask`, and `ReopenTask`;
- events such as `TaskCreated`, `TaskRenamed`, `TaskCompleted`, and `TaskReopened`;
- at least one projection for read-side task list views;
- at least one validation rule using Spine options;
- at least one rejection/business refusal path.

## Required Demonstrations

The example must demonstrate:

- command handling through bare-decorated aggregate methods;
- framework-generated handler registry discovery for those bare decorators;
- emitting handlers that return generated domain event/command messages, never
  framework `Event` or `Command` envelopes;
- default-route command target-ID validation before handler invocation;
- projection subscribers;
- query of projection state;
- subscription to task list updates;
- validation failure handling;
- immediate command acknowledgement behavior;
- asynchronous event delivery;
- single-process development startup, plus deployer-configured managed complete
  application replicas for production deployment;
- black-box tests for the bounded context.

If building the example exposes a missing framework feature, implementation
returns to the framework first, adds the missing feature, and then resumes the
example.

## End-User API Constraints

The example is a public API specimen. It must not use framework internals to
make the example pass.

- Use bare decorators: `@Assign`, `@Command`, `@React`, and `@Subscribe`.
- Do not use schema-bearing decorators such as `@Assign(CreateTaskSchema)`.
- `@Assign` handlers return generated domain event messages, using singular
  message, array, or tuple return types.
- `@Command` handlers return generated domain command messages, using singular
  message, array, or tuple return types.
- `@React` handlers return generated domain event messages or explicit `void`
  for no emission.
- `@Subscribe` handlers declare explicit `void` return types.
- The example must not define or use aggregate `@Apply` handlers.
- The example must not call transaction-control methods such as
  `startTransaction()` or `commitTransaction()`. The framework manages entity
  transactions.
- Ordinary example handlers must not return `Event`, `Command`, or other
  framework envelopes, and must not call `packEvent()` or `packCommand()` to
  satisfy handler returns.
- Ordinary example handlers must not create internal framework event IDs or use
  `EventIdSchema`.
- Ordinary example handlers must not perform default command target-ID
  extraction such as `requireTaskId(command.id)`. The default command route
  must reject commands missing the first-field target ID before the handler is
  invoked.
- The example must not define, import, alias, or call handler metadata
  discovery/materialization helper code such as
  `materializeDecoratedEntityHandlers`. Decorated handler discovery is a
  framework/generated-registry concern.
- The build workflow must regenerate the ignored handler registry artifact
  before TypeScript compilation, and runtime context assembly must load the
  compiled registry through framework discovery.

## Documentation

The example must include a `USER_GUIDE.md`. The guide should explain:

- how to generate Protobuf-ES code;
- how to start the server;
- how to post commands;
- how to query state;
- how to subscribe to updates;
- how to run tests;
- which framework features the example demonstrates.

The example guide may link to the framework `USER_GUIDE.md` and package READMEs.
