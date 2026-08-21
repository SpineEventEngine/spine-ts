# Spine client for web browsers

Use this browser-safe package to post commands, send queries, and create Spine
subscriptions for query-side views. It is framework-neutral: React support is
in `@spine-event-engine/client-react`.

For protocol, browser-session, reconnect, and security limits, read the
[reference](REFERENCE.md).

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains application sign-in and gateway composition.

## Install and prepare an application

This is an experimental snapshot. In a browser application with its generated
Proto model already available, install the browser client explicitly:

```sh
pnpm add @spine-event-engine/client-web@2.0.0-snapshot.3
```

Before the first request, provide an application Gateway endpoint that permits
the browser origin, selects either gRPC-Web or binary Connect, and establishes
the application's cookie or bearer session. The Gateway resolves credentials
and authorizes requests; this package does not create it, sign users in, or
provide a model package. See the [reference](REFERENCE.md) for the complete
public contract.

## 💡 Why use it?

- ✅ Uses browser-compatible gRPC-Web or Connect transports.
- ✅ Posts commands and sends entity queries without a UI-framework dependency.
- ✅ Creates subscriptions with explicit activation and cancellation.
- ✅ Supports cookie or bearer session metadata supplied by the application.

## 🚀 Create a browser client

Choose the protocol deliberately. gRPC-Web is the portable browser choice.
Connect is an optional binary optimization for a gateway already configured to
accept it; the client does not probe or fall back between protocols.

<!-- docs-snippet-path: examples/message-board/web/src/index.tsx -->

```ts
import { BrowserSession, Client } from "@spine-event-engine/client-web";

const session = BrowserSession.cookie({ maxRequestMs: 10_000 });
const client = Client.forGrpcWeb("http://127.0.0.1:8080", {
  tenant: "tasks",
  credentials: session.credentials,
  onRequestMetadata: () => session.requestMetadata(),
});

await client.close();
await session.close();
```

Use `forGrpcWeb()` for a gRPC-Web Gateway. Use `forConnect()` only when that
Gateway is separately configured for binary Connect (`application/proto`);
neither factory probes or falls back to the other protocol. The endpoint above
is illustrative: the local application must actually expose the chosen browser
protocol and allow its origin.

## 📬 Post commands and send queries

Use an actor or guest request scope. Commands return an application outcome;
queries return the raw Spine response.

<!-- docs-snippet-path: examples/message-board/web/src/index.tsx -->

```ts
import { create } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { Client } from "@spine-event-engine/client-web";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { BoardMessageViewSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";

// BoardMessageViewSchema comes from this application's generated model; it is
// not an installable dependency of client-web.
const client = Client.forGrpcWeb("http://127.0.0.1:8080");
const request = client.onBehalfOf("alice");
const target = create(TargetSchema, {
  type: TypeUrls.derive(BoardMessageViewSchema),
  criterion: { case: "includeAll", value: true },
});
const query = create(QuerySchema, { id: create(QueryIdSchema, { value: "messages" }), target });
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: "messages" }),
  target,
  context: create(ActorContextSchema, { actor: { value: "alice" } }),
});
const response = await request.send(query);
const subscription = await request.createSubscription(topic, {
  kind: "entity",
  authoritativeQuery: () => query,
});
await subscription.activate();
await subscription.cancel();
console.log(response.message.length);
await client.close();
```

Commands are not retried. Pass an `AbortSignal` when application code needs to
cancel an admitted call.

Command validation belongs to the server. The browser client serializes the
submitted Proto value without enforcing its validation options locally, then
returns the server's `error` outcome. This lets a form display the same
validation messages as every other client instead of maintaining browser-only
rules.

## 🔄 Handle reconnects

Subscriptions are useful notifications, not complete history. After an Entity
reconnect, provide `authoritativeQuery` so the client can re-read current
state. Event subscriptions report that a gap may have occurred; they do not
replay missing events.

## ⚠️ Security and delivery limits

Connect the browser to an authenticated gateway, never directly to a trusted
backend. This package does not implement sign-in, choose an identity provider,
or store durable sessions. Commands are not retried, and subscription updates
may be duplicated, reordered, or missed while disconnected.

## 🔗 Learn more

- [React adapter](../client-react/README.md)
- [Authentication package](../auth/README.md)
- [Browser authentication and extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Detailed coding-agent reference](REFERENCE.md)
