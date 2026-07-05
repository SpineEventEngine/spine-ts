# To-Do Example

Small server-side to-do example for Spine TS.

Current status: runnable in-process task operations slice. The example defines
generated Protobuf-ES messages, a decorated task aggregate, task-list projection
rows, and `createTodoContext()` for a single-tenant `Tasks` bounded context
using the framework's default in-memory storage.

Implemented in this slice:

- post `CreateTask` through the real `CommandService` seam;
- post `RenameTask`, `CompleteTask`, and `ReopenTask` through the same seam;
- handle the command with `TaskAggregate`;
- produce and apply task-created, task-renamed, task-completed, and
  task-reopened events;
- update `TaskListProjection` rows from event delivery;
- query visible `TaskList` projection rows through `QueryService`.

Still deferred: validation/refusal examples, subscriptions, standalone server
startup, and the final end-to-end user guide.
