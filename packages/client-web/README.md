# @spine-event-engine/client-web

`@spine-event-engine/client-web` is the framework-neutral, browser-safe Spine
protocol client. It exposes the same command, raw-query, and subscription
facade as the Node client without importing Node, React, or generated Entity
column helpers.

## Create a browser client

Choose the wire protocol explicitly. gRPC-Web is the universal browser route;
Connect is an optional optimization for an endpoint that is separately known to
support Connect. There is no protocol probe or fallback.

```ts
import { Client, type BrowserClientOptions } from "@spine-event-engine/client-web";

const options: BrowserClientOptions = {
  tenant: "tasks",
  onRequestMetadata: () => ({ authorization: "Bearer application-owned-token" }),
};

// Local names make the explicit protocol choice visible at composition time.
const createGrpcWebClient = (baseUrl: string) => Client.forGrpcWeb(baseUrl, options);
const createConnectClient = (baseUrl: string) => Client.forConnect(baseUrl, options);

const grpcWebClient = createGrpcWebClient("https://api.example.test");
const connectClient = createConnectClient("https://connect.example.test");
await Promise.all([grpcWebClient.close(), connectClient.close()]);
```

`onRequestMetadata` is called synchronously for every outbound call. It returns
fresh application-owned headers; the client neither logs them nor includes them
in request IDs. Browser request IDs prefer `crypto.randomUUID()`, otherwise use
`crypto.getRandomValues()` to create a UUID v4, and fail before a transport call
when secure Web Crypto is unavailable. Credential, session, and identity
provider policy remains the application’s responsibility.

The browser factories create and select their Connect-Web transport, but that
source has no platform-transport close hook. `client.close()` closes owned
subscription work; an injected `ClientTransport` closes a platform resource
only when that source supplies its optional `close()` hook.

## Commands and raw queries

`post()` returns a `ClientOutcome`; `send()` returns the raw validated
`QueryResponse`. Commands are never retried. A caller signal or `client.close()`
aborts admitted work; ordinary transport/deadline errors remain transport
errors.

```ts
import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-web";
import { CreateTaskSchema } from "@example/tasks-proto/task_commands_pb";
import { QuerySchema } from "@spine-event-engine/proto/client";

const client = Client.forGrpcWeb("https://api.example.test", { tenant: "tasks" });
const actor = client.onBehalfOf("alice");
const posted = await actor.post(
  CreateTaskSchema,
  create(CreateTaskSchema, { title: "First task" }),
);
const response = await actor.send(create(QuerySchema));
if (posted.kind === "ok") console.log(response.message.length);
await client.close();
```

## Subscriptions and recovery

`createSubscription()` only creates the local handle. `activate()` performs
`Subscribe` and starts the remote stream; `cancel()` is terminal, ends both
local iterators, and performs at most one bounded remote `Cancel` for each
accepted wire (a reconnect can therefore clean several wires). Each remote
cleanup is bounded to 1,000 ms per accepted wire. `close()` is also terminal
for every subscription owned by the client. Before any other terminal state, a
normal explicit cancel/close emits exactly one `{ state: "closed", generation
}` lifecycle notice before lifecycle iteration completes. A non-overflow
non-retryable error or exhausted retry budget emits exactly one `{ state:
"failed", generation, error }` notice before both streams fail. Queue overflow
instead fails both streams directly with the same overflow error; it does not
enqueue `failed`.

Updates and lifecycle are independent single-consumer streams: there is no
cross-stream ordering guarantee. The default update queue is 64 deliveries and
1,048,576 bytes; the lifecycle queue is 32 notices. Every capacity must be a
positive safe integer. Overflow is terminal and never silently drops a
delivery.

Retries start only after the initial attempt. Defaults permit five retry
attempts and 30,000 ms total elapsed recovery time. The default delay is a
250 ms exponential base with ±20% jitter, capped at 5,000 ms (and never below
1 ms). Custom retry attempts, elapsed time, queue capacities, scheduler values,
and returned custom delays must be positive safe integers (the scheduler clock
is non-negative). Lifecycle generations increase for each reconnect attempt:
`connecting` identifies the generation and retry attempt, then successful
recovery reaches `connected`.

```ts
import { create } from "@bufbuild/protobuf";
import { deriveTypeUrl } from "@spine-event-engine/core";
import { Client } from "@spine-event-engine/client-web";
import {
  QueryIdSchema,
  QuerySchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { TaskListSchema } from "@example/tasks-proto/task_list_pb";

const client = Client.forGrpcWeb("https://api.example.test", { tenant: "tasks" });
const target = create(TargetSchema, {
  type: deriveTypeUrl(TaskListSchema),
  criterion: { case: "includeAll", value: true },
});
const query = create(QuerySchema, {
  id: create(QueryIdSchema, { value: "task-list-query" }),
  target,
});
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: "task-list-topic" }),
  target,
});
const subscription = await client.onBehalfOf("alice").createSubscription(topic, {
  kind: "entity",
  authoritativeQuery: () => query, // a { build(): Query } value is also accepted
});
await subscription.activate();
await subscription.cancel();
await client.close();
```

Event reconnection announces `connecting`, then `gapPossible`, then
`connected` and continues. `gapPossible` is a notification, not replay or
completeness evidence: event gaps remain possible, and no cluster-complete
delivery guarantee exists. Entity reconnection instead evaluates
`authoritativeQuery` only during recovery, requires its target to be
byte-equivalent to the Topic target, replaces only its request context, emits
`resynchronizing`, delivers the successful raw `QueryResponse` as
`{ kind: "resynchronization", response }` before held wire updates, then emits
`connected`. Re-query authoritative entity state when an Entity subscription
reconnects; do not infer an Event history from the notification.

```ts
import { create } from "@bufbuild/protobuf";
import { deriveTypeUrl } from "@spine-event-engine/core";
import { Client } from "@spine-event-engine/client-web";
import { TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { TaskCreatedSchema } from "@example/tasks-proto/task_events_pb";

const client = Client.forGrpcWeb("https://api.example.test", { tenant: "tasks" });
const eventTopic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: "task-created" }),
  target: create(TargetSchema, {
    type: deriveTypeUrl(TaskCreatedSchema),
    criterion: { case: "includeAll", value: true },
  }),
});
const event = await client.onBehalfOf("alice").createSubscription(eventTopic, { kind: "event" });
const lifecycle = event.lifecycle[Symbol.asyncIterator]();
const updates = event.updates[Symbol.asyncIterator]();
await event.activate();
const firstLifecycleNotice = await lifecycle.next(); // connecting
const firstDelivery = await updates.next(); // { kind: "update", update } when available
await event.cancel();
await client.close();
void firstLifecycleNotice;
void firstDelivery;
```

Signals and scheduler lifecycle are application responsibilities: pass an
`AbortSignal` to `post`, `send`, or `activate` for one operation, and provide a
deterministic scheduler only when the application owns retry timing. Neither
signals nor a scheduler create a durable cursor, cache, replay log, or
cross-stream ordering contract.
