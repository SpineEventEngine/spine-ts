# To-Do Example User Guide

This application is a local, runnable specimen of the public Spine TS API. It
uses generated messages and a framework-generated registry for bare-decorated
handlers. Begin with the concise [README](README.md) for prerequisites, build,
server, and smoke commands.

## Choose storage for the single-process app

The normal `start` command deliberately stays beginner-friendly: it selects
`memory`, so one process starts with no service dependency and discards data at
shutdown. To keep data in a local MySQL or PostgreSQL database, select one
provider before launching the same app:

```bash
TODO_STORAGE=mysql TODO_MYSQL_URL='mysql://user:password@127.0.0.1:3306/todo' \
  pnpm --filter @spine-event-engine/example-todo start:mysql
```

```bash
TODO_STORAGE=postgresql \
  TODO_POSTGRESQL_URL='postgresql://user:password@127.0.0.1:5432/todo' \
  pnpm --filter @spine-event-engine/example-todo start:postgresql
```

The selection boundary builds `MysqlStorageFactory` or `PostgresStorageFactory`
with the generated To-Do type registry. That registry lets durable storage
reversibly render message-valued entity IDs and history columns. A selected
provider without its matching URL stops before startup with a message naming
the missing variable; it never prints the supplied URL.

In another terminal, run `pnpm --filter @spine-event-engine/example-todo smoke`.
It posts a To-Do command and queries the resulting task list, providing an
opt-in live journey through the database you supplied. The command neither
starts Docker nor creates a database. The managed multi-process walkthrough is
different: it intentionally uses Datastore and Delivery to demonstrate shared
replicas, not MySQL or PostgreSQL selection.

## The path before the server starts

Start with a small domain: a task has an identifier, title, and completion
state. The Proto files make that model portable. In this example the first
field of every command is the required task ID, and the first field of the
aggregate state is also its required ID. That convention gives the generated
registry the target for a command; it is not an extra TypeScript annotation.

```text
Proto messages → spine-proto generate → generated schemas and registry
      → Aggregate command handler → stored event → Projection state → read
```

`CreateTask` produces `TaskCreated`, optionally followed by `TaskAssigned` when
the command names an initial assignee. The projections observe these Events
and make a `TaskList` and any initial assignment readable. The framework
validates generated message constraints before accepting a command. A business
rule instead throws its generated
rejection: completing a completed task throws `TaskAlreadyDone`. Validation and
technical failures are non-OK acknowledgements; a domain rejection is accepted
command processing with no state transition and is published separately on a
best-effort rejection-event path.

## Return one Event or an ordered pair

The actual [`TaskAggregate`](src/todo-app.ts) handlers show two native
TypeScript return forms. `assignTask()` declares
`TaskAssignedEvent | TaskReassignedEvent`. The two local names alias the
generated `TaskAssigned` and `TaskReassigned` message types; they are not new
Event types. The `|` means **one of these**: an unassigned
task produces `TaskAssigned`, while assigning a task to a different person
produces `TaskReassigned`. Both alternatives are real Events in the To-Do
model. Repeating the current assignee is still rejected.

`createTask()` declares `readonly [TaskCreated, TaskAssignedEvent?]`. The brackets
describe an **ordered pair**, and `?` means the second Event may be absent.
With no initial assignee, it returns only `TaskCreated`. With an assignee in
`CreateTask`, it returns `TaskCreated` first and `TaskAssigned` second. The
Aggregate stores that assignee in its state, and the Task Assignee Projection
receives the second Event. The framework records the returned Events; the
handler does not build an Event envelope or choose Event IDs itself.

The runnable [black-box tests](test/black-box.test.ts) exercise both choices,
both tuple lengths, Event order, and the old and new assignee read models through
the generated handler registry. Generate and build the example first, then run
the two focused journeys from the repository root:

```bash
pnpm proto:generate
pnpm exec tsc -b examples/todo
pnpm exec vitest run examples/todo/test/black-box.test.ts --maxWorkers=1 \
  -t "assigns an open task or changes its assignee|creates a task with an optional initial assignment"
```

