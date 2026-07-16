# To-Do Example User Guide

This application is a local, runnable specimen of the public Spine TS API. It
uses generated messages and a framework-generated registry for bare-decorated
handlers. Begin with the concise [README](README.md) for prerequisites, build,
server, and smoke commands.

## Build and server lifecycle

From the repository root, run `pnpm typecheck:build`. It generates
`examples/todo/generated/handler/generated-handler-registry.ts` and compiles
the package. Both generated and compiled directories are ignored.

Start the process with:

```bash
pnpm --filter @spine-ts/example-todo start
```

It creates a local `http://127.0.0.1:8080` server over one in-memory bounded
context. For programmatic local tests, the public package exports
`startTodoServer({ host: "127.0.0.1", port: 0 })`; always call the returned
server's `close()` method. The command-line process owns its listener until
`Ctrl-C` stops it. Each start has fresh in-memory state.

`createTodoContext()` adds `TaskAggregate` and `TaskListProjection`, then loads
the compiled registry from the package root before `buildAsync()`. If the
generated registry is missing or unreadable, context creation fails with its
module path; rerun `pnpm typecheck:build` and retry. Application handlers keep
their bare `@Assign` and `@Subscribe` decorators: they do not manually register
handler schemas.

## Post commands and inspect acknowledgements

Use generated schemas and public clients. The checked-in `pnpm --filter
@spine-ts/example-todo smoke` program is the executable CreateTask example: it
owns an `Http2SessionManager`, bounds the command and eventual query, checks an
OK acknowledgement, and aborts its session in `finally`.

`CreateTask` needs a task ID and non-empty title. `RenameTask` changes the title;
`CompleteTask` marks it done; `ReopenTask` marks it open. All use the same
`CommandService.Post` envelope shape as the smoke program, replacing only the
generated command schema/message.

An OK acknowledgement confirms the immediate command path, not that an
asynchronous projection is visible. Query or subscribe for that observable
effect. Invalid accepted payloads return `COMMAND_VALIDATION_ERROR` with packed
`spine.validation.ValidationError` details. Completing an already completed
task throws the generated `TaskAlreadyDone` rejection; reopening an open task
throws generated `TaskNotDone`. Both return an OK acceptance acknowledgement,
leave task-list state unchanged after rollback, and schedule a best-effort typed
rejection event post. When that post succeeds, an already-active rejection
subscription with queue capacity may receive the typed payload and ordinary
event metadata; the client envelope redacts the rejected command and throwable
stack. Internal generated subscribers still receive the full defensive
rejection context. Saturation or closure can prevent client observation. A post
failure is recorded internally, does not change the OK `Ack`, and has no current
retry guarantee. Invalid payloads and technical failures remain non-OK
acknowledgements.

## Query task lists

Every `TaskList` projection row has the task ID as its projection ID. The
following complete ESM client factors the shared client, target, read, and
decode setup while executing all-row, exact-ID, and declared-column queries.
First run `pnpm typecheck:build` from the repository root, then save the module
as `examples/todo/scripts/query-client.mjs`. Start `pnpm --filter
@spine-ts/example-todo start` in terminal one. In terminal two, seed one open
task and copy the task ID printed after `to-do smoke ok:`:

```bash
pnpm --filter @spine-ts/example-todo smoke
```

Pass that complete ID as `SPINE_TODO_TASK_ID` when running the saved query
module from the repository root. For example, replace `smoke-...` below with
the ID just printed:

```bash
SPINE_TODO_TASK_ID='smoke-...' pnpm --filter @spine-ts/example-todo exec node scripts/query-client.mjs
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
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { SignalMetadata } from "@spine-ts/server";

import { TaskListSchema } from "../dist/generated/spine/example/todo/v1/task_list_pb.js";

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
            id: [packAny(StringValueSchema, create(StringValueSchema, { value: taskId }))],
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
                value: packAny(Int32ValueSchema, create(Int32ValueSchema, { value: 1 })),
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
      type: deriveTypeUrl(TaskListSchema),
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
      const list = unpackAny(row.state, TaskListSchema);
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
@spine-ts/example-todo start` running in another terminal, execute it from the
repository root with:

```bash
pnpm --filter @spine-ts/example-todo exec node scripts/subscription-client.mjs
```

It starts the iterator read before posting the command, applies the delivery
deadline after that post, and decodes one exact-ID projection update. When
subscription creation succeeds, the returned `Subscription` is an opaque,
server-generated handle; the module explicitly cancels it and immediately
aborts the stream signal, returns the iterator, and aborts the HTTP/2 session.
If the one-second creation deadline expires before that handle reaches the
client, the client has no subscription ID it can cancel. Session abort still
closes the client transport, while any server record created but never
activated is removed by the configurable server inactive TTL
(`SpineServicesOptions.inactiveTtlMs`), which defaults to 30 seconds.
Non-positive or non-finite values become 1; positive finite values are floored;
effective values above 2,147,483,647 milliseconds synchronously throw TypeError
before storage or timer work.

```js
import { log } from "node:console";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import { SignalMetadata } from "@spine-ts/server";

import { CreateTaskSchema } from "../dist/generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "../dist/generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema } from "../dist/generated/spine/example/todo/v1/task_list_pb.js";

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
  type: deriveTypeUrl(TaskListSchema),
  criterion: {
    case: "filters",
    value: create(TargetFiltersSchema, {
      idFilter: {
        id: [packAny(StringValueSchema, create(StringValueSchema, { value: taskId }))],
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
  return packCommand({
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
  return unpackAny(entityUpdate.kind.value, TaskListSchema);
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
child-owned projected row. Its cleanup stops the child, closes the parent
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
