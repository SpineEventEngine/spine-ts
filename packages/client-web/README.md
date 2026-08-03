# Spine client for web browsers

Use this browser-safe package to post commands, send queries, and create Spine
subscriptions for query-side views. It is framework-neutral: React support is
in `@spine-event-engine/client-react`.

For detailed protocol, browser-session, reconnect, and security limits, read
the [reference for agents](REFERENCE.md).

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains application-owned sign-in and gateway composition.

## 💡 Why use it?

- ✅ Uses browser-compatible gRPC-Web or Connect transports.
- ✅ Posts commands and sends entity queries without a UI-framework dependency.
- ✅ Creates subscriptions with explicit activation and cancellation.
- ✅ Supports cookie or bearer session metadata supplied by the application.

## 🚀 Create a browser client

Choose the protocol deliberately. gRPC-Web is the portable browser choice.
Connect is an optional binary optimization for a gateway already configured to
accept it; the client does not probe or fall back between protocols.

```ts
import { BrowserSession, Client } from "@spine-event-engine/client-web";

const session = BrowserSession.cookie({ maxRequestMs: 10_000 });
const client = Client.forGrpcWeb("https://api.example.test", {
  tenant: "tasks",
  credentials: session.credentials,
  onRequestMetadata: () => session.requestMetadata(),
});

await client.close();
await session.close();
```

The endpoint should be an application gateway. Applications own sign-in,
identity-provider redirects, session exchange, and authorization policy.

## 📬 Post commands and send queries

Use an actor or guest request scope. Commands return an application outcome;
queries return the raw Spine response.

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

const client = Client.forGrpcWeb("https://api.example.test");
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
- [Reference for coding agents](REFERENCE.md)
