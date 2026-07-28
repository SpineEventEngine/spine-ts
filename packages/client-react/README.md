# @spine-event-engine/client-react

`@spine-event-engine/client-react` observes an application-owned public
`@spine-event-engine/client-web` request scope in React. React is a peer
dependency. This package owns neither a cache nor request construction, SSR,
Suspense, service workers, or an external state manager.

## Query observation

Create the browser client and request scope outside render, then provide the
stable scope. A query starts in an effect, so rendering itself starts no RPC.

```ts
import { createElement } from "react";
import { Client } from "@spine-event-engine/client-web";
import { SpineClientProvider, useEntityQuery } from "@spine-event-engine/client-react";

const client = Client.forGrpcWeb("https://api.example.test");
const request = client.asGuest();

function MessageList() {
  const result = useEntityQuery(() => buildMessageQuery(), []);
  return createElement("output", undefined, result.status);
}

function App() {
  return createElement(SpineClientProvider, { request }, createElement(MessageList));
}

declare function buildMessageQuery(): Parameters<typeof request.send>[0];
void App;
```

`useEntityQuery` forwards each effect generation's `AbortSignal` to the public
`request.send(query, { signal })` call. For a generic `useRequest` factory,
accept and forward its required signal to the cancellable operation. Cancellation
is cooperative: a factory that does not forward the signal can continue its
underlying work, though a retired generation never publishes its result. As
with every hook dependency list, callers remain responsible for supplying the
dependencies that make their factory stable.

## Subscription observation

The subscription factory runs after commit. It must call only the public
client-web API. Entity recovery is authoritative: client-web evaluates the
provided `authoritativeQuery` after reconnect and emits a `resynchronization`
delivery. Event subscriptions instead publish `gapPossible`; that notice is
not event-history completeness evidence.

```ts
import { useEntitySubscription, useSubscriptionDelivery } from "@spine-event-engine/client-react";
import type { ClientRequest } from "@spine-event-engine/client-web";

declare const messageTopic: Parameters<ClientRequest["createSubscription"]>[0];
declare const authoritativeMessageQuery: Extract<
  Parameters<ClientRequest["createSubscription"]>[1],
  { kind: "entity" }
>["authoritativeQuery"];

function Updates() {
  const observation = useEntitySubscription(messageTopic, authoritativeMessageQuery, []);
  const delivery = useSubscriptionDelivery(observation);
  return `${observation.status}:${delivery?.kind ?? "none"}`;
}

void Updates;
```

Unmounting retires the hook generation and invokes bounded, idempotent
`cancel()` cleanup. A late request result, subscription factory result,
activation completion, delivery, lifecycle notice, or iterator failure from a
retired generation is not published. React Strict Mode mount/unmount/remount
therefore activates at most once for each still-live generation.
