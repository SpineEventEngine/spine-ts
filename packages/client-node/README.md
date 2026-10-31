# Spine client for Node.js

Use this package from a Node.js ESM application to post commands, send queries,
or create subscriptions for query-side views. It manages the Node HTTP/2 transport;
the request and subscription API is shared with the browser client.

This is an experimental snapshot. Install the snapshot explicitly while its API
and packaging continue to evolve:

```sh
pnpm add @spine-event-engine/client-node@snapshot
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
service. For the concrete Message Board workspace walkthrough, clone this
repository, run `pnpm install --frozen-lockfile && pnpm typecheck:build`, then
start `pnpm --dir examples/message-board/app start`. That command starts the
single-tenant local service at `http://127.0.0.1:8090`.

The imports below are the Message Board workspace model contract: its
`package.json` exports compiled `generated/*.js` modules after the setup above.
They are not an installable dependency for an external application. In your
application, depend on your own generated model package and replace this model
package name and generated export paths with the ones declared by its
`package.json` and `spine-proto.json`.

Create one client for the component that manages the connection. A client from
`connectTo()` creates its HTTP/2 session, so always close it.

<!-- docs-snippet-path: examples/message-board/app/src/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-node";
import { Time } from "@spine-event-engine/core/time";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import {
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";

const client = Client.connectTo("http://127.0.0.1:8090");
const request = client.onBehalfOf("alice");
const result = await request.post(
  PostMessageSchema,
  create(PostMessageSchema, {
    id: create(MessageIdSchema, { value: "message-1" }),
    board: create(BoardIdSchema, { value: "general" }),
    author: create(UserIdSchema, { value: "alice" }),
    username: "Alice",
    text: "Hello, Message Board.",
    postedAt: Time.currentTime(),
  }),
);
if (result.kind !== "ok") throw new Error(`Message was not accepted: ${result.kind}`);
await client.close();
```

The URL is an application gateway URL. It is not an instruction to expose a
Spine server directly to the internet. A successful call is an observation that
the local service accepted the command; handle admission failures and observe the relevant Events or rejections when
your application needs to know the processing outcome.

## Receive Events and rejections after a Command

The returned request also provides `postAndSubscribe(schema, command, options)`.
It activates every selected Event/rejection subscription, posts once, then
returns an accepted/refused result. On acceptance, consume the returned
subscription's continuing `updates` stream. Several types may be selected;
receiving one update does not close the subscription.

`activationTimeoutMs` and `firstUpdateTimeoutMs` are optional, with no defaults.
The first-update callback is named `onFirstUpdateTimeout`; it notifies once and
allows late updates to arrive. See the [complete browser-safe API examples](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-web/README.md#observe-command-outcomes)
for the same request methods and non-blocking update consumers. Change client
construction to `Client.connectTo()` for native Node transport.

The runnable [Todo smoke client](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/todo/scripts/smoke.mjs) uses
this API for actual Commands, multiple Events, and rejections, then checks the
TaskList Projection. Run it using the [Todo instructions](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/todo/README.md).

## 🔎 Query generated entities

`request.query(generatedQ)` also executes an application-defined query. Import
the model package's ordinary Proto-module entry first so its generated Query
and Response schemas are registered. The result contains the wire `Response`
and a readonly array with zero or one decoded paired response. The shared
[browser client reference](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-web/REFERENCE.md) describes the same
type inference, protocol errors, and cancellation behavior for Node.

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
automatically. Entity subscriptions use their authoritative query after
reconnection; Event subscriptions report possible gaps without replay.

Node subscriptions use the same `createSubscription`, `postAndSubscribe`,
`activate`, and `cancel` API as the browser client; see the [client-web reference](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-web/REFERENCE.md)
for lifecycle and recovery limits. Close the client during process shutdown so
its HTTP/2 session and subscriptions can finish cleanup. If closure rejects
because remote cleanup failed, inspect `client.cleanupFailures` and retry
`close()` explicitly. The session remains available for that retry.

## 🔗 Learn more

- [Browser client](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-web/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
