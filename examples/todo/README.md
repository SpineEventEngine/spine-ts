# To-Do — Your first Spine TS application

The To-Do example is the smallest complete Node application in this repository.
It accepts task commands, records events, updates a task-list Projection, and
exposes commands, queries, and subscriptions through a real local server.

## 💡 What will you learn?

- ✅ How Proto messages become generated TypeScript model code.
- ✅ How one generated message interface and one authored interface become routing tokens.
- ✅ How `@Assign` and `@Subscribe` methods handle commands and events.
- ✅ How generated validation and domain rejections protect entity state.
- ✅ How a client posts a command and reads the resulting Projection.

## 🚀 Run it

Install workspace dependencies once:

```bash
pnpm install --frozen-lockfile
```

Start the server in one terminal:

```bash
pnpm --filter @spine-event-engine/example-todo start
```

After it reports `http://127.0.0.1:8080`, run the smoke client in another
terminal:

```bash
pnpm --filter @spine-event-engine/example-todo smoke
```

The smoke client posts one `CreateTask` command and waits for the matching
`TaskList` row. Stop the server with `Ctrl-C`.

## 🧭 How it works

```mermaid
flowchart LR
  Command[CreateTask command] --> Task[TaskAggregate]
  Task -->|TaskCreated| List[TaskListProjection]
  Task --> Events[(In-memory event storage)]
  List --> Client[Smoke client query]
```

The command handler manages one task's write-side state and returns the domain
event that describes a successful creation. Here is the event-producing part of
[`TaskAggregate.createTask()`](src/index.ts); the aggregate applies the same
ID, title, and initial completion state to its stored state before returning it:

```ts
import { create } from "@bufbuild/protobuf";
import {
  TaskCreatedSchema,
  type TaskCreated,
} from "./generated/spine/examples/todo/task_events_pb.js";
import { type TaskId } from "./generated/spine/examples/todo/task_id_pb.js";

function createTask(id: TaskId, title: string): TaskCreated {
  return create(TaskCreatedSchema, { id, title });
}
```

`TaskListProjection.onTaskCreated()` adds that task to the list and increments
the open-task count. The smoke client waits for this Projection row, which is
why the example demonstrates a command followed by an observable read model.

## 🧩 Route related events together

The To-Do model has a generated `TaskEvent` interface for every task event and
an authored `TaskAssignmentEvent` interface for assignment lifecycle events.
Run `pnpm proto:generate` after changing the Proto model; it writes
`generated/interfaces/task-event.ts` and
`generated/interfaces/task-assignment-event.ts`. The application imports each
exported name in type position for the interface and in value position for the
runtime routing token. The [walkthrough](USER_GUIDE.md) shows the complete
create, assign, reassign, and unassign path.

## 🧪 Run the focused tests

```bash
pnpm vitest run examples/todo/test/black-box.test.ts
pnpm vitest run examples/todo/test/startup-contract.test.ts
```

The first suite uses the public `BlackBox` testing API. The second verifies the
single-process and managed startup contracts, including deployer-supplied
process and Delivery shard counts.

## ⚠️ Single-process mode is local by design

The normal `start` command stores state in memory, which disappears when the
server stops. It does not configure authentication, deployment, tracing,
monitoring, or a multi-machine topology. The managed reference below has a
separate production assembly.

## Managed node reference

The normal `start` command above deliberately remains a single-process local
server. The managed example needs two helper services: Datastore stores the
application state, and Delivery tells the child processes when inbox work is
ready. The following local setup is intentionally disposable.

First build the workspace from the repository root:

```bash
pnpm typecheck:build
```

In a second terminal, start a Datastore emulator:

```bash
docker run --rm --name todo-datastore --publish 8081:8081 \
  gcr.io/google.com/cloudsdktool/google-cloud-cli@sha256:cda01b8c880e9161992c3fd61d7d0e153b4dd073aa4a9d62ad79243907cf8dd4 \
  gcloud emulators firestore start \
  --database-mode=datastore-mode --host-port=0.0.0.0:8081 --quiet
```

In a third terminal, start the repository's in-memory Delivery server:

```bash
HOST=127.0.0.1 PORT=8484 \
node packages/delivery-server/dist/bin/spine-delivery-server.js
```

Finally, start one managed To-Do node from the repository root:

```bash
PROCESS_COUNT=2 DELIVERY_SHARD_COUNT=2 \
HOST=127.0.0.1 PORT=8080 \
DATASTORE_PROJECT_ID=todo-managed \
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
DELIVERY_SERVER_URL=http://127.0.0.1:8484 \
pnpm --dir examples/todo start:managed
```

Wait for `To-do managed coordinator ready at 127.0.0.1:8080`. Stop the To-Do
node, Delivery server, and emulator with `Ctrl-C` in their terminals.

### Why is the file called `managed-entry.ts`?

An _entrypoint_ is the first application file that Node executes. _Managed_
means that Spine supervises several complete child processes behind one Node
Coordinator. The same file is therefore executed in two roles:

```mermaid
flowchart TD
  Start[Node runs managed-entry.ts] --> Parent[Parent: open Coordinator on port 8080]
  Parent --> ChildOne[Child 1: complete Tasks context]
  Parent --> ChildTwo[Child 2: complete Tasks context]
  ChildOne --> Delivery[Observe shared Delivery server]
  ChildTwo --> Delivery
  ChildOne --> Datastore[(Shared Datastore)]
  ChildTwo --> Datastore
```

Read [`managed-entry.ts`](src/managed-entry.ts) from top to bottom:

1. `readTodoManagedDeployment()` validates the six required managed settings.
   `DATASTORE_EMULATOR_HOST` is optional and only tells the Datastore client to
   use the disposable local emulator.
2. `ManagedServerApplication.run()` starts the parent Coordinator and the
   requested number of child processes.
3. `createServer` builds one complete Tasks Bounded Context inside each child.
   Each child uses shared Datastore, observes Delivery directly, and keeps only
   a volatile local subscription registry. The front-facing Gateway is the
   durable owner of browser subscription definitions.
4. `synchronize` opens the child's Delivery connection before that child is
   announced as ready.
5. Only the parent prints the ready message and owns terminal shutdown.

`PROCESS_COUNT` is chosen by the deployer. `DELIVERY_SHARD_COUNT` is a separate
application decision; this example chooses two of each only as a small
reference. The managed parent exposes one Node Coordinator at `HOST:PORT` and
starts the requested number of identical Tasks application replicas behind it.
Each child has the whole bounded context, connects directly to the Delivery
server, and uses the shared Datastore configured for the deployment. A Gateway
or other front-facing proxy sends normal gRPC requests to the Coordinator, not
to a child listener.

## 🔗 Learn more

- [To-Do walkthrough](USER_GUIDE.md)
- [Framework user guide](../../docs/USER_GUIDE.md)
- [Black-box testing](../../packages/testing/README.md)
- [Reference for coding agents](REFERENCE.md)