For the other supported return forms and which decorators allow them, see the
[framework handler guide](../../docs/USER_GUIDE.md#choose-what-a-handler-returns).

## Give events a shared TypeScript interface

The To-Do event file deliberately has two kinds of declaration:

```proto
option (every_is).ts_type = "TaskEvent";
option (every_is).generate = true;

message TaskAssigned {
  option (is).ts_type = "TaskAssignmentEvent";
  // fields omitted here; see task_events.proto
}

message TaskUnassigned {
  option (is).ts_type = "TaskAssignmentEvent";
}
```

`every_is` applies to all messages in this file. With `generate = true`,
`pnpm proto:generate` creates `generated/interfaces/task-event.ts`: it exports
both a TypeScript `TaskEvent` interface and a runtime `TaskEvent` token.
`is.ts_type` names an interface you author in the same model module as the
message source. Here, [`src/todo-app.ts`](src/todo-app.ts) exports the top-level named
`interface TaskAssignmentEvent { readonly assignee?: UserId }`; generation
creates `generated/interfaces/task-assignment-event.ts`, which exports that
type and its token. After resolving real paths, only the requested authored
interface must be a top-level named export. Its recursive `extends` parents
must resolve to interfaces in the same model module, but they do not need to be
top-level named exports. Property types may still come from another module, such
as `UserId`.

TypeScript reads `ts_type`. It ignores Java-only option fields, and neither
option creates semantic tags or transport topics. A compiler error is useful:
an authored interface in a different module, a missing exported interface, or
an interface whose member message is not structurally compatible stops
generation/compilation instead of silently broadening a route.

Generated files identify their generated provenance and intentionally have no
copyright header. Keep copyright in authored Proto and TypeScript; regenerate,
do not hand-edit `generated/interfaces/`.

## Register exact and interface routes

The application declares the authored `TaskAssignmentEvent` interface once in
`src/todo-app.ts`. Generation creates a runtime token with the same name. Code
that only configures routing imports that token and aliases it to make its
runtime role explicit.

<!-- docs-snippet-path: examples/todo/src/docs/routing.ts -->

```ts
import { EventRouting } from "@spine-event-engine/server";
import type { UserId } from "@spine-event-engine/proto";

import { TaskReassignedSchema } from "../../generated/spine/examples/todo/task_events_pb.js";
import type { TaskListId } from "../../generated/spine/examples/todo/task_id_pb.js";
import { TaskAssignmentEvent as TaskAssignmentEventToken } from "../../generated/interfaces/task-assignment-event.js";
import { TaskEvent } from "../../generated/interfaces/task-event.js";

// Task Events already include the intended list ID, so this route needs no repository read.
const taskListRouting = EventRouting.create<TaskListId>().route(TaskEvent, (event) =>
  event.taskListId === undefined ? [] : [event.taskListId],
);
// Reassignment names both recipients; its exact route takes precedence over the interface route.
const assigneeRouting = EventRouting.create<UserId>()
  .route(TaskAssignmentEventToken, (event) =>
    event.assignee === undefined ? [] : [event.assignee],
  )
  .route(TaskReassignedSchema, (event) =>
    event.previousAssignee === undefined || event.assignee === undefined
      ? []
      : [event.previousAssignee, event.assignee],
  );

void taskListRouting;
void assigneeRouting;
```

The schema overload is `.route(Schema, route)`; the token overload is
`.route(Token, route)`. Selection is exact schema first, then the first
registered matching token, then the replacement/default route. Therefore the
exact `TaskReassigned` route wins over the broader assignment token and returns
two assignee targets; `TaskAssigned` and `TaskUnassigned` use the token route
and return one; an unrelated event can return zero from its selected route.

Routing runs once when an accepted event is admitted. The framework stores the
typed targets with that accepted work, so retry replays those stored targets
without calling the route again. Read-side catch-up intentionally rebuilds
from events and may evaluate routing again to construct its view.

The Events here already name their recipients. See the separate
[Orders query-routing example](../orders/src/query-routing.ts) for a route that
must look up saved receiving-repository state to discover the affected cards.
Routing reads run when the Event is admitted; they do not run handlers or save
changes, and later delivery is not atomic with the read. A Command route must
choose exactly one recipient. Event and state routes may choose several; more
than 1,000 final distinct recipients produce a warning without dropping any.

## Run the assignment routing journey

The public black-box test is the runnable proof. From the repository root, run
the focused journey with:

```bash
pnpm vitest run examples/todo/test/black-box.test.ts -t "routes assignment lifecycle events to zero, one, and two assignee targets"
```

It posts the real generated commands in this order: `CreateTask`, `AssignTask`,
`ReassignTask`, then `UnassignTask`. Immediately after create, the assignee
Projection has **zero** targets. Assign routes to Ada, so Ada has **one** target
(the task). Reassign uses the exact `TaskReassigned` route, so its stored plan
has **two** targets: Ada loses the task and Lin gains it. Unassign routes to
Lin, leaving Lin with **zero** targets. The test waits for each observable
Projection state; it is not an assertion about a synchronous command Ack.

Run the durable replay proof separately:

```bash
pnpm vitest run examples/todo/test/black-box.test.ts -t "replays a persisted projection Inbox target without rerouting after restart"
```

That test persists admitted work, restarts with a route callback that would
produce a different target, and observes delivery to the originally stored
typed target. The replacement callback is not called: retry replays the stored
Inbox target and does not reroute. This is intentionally different from
`context.catchUpReadSide()`: this process-local reset/replay helper clears
projection state and rebuilds it from stored events, rather than retrying one
accepted Inbox item. It is not durable Projection catch-up and has no
cross-context exchange, enrichment, or historical/live coordination.

The linked source is the complete executable proof:

- [zero/one/two assignment test](test/black-box.test.ts)
- [durable stored-target no-reroute test](test/black-box.test.ts)
- [read-side rebuild test](test/black-box.test.ts)

Server components receive framework logging through their configured logger;
use it for operational context, never as a substitute for a stored event or a
rejection. Durable storage replays accepted inbox work through the same handler
path after a restart, so handlers and downstream effects must tolerate
at-least-once delivery. This local sample uses memory, so its state disappears
when it stops.

## Build and server lifecycle

From the repository root, run `pnpm typecheck:build`. It generates
`examples/todo/generated/handler/generated-handler-registry.ts` and compiles
the package. Both generated and compiled directories are ignored.

Start the process with:

```bash
pnpm --filter @spine-event-engine/example-todo start
```

It creates a local `http://127.0.0.1:8080` server over one in-memory bounded
context. For programmatic local tests, the public package exports
`startTodoServer({ host: "127.0.0.1", port: 0 })`; always call the returned
server's `close()` method. The command-line process keeps its listener until
`Ctrl-C` stops it. Each start has fresh in-memory state.

`createTodoContext()` adds `TaskAggregate` and `TaskListProjection`, then loads
the compiled registry from the package root before `buildAsync()`. If the
generated registry is missing or unreadable, context creation fails with its
module path; rerun `pnpm typecheck:build` and retry. Application handlers keep
their bare `@Assign` and `@Subscribe` decorators: they do not manually register
handler schemas.

For application behavior tests, prefer `await BlackBox.from(await createTodoContext())`
from `@spine-event-engine/testing`. Use `asGuest()` or `onBehalfOf()` for a fixed actor,
post generated command messages, query `TaskListSchema`, and use
`blackBox.eventually()` for projection visibility. Close the BlackBox in
`finally`; it closes its local listener, client session, and uncancelled typed
state/event subscriptions. This runner-neutral boundary works in Node and
Vitest without raw Connect or private server types.

## Post commands and inspect acknowledgements

Use generated schemas and public clients. The checked-in `pnpm --filter
@spine-event-engine/example-todo smoke` program is the executable CreateTask example: it
uses an `Http2SessionManager`, bounds the command and eventual query, checks an
OK acknowledgement, and aborts its session in `finally`.

`CreateTask` needs a task ID, task-list ID, and non-empty title; an initial assignee is
optional. `AssignTask` selects an assignee, emitting `TaskAssigned` initially
or `TaskReassigned` when changing to a different person. `ReassignTask` requires
an existing assignee and emits `TaskReassigned`; `UnassignTask` removes the
assignee. `RenameTask` changes the title; `CompleteTask` marks
it done; `ReopenTask` marks it open. All use the same
`CommandService.Post` envelope shape as the smoke program, replacing only the
generated command schema/message.

An OK acknowledgement confirms the immediate command path, not that an
asynchronous projection is visible. Query or subscribe for that observable
effect.

- Invalid payloads return `COMMAND_VALIDATION_ERROR` with packed validation
  details.
- `TaskAlreadyDone` and `TaskNotDone` are domain rejections. They roll back the
  Aggregate transaction and return an OK acceptance acknowledgement. No domain
  event reaches the Projection, so the task list stays unchanged.
- A rejection also schedules a best-effort typed event. An active unsaturated
  subscription may receive it; saturation, closure, or post failure can prevent
  observation and does not change the OK acknowledgement.

Client envelopes redact rejected-command payloads and throwable stacks.
Technical failures remain non-OK acknowledgements.

### Assignment rejections

| Attempt                       | Current state                              | Rejection             |
| ----------------------------- | ------------------------------------------ | --------------------- |
| Assign, reassign, or unassign | Completed task                             | `TaskAlreadyDone`     |
| Assign                        | Requested assignee is the current assignee | `TaskAlreadyAssigned` |
| Reassign                      | No current assignee                        | `TaskNotAssigned`     |
| Reassign                      | Requested assignee is the current assignee | `TaskAlreadyAssigned` |
| Unassign                      | No current assignee                        | `TaskNotAssigned`     |

Rejected commands preserve aggregate state and produce no normal event route
targets. The rejection event has its own declared TaskList route where needed.

### Snapshot boundary

`TaskList` now stores its typed `TaskListId` in field 4; field 1 is reserved.
Existing snapshots are reset for this change. The example provides no automatic
migration and does not infer a task-list ID from a task ID, so start local
example data fresh after updating.

## Query task lists

Every `TaskList` row uses its typed `TaskListId` as the Projection ID. Normal
generation creates `TaskListQuery` with its declared columns. Import that one
module and build the query; no second generator or column registration is needed.
The existing smoke command posts a task and reads its list through the selected
memory, MySQL, or PostgreSQL storage:

```bash
pnpm --filter @spine-event-engine/example-todo smoke
```

From the repository root, build with `pnpm typecheck:build`, start the app in
another terminal with `pnpm --filter @spine-event-engine/example-todo start`,
then run the smoke command above. Copy the full ID printed after `to-do smoke
ok:` into this invocation of the reader. Replace `smoke-...` with that ID:

```bash
SPINE_TODO_TASK_ID='smoke-...' pnpm --dir examples/todo exec node --input-type=module -e '
import { TaskListReader } from "./dist/src/docs/query-client.js";
const rows = await TaskListReader.readOpen(
  process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080",
  process.env.SPINE_TODO_TASK_ID,
);
if (rows.length !== 1) throw new Error("Expected one open TaskList.");
console.log(rows[0].id.value, rows[0].tasks[0]?.title);
'
```

This command calls `TaskListReader` directly. The smoke program uses direct gRPC
and does not use that object.

The following complete object reads an open list through the Node client.
`send(query)` binds the actor and effective tenant when it executes the query.
The result contains complete generated state messages. A filter chooses rows,
not fields; incoming wire field masks are ignored.

<!-- docs-snippet-path: examples/todo/src/docs/query-client.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-node";
import { AnyMessages } from "@spine-event-engine/core";
import type { QueryResponse } from "@spine-event-engine/proto/client";

import { TaskListIdSchema } from "../../generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../../generated/spine/examples/todo/task_list_pb.js";
import { TaskListQuery } from "../../generated/spine/examples/todo/task_list_query.js";

/**
 * Groups the actor-bound generated-query example methods.
 */
export const TaskListReader: Readonly<{
  readOpen(baseUrl: string, taskId: string): Promise<readonly TaskList[]>;
  states(response: QueryResponse): readonly TaskList[];
}> = Object.freeze({
  /**
   * Reads complete TaskList states through the Node client.
   *
   * @param baseUrl The running To-Do server URL.
   * @param taskId The TaskList ID printed by the smoke command.
   * @returns Complete matching state messages.
   */
  async readOpen(baseUrl, taskId) {
    const client = Client.connectTo(baseUrl);
    try {
      // The generated import registers columns. Build without an actor or tenant.
      const query = TaskListQuery.create()
        .byId(create(TaskListIdSchema, { value: taskId }))
        .openTaskCount()
        .isAtLeast(1)
        .build();
      // The request binds actor and tenant at execution.
      const response = await client.onBehalfOf("todo-query-user").send(query);
      return TaskListReader.states(response);
    } finally {
      await client.close();
    }
  },

  /**
   * Decodes complete TaskList states from a query response.
   *
   * @param response The query response to inspect.
   * @returns Recognized TaskList states, omitting absent or foreign states.
   */
  states(response) {
    return response.message.flatMap((row) => {
      const state =
        row.state === undefined ? undefined : AnyMessages.unpack(row.state, TaskListSchema);
      return state === undefined ? [] : [state];
    });
  },
});
```

For a live view, subscription recovery can use the same built query as its
`authoritativeQuery`; recovery binds the subscription actor and tenant and
returns complete state before live updates resume.

An OK command Ack does not make projection delivery synchronous. When a query
waits for a command consequence, repeat the bounded read only until an overall
deadline, as the checked-in smoke does.

## Subscribe safely

For a live view, create a `Topic` with the same `TaskList` target, subscribe,
and activate the returned subscription. First run `pnpm typecheck:build` from
the repository root, then save this complete ESM module as
`examples/todo/scripts/subscription-client.mjs`. With `pnpm --filter
@spine-event-engine/example-todo start` running in another terminal, execute it from the
repository root with:

```bash
pnpm --filter @spine-event-engine/example-todo exec node scripts/subscription-client.mjs
```

It starts the iterator read before posting the command, applies the delivery
deadline after that post, and decodes one exact-ID projection update.

On success, the `Subscription` is an opaque server-generated handle. The module
cancels it, aborts the stream signal, returns the iterator, and aborts HTTP/2.

If the one-second creation deadline expires first, the client has no ID to
cancel. Session abort still closes transport. A created but inactive definition
remains pending for 30 seconds; active definitions have no framework TTL. The
default registry uses application storage, while streams and queues are local.
Cancel physically deletes the definition.

```js
import { log } from "node:console";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  CommandService,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";

import { CreateTaskSchema } from "../dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../dist/generated/spine/examples/todo/task_list_pb.js";

const baseUrl = process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080";
const session = new Http2SessionManager(baseUrl);
const transport = createGrpcTransport({ baseUrl, sessionManager: session });
const commands = createClient(CommandService, transport);
const subscriptions = createClient(SubscriptionService, transport);
const metadata = new SignalMetadata();
const actorContext = metadata.actorContext({
  actor: create(UserIdSchema, { value: "todo-subscription-user" }),
});
const suffix = randomUUID();
const taskId = `subscription-task-${suffix}`;
const target = create(TargetSchema, {
  type: TypeUrls.derive(TaskListSchema),
  criterion: {
    case: "filters",
    value: create(TargetFiltersSchema, {
      idFilter: {
        id: [AnyMessages.pack(TaskListIdSchema, create(TaskListIdSchema, { value: taskId }))],
      },
    }),
  },
});

try {
  const subscription = await withTimeout(
    subscriptions.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `subscription-topic-${suffix}` }),
        target,
        context: actorContext,
      }),
    ),
    "subscription creation",
    1_000,
  );
  let stream;
  let iterator;
  let pendingUpdate;
  let canceled = false;

  try {
    stream = new AbortController();
    iterator = subscriptions
      .activate(subscription, { signal: stream.signal })
      [Symbol.asyncIterator]();
    pendingUpdate = iterator.next();
    void pendingUpdate.catch(() => undefined);
    const ack = await withTimeout(
      commands.post(createTaskCommand(taskId)),
      "CreateTask acknowledgement",
      1_000,
    );
    if (ack.status?.status.case !== "ok") {
      throw new Error("CreateTask was not acknowledged.");
    }

    const delivered = await withTimeout(pendingUpdate, "subscription update", 1_000);
    pendingUpdate = undefined;
    if (delivered.done === true) {
      throw new Error("Subscription ended before delivering an update.");
    }
    const list = taskListFrom(delivered.value);
    if (list === undefined) {
      throw new Error("Subscription update did not contain TaskList state.");
    }
    if (list.id?.value !== taskId) {
      throw new Error(`Expected TaskList ${taskId}, received ${list.id?.value ?? "<missing>"}.`);
    }
    log(`subscription update: ${list.id.value}`);

    const cancel = await withTimeout(
      subscriptions.cancel(subscription),
      "subscription cancellation",
      1_000,
    );
    if (cancel.status?.status.case !== "ok") {
      throw new Error("Subscription cancellation was not acknowledged.");
    }
    canceled = true;
    stream.abort();
    await withTimeout(
      iterator.return?.() ?? Promise.resolve({ done: true }),
      "iterator return",
      1_000,
    );
    iterator = undefined;
  } finally {
    stream?.abort();
    if (!canceled) {
      await withTimeout(subscriptions.cancel(subscription), "subscription cleanup", 1_000).catch(
        () => undefined,
      );
    }
    if (pendingUpdate !== undefined) {
      await withTimeout(pendingUpdate, "pending subscription read cleanup", 1_000).catch(
        () => undefined,
      );
    }
    if (iterator !== undefined) {
      await withTimeout(
        iterator.return?.() ?? Promise.resolve({ done: true }),
        "iterator cleanup",
        1_000,
      ).catch(() => undefined);
    }
  }
} finally {
  session.abort();
}

