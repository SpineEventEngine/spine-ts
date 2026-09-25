# To-Do — your first Spine TS application

This small application accepts task commands, records Events, updates a task-list
Projection (a read model), and serves commands, queries, and subscriptions on a local server.

## Running the app

Install the workspace dependencies first. Use `pnpm install --frozen-lockfile`
when you need the lockfile-exact dependency set, or `pnpm install` for normal
local development. The multi-process app also requires Docker to be installed
and running so it can run its local Datastore emulator container.

### Single-process app

From the repository root, start it with:

```bash
examples/todo/scripts/run-single-process.sh
```

The launcher builds the workspace once and starts one Node process from
[`single-process-app.ts`](src/single-process-app.ts). It assembles the reusable
To-Do application area (a Bounded Context) in [`todo-app.ts`](src/todo-app.ts), listens at
`http://127.0.0.1:8080`, and keeps its Event Store in memory by default. Run the smoke client in
another terminal:

```bash
pnpm --filter @spine-event-engine/example-todo smoke
```

```mermaid
flowchart LR
  Client[Smoke client] --> App[One To-Do process]
  App --> Store[(In-memory Event Store)]
  App --> List[Task-list Projection]
```

Press `Ctrl-C` to stop the app. Its in-memory data disappears when it stops.

### Durable single-process storage

Set `TODO_STORAGE` to `mysql` or `postgresql` to use a durable database in the
same single Node process. Each choice requires its matching URL; startup reports
the missing setting without printing the URL or its credentials.

```bash
TODO_STORAGE=mysql \
TODO_MYSQL_URL='mysql://user:password@127.0.0.1:3306/todo' \
pnpm --filter @spine-event-engine/example-todo start:mysql
```

```bash
TODO_STORAGE=postgresql \
TODO_POSTGRESQL_URL='postgresql://user:password@127.0.0.1:5432/todo' \
pnpm --filter @spine-event-engine/example-todo start:postgresql
```

With either server running, `pnpm --filter @spine-event-engine/example-todo smoke`
posts a real To-Do command and reads the resulting task-list query through the
selected backend. These are opt-in live checks: they use the database URL you
supply and do not create or start database containers.

`TODO_STORAGE=memory` is explicit but optional because it is the default. The
separate managed multi-process demonstration below continues to use Datastore;
it demonstrates shared replicas and Delivery rather than these local durable
single-process choices.

### Multi-process app

From the repository root, start the complete local demonstration with:

```bash
examples/todo/scripts/run-multi-process.sh
```

The launcher builds the workspace, creates a uniquely named Datastore emulator
container from `google/cloud-sdk:578.0.0-emulators`,
starts the repository's Delivery server, waits for both, then starts the
parent process that accepts requests and forwards them to workers (the
Coordinator) in [`multi-process-app.ts`](src/multi-process-app.ts). The parent
uses [`multi-process-coordinator.ts`](src/multi-process-coordinator.ts)
for readiness and shutdown, while every worker (a replica) uses
[`multi-process-replica.ts`](src/multi-process-replica.ts) to assemble a full
To-Do application area with Datastore and Delivery. A Delivery shard is one
independent partition of Delivery work. Settings are parsed in
[`multi-process-settings.ts`](src/multi-process-settings.ts).

```mermaid
flowchart LR
  Coordinator --> Replica1[Complete replica]
  Coordinator --> Replica2[Complete replica]
  Replica1 --> Store[(Datastore Event Store)]
  Replica2 --> Store
  Replica1 --> Delivery[Delivery server]
  Replica2 --> Delivery
```

Set `TODO_PROCESS_COUNT` and `TODO_DELIVERY_SHARD_COUNT` before running the
launcher to select the number of replicas and Delivery shards independently.
For example, `TODO_PROCESS_COUNT=3 TODO_DELIVERY_SHARD_COUNT=2` starts three
complete app replicas with two Delivery shards. The launcher waits for the
Coordinator's ready message and owns shutdown: normal exit, `Ctrl-C`, `SIGTERM`,
and partial startup all stop only the processes and emulator container it made.
The Datastore emulator holds data only while its container runs.
It observes the emulator's ready log, the Delivery server's exact
`Delivery server listening at …` message, and the Coordinator ready message;
if Delivery or the Coordinator exits before its message, the launcher reports
its captured output; if the owned emulator stops or is missing, it reports its
available container logs. It then cleans up only resources it created.

## How it works

`CreateTask` always produces a stored `TaskCreated` Event. If the command also
names an initial assignee, it produces `TaskAssigned` second. The Task List and
Task Assignee Projections observe those Events to make the task readable.
`AssignTask` produces `TaskAssigned` for an unassigned task or `TaskReassigned`
when moving it from one person to another. The
[walkthrough](USER_GUIDE.md#return-one-event-or-an-ordered-pair) explains why
the handlers declare these alternatives and how the optional Event works.

<!-- docs-snippet-path: examples/todo/src/docs/create-task.ts -->

```ts
import { create } from "@bufbuild/protobuf";

import { TaskCreatedSchema } from "../../generated/spine/examples/todo/task_events_pb.js";
import { TaskIdSchema, TaskListIdSchema } from "../../generated/spine/examples/todo/task_id_pb.js";

function createTask(id: string, taskListId: string, title: string) {
  return create(TaskCreatedSchema, {
    id: create(TaskIdSchema, { value: id }),
    taskListId: create(TaskListIdSchema, { value: taskListId }),
    title,
  });
}

void createTask;
```

## Learn more

- [To-Do walkthrough](USER_GUIDE.md)
- [Framework user guide](../../docs/USER_GUIDE.md)
- [Black-box testing](../../packages/testing/README.md)
- [Reference for coding agents](REFERENCE.md)
