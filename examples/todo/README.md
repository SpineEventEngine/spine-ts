# To-Do Example

Small server-side to-do example for Spine TS.

Current status: runnable in-process create-task vertical slice. The example
defines generated Protobuf-ES messages, a decorated task aggregate, a task-list
projection, and `createTodoContext()` for a single-tenant `Tasks` bounded
context using the framework's default in-memory storage.

Implemented in this slice:

- post `CreateTask` through the real `CommandService` seam;
- handle the command with `TaskAggregate`;
- produce and apply `TaskCreated`;
- update `TaskListProjection` from event delivery;
- query visible `TaskList` projection state through `QueryService`.

Still deferred: rename, complete, reopen, validation/refusal examples,
subscriptions, standalone server startup, and the final end-to-end user guide.
