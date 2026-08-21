# Spine client for Node.js

Use this package from a Node.js ESM application to post commands, send queries,
or create subscriptions for query-side views. It owns the Node HTTP/2 transport;
the request and subscription API is shared with the browser client.

This is an experimental snapshot. Install the snapshot explicitly while its API
and packaging continue to evolve:

```sh
pnpm add @spine-event-engine/client-node@2.0.0-snapshot.3
```

For detailed public contracts, lifecycle rules, and limits, read the
[reference](REFERENCE.md).

## 💡 Who should use it?

- ✅ Node.js services, workers, and command-line applications that call a Spine
  application gateway.
- ✅ Applications that already own a generated Spine model package and a
  reachable local or deployed Spine service.
- ❌ Browser applications; use `@spine-event-engine/client-web` instead.

## 🚀 Post a command to a local application

Before running this example, use Node.js with ESM support, generate and build
your application's Proto model, and start that application's local Spine
service. The Message Board workspace app provides one concrete local service at
`http://127.0.0.1:8080`; its generated model imports below stand for your own
published application model. Do not add the private example package as an
application dependency.

Create one client for the component that manages the connection. A client from
`connectTo()` owns its HTTP/2 session, so always close it.

<!-- docs-snippet-path: examples/message-board/app/src/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Client } from "@spine-event-engine/client-node";
import { PostMessageSchema } from "../../model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardIdSchema,
  MessageIdSchema,
} from "../../model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "../../model/generated/spine/examples/messageboard/user_pb.js";

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
if (result.kind !== "ok") throw new Error(`Message was not accepted: ${result.kind}`);
await client.close();
```

The URL is an application gateway URL. It is not an instruction to expose a
Spine server directly to the internet. A successful call is an observation that
the local service accepted the command; handle rejection and error outcomes in
your application instead of assuming every command succeeds.

## 🔎 Query generated entities

Generate entity columns from the model package, register them once, and build
queries with those declared columns. The `./codegen` entry point is for model
generation; applications use the generated definition and `EntityQuery`.
`limit()` requires an ordering. Only generated columns for the selected Entity
may be used in its predicates.

The [reference](REFERENCE.md) documents the query builder and its column-safety
rules.

## ⚠️ Cleanup and limits

The client does not make a server safe for public access. Put the authenticated
application gateway at the network boundary. Commands are not retried
automatically, and an interrupted subscription must be recreated before the
application re-reads current entity state.

Node subscriptions use the same `createSubscription`, `activate`, and `cancel`
API as the browser client; see the [client-web reference](../client-web/REFERENCE.md)
for lifecycle and recovery limits. Close the client during process shutdown so
its owned HTTP/2 session and subscriptions can finish cleanup.

## 🔗 Learn more

- [Browser client](../client-web/README.md)
- [Server](../server/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
