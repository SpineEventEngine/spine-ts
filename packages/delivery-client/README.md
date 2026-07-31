# Client for the Spine Delivery server

This package is the Node client for the Delivery simple-server gRPC API. Use it
from a trusted application network to read inbox work and coordinate shards.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Connects a Node process to the in-memory Delivery simple server.
- ✅ Reads inbox work and current shard assignments.
- ✅ Observes later shard changes without polling.
- ✅ Adapts remote inbox and shard services to `DeliveryBuilder`.

## 🚀 Connect and read

Connect to an absolute HTTP(S) origin whose path is `/`. The client owns this
connection and `close()` ends its active reads and streams.

```ts
// docs-snippet-path: packages/delivery-client/src/client/client.ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

const client = DeliveryClient.connectTo("http://127.0.0.1:8484", { pageSize: 100 });
const shards = await client.shardSnapshot();
client.close();
void shards;
```

Read operations can use the configured bounded retry policy. Mutations never
retry automatically: a lost mutation response means the remote outcome is
unknown and must be reconciled before any later action.

```ts
// docs-snippet-path: packages/delivery-client/src/client/client.ts
import { DeliveryOutcomeUnknownError } from "@spine-event-engine/delivery-client";

try {
  // await client.writeOne(message);
} catch (error) {
  if (error instanceof DeliveryOutcomeUnknownError) {
    // Read the fact named by error.reconciliation; do not repeat the mutation.
  }
}
```

## 👀 Observe shards

Use a snapshot to establish current facts and an observation stream for later
hints. Cancel the stream when it is no longer needed.

```ts
// docs-snippet-path: packages/delivery-client/src/client/client.ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
const updates = client.observeShardUpdates({ timeoutMs: 5_000 });
for await (const update of updates) {
  console.log(update.shard, update.status);
  updates.cancel();
}
```

`RemoteInbox` and `RemoteWorkRegistry` adapt a client to a server
`DeliveryBuilder`. `RemoteInbox` requires caller-owned durable,
capacity-bounded removal quarantine storage so recovery cannot replay an
uncertain callback.

```ts
// docs-snippet-path: packages/delivery-client/src/remote/adapters.ts
import {
  DeliveryClient,
  type RemovalQuarantine,
  RemoteInbox,
  RemoteWorkRegistry,
} from "@spine-event-engine/delivery-client";
import { DeliveryBuilder } from "@spine-event-engine/server";

declare const quarantine: RemovalQuarantine;

const client = DeliveryClient.connectTo("http://127.0.0.1:8484");
const delivery = new DeliveryBuilder()
  .withNode("orders-worker")
  .withInbox(new RemoteInbox(client, quarantine))
  .withWorkRegistry(new RemoteWorkRegistry(client))
  .build();
client.close();
void delivery;
```

The quarantine must atomically store only a bounded record before callback
admission and before removal. An in-memory `Map` is suitable only for a test:
production recovery needs a durable, capacity-bounded implementation.

## ⚠️ Reconcile uncertain writes

Read operations may use the configured bounded retry policy. Mutations do not
retry automatically: if a response is lost, first read the named fact and
decide what happened. The protocol is unauthenticated and offers no durable
client state, exactly-once delivery, or renewable fencing.

## 🔗 Learn more

- [Delivery server](../delivery-server/README.md)
- [Server delivery APIs](../server/README.md#delivery-and-environment)
- [Reference for coding agents](REFERENCE.md)
