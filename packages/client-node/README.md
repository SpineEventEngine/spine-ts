# Spine client for Node.js

Use this package from a Node.js application to post commands, send queries, or
create subscriptions for query-side views. It creates the Node HTTP/2 transport;
the same request and subscription API is shared with the browser client.

For detailed public contracts and limits, read the [reference](REFERENCE.md).

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains the gateway boundary shared by Node and browser clients.

## 💡 Why use it?

- ✅ Posts commands and reads entities through typed Spine services.
- ✅ Creates, activates, and cancels subscriptions.
- ✅ Manages the Node HTTP/2 connection and closes it predictably.
- ✅ Builds safe entity queries from generated `(column)` declarations.

## 🚀 Connect to an application server

Create one client for the process or application component that manages the
connection. A client created with `connectTo()` creates and closes its HTTP/2
session.

```ts
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Client } from "@spine-event-engine/client-node";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";

const client = Client.connectTo("http://127.0.0.1:8080", { tenant: "tasks" });
const request = client.onBehalfOf("alice");
const result = await request.post(
  PostMessageSchema,
  create(PostMessageSchema, {
    id: create(MessageIdSchema, { value: "message-1" }),
    board: create(BoardIdSchema, { value: "general" }),
    author: create(UserIdSchema, { value: "alice" }),
    username: "Alice",
    text: "Hello, Message Board.",
    postedAt: timestampFromDate(new Date()),
  }),
);
if (result.kind === "rejection") console.log(result.rejection);
await client.close();
```

The URL is an application gateway URL. It is not an instruction to expose a
Spine server directly to the internet.

Node subscriptions use the same `createSubscription`, `activate`, and `cancel`
API as the browser client; see the [client-web reference](../client-web/REFERENCE.md)
for its lifecycle and recovery limits.

## 🔎 Query entities by declared columns

Generate entity columns from the model package, register them once, and build
queries with those declared columns. The `./codegen` entry point is for model
generation; applications use the generated definition and `EntityQuery`.
`limit()` requires an ordering. Only generated columns for the selected Entity
may be used in its predicates.

Generate those definitions in a model package with the Node code-generation
plugin, then import the resulting declaration from that model:

```sh
protoc --spine-entity-columns_out=generated proto/spine/examples/messageboard/message_board.proto
```

```ts
import { Client, EntityColumn, EntityQuery } from "@spine-event-engine/client-node";
import { create } from "@bufbuild/protobuf";
import { ActorContextSchema } from "@spine-event-engine/proto";
import { TaskListColumnDefinition } from "@spine-event-engine/example-todo/generated/spine/examples/todo/task_list_columns.js";
import { TaskListSchema } from "@spine-event-engine/example-todo/generated/spine/examples/todo/task_list_pb.js";

const columns = EntityColumn.register(TaskListSchema, TaskListColumnDefinition);
const query = EntityQuery.select({
  schema: TaskListSchema,
  columns,
  context: create(ActorContextSchema, { actor: { value: "alice" } }),
})
  .orderBy(columns.openTaskCount, "desc")
  .limit(20)
  .build();
const client = Client.connectTo("http://127.0.0.1:8080");
const response = await client.asGuest().send(query);
console.log(response.message.length);
await client.close();
```

## ⚠️ Connection behavior

The client does not make a server safe for public access. Put the authenticated
application gateway at the network boundary. Commands are not retried
automatically, and an interrupted subscription must be recreated before the
application re-reads current entity state.

## 🔗 Learn more

- [Browser client](../client-web/README.md)
- [Server](../server/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
