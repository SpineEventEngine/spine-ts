# Client for the Spine Delivery server

Use this Node client when an application node must coordinate delivery work with
a Delivery server on a trusted network. Start with the local server while
developing; use the same client to connect separate application nodes to a
remote Delivery server.

The [reference](REFERENCE.md) records the complete protocol, retry, and limit
contract, including API detail for coding agents.

This is an experimental snapshot package. Use Node 24 or newer and a reachable
Delivery server on a trusted network.

```sh
pnpm add @spine-event-engine/delivery-client@snapshot
```

## 💡 Why use it?

- ✅ Connects a Node process to a local or remote Delivery server.
- ✅ Reads inbox work and current shard assignments.
- ✅ Observes later shard changes without polling.
- ✅ Adapts remote inbox and shard services to `DeliveryBuilder`.

## 🚀 Connect and read

Connect to an absolute HTTP(S) origin whose path is `/`. The client manages this
connection and `close()` ends its active reads and streams.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

const client = DeliveryClient.connectTo("http://127.0.0.1:8484", { pageSize: 100 });
const shards = await client.shardSnapshot();
client.close();
void shards;
```

Read operations can use the configured bounded retry policy. Mutations never
retry automatically: a lost mutation response means the remote outcome is
unknown and must be reconciled before any later action.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
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

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
const updates = client.observeShardUpdates({ timeoutMs: 5_000 });
for await (const update of updates) {
  console.log(update.shard, update.status);
  updates.cancel();
}
```

Here `timeoutMs` bounds setup through the first acknowledgement only; it never
ends an acknowledged observation stream.

`RemoteInbox` and `RemoteWorkRegistry` adapt a client to a server
`DeliveryBuilder`. The authoritative delivery state is the remote Inbox row and
the current shard lease; the client keeps no local removal record. A delivered
row is the deduplication fact, but a handler effect and its acknowledgement are
not one transaction. If an acknowledgement is lost, delivery can happen again
after restart, so make downstream effects idempotent.

<!-- docs-snippet-path: packages/delivery-client/src/remote/adapters.ts -->

```ts
import {
  DeliveryClient,
  RemoteInbox,
  RemoteWorkRegistry,
} from "@spine-event-engine/delivery-client";
import { DeliveryBuilder } from "@spine-event-engine/server";

const client = DeliveryClient.connectTo("http://127.0.0.1:8484");
const delivery = new DeliveryBuilder()
  .withNode("orders-worker")
  .withInbox(new RemoteInbox(client))
  .withWorkRegistry(new RemoteWorkRegistry(client))
  .build();
client.close();
void delivery;
```

For server assembly, pass one `RemoteDelivery` to the environment instead of
manually wiring adapters. Each attached environment gets a bounded Admin
snapshot and later shard-update hints; after a stream loss or bounded-buffer
overflow it takes a fresh snapshot before resuming updates. Inbox rows and the
exclusive shard session remain authoritative, so notifications are best-effort
wake-ups. `open()` runs before the first attachment/listener admission. A
failed bounded readiness check closes its fresh client and can be retried.

When identically configured application nodes share a Delivery server, every
node observes and attempts each reported shard. The remote registry admits one
owner for a shard at a time; updates are only hints recovered through a bounded
snapshot, and the facility makes no ordering promise across different shards.
The winning owner repeats finite Inbox drains until no deliverable rows remain,
including rows that arrive while a drain is active, before it releases the
shard. A pre-commit ownership probe fences known stale owners, but it is not a
linearizable distributed transaction with Entity storage.

<!-- docs-snippet-path: packages/delivery-client/src/remote/remote-delivery.ts -->

```ts
import { RemoteDelivery } from "@spine-event-engine/delivery-client";

const delivery = RemoteDelivery.connectTo({ endpoint: "https://delivery.example.test" });
void delivery;
```

## ⚠️ Design for redelivery

Read operations may use the configured bounded retry policy. Mutations do not
retry automatically: if a response is lost, first read the named fact and
decide what happened. The protocol is unauthenticated and offers no durable
client state, exactly-once effects, or renewable fencing. It does not persist
attempt history or quarantine records.

## 🔗 Learn more

- [Delivery server](../delivery-server/README.md)
- [Server delivery APIs](../server/README.md#delivery-and-environment)
- [Detailed delivery reference](REFERENCE.md)
