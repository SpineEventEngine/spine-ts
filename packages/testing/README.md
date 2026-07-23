# @spine-ts/testing

`BlackBox` starts one ephemeral local `@spine-ts/server` server and exposes one
public `@spine-ts/client` session. It is runner-neutral: use it from Node's
test runner, Vitest, or another assertion library.

```ts
import { create } from "@bufbuild/protobuf";
import { ProjectionColumn, ProjectionQuery } from "@spine-ts/client";
import { ActorContextSchema, UserIdSchema } from "@spine-ts/proto";
import { BlackBox } from "@spine-ts/testing";
import { createTasksContext } from "@example/tasks-test-support";
import { CreateTaskSchema } from "@example/tasks-proto/task_commands_pb";
import { TaskCreatedSchema } from "@example/tasks-proto/task_events_pb";
import { TaskIdSchema } from "@example/tasks-proto/task_id_pb";
import { TaskListColumnDefinition } from "@example/tasks-proto/task_list_columns";
import { TaskListSchema } from "@example/tasks-proto/task_list_pb";

const taskId = create(TaskIdSchema, { value: "task-1" });
const TaskListColumns = ProjectionColumn.register(TaskListSchema, TaskListColumnDefinition);
const taskListQuery = ProjectionQuery.select({
  schema: TaskListSchema,
  columns: TaskListColumns,
  context: create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "alice" }),
  }),
})
  .byId(taskId)
  .build();

const blackBox = await BlackBox.from(await createTasksContext(), {
  zoneId: "Europe/Lisbon",
});
try {
  const alice = blackBox.onBehalfOf("alice");
  const stateUpdates = await alice.subscribeToState(TaskListSchema, TaskIdSchema, {
    ids: [taskId],
  });
  const createdEvents = await alice.subscribeToEvents(TaskCreatedSchema);

  const result = await alice.post(
    CreateTaskSchema,
    create(CreateTaskSchema, { id: taskId, title: "Write tests" }),
  );
  if (result.kind !== "ok") throw new Error(`CreateTask failed: ${result.kind}`);

  const observed = await blackBox.eventually(
    () => alice.query(TaskListSchema, taskListQuery),
    (candidate) => candidate.kind === "ok" && candidate.states.length === 1,
  );
  if (observed.kind !== "ok") throw new Error(`TaskList query failed: ${observed.kind}`);

  await stateUpdates.cancel();
  await createdEvents.cancel();
} finally {
  await blackBox.close();
}
```

The `@example/*` modules are a complete consumer-substitution pattern: the
application owns `createTasksContext()`, its generated Protobuf-ES schemas, and
its generated Projection column definition. Replace those paths with the
corresponding modules in the application under test. A scope can also inject a
generated event directly with `postEvent(EventSchema, eventMessage)`.

```ts
await alice.postEvent(
  TaskCreatedSchema,
  create(TaskCreatedSchema, { id: taskId, title: "Imported task" }),
);
```

Direct input uses the same fixed tenant, zone, and actor as the scope.

The BlackBox owns subscriptions returned by its scopes. Explicitly cancel a
subscription when finished; `close()` cancels remaining subscriptions, closes
the client, and closes the local server. A multitenant context requires a fixed
tenant; a single-tenant context rejects one. `BlackBoxTimeoutError` signals an
eventual predicate that did not match before its bounded timeout. `timeoutMs`
and `intervalMs` are positive integers: their defaults are 500 and 5
milliseconds, respectively; fractional, non-finite, zero, and negative values
are rejected before a context builder is built or any server/client resource
is acquired. Per-call `eventually()` overrides are validated before its first
read.
