# @spine-event-engine/client-node

Node transport factory and descriptor-backed Entity query foundations for Spine.

Browser/gateway behavior is documented in the
[browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md).

`Client.connectTo(url)` supplies a Node HTTP/2 transport to the shared
`@spine-event-engine/client-web` kernel and owns that session. `Client.usingTransport(transport)`
uses a caller-owned transport. Node is responsible only for that native
transport and request-ID source; request scopes, protocol operations, and
subscription lifecycle belong to the shared client.

```ts
import { Client } from "@spine-event-engine/client-node";
import { CreateTaskSchema } from "@example/tasks-proto/task_commands_pb";

const client = Client.connectTo("http://127.0.0.1:8080", { tenant: "tasks" });
await client.onBehalfOf("alice").post(CreateTaskSchema, { title: "Read client results" });
await client.close();
```

The public protocol verbs are `post`, `send`, `createSubscription`, `activate`,
and `cancel`. `send()` accepts a built Spine `Query`; `createSubscription()`
accepts a Spine `Topic`, returns an inactive handle, and `activate()` starts its
wire stream. Entity-column generation remains Node-only on the `./codegen`
subpath.
