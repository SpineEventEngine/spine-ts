# React adapter for the Spine browser client

Use this optional React adapter to observe work started through an
application-owned `@spine-event-engine/client-web` request scope. It does not
create clients, define queries, cache data, or provide an authentication system.

For detailed hook lifecycles and error behavior, read the [reference for
agents](REFERENCE.md).

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains the subscription and authentication limits inherited from the browser client.

## 💡 Why use it?

- ✅ Provides a stable Spine request scope to a React tree.
- ✅ Runs queries with familiar React loading, success, and error states.
- ✅ Starts and cancels subscriptions with the component lifecycle.
- ✅ Keeps the framework-neutral browser client free of React dependencies.

## 🚀 Provide a request scope

Create the browser client outside rendering, select an actor scope, and provide
that stable scope to React descendants.

```ts
import { createElement } from "react";
import { Client } from "@spine-event-engine/client-web";
import { SpineClientProvider, useEntityQuery } from "@spine-event-engine/client-react";

const client = Client.forGrpcWeb("https://api.example.test");
const request = client.onBehalfOf("alice");

function Tasks() {
  const result = useEntityQuery(() => buildTaskQuery(), []);
  return createElement("output", undefined, result.status);
}

function App() {
  return createElement(SpineClientProvider, { request }, createElement(Tasks));
}

declare function buildTaskQuery(): Parameters<typeof request.send>[0];
void App;
```

`use...` names are reserved for this React adapter because each one is a React
hook. Application code otherwise uses the client verbs such as `post`, `send`,
`createSubscription`, `activate`, and `cancel`.

## 🔔 Observe a subscription

An Entity subscription needs an authoritative query for reconnect recovery.
The hook starts and cancels it after React commits the component.

```ts
// docs-snippet-path: examples/chat/web/src/index.tsx
import { create } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { useEntitySubscription, useSubscriptionDelivery } from "@spine-event-engine/client-react";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { ChatMessageViewSchema } from "@spine-event-engine/example-chat-model/generated/spine/examples/chat/chat_pb.js";

const target = create(TargetSchema, {
  type: TypeUrls.derive(ChatMessageViewSchema),
  criterion: { case: "includeAll", value: true },
});
const query = create(QuerySchema, { id: create(QueryIdSchema, { value: "messages" }), target });
const topic = create(TopicSchema, { id: create(TopicIdSchema, { value: "messages" }), target });

function TaskUpdates() {
  const observation = useEntitySubscription(topic, () => query, []);
  const delivery = useSubscriptionDelivery(observation);
  return `${observation.status}:${delivery?.kind ?? "none"}`;
}

void TaskUpdates;
```

## ⚠️ What stays in application code

This adapter is not a cache, router, state manager, or authentication system.
The application creates the browser client, chooses when a user is signed in,
and decides how query results appear in the UI. Subscription hooks still follow
the browser client’s reconnect rule: re-read authoritative entity state after
a possible gap.

## 🔗 Learn more

- [Browser client](../client-web/README.md)
- [Chat web example](../../examples/chat/web/README.md)
- [Reference for coding agents](REFERENCE.md)
