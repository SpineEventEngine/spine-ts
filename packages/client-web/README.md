# Spine client for web browsers

Use this browser-safe package to post commands, send queries, and create Spine
subscriptions for query-side views. It is framework-neutral: React support is
in `@spine-event-engine/client-react`.

For protocol, browser-session, reconnect, and security limits, read the
[reference](REFERENCE.md).

The [browser client and gateway guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains application sign-in and gateway composition.

## Install and prepare an application

This is an experimental snapshot. In a browser application with its generated
Proto model already available, install every package imported by the browser
examples explicitly:

```sh
pnpm add @bufbuild/protobuf@2.12.1 @spine-event-engine/core@snapshot @spine-event-engine/proto@snapshot @spine-event-engine/client-web@snapshot
```

Generate your application's model from its authored Proto sources with the
[Proto tools guide](https://github.com/SpineEventEngine/spine-ts/tree/master/packages/proto-tools#readme), then import its published
schemas from your own model package. The Message Board schema used below is a
repository example of that application-owned output, not a package to install.

Before the first request, provide an application Gateway endpoint that permits
the browser origin, selects either gRPC-Web or binary Connect, and establishes
the application's cookie or bearer session. The Gateway resolves credentials
and authorizes requests; this package does not create it, sign users in, or
provide a model package. See the [reference](REFERENCE.md) for the complete
public contract.

## 💡 Why use it?

- ✅ Uses browser-compatible gRPC-Web or Connect transports.
- ✅ Posts commands and sends entity queries without a UI-framework dependency.
- ✅ Executes generated application queries and decodes their paired results.
- ✅ Creates subscriptions with explicit activation and cancellation.
- ✅ Supports cookie or bearer session metadata supplied by the application.

## 🚀 Create a browser client

Choose the protocol deliberately. gRPC-Web is the portable browser choice.
Connect is an optional binary optimization for a gateway already configured to
accept it; the client does not probe or fall back between protocols.

<!-- docs-snippet-path: examples/message-board/web/src/docs/client-web-create-client.ts -->

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

Use an actor or guest request scope. Commands return an acknowledgement of
acceptance; queries return the raw Spine response. Events and rejections from
Command processing are its outcomes.

<!-- docs-snippet-path: examples/message-board/web/src/docs/client-web-request-subscription.ts -->

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
returns the server's `error` acknowledgement. This lets a form display the same
validation messages as every other client instead of maintaining browser-only
rules.

## Observe Command outcomes

Use `postAndSubscribe` when you need to observe Events or rejections caused by
a Command. It activates the selected subscriptions before posting, so a fast
outcome can arrive safely before the posting acknowledgement. Both `events`
and `rejections` accept several generated schemas.

This example receives a generated Message Board Command from application code.
It keeps listening after the first update; application code decides when to
call `subscription.cancel()`. The actual [Message Board form](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/message-board/web/src/post-form.tsx)
uses the same API and cancels after it handles its post's outcome.

<!-- docs-snippet-path: examples/message-board/web/src/post-form.tsx -->

```ts
import { AnyPacker } from "@spine-event-engine/core";
import { Client, type Subscription } from "@spine-event-engine/client-web";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";

const client = Client.forGrpcWeb("http://127.0.0.1:8090");
const request = client.onBehalfOf("alice");

async function postMessage(command: PostMessage): Promise<Subscription | undefined> {
  const result = await request.postAndSubscribe(PostMessageSchema, command, {
    events: [MessagePostedSchema],
    rejections: [MessageAlreadyPostedSchema],
    activationTimeoutMs: 3_000,
    firstUpdateTimeoutMs: 10_000,
    onFirstUpdateTimeout: () => {
      console.info("Still waiting for confirmation. The subscription remains active.");
    },
  });
  if (result.kind === "refused") {
    console.error("Command was not accepted:", result.acknowledgement);
    return undefined;
  }
  console.info("Command accepted; its outcomes arrive separately.");
  void receiveUpdates(result.subscription).catch(console.error);
  void observeLifecycle(result.subscription).catch(console.error);
  return result.subscription;
}

async function receiveUpdates(subscription: Subscription): Promise<void> {
  for await (const delivery of subscription.updates) {
    if (delivery.kind !== "update" || delivery.update.update.case !== "eventUpdates") continue;
    for (const event of delivery.update.update.value.event) {
      if (event.message === undefined) continue;
      const posted = AnyPacker.tryUnpack(event.message, MessagePostedSchema);
      const rejected = AnyPacker.tryUnpack(event.message, MessageAlreadyPostedSchema);
      if (posted !== undefined) console.info("Message posted:", posted.text);
      if (rejected !== undefined) console.info("Message was already posted:", rejected.id);
    }
  }
}

async function observeLifecycle(subscription: Subscription): Promise<void> {
  for await (const notice of subscription.lifecycle) {
    if (notice.state === "failed" || notice.state === "notificationFailed") {
      console.error(notice.error);
    }
  }
}

// Call postMessage(command).catch(...) from a user action.
// Keep its returned handle and await handle.cancel() when observation ends.
// Await client.close() when the application releases this connection.
void postMessage;
```

`postMessage()` rejects on activation, protocol, or transport failure; handle
that error at the user action. The `for await` loops suspend only their
asynchronous functions while waiting. The browser remains responsive, and the
caller receives the subscription without waiting for the loops to finish.

The example's three- and ten-second values are application choices.
**Neither timeout has a default.** Activation timeout prevents posting if setup
is not ready. First-update timeout calls the notification once and leaves the
subscription active. The first matching update clears it at receipt; there is
no timeout between subsequent updates. A rejection counts as an update. The
callback can accept the subscription argument and explicitly cancel it if that
is the application's policy.

A successful acknowledgement means acceptance, not completed processing. A
missing update does not prove failure. The helper never reposts a Command
or replays Events. It matches the immediate Command Origin using Spine JVM's
full comparison, including the actor context.

## Observe several Event types without posting

An ordinary subscription uses the same timing options and continuing updates:

<!-- docs-snippet-path: examples/message-board/web/src/post-form.tsx -->

```ts
import { Client } from "@spine-event-engine/client-web";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";

const client = Client.forGrpcWeb("http://127.0.0.1:8090");
const request = client.onBehalfOf("alice");
const subscription = await request.createSubscription(
  [MessagePostedSchema, MessageAlreadyPostedSchema],
  {
    kind: "event",
    firstUpdateTimeoutMs: 10_000,
    onFirstUpdateTimeout: () => console.info("No update yet; still listening."),
  },
);

async function start(): Promise<void> {
  await subscription.activate({ activationTimeoutMs: 3_000 });
  for await (const update of subscription.updates) console.info(update);
}

void start().catch(console.error);
// Keep the UI running. Its stop action can await subscription.cancel().
// The application closes client when it releases this connection.
```

This observes those types generally. `postAndSubscribe` additionally selects
outcomes caused by its particular Command. All selected types share one logical
subscription; readiness requires every member, and a terminal member failure
ends the group. No total ordering is promised across separate Event streams.

If remote cleanup fails, retry `subscription.cancel()` or `client.close()`.
`client.cleanupFailures` exposes retained errors even when failed setup never
returned a handle. A failed `client.close()` keeps its transport available for
retry and continues to reject new work.

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

- [React adapter](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/client-react/README.md)
- [Authentication package](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/auth/README.md)
- [Browser authentication and extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Detailed coding-agent reference](REFERENCE.md)