function createTaskCommand(taskId) {
  return SignalEnvelopes.command({
    context: metadata.commandContext({ actorContext }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      title: "Observe the subscription",
    }),
  });
}

function taskListFrom(update) {
  const entityUpdate =
    update.update.case === "entityUpdates" ? update.update.value.update[0] : undefined;
  if (entityUpdate?.kind.case !== "state") {
    return undefined;
  }
  return AnyMessages.unpack(entityUpdate.kind.value, TaskListSchema);
}

async function withTimeout(promise, label, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
```

The smoke deliberately does not subscribe; the black-box suite is the
subscription acceptance proof. Active streams and queued updates are
process-local, and this guide does not promise update replay after disconnect
or restart.

## Test the supported paths

From a clean generated state:

```bash
pnpm typecheck:build
pnpm vitest run examples/todo/test/black-box.test.ts
pnpm vitest run examples/todo/test/startup-contract.test.ts
```

The black-box test starts a real loopback server and proves public generated
clients, acknowledgement handling, eventual projection reads, subscriptions,
validation/rejections, generated-registry recovery, and listener/session cleanup.

The startup-contract test verifies structural commands, public exports, settings,
and documentation contracts. Behavioral launcher coverage and the documented
live smoke paths exercise both app modes. The single-process app uses in-memory
storage. The multi-process app requires explicit process and Delivery shard
counts, then starts complete replicas behind the Node Coordinator. Read
the implementation in order: `single-process-app.ts`, `multi-process-app.ts`,
`multi-process-coordinator.ts`, and `multi-process-replica.ts`. For the runnable
setup, follow the [multi-process app reference](README.md#multi-process-app).

## Further reading and limits

- [Framework user guide](../../docs/USER_GUIDE.md)
- [Server package README](../../packages/server/README.md)
- [Testing package README](../../packages/testing/README.md)
- [Transport package README](../../packages/transport/README.md)
- [Example black-box test](test/black-box.test.ts)
- [Example startup-contract test](test/startup-contract.test.ts)

The walkthrough uses the single-process app, so restarting it clears its tasks.
The multi-process app uses shared storage and direct Delivery observation;
application-specific authentication, tracing, and monitoring remain deployment
concerns.
