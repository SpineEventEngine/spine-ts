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

- command handling through decorated aggregate methods;
- event appliers;
- projection subscribers;
- query of projection state;
- subscription to task list updates;
- validation failure handling;
- immediate command acknowledgement behavior;
- asynchronous event delivery;
- local multi-process mode through the bus abstraction when available;
- black-box tests for the bounded context.

If building the example exposes a missing framework feature, implementation
returns to the framework first, adds the missing feature, and then resumes the
example.

## Documentation

The example must have its own `USER_GUIDE.md`. The guide should explain:

- how to generate Protobuf-ES code;
- how to start the server;
- how to post commands;
- how to query state;
- how to subscribe to updates;
- how to run tests;
- which framework features the example demonstrates.

The example guide may link to the framework `USER_GUIDE.md` and package READMEs.
