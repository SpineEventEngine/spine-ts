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

Read operations can use the configured retry policy. If a managed pickup reply
is lost, `pickUpForDelivery()` retries with the same worker and run ID within
the original deadline. For a lost inbox write reply, read the affected message to
learn whether the write succeeded before deciding what to do next.
Inbox receipts and `sinceWhen` page anchors use Protobuf `Timestamp` values,
preserving seconds and nanoseconds. `readPage` calls the JVM
`InboxService.FindManyInShard` RPC with an exclusive timestamp bound.

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

## Shards with pending work

Open `observeAvailableShards()` to receive a shard index whenever the Delivery
server has a free shard with pending work. A newly connected client also learns
about work already waiting. An idle call can stay silent indefinitely.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
declare const shutdown: AbortSignal;

for await (const shard of client.observeAvailableShards({ signal: shutdown })) {
  console.log("Work is waiting in shard", shard.index, "of", shard.ofTotal);
}
```

This low-level call opens one stream. Starting a fresh call after a disconnect
discovers the free shards again. Several clients can receive the same index, so
a worker must still request pickup before processing a message.

## 👀 Shard state for Admin

For a live Admin view, read updates as soon as the stream opens. It sends
the known shards first and keeps sending changes. For a one-time report,
use `shardSnapshot()` separately. The stream reads at the pace of its consumer.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient, type RemoteShardObservation } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
declare const shutdown: AbortSignal;
declare function reportDashboardError(error: unknown): void;
declare function showLive(rows: ReadonlyMap<string, RemoteShardObservation>, stale: boolean): void;

async function showAdmin(): Promise<void> {
  const live = new Map<string, RemoteShardObservation>();
  showLive(live, true);
  const updates = client.observeShardUpdates({ signal: shutdown, timeoutMs: 5_000 });
  try {
    for await (const update of updates) {
      const key = `${update.shard.index}/${update.shard.ofTotal}`;
      live.set(key, update);
      showLive(live, false);
    }
  } catch (error) {
    showLive(live, true);
    throw error;
  } finally {
    updates.cancel();
  }
}

await showAdmin().catch(reportDashboardError);
```

Call `showAdmin()` again after a failure to build a fresh live view. The client
defaults to no hidden Admin reconnects, so a failed stream reaches the caller.
Here `timeoutMs` bounds setup through the first acknowledgement only; it never
ends an acknowledged observation stream. Keep the snapshot and live view
separate so a slower snapshot response cannot overwrite a newer live update.

Use `DeliveryBuilder.remote({ endpoint })` to connect an application to the
Delivery server. During startup each node opens `ShardObservingService.ObserveAll`.
If shard 3 already contains a pending Command, a new node can take that shard
and run the handler. If the inbox is empty, startup finishes with the stream
open and silent. The server repeats a notice for free, unclaimed work after
ten seconds by default. Further writes do not postpone the reminder.

For a node that should process at most two shards concurrently:

<!-- docs-snippet-path: packages/delivery-client/src/remote/delivery-builder.ts -->

```ts
import { DeliveryBuilder } from "@spine-event-engine/delivery-client";

const delivery = DeliveryBuilder.remote({
  endpoint: "https://delivery.example.test",
  notifications: { kind: "delivery-server", maxConcurrentDeliveries: 2 },
});
void delivery;
```

With no `maxConcurrentDeliveries`, the node can process distinct shards in
parallel. Two calls to `environment.delivery.deliverMessagesFrom(shard)` on
that node for the same shard share one delivery attempt. An independent write
of another Command to that shard always stores its inbox message.

When an application uses its own shared database for the inbox, it can use
`DeliveryBuilder.local({ storageFactory, shardObserver })` to notify nodes
through its own queue. For a complete publisher and consumer example, see
[running and observation](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/USER_GUIDE.md#8-running-and-observation).

## ⚠️ Design for redelivery

A session renewal permits the worker to continue processing its shard.
If a connection fails after a handler saves its result but before the inbox message
is acknowledged, another worker may invoke that handler again. Keep this case
in mind when a handler calls an external service.

## 🔗 Learn more

- [Delivery server](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/delivery-server/README.md)
- [Server delivery APIs](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md#native-lifecycle-and-routing)
- [Detailed delivery reference](REFERENCE.md)
