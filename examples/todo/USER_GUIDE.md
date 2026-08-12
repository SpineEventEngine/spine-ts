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

The generated registry uses exact message types first. A routing declaration
can supply the fallback with `replaceDefault`; a handler does not declare its
own default. Command, event, and state-update handlers are distinct routes;
TypeScript does not interpret Java Proto options for routing. An event handler
can narrow an event with `@Where` against an event field. Keep filters about
event data, not a made-up semantic route name.

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

`CreateTask` needs a task ID and non-empty title. `RenameTask` changes the title;
`CompleteTask` marks it done; `ReopenTask` marks it open. All use the same
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

## Query task lists

Every `TaskList` projection row has the task ID as its projection ID. The
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
pnpm vitest run examples/todo/test/local-multi-process.test.ts
```

The black-box test starts a real loopback server and proves public generated
clients, acknowledgement handling, eventual projection reads, subscriptions,
validation/rejections, generated-registry recovery, and listener/session cleanup.

The local multi-process test starts a separate child process and same-host
ZeroMQ IPC fixture, sends one generated command from the parent, and reads the
row projected by the child. Its cleanup stops the child, closes the parent
listener and transport, and removes the temporary IPC directory on success and
failure paths. It is a focused test fixture—not a public multi-process
supervisor or CLI. Sandboxes that deny loopback/IPC binds can report `EPERM`;
run the native test in an environment that permits those local resources.

## Further reading and limits

- [Framework user guide](../../docs/USER_GUIDE.md)
- [Server package README](../../packages/server/README.md)
- [Testing package README](../../packages/testing/README.md)
- [Transport package README](../../packages/transport/README.md)
- [Example black-box test](test/black-box.test.ts)
- [Example local multi-process test](test/local-multi-process.test.ts)

The example is local-only and process-local: no production persistence,
authentication, deployment, tracing, health checking, process supervision, or
remote/multi-host transport is provided. Restarting the standalone server clears
its tasks.
