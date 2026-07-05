# To-Do Example User Guide

This guide shows the runnable server-side to-do example. The server is intended
for local development and tests; it uses in-memory storage, so state is not
shared across processes and disappears when the process exits.

## Generate And Build

Run generation and TypeScript build from the repository root:

```bash
pnpm typecheck:build
```

Generated Protobuf-ES output lives under `examples/todo/generated/` and remains
ignored by Git. The build writes runnable JavaScript under `examples/todo/dist/`.

## Start The Server

Start the example after building:

```bash
pnpm --filter @spine-ts/example-todo start
```

By default the process listens at:

```text
http://127.0.0.1:8080
```

Application code can also start an ephemeral test server:

```ts
import { startTodoServer } from "@spine-ts/example-todo";

const server = await startTodoServer({ host: "127.0.0.1", port: 0 });
console.log(server.baseUrl);
await server.close();
```

The server registers the existing Spine `CommandService`, `QueryService`, and
`SubscriptionService` adapters over `createTodoContext()`. There is no separate
process supervisor or framework facade in this example.

## Post Commands

Use Connect clients and the generated command schemas:

```ts
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { packCommand } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
} from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import { CreateTaskSchema } from "./generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "./generated/spine/example/todo/v1/task_id_pb.js";

const transport = createGrpcTransport({ baseUrl: "http://127.0.0.1:8080" });
const commands = createClient(CommandService, transport);
const command = packCommand({
  id: create(CommandIdSchema, { uuid: "command-create-1" }),
  context: create(CommandContextSchema, {
    actorContext: create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "todo-user" }),
    }),
  }),
  schema: CreateTaskSchema,
  message: create(CreateTaskSchema, {
    id: create(TaskIdSchema, { value: "task-1" }),
    title: "Write the guide",
  }),
});

const ack = await commands.post(command);
console.log(ack.status?.status.case);
```

`RenameTask`, `CompleteTask`, and `ReopenTask` use the same command service
path. Invalid command payloads return an Ack error with
`COMMAND_VALIDATION_ERROR` and packed `spine.validation.ValidationError`
details. Completing an already completed task returns `TASK_ALREADY_DONE`;
reopening an open task returns `TASK_NOT_DONE`.

## Query Task Lists

The read side stores one `TaskList` projection row per task ID. Query all rows
with an `includeAll` target:

```ts
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { deriveTypeUrl, unpackAny } from "@spine-ts/core";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { TargetSchema } from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { TaskListSchema } from "./generated/spine/example/todo/v1/task_list_pb.js";

const transport = createGrpcTransport({ baseUrl: "http://127.0.0.1:8080" });
const queries = createClient(QueryService, transport);
const response = await queries.read(
  create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query-task-lists" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: { case: "includeAll", value: true },
    }),
  }),
);
const lists = response.message.map((row) => unpackAny(row.state, TaskListSchema));
console.log(lists);
```

ID-filter queries are also supported by `QueryService.Read`; see
`examples/todo/src/index.test.ts` for the exact `StringValue` ID filter shape.

## Subscribe To Updates

Subscribe to the `TaskList` projection target, activate the returned
subscription, then post commands. Updates are emitted from projection changes:

```ts
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { deriveTypeUrl, unpackAny } from "@spine-ts/core";
import { TargetSchema } from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { TaskListSchema } from "./generated/spine/example/todo/v1/task_list_pb.js";

const transport = createGrpcTransport({ baseUrl: "http://127.0.0.1:8080" });
const subscriptions = createClient(SubscriptionService, transport);
const subscription = await subscriptions.subscribe(
  create(TopicSchema, {
    id: create(TopicIdSchema, { value: "topic-task-lists" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: { case: "includeAll", value: true },
    }),
  }),
);

for await (const update of subscriptions.activate(subscription)) {
  const entityUpdate =
    update.update.case === "entityUpdates" ? update.update.value.update[0] : undefined;
  const state = entityUpdate?.kind.case === "state" ? entityUpdate.kind.value : undefined;
  if (state !== undefined) {
    console.log(unpackAny(state, TaskListSchema));
  }
}
```

Call `SubscriptionService.Cancel` with the returned subscription when the
client is done.

## Run Tests

Focused example coverage:

```bash
pnpm typecheck:build
pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests
```

The focused suite covers in-process black-box behavior and a real
gRPC-compatible smoke test that starts the standalone server, posts a
`CreateTask` command, reads `TaskList` through `QueryService`, and receives a
`SubscriptionService` update.

Some sandboxes block loopback listeners with `EPERM`; rerun the focused test
with the required local-network approval if that happens.
