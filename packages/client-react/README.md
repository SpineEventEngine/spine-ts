# React adapter for the Spine browser client

Use this optional React adapter to observe query-side views and subscriptions
through an `@spine-event-engine/client-web` request scope supplied by the application. It
does not create clients, define queries, cache data, or provide an authentication
system.

For detailed hook lifecycles and error behavior, read the [reference](REFERENCE.md).

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains the subscription and authentication limits inherited from the browser client.

## Install and prepare an application

This is an experimental snapshot. Install React and its type package as peers,
then install both Spine client packages in an application that already owns a
generated Proto model. Include every direct import used by the examples:

```sh
pnpm add react@^19.2.8 @types/react@^19.2.7
pnpm add @bufbuild/protobuf@2.12.1 @spine-event-engine/core@2.0.0-snapshot.3 @spine-event-engine/proto@2.0.0-snapshot.3 @spine-event-engine/client-web@2.0.0-snapshot.3 @spine-event-engine/client-react@2.0.0-snapshot.3
```

Generate and publish the application's model schemas using the [Proto tools
guide](../proto-tools/README.md). The Message Board schema in this guide is a
repository example of such output; it is not a public dependency to install.

The application, not React, creates the authenticated Gateway connection and
chooses its session policy. Keep the `Client` outside React rendering and close
it when the application unmounts or shuts down. See the [reference](REFERENCE.md)
for hook and cleanup details.

## 💡 Why use it?

- ✅ Provides a stable Spine request scope to a React tree.
- ✅ Runs queries with familiar React loading, success, and error states.
- ✅ Starts and cancels subscriptions with the component lifecycle.
- ✅ Keeps the framework-neutral browser client free of React dependencies.

## 🚀 Provide a request scope

Create the browser client outside rendering, select an actor scope, and provide
that stable scope to React descendants.

<!-- docs-snippet-path: examples/message-board/web/src/docs/client-react-provider-query.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { SpineClientProvider, useEntityQuery } from "@spine-event-engine/client-react";
import { Client } from "@spine-event-engine/client-web";
import { BoardMessageViewSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { QueryIdSchema, QuerySchema, TargetSchema } from "@spine-event-engine/proto/client";
import { createElement } from "react";

const client = Client.forGrpcWeb("http://127.0.0.1:8080");
const request = client.onBehalfOf("alice");

const taskQuery = () =>
  create(QuerySchema, {
    id: create(QueryIdSchema, { value: "messages" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(BoardMessageViewSchema),
      criterion: { case: "includeAll", value: true },
    }),
  });

function Tasks() {
  const result = useEntityQuery(taskQuery, []);
  return createElement("output", undefined, result.status);
}

function App() {
  return createElement(SpineClientProvider, { request }, createElement(Tasks));
}

async function stopApplication() {
  await client.close();
}

void App;
void stopApplication;
```

Call `stopApplication()` from the application's unmount or shutdown path. The
schema import is an application-generated model contract, not an installable
Message Board package.

`use...` names are reserved for this React adapter because each one is a React
hook. Application code otherwise uses the client verbs such as `post`, `send`,
`createSubscription`, `activate`, and `cancel`.

## 🔔 Observe a subscription

An Entity subscription needs an authoritative query for reconnect recovery.
The hook starts and cancels it after React commits the component.

<!-- docs-snippet-path: examples/message-board/web/src/docs/client-react-subscription.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { useEntitySubscription, useSubscriptionDelivery } from "@spine-event-engine/client-react";
import { BoardMessageViewSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";

const target = create(TargetSchema, {
  type: TypeUrls.derive(BoardMessageViewSchema),
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
- [Message Board web example](../../examples/message-board/web/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
