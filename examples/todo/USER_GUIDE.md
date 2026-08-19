# To-Do Example User Guide

This application is a local, runnable specimen of the public Spine TS API. It
uses generated messages and a framework-generated registry for bare-decorated
handlers. Begin with the concise [README](README.md) for prerequisites, build,
server, and smoke commands.

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

`CreateTask` produces `TaskCreated`; the projection observes it and makes a
`TaskList` readable. The framework validates generated message constraints
before accepting a command. A business rule instead throws its generated
rejection: completing a completed task throws `TaskAlreadyDone`. Validation and
technical failures are non-OK acknowledgements; a domain rejection is accepted
command processing with no state transition and is published separately on a
best-effort rejection-event path.

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
message source. Here, [`src/index.ts`](src/index.ts) exports the top-level named
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

The same exported name works in two places: use `TaskEvent` or
`TaskAssignmentEvent` as a type in a type annotation, and use the imported
runtime value as the token passed to `.route(...)`. The application aliases the
assignment token only to make that distinction easy to read.

```ts
// docs-snippet-path: examples/todo/src/index.ts
import { EventRouting } from "@spine-event-engine/server";
import { TaskReassignedSchema } from "../generated/spine/examples/todo/task_events_pb.js";
import type { TaskListId } from "../generated/spine/examples/todo/task_id_pb.js";
import type { UserId } from "@spine-event-engine/proto";
import { TaskAssignmentEvent as TaskAssignmentEventToken } from "../generated/interfaces/task-assignment-event.js";
import { TaskEvent } from "../generated/interfaces/task-event.js";

export interface TaskAssignmentEvent {
  readonly assignee?: UserId | undefined;
}

const taskListRouting = EventRouting.create<TaskListId>().route(TaskEvent, (event) =>
  event.taskListId === undefined ? [] : [event.taskListId],
);
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

`CreateTask` needs a task ID and non-empty title. `AssignTask` selects an
assignee, `ReassignTask` changes it and emits `TaskReassigned`, and
`UnassignTask` removes it. `RenameTask` changes the title; `CompleteTask` marks
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
| Assign                        | An assignee already exists                 | `TaskAlreadyAssigned` |
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

Every `TaskList` projection row has the task-list ID as its projection ID. The
following complete ESM client factors the shared client, target, read, and
decode setup while executing all-row, exact-ID, and declared-column queries.
First run `pnpm typecheck:build` from the repository root, then save the module
as `examples/todo/scripts/query-client.mjs`. Start `pnpm --filter
@spine-event-engine/example-todo start` in terminal one. In terminal two, seed one open
task and copy the task ID printed after `to-do smoke ok:`:

```bash
pnpm --filter @spine-event-engine/example-todo smoke
```

Pass that complete ID as `SPINE_TODO_TASK_ID` when running the saved query
module from the repository root. For example, replace `smoke-...` below with
the ID just printed:

```bash
SPINE_TODO_TASK_ID='smoke-...' pnpm --filter @spine-event-engine/example-todo exec node scripts/query-client.mjs
```

The exact-ID result must contain the seeded row, and the module enforces that
proof. All-row and `open_task_count = 1` reads are bounded demonstrations: they
request at most 16 rows and may omit the seed when more matching rows tie on the
declared `open_task_count` ordering column. Their summaries report the requested
limit, whether the returned page contains the seed, capped IDs, unavailable
rows, and rows omitted by the client-side decoder. The exact-ID query requests
one row. The client independently inspects at most 16 returned rows.

```js
import { log } from "node:console";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { create } from "@bufbuild/protobuf";
import { Int32ValueSchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  QueryService,
  ResponseFormatSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";

import { TaskListSchema } from "../dist/generated/spine/examples/todo/task_list_pb.js";

const baseUrl = process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080";
const taskId = process.env.SPINE_TODO_TASK_ID?.trim();
if (taskId === undefined || taskId === "") {
  throw new Error("Set SPINE_TODO_TASK_ID to the complete task ID printed by package smoke.");
}
const querySuffix = randomUUID();
const maxQueryRows = 16;
const maxLoggedIdLength = 64;
const session = new Http2SessionManager(baseUrl);
const transport = createGrpcTransport({ baseUrl, sessionManager: session });
const queries = createClient(QueryService, transport);
const metadata = new SignalMetadata();
const actorContext = metadata.actorContext({
  actor: create(UserIdSchema, { value: "todo-query-user" }),
});

try {
  const all = await readTaskLists(
    taskListQuery(`query-all-${querySuffix}`, { case: "includeAll", value: true }),
  );
  const exact = await readTaskLists(
    taskListQuery(
      `query-exact-${querySuffix}`,
      {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: taskId }))],
          },
        }),
      },
      1,
    ),
  );
  const oneOpenTask = await readTaskLists(
    taskListQuery(`query-one-open-task-${querySuffix}`, {
      case: "filters",
      value: create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["open_task_count"] },
                value: AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 1 })),
                operator: Filter_Operator.EQUAL,
              }),
            ],
            operator: CompositeFilter_CompositeOperator.ALL,
          }),
        ],
      }),
    }),
  );

  requireTask(exact, "exact-ID query");
  log({
    all: resultSummary(all),
    exact: resultSummary(exact),
    oneOpenTask: resultSummary(oneOpenTask),
  });
} finally {
  session.abort();
}

function requireTask(result, label) {
  if (!result.taskLists.some((list) => list.id === taskId)) {
    throw new Error(`${label} did not return the requested smoke task.`);
  }
}

function resultSummary(result) {
  return {
    requestedLimit: result.requestedLimit,
    containsSeededTask: result.taskLists.some((list) => list.id === taskId),
    taskIds: result.taskLists.map((list) => list.id.slice(0, maxLoggedIdLength)),
    unavailableRows: result.unavailableRows,
    decoderOmittedRows: result.omittedRows,
  };
}

function taskListQuery(id, criterion, limit = maxQueryRows) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: id }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(TaskListSchema),
      criterion,
    }),
    context: actorContext,
    format: create(ResponseFormatSchema, {
      limit,
      orderBy: [
        create(OrderBySchema, {
          column: "open_task_count",
          direction: OrderBy_Direction.ASCENDING,
        }),
      ],
    }),
  });
}

async function readTaskLists(query) {
  const response = await withTimeout(queries.read(query), `query ${query.id?.value}`, 1_000);
  if (response.response?.status?.status.case !== "ok") {
    throw new Error(`Query ${query.id?.value ?? "<missing>"} was not acknowledged.`);
  }
  return {
    ...decodeTaskLists(response),
    requestedLimit: query.format?.limit ?? 0,
  };
}

function decodeTaskLists(response) {
  const maxDecodedRows = 16;
  const taskLists = [];
  let unavailableRows = 0;
  const inspectedRows = response.message.slice(0, maxDecodedRows);
  for (const row of inspectedRows) {
    if (row.state === undefined) {
      unavailableRows += 1;
      continue;
    }
    try {
      const list = AnyMessages.unpack(row.state, TaskListSchema);
      if (list !== undefined) {
        taskLists.push(list);
      } else {
        unavailableRows += 1;
      }
    } catch {
      // Skip malformed matching-type bytes just like absent or mismatched rows.
      unavailableRows += 1;
    }
  }
  return {
    taskLists,
    unavailableRows,
    omittedRows: Math.max(0, response.message.length - inspectedRows.length),
  };
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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
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
import { TaskIdSchema } from "../dist/generated/spine/examples/todo/task_id_pb.js";
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
        id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: taskId }))],
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
      commands.post(createTaskCommand(taskId, suffix)),
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
    if (list.id !== taskId) {
      throw new Error(`Expected TaskList ${taskId}, received ${list.id}.`);
    }
    log(`subscription update: ${list.id}`);

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

function createTaskCommand(taskId, commandSuffix) {
  return SignalEnvelopes.command({
    id: metadata.commandId(`subscription-command-${commandSuffix}`),
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

The startup-contract test verifies both entrypoints. The normal entry remains a
single-process in-memory server. The managed entry requires explicit process
and Delivery shard counts and assembles complete application replicas behind
the Node Coordinator. For a runnable three-terminal setup and a line-by-line
map of why the file is named `managed-entry.ts`, follow the
[managed node reference](README.md#managed-node-reference).

## Further reading and limits

- [Framework user guide](../../docs/USER_GUIDE.md)
- [Server package README](../../packages/server/README.md)
- [Testing package README](../../packages/testing/README.md)
- [Transport package README](../../packages/transport/README.md)
- [Example black-box test](test/black-box.test.ts)
- [Example startup-contract test](test/startup-contract.test.ts)

The walkthrough uses the local single-process entry, so restarting that server
clears its tasks. The managed entry is a separate production reference with
shared storage, direct Delivery observation, and framework-owned child-process
supervision; application-specific authentication, tracing, and monitoring
remain deployment concerns.
